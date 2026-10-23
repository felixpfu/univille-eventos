import { randomUUID } from "node:crypto";
import { createToken, tokenHash } from "./security.js";
import { fail, getEvent } from "./domain.js";
import { transaction } from "./db.js";

const DAY = 24 * 60 * 60 * 1000;
const DEFAULTS = { publications: false, reminders: false, courseId: null };
const enabled = (preference) =>
  Boolean(preference.publications || preference.reminders);
const normalizedEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

export function initNotificationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notificationPreferences (
      userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      publications INTEGER NOT NULL DEFAULT 0 CHECK(publications IN (0,1)),
      reminders INTEGER NOT NULL DEFAULT 0 CHECK(reminders IN (0,1)),
      courseId TEXT REFERENCES courses(id) ON DELETE SET NULL,
      verifiedEmail TEXT, verifiedAt INTEGER, updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notificationTokens (
      hash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('verify','unsubscribe')), email TEXT NOT NULL,
      expiresAt INTEGER NOT NULL, consumedAt INTEGER, createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notification_tokens_user ON notificationTokens(userId,kind);
    CREATE TABLE IF NOT EXISTS notificationOutbox (
      id TEXT PRIMARY KEY, dedupeKey TEXT NOT NULL UNIQUE,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('verify','approval','publication','reminder')),
      eventId TEXT REFERENCES events(id) ON DELETE CASCADE, eventVersion INTEGER, eventDate TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','cancelled','dead')),
      attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt INTEGER NOT NULL,
      lockedBy TEXT, leaseUntil INTEGER, createdAt INTEGER NOT NULL, sentAt INTEGER, lastError TEXT
    );
    CREATE INDEX IF NOT EXISTS notification_outbox_pending ON notificationOutbox(status,nextAttemptAt);
    CREATE TABLE IF NOT EXISTS notificationWorkerLock (
      id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expiresAt INTEGER NOT NULL
    );
  `);
}

// Configuration remains on the server; the API exposes only availability and a reason.
export function notificationConfig(
  env = process.env,
  publicOrigin = env.PUBLIC_ORIGIN,
) {
  let origin = "";
  try {
    const url = new URL(publicOrigin || "");
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      origin = url.origin;
  } catch {}
  const host = String(env.SMTP_HOST || "").trim();
  const from = String(env.SMTP_FROM || "").trim();
  const secureValue = String(env.SMTP_SECURE ?? "false").toLowerCase();
  const secure = secureValue === "true";
  const port = Number(env.SMTP_PORT || (secure ? 465 : 587));
  const user = String(env.SMTP_USER || "");
  const pass = String(env.SMTP_PASS || "");
  const configured = Boolean(host && from);
  const available =
    configured &&
    Boolean(origin) &&
    /^[a-zA-Z0-9.-]{1,253}$/.test(host) &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from) &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535 &&
    ["true", "false"].includes(secureValue) &&
    Boolean(user) === Boolean(pass);
  return {
    configured,
    available,
    origin,
    host,
    from,
    port,
    secure,
    user,
    pass,
    message: available
      ? "Confirme seu e-mail para receber as notificações escolhidas. Os envios são processados em segundo plano."
      : "O envio de e-mails ainda não está disponível. Suas preferências podem ser salvas ou desativadas; nenhum e-mail será enviado até a configuração do serviço.",
  };
}

function preferenceRow(db, userId) {
  return db
    .prepare("SELECT * FROM notificationPreferences WHERE userId=?")
    .get(userId);
}

function isVerified(preference, user) {
  return Boolean(
    user?.active &&
    preference?.verifiedAt &&
    normalizedEmail(preference.verifiedEmail) === normalizedEmail(user.email),
  );
}

function state(db, user, config) {
  const preference = preferenceRow(db, user.id);
  return {
    available: config.available,
    configured: config.configured,
    verified: isVerified(preference, user),
    email: user.email,
    preferences: preference
      ? {
          publications: Boolean(preference.publications),
          reminders: Boolean(preference.reminders),
          courseId: preference.courseId,
        }
      : { ...DEFAULTS },
    message: config.message,
  };
}

function insertJob(db, user, kind, event, now, dedupeKey) {
  return Number(
    db
      .prepare(
        `INSERT INTO notificationOutbox
    (id,dedupeKey,userId,email,kind,eventId,eventVersion,eventDate,nextAttemptAt,createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupeKey) DO NOTHING`,
      )
      .run(
        randomUUID(),
        dedupeKey,
        user.id,
        normalizedEmail(user.email),
        kind,
        event?.id || null,
        event?.version || null,
        event?.date || null,
        now,
        now,
      ).changes,
  );
}

function cancelPending(db, userId, includeVerification = false) {
  db.prepare(
    `UPDATE notificationOutbox SET status='cancelled',lockedBy=NULL,leaseUntil=NULL
    WHERE userId=? AND status IN ('pending','processing') ${includeVerification ? "" : "AND kind<>'verify'"}`,
  ).run(userId);
}

function readToken(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{40,128}$/.test(value))
    fail(400, "Este link é inválido ou expirou.", "INVALID_EMAIL_TOKEN");
  return tokenHash(value);
}

function currentToken(db, value, kind, now) {
  const token = db
    .prepare(
      `SELECT t.*,u.active,u.email AS currentEmail FROM notificationTokens t
    JOIN users u ON u.id=t.userId WHERE t.hash=? AND t.kind=? AND t.consumedAt IS NULL AND t.expiresAt>?`,
    )
    .get(readToken(value), kind, now);
  if (
    !token ||
    !token.active ||
    normalizedEmail(token.email) !== normalizedEmail(token.currentEmail)
  )
    fail(
      400,
      "Este link é inválido ou expirou. Solicite um novo na sua conta.",
      "INVALID_EMAIL_TOKEN",
    );
  return token;
}

export function registerNotificationRoutes(
  api,
  { db, auth, now = () => new Date(), publicOrigin, rateLimit, config },
) {
  const configuration = () =>
    config || notificationConfig(process.env, publicOrigin);
  api.get("/notifications/preferences", auth, (req, res) =>
    res.json(state(db, req.user, configuration())),
  );
  api.put("/notifications/preferences", auth, (req, res) => {
    const input = req.body;
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) => !["publications", "reminders", "courseId"].includes(key),
      )
    )
      fail(400, "Preferências inválidas.", "VALIDATION_ERROR");
    const before = preferenceRow(db, req.user.id);
    const values = {};
    for (const key of ["publications", "reminders"]) {
      const value = input[key] ?? Boolean(before?.[key]);
      if (typeof value !== "boolean")
        fail(400, "Selecione as notificações desejadas.", "VALIDATION_ERROR");
      values[key] = Number(value);
    }
    const courseId =
      input.courseId === undefined
        ? before?.courseId || null
        : input.courseId || null;
    if (
      courseId !== null &&
      (typeof courseId !== "string" ||
        !db.prepare("SELECT id FROM courses WHERE id=?").get(courseId))
    )
      fail(400, "Selecione um setor válido.", "VALIDATION_ERROR");
    transaction(db, () => {
      const verified = isVerified(before, req.user);
      db.prepare(
        `INSERT INTO notificationPreferences(userId,publications,reminders,courseId,verifiedEmail,verifiedAt,updatedAt)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(userId) DO UPDATE SET publications=excluded.publications,
        reminders=excluded.reminders,courseId=excluded.courseId,verifiedEmail=excluded.verifiedEmail,verifiedAt=excluded.verifiedAt,updatedAt=excluded.updatedAt`,
      ).run(
        req.user.id,
        values.publications,
        values.reminders,
        courseId,
        verified ? before.verifiedEmail : null,
        verified ? before.verifiedAt : null,
        now().getTime(),
      );
      if (!enabled(values)) cancelPending(db, req.user.id);
    });
    res.json(state(db, req.user, configuration()));
  });
  api.post("/notifications/verify-request", auth, (req, res) => {
    rateLimit?.(req);
    const config = configuration();
    if (!config.available)
      return res.status(503).json({
        ...state(db, req.user, config),
        error: config.message,
        code: "EMAIL_UNAVAILABLE",
        queued: false,
        sent: false,
      });
    const preference = preferenceRow(db, req.user.id);
    if (!preference || !enabled(preference))
      fail(
        400,
        "Salve primeiro as notificações que deseja receber.",
        "NOT_OPTED_IN",
      );
    if (isVerified(preference, req.user))
      return res.json({
        ...state(db, req.user, config),
        queued: false,
        sent: false,
        message: "Seu e-mail já está confirmado.",
      });
    const instant = now().getTime();
    const recent = db
      .prepare(
        `SELECT count(*) AS count,max(createdAt) AS latest FROM notificationOutbox
      WHERE userId=? AND kind='verify' AND createdAt>?`,
      )
      .get(req.user.id, instant - DAY);
    if (recent.count >= 5 || (recent.latest && recent.latest > instant - 60000))
      fail(
        429,
        "Aguarde para solicitar outro link de confirmação. São permitidos até cinco pedidos por dia.",
        "RATE_LIMITED",
      );
    insertJob(
      db,
      req.user,
      "verify",
      null,
      instant,
      `verify:${req.user.id}:${randomUUID()}`,
    );
    res.status(202).json({
      ...state(db, req.user, config),
      queued: true,
      sent: false,
      message:
        "Pedido de confirmação colocado na fila. O envio ocorrerá em segundo plano.",
    });
  });
  api.post("/notifications/verify", (req, res) => {
    rateLimit?.(req);
    transaction(db, () => {
      const instant = now().getTime();
      const token = currentToken(db, req.body?.token, "verify", instant);
      db.prepare(
        "UPDATE notificationTokens SET consumedAt=? WHERE userId=? AND kind='verify' AND consumedAt IS NULL",
      ).run(instant, token.userId);
      db.prepare(
        "UPDATE notificationPreferences SET verifiedEmail=?,verifiedAt=?,updatedAt=? WHERE userId=?",
      ).run(token.email, instant, instant, token.userId);
    });
    res.json({
      ok: true,
      verified: true,
      message:
        "E-mail confirmado. Você receberá apenas as notificações escolhidas.",
    });
  });
  api.post("/notifications/unsubscribe", (req, res) => {
    rateLimit?.(req);
    transaction(db, () => {
      const instant = now().getTime();
      const token = currentToken(db, req.body?.token, "unsubscribe", instant);
      db.prepare(
        "UPDATE notificationPreferences SET publications=0,reminders=0,updatedAt=? WHERE userId=?",
      ).run(instant, token.userId);
      cancelPending(db, token.userId, true);
      db.prepare(
        "UPDATE notificationTokens SET consumedAt=? WHERE userId=? AND consumedAt IS NULL",
      ).run(instant, token.userId);
    });
    res.json({
      ok: true,
      message:
        "Notificações desativadas. Você pode alterar essa opção na sua conta.",
    });
  });
}

export function saoPauloTime(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type).value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function futureEvent(event, instant) {
  const local = saoPauloTime(instant);
  return (
    event.date > local.date ||
    (event.date === local.date && event.startTime > local.time)
  );
}

function subscribers(db) {
  return db
    .prepare(
      `SELECT u.*,p.publications,p.reminders,p.courseId AS filterCourseId,p.verifiedEmail,p.verifiedAt
    FROM notificationPreferences p JOIN users u ON u.id=p.userId WHERE u.active=1 AND (p.publications=1 OR p.reminders=1)`,
    )
    .all();
}

// Called inside the event transaction. This helper performs no network operations.
export function enqueueEventNotifications(
  db,
  event,
  { now = () => new Date() } = {},
) {
  if (event.status !== "approved" || !futureEvent(event, now())) return 0;
  let count = 0;
  for (const user of subscribers(db)) {
    if (!isVerified(user, user)) continue;
    const own = user.id === event.authorId;
    if (
      !user.publications ||
      (!own && user.filterCourseId && user.filterCourseId !== event.courseId)
    )
      continue;
    count += insertJob(
      db,
      user,
      own ? "approval" : "publication",
      event,
      now().getTime(),
      `${own ? "approval" : "publication"}:${event.id}:${event.version}:${user.id}:${event.date}`,
    );
  }
  return count;
}

export function enqueueDailyReminders(db, { now = () => new Date() } = {}) {
  const instant = now();
  const local = saoPauloTime(instant);
  const events = db
    .prepare(
      "SELECT * FROM events WHERE status='approved' AND date=? AND startTime>?",
    )
    .all(local.date, local.time);
  let count = 0;
  for (const event of events)
    for (const user of subscribers(db)) {
      if (
        !user.reminders ||
        !isVerified(user, user) ||
        (user.filterCourseId && user.filterCourseId !== event.courseId)
      )
        continue;
      count += insertJob(
        db,
        user,
        "reminder",
        event,
        instant.getTime(),
        `reminder:${event.id}:${event.version}:${user.id}:${event.date}`,
      );
    }
  return count;
}

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
function tokenForMail(db, user, kind, instant) {
  const token = createToken();
  db.prepare(
    "INSERT INTO notificationTokens(hash,userId,kind,email,expiresAt,createdAt) VALUES (?,?,?,?,?,?)",
  ).run(
    tokenHash(token),
    user.id,
    kind,
    normalizedEmail(user.email),
    instant + (kind === "verify" ? DAY : 365 * DAY),
    instant,
  );
  return token;
}

function mailForJob(db, job, user, event, config, instant) {
  let subject, lines, action, link;
  if (job.kind === "verify") {
    subject = "Confirme seu e-mail — Agenda Univille";
    lines = [
      "Você solicitou notificações da agenda de eventos da Univille, campus São Bento do Sul.",
      "Confirme o e-mail no botão abaixo. O link vale por 24 horas. Se não fez esse pedido, ignore esta mensagem.",
    ];
    action = "Confirmar meu e-mail";
    link = `${config.origin}/#email-verify=${tokenForMail(db, user, "verify", instant)}`;
  } else {
    subject =
      job.kind === "reminder"
        ? "Hoje na Univille: "
        : job.kind === "approval"
          ? "Solicitação aprovada: "
          : "Novo evento na Univille: ";
    subject += String(event.name)
      .replace(/[\r\n]/g, " ")
      .slice(0, 180);
    const date = event.date.split("-").reverse().join("/");
    lines = [
      job.kind === "reminder"
        ? "Lembrete: este evento acontece hoje."
        : job.kind === "approval"
          ? "Sua solicitação foi aprovada e está na agenda."
          : "Um evento foi publicado na agenda.",
      `Evento: ${event.name}`,
      `Data: ${date}`,
      `Horário: ${event.startTime}–${event.endTime}`,
      `Local: ${event.roomName || "Não informado"}`,
      ...(event.courseName ? [`Setor: ${event.courseName}`] : []),
    ];
    action = "Consultar agenda";
    link = `${config.origin}/`;
  }
  const unsubscribe = `${config.origin}/#email-unsubscribe=${tokenForMail(db, user, "unsubscribe", instant)}`;
  const text = [
    ...lines,
    `${action}: ${link}`,
    "Horários de Brasília (America/Sao_Paulo).",
    `Desativar notificações: ${unsubscribe}`,
  ].join("\n\n");
  return {
    from: config.from,
    to: user.email,
    subject,
    messageId: `<${job.id}@${new URL(config.origin).hostname}>`,
    text,
    html: `<div lang="pt-BR" style="font-family:Arial,sans-serif;max-width:620px;color:#163e2d"><h1 style="font-size:22px">Agenda Univille</h1><p>Campus São Bento do Sul</p>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p><p>Horários de Brasília (America/Sao_Paulo).</p><p><a href="${escapeHtml(unsubscribe)}">Desativar notificações</a></p></div>`,
  };
}

function eligibleJob(db, job, instant) {
  const user = db
    .prepare("SELECT * FROM users WHERE id=? AND active=1")
    .get(job.userId);
  if (!user || normalizedEmail(user.email) !== job.email) return null;
  const preference = preferenceRow(db, user.id);
  if (!preference || !enabled(preference)) return null;
  if (job.kind === "verify")
    return isVerified(preference, user) ? null : { user };
  if (!isVerified(preference, user)) return null;
  const event = getEvent(db, job.eventId);
  if (
    !event ||
    event.status !== "approved" ||
    event.version !== job.eventVersion ||
    event.date !== job.eventDate ||
    !futureEvent(event, instant)
  )
    return null;
  if (job.kind === "approval")
    return event.authorId === user.id && preference.publications
      ? { user, event }
      : null;
  if (preference.courseId && preference.courseId !== event.courseId)
    return null;
  if (job.kind === "publication" && !preference.publications) return null;
  if (
    job.kind === "reminder" &&
    (!preference.reminders || event.date !== saoPauloTime(instant).date)
  )
    return null;
  return { user, event };
}

async function createTransport(config) {
  const { default: nodemailer } = await import("nodemailer");
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
}

export async function processNotifications({
  db,
  now = () => new Date(),
  config = notificationConfig(),
  transport,
  limit = 50,
} = {}) {
  if (!config.available)
    return {
      available: false,
      sent: 0,
      cancelled: 0,
      failed: 0,
      message: config.message,
    };
  const owner = randomUUID();
  const acquire = db
    .prepare(
      `INSERT INTO notificationWorkerLock(id,owner,expiresAt) VALUES (1,?,?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expiresAt=excluded.expiresAt WHERE notificationWorkerLock.expiresAt<=?`,
    )
    .run(owner, now().getTime() + 120000, now().getTime());
  if (!acquire.changes)
    return { available: true, busy: true, sent: 0, cancelled: 0, failed: 0 };
  const result = { available: true, sent: 0, cancelled: 0, failed: 0 };
  let mailer = transport;
  try {
    enqueueDailyReminders(db, { now });
    mailer ||= await createTransport(config);
    db.prepare(
      "UPDATE notificationOutbox SET status='pending',lockedBy=NULL,leaseUntil=NULL WHERE status='processing' AND leaseUntil<=?",
    ).run(now().getTime());
    for (
      let index = 0;
      index < Math.max(1, Math.min(Number(limit) || 50, 200));
      index++
    ) {
      const instant = now().getTime();
      const job = db
        .prepare(
          "SELECT * FROM notificationOutbox WHERE status='pending' AND nextAttemptAt<=? ORDER BY createdAt,id LIMIT 1",
        )
        .get(instant);
      if (!job) break;
      db.prepare(
        "UPDATE notificationWorkerLock SET expiresAt=? WHERE id=1 AND owner=?",
      ).run(instant + 120000, owner);
      const claim = db
        .prepare(
          "UPDATE notificationOutbox SET status='processing',lockedBy=?,leaseUntil=? WHERE id=? AND status='pending'",
        )
        .run(owner, instant + 120000, job.id);
      if (!claim.changes) continue;
      const eligible = eligibleJob(db, job, now());
      if (!eligible) {
        db.prepare(
          "UPDATE notificationOutbox SET status='cancelled',lockedBy=NULL,leaseUntil=NULL WHERE id=? AND lockedBy=?",
        ).run(job.id, owner);
        result.cancelled++;
        continue;
      }
      try {
        const mail = mailForJob(
          db,
          job,
          eligible.user,
          eligible.event,
          config,
          instant,
        );
        const info = await mailer.sendMail(mail);
        if (info?.rejected?.length)
          throw Object.assign(new Error("Recipient rejected"), {
            code: "ERECIPIENT",
          });
        db.prepare(
          "UPDATE notificationOutbox SET status='sent',sentAt=?,attempts=attempts+1,lastError=NULL,lockedBy=NULL,leaseUntil=NULL WHERE id=? AND lockedBy=?",
        ).run(now().getTime(), job.id, owner);
        result.sent++;
      } catch (error) {
        const attempts = job.attempts + 1;
        // SMTP errors may contain credentials, recipients or content. Persist only a bounded code.
        const code = /^[A-Z0-9_]{1,32}$/.test(String(error?.code || ""))
          ? String(error.code)
          : "SMTP_SEND_FAILED";
        const delay = Math.min(
          6 * 60 * 60 * 1000,
          60000 * 2 ** Math.min(attempts - 1, 9),
        );
        db.prepare(
          "UPDATE notificationOutbox SET status=?,attempts=?,nextAttemptAt=?,lastError=?,lockedBy=NULL,leaseUntil=NULL WHERE id=? AND lockedBy=?",
        ).run(
          attempts >= 5 ? "dead" : "pending",
          attempts,
          now().getTime() + delay,
          code,
          job.id,
          owner,
        );
        result.failed++;
      }
    }
    db.prepare(
      "DELETE FROM notificationTokens WHERE expiresAt<=? OR (consumedAt IS NOT NULL AND consumedAt<=?)",
    ).run(now().getTime(), now().getTime() - DAY);
    return result;
  } finally {
    db.prepare("DELETE FROM notificationWorkerLock WHERE id=1 AND owner=?").run(
      owner,
    );
    if (!transport) mailer?.close?.();
  }
}
