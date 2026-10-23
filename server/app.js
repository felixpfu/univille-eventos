import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { openDatabase, transaction } from "./db.js";
import {
  hashPassword,
  verifyPassword,
  publicUser,
  tokenHash,
  createToken,
  cookieValue,
} from "./security.js";
import {
  HttpError,
  fail,
  roles,
  catalogs,
  textField,
  emailField,
  passwordField,
  timestamp,
  publicWindow,
  metadata,
  getEvent,
  eventList,
  normalizeEvent,
  assertNoConflict,
  saveEvent,
  versionCheck,
  audit,
  filteredReports,
  reportCsv,
} from "./domain.js";

export function createApp(options = {}) {
  const app = express();
  const db = openDatabase(options.dbPath);
  app.locals.db = db;
  const now = options.now || (() => new Date());
  const production =
    options.production ?? process.env.NODE_ENV === "production";
  const basePath = (options.basePath ?? process.env.BASE_PATH ?? "").replace(
    /\/$/,
    "",
  );
  if (basePath && !/^\/[a-zA-Z0-9/_-]+$/.test(basePath))
    throw new Error("BASE_PATH inválido.");
  const publicOrigin =
    options.publicOrigin ||
    process.env.PUBLIC_ORIGIN ||
    (production ? "https://flxpfu.com.br" : "");
  const cookieName = production
    ? "__Host-univille_session"
    : "univille_session";
  const sessionMaxAge = 8 * 60 * 60 * 1000;
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: production,
    path: production ? "/" : basePath || "/",
    maxAge: sessionMaxAge,
  };
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "64kb", strict: true }));
  const api = express.Router();
  app.use(`${basePath}/api`, api);
  const authAttempts = new Map();
  const authenticatedUser = (req) => {
    const token = cookieValue(req, cookieName);
    return token
      ? db
          .prepare(
            `SELECT u.* FROM users u JOIN sessions s ON s.userId=u.id WHERE s.tokenHash=? AND s.expiresAt>? AND u.active=1`,
          )
          .get(tokenHash(token), now().getTime()) || null
      : null;
  };
  const recheckAdmin = (req) => {
    if (authenticatedUser(req)?.role !== "admin")
      fail(
        403,
        "O acesso administrativo foi alterado. Entre novamente.",
        "FORBIDDEN",
      );
  };
  function issueSession(req, res, user) {
    const old = cookieValue(req, cookieName);
    if (old)
      db.prepare("DELETE FROM sessions WHERE tokenHash=?").run(tokenHash(old));
    const token = createToken();
    db.prepare("DELETE FROM sessions WHERE expiresAt <= ?").run(
      now().getTime(),
    );
    db.prepare(
      "INSERT INTO sessions(tokenHash,userId,expiresAt) VALUES (?,?,?)",
    ).run(tokenHash(token), user.id, now().getTime() + sessionMaxAge);
    res.cookie(cookieName, token, cookieOptions);
  }
  api.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const allowed = publicOrigin || `${req.protocol}://${req.get("host")}`;
      if ((origin && origin !== allowed) || (production && !origin))
        return next(
          new HttpError(
            403,
            "Origem da requisição não autorizada.",
            "INVALID_ORIGIN",
          ),
        );
      if (req.get("sec-fetch-site") === "cross-site")
        return next(
          new HttpError(
            403,
            "Origem da requisição não autorizada.",
            "INVALID_ORIGIN",
          ),
        );
      if (
        req.headers["content-length"] &&
        Number(req.headers["content-length"]) > 0 &&
        !req.is("application/json")
      )
        return next(
          new HttpError(
            415,
            "Envie os dados em JSON.",
            "UNSUPPORTED_MEDIA_TYPE",
          ),
        );
    }
    req.user = authenticatedUser(req);
    next();
  });
  const auth = (req, res, next) =>
    req.user
      ? next()
      : next(
          new HttpError(
            401,
            "Entre na sua conta para continuar.",
            "UNAUTHENTICATED",
          ),
        );
  const admin = (req, res, next) =>
    req.user?.role === "admin"
      ? next()
      : next(
          new HttpError(
            req.user ? 403 : 401,
            req.user
              ? "Acesso restrito à administração."
              : "Entre na sua conta para continuar.",
            req.user ? "FORBIDDEN" : "UNAUTHENTICATED",
          ),
        );
  const requester = (req, res, next) =>
    ["requester", "admin"].includes(req.user?.role)
      ? next()
      : next(
          new HttpError(
            req.user ? 403 : 401,
            "Esta ação requer uma conta de solicitante.",
            req.user ? "FORBIDDEN" : "UNAUTHENTICATED",
          ),
        );
  function rateLimit(req) {
    const key = req.ip;
    const current = authAttempts.get(key);
    const instant = now().getTime();
    if (current && current.expiresAt > instant && current.count >= 15)
      fail(
        429,
        "Muitas tentativas. Tente novamente em 15 minutos.",
        "RATE_LIMITED",
      );
    if (!current || current.expiresAt <= instant)
      authAttempts.set(key, { count: 1, expiresAt: instant + 15 * 60 * 1000 });
    else current.count++;
    if (authAttempts.size > 10000)
      for (const [id, value] of authAttempts)
        if (value.expiresAt <= instant) authAttempts.delete(id);
  }
  api.get("/health", (req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ ok: true });
  });
  api.get("/auth/me", (req, res) => res.json({ user: publicUser(req.user) }));
  api.post("/auth/register", async (req, res) => {
    rateLimit(req);
    const name = textField(req.body?.name, "Nome completo", 160, true);
    const email = emailField(req.body?.email);
    const password = passwordField(req.body?.password);
    const role = req.body?.role || "requester";
    if (!["visitor", "requester"].includes(role))
      fail(
        403,
        "Esse perfil não pode ser cadastrado publicamente.",
        "FORBIDDEN",
      );
    if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
      fail(409, "Este e-mail já está cadastrado.", "EMAIL_EXISTS");
    const passwordHash = await hashPassword(password);
    const user = { id: randomUUID(), name, email, role, active: 1 };
    db.prepare(
      "INSERT INTO users(id,name,email,passwordHash,role,active,createdAt) VALUES (?,?,?,?,?,1,?)",
    ).run(user.id, name, email, passwordHash, role, timestamp(now));
    issueSession(req, res, user);
    res.status(201).json({ user: publicUser(user) });
  });
  api.post("/auth/login", async (req, res) => {
    rateLimit(req);
    const email = emailField(req.body?.email);
    const password = req.body?.password;
    if (typeof password !== "string" || password.length > 128)
      fail(401, "E-mail ou senha inválidos.", "INVALID_CREDENTIALS");
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    // Hashing a fixed dummy value keeps unknown-account requests on the same expensive path.
    const hash =
      user?.passwordHash ||
      "scrypt$00000000000000000000000000000000$" + "0".repeat(128);
    const valid = await verifyPassword(password, hash);
    if (!valid || !user?.active)
      fail(401, "E-mail ou senha inválidos.", "INVALID_CREDENTIALS");
    const latest = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
    if (!latest?.active || latest.passwordHash !== user.passwordHash)
      fail(401, "E-mail ou senha inválidos.", "INVALID_CREDENTIALS");
    issueSession(req, res, latest);
    res.json({ user: publicUser(latest) });
  });
  api.post("/auth/logout", (req, res) => {
    const token = cookieValue(req, cookieName);
    if (token)
      db.prepare("DELETE FROM sessions WHERE tokenHash=?").run(
        tokenHash(token),
      );
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  });
  api.post("/auth/password", auth, async (req, res) => {
    rateLimit(req);
    const password = passwordField(req.body?.newPassword);
    if (
      typeof req.body?.currentPassword !== "string" ||
      req.body.currentPassword.length > 128 ||
      !(await verifyPassword(req.body.currentPassword, req.user.passwordHash))
    )
      fail(400, "A senha atual está incorreta.", "INVALID_CREDENTIALS");
    const encoded = await hashPassword(password);
    transaction(db, () => {
      const latest = authenticatedUser(req);
      if (!latest || latest.passwordHash !== req.user.passwordHash)
        fail(
          401,
          "A conta foi atualizada. Entre novamente.",
          "UNAUTHENTICATED",
        );
      db.prepare("UPDATE users SET passwordHash=? WHERE id=?").run(
        encoded,
        req.user.id,
      );
      db.prepare("DELETE FROM sessions WHERE userId=?").run(req.user.id);
      audit(db, req.user.id, "password.changed", req.user.id, now);
      issueSession(req, res, req.user);
    });
    res.json({ user: publicUser(req.user) });
  });
  api.get("/metadata", (req, res) =>
    res.json(metadata(db, ["requester", "admin"].includes(req.user?.role))),
  );
  api.get("/events", (req, res) => {
    const { start, end } = publicWindow(now);
    const events = eventList(db, "status='approved' AND date>=? AND date<?", [
      start,
      end,
    ]).map((event) => ({
      id: event.id,
      name: event.name,
      themeId: event.themeId,
      themeName: event.themeName,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      roomId: event.roomId,
      roomName: event.roomName,
      speaker: event.speaker,
    }));
    res.json({ events });
  });
  api.get("/requests", requester, (req, res) =>
    res.json({ requests: eventList(db, "authorId=?", [req.user.id]) }),
  );
  function authorizedEvent(req, allowAdmin = true) {
    const event = getEvent(db, req.params.id);
    if (
      !event ||
      (event.authorId !== req.user.id &&
        !(allowAdmin && req.user.role === "admin" && event.status !== "draft"))
    )
      fail(404, "Solicitação não encontrada.", "NOT_FOUND");
    return event;
  }
  api.get("/requests/:id", requester, (req, res) =>
    res.json({ request: authorizedEvent(req) }),
  );
  api.post("/requests", requester, (req, res) => {
    const request = transaction(db, () => {
      const data = normalizeEvent(db, req.body, null, false, now);
      const event = saveEvent(db, data, {
        authorId: req.user.id,
        status: "draft",
        now,
      });
      audit(db, req.user.id, "request.created", event.id, now);
      return event;
    });
    res.status(201).json({ request });
  });
  api.put("/requests/:id", requester, (req, res) => {
    const request = transaction(db, () => {
      const current = authorizedEvent(req);
      versionCheck(current, req.body?.version);
      const ownerEditable =
        current.authorId === req.user.id &&
        ["draft", "pending", "rejected"].includes(current.status);
      const adminEditable =
        req.user.role === "admin" && current.status === "approved";
      if (!ownerEditable && !adminEditable)
        fail(
          403,
          "Esta solicitação não pode ser editada neste estado.",
          "INVALID_TRANSITION",
        );
      const complete = ["pending", "approved"].includes(current.status);
      const data = normalizeEvent(db, req.body, current, complete, now);
      if (complete) assertNoConflict(db, data, current.id);
      const result = saveEvent(db, data, {
        existing: current,
        status: current.status,
        now,
      });
      audit(db, req.user.id, "request.edited", current.id, now);
      return result;
    });
    res.json({ request });
  });
  api.delete("/requests/:id", requester, (req, res) => {
    transaction(db, () => {
      const current = authorizedEvent(req, false);
      versionCheck(current, req.body?.version);
      if (current.status !== "draft")
        fail(
          403,
          "Somente rascunhos podem ser excluídos.",
          "INVALID_TRANSITION",
        );
      db.prepare("DELETE FROM events WHERE id=?").run(current.id);
      audit(db, req.user.id, "request.deleted", current.id, now);
    });
    res.json({ ok: true });
  });
  api.post("/requests/:id/submit", requester, (req, res) => {
    const request = transaction(db, () => {
      const current = authorizedEvent(req, false);
      versionCheck(current, req.body?.version);
      if (!["draft", "rejected"].includes(current.status))
        fail(
          403,
          "Este pedido não pode ser enviado neste estado.",
          "INVALID_TRANSITION",
        );
      const data = normalizeEvent(db, {}, current, true, now);
      assertNoConflict(db, data, current.id);
      const result = saveEvent(db, data, {
        existing: current,
        status: "pending",
        now,
      });
      audit(db, req.user.id, "request.submitted", current.id, now);
      return result;
    });
    res.json({ request });
  });
  api.post("/requests/:id/cancel", requester, (req, res) => {
    const request = transaction(db, () => {
      const current = authorizedEvent(req);
      versionCheck(current, req.body?.version);
      if (
        !(current.authorId === req.user.id && current.status === "pending") &&
        !(req.user.role === "admin" && current.status === "approved")
      )
        fail(
          403,
          "Este pedido não pode ser cancelado neste estado.",
          "INVALID_TRANSITION",
        );
      db.prepare(
        "UPDATE events SET status='cancelled',version=version+1,updatedAt=? WHERE id=?",
      ).run(timestamp(now), current.id);
      audit(db, req.user.id, "request.cancelled", current.id, now);
      return getEvent(db, current.id);
    });
    res.json({ request });
  });
  api.get("/admin/requests", admin, (req, res) => {
    const statuses = ["pending", "rejected", "approved", "cancelled"];
    if (req.query.status && !statuses.includes(req.query.status))
      fail(400, "Status inválido.", "VALIDATION_ERROR");
    res.json({
      requests: req.query.status
        ? eventList(db, "status=?", [req.query.status])
        : eventList(db, "status<>'draft'"),
    });
  });
  for (const action of ["approve", "reject"])
    api.post(`/admin/requests/:id/${action}`, admin, (req, res) => {
      const request = transaction(db, () => {
        const current = getEvent(db, req.params.id);
        if (!current) fail(404, "Solicitação não encontrada.", "NOT_FOUND");
        versionCheck(current, req.body?.version);
        if (current.status !== "pending")
          fail(
            403,
            "Somente pedidos aguardando aprovação podem ser analisados.",
            "INVALID_TRANSITION",
          );
        const reason =
          action === "reject"
            ? textField(
                req.body?.reason,
                "Justificativa da rejeição",
                5000,
                true,
              )
            : "";
        if (action === "approve") {
          const data = normalizeEvent(db, {}, current, true, now);
          assertNoConflict(db, data, current.id);
        }
        db.prepare(
          "UPDATE events SET status=?,rejectionReason=?,version=version+1,updatedAt=? WHERE id=?",
        ).run(
          action === "approve" ? "approved" : "rejected",
          reason,
          timestamp(now),
          current.id,
        );
        audit(db, req.user.id, `request.${action}d`, current.id, now);
        return getEvent(db, current.id);
      });
      res.json({ request });
    });
  api.get("/admin/reports", admin, (req, res) =>
    res.json({ events: filteredReports(db, req.query) }),
  );
  api.get("/admin/reports.csv", admin, (req, res) =>
    res
      .type("text/csv; charset=utf-8")
      .attachment("eventos-univille.csv")
      .send(reportCsv(filteredReports(db, req.query))),
  );
  installCatalogRoutes(api, db, admin, now);
  installUserRoutes(api, db, admin, now, recheckAdmin);
  api.use((req, res, next) =>
    next(new HttpError(404, "Recurso não encontrado.", "NOT_FOUND")),
  );
  const dist = options.distPath || resolve("dist");
  if (existsSync(join(dist, "index.html"))) {
    app.use(
      basePath || "/",
      express.static(dist, { index: false, maxAge: production ? "1h" : 0 }),
    );
    app.get(
      basePath
        ? new RegExp(`^${basePath.replaceAll("/", "\\/")}(?:/.*)?$`)
        : /.*/,
      (req, res) => res.sendFile(join(dist, "index.html")),
    );
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError)
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
        ...(error.fields ? { fields: error.fields } : {}),
      });
    if (error.type === "entity.too.large")
      return res.status(413).json({
        error: "Os dados enviados excedem o limite permitido.",
        code: "PAYLOAD_TOO_LARGE",
      });
    if (error instanceof SyntaxError && "body" in error)
      return res
        .status(400)
        .json({ error: "JSON inválido.", code: "INVALID_JSON" });
    if (
      error.code?.startsWith("SQLITE_CONSTRAINT") ||
      /constraint failed/i.test(error.message)
    )
      return res.status(409).json({
        error: "Este registro já existe ou está vinculado a outros dados.",
        code: "LINKED_RECORD",
      });
    if (options.onError) options.onError(error);
    else console.error("Erro interno:", error.message);
    res.status(500).json({
      error: "Não foi possível concluir a operação.",
      code: "INTERNAL_ERROR",
    });
  });
  return app;
}

function installCatalogRoutes(api, db, admin, now) {
  const entityFor = (req) => {
    if (!catalogs.has(req.params.entity))
      fail(404, "Cadastro não encontrado.", "NOT_FOUND");
    return req.params.entity;
  };
  const itemFor = (entity, id) => {
    const item = db.prepare(`SELECT * FROM ${entity} WHERE id=?`).get(id);
    if (!item) fail(404, "Registro não encontrado.", "NOT_FOUND");
    if (entity === "rooms")
      item.resourceIds = db
        .prepare("SELECT resourceId FROM roomResources WHERE roomId=?")
        .all(id)
        .map((row) => row.resourceId);
    return item;
  };
  const save = (req, entity, existing) => {
    const body = req.body || {};
    const name = textField(body.name ?? existing?.name, "Nome", 160, true);
    const description = textField(
      body.description ?? existing?.description,
      "Descrição",
      2000,
    );
    const id = existing?.id || randomUUID();
    let costCenterId;
    if (entity === "courses") {
      costCenterId = body.costCenterId ?? existing?.costCenterId;
      if (
        typeof costCenterId !== "string" ||
        !db.prepare("SELECT id FROM costCenters WHERE id=?").get(costCenterId)
      )
        fail(400, "Selecione um centro de custo válido.", "VALIDATION_ERROR");
    }
    let resourceIds;
    if (entity === "rooms") {
      resourceIds = body.resourceIds ?? existing?.resourceIds ?? [];
      if (
        !Array.isArray(resourceIds) ||
        resourceIds.length > 100 ||
        resourceIds.some(
          (id) =>
            typeof id !== "string" ||
            !db.prepare("SELECT id FROM resources WHERE id=?").get(id),
        )
      )
        fail(400, "Selecione recursos válidos.", "VALIDATION_ERROR");
      resourceIds = [...new Set(resourceIds)];
      if (existing) {
        const assigned = db
          .prepare(
            "SELECT DISTINCT er.resourceId FROM eventResources er JOIN events e ON e.id=er.eventId WHERE e.roomId=?",
          )
          .all(id);
        if (assigned.some((row) => !resourceIds.includes(row.resourceId)))
          fail(
            409,
            "Há eventos utilizando um dos recursos que seriam removidos deste ambiente.",
            "LINKED_RECORD",
          );
      }
    }
    if (existing)
      db.prepare(
        `UPDATE ${entity} SET name=?,description=?${entity === "courses" ? ",costCenterId=?" : ""} WHERE id=?`,
      ).run(
        name,
        description,
        ...(entity === "courses" ? [costCenterId] : []),
        id,
      );
    else
      db.prepare(
        `INSERT INTO ${entity}(id,name,description${entity === "courses" ? ",costCenterId" : ""}) VALUES (?,?,?${entity === "courses" ? ",?" : ""})`,
      ).run(
        id,
        name,
        description,
        ...(entity === "courses" ? [costCenterId] : []),
      );
    if (entity === "rooms") {
      db.prepare("DELETE FROM roomResources WHERE roomId=?").run(id);
      for (const resourceId of resourceIds)
        db.prepare(
          "INSERT INTO roomResources(roomId,resourceId) VALUES (?,?)",
        ).run(id, resourceId);
    }
    audit(
      db,
      req.user.id,
      `catalog.${existing ? "updated" : "created"}.${entity}`,
      id,
      now,
    );
    return itemFor(entity, id);
  };
  api.get("/admin/catalog/:entity", admin, (req, res) => {
    const entity = entityFor(req);
    res.json({ items: metadata(db)[entity] });
  });
  api.post("/admin/catalog/:entity", admin, (req, res) => {
    const entity = entityFor(req);
    res
      .status(201)
      .json({ item: transaction(db, () => save(req, entity, null)) });
  });
  api.put("/admin/catalog/:entity/:id", admin, (req, res) => {
    const entity = entityFor(req);
    res.json({
      item: transaction(db, () =>
        save(req, entity, itemFor(entity, req.params.id)),
      ),
    });
  });
  api.delete("/admin/catalog/:entity/:id", admin, (req, res) => {
    const entity = entityFor(req);
    transaction(db, () => {
      itemFor(entity, req.params.id);
      // Room-resource relations are auxiliary links too: remove links explicitly before deleting a room.
      if (
        entity === "rooms" &&
        db
          .prepare("SELECT 1 FROM roomResources WHERE roomId=? LIMIT 1")
          .get(req.params.id)
      )
        fail(
          409,
          "Remova os vínculos com recursos antes de excluir o ambiente.",
          "LINKED_RECORD",
        );
      db.prepare(`DELETE FROM ${entity} WHERE id=?`).run(req.params.id);
      audit(db, req.user.id, `catalog.deleted.${entity}`, req.params.id, now);
    });
    res.json({ ok: true });
  });
}

function installUserRoutes(api, db, admin, now, recheckAdmin) {
  const findUser = (id) => {
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!user) fail(404, "Usuário não encontrado.", "NOT_FOUND");
    return user;
  };
  api.get("/admin/users", admin, (req, res) =>
    res.json({
      users: db
        .prepare("SELECT * FROM users ORDER BY name COLLATE NOCASE")
        .all()
        .map(publicUser),
    }),
  );
  api.post("/admin/users", admin, async (req, res) => {
    const name = textField(req.body?.name, "Nome completo", 160, true);
    const email = emailField(req.body?.email);
    const password = passwordField(req.body?.password);
    const role = req.body?.role;
    if (!roles.has(role)) fail(400, "Perfil inválido.", "VALIDATION_ERROR");
    if (req.body.active !== undefined && typeof req.body.active !== "boolean")
      fail(400, "Situação inválida.", "VALIDATION_ERROR");
    const encoded = await hashPassword(password);
    const user = transaction(db, () => {
      recheckAdmin(req);
      if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
        fail(409, "Este e-mail já está cadastrado.", "EMAIL_EXISTS");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO users(id,name,email,passwordHash,role,active,createdAt) VALUES (?,?,?,?,?,?,?)",
      ).run(
        id,
        name,
        email,
        encoded,
        role,
        Number(req.body.active ?? true),
        timestamp(now),
      );
      audit(db, req.user.id, "user.created", id, now);
      return findUser(id);
    });
    res.status(201).json({ user: publicUser(user) });
  });
  api.put("/admin/users/:id", admin, async (req, res) => {
    const before = findUser(req.params.id);
    const name = textField(
      req.body?.name ?? before.name,
      "Nome completo",
      160,
      true,
    );
    const email = emailField(req.body?.email ?? before.email);
    const role = req.body?.role ?? before.role;
    if (!roles.has(role)) fail(400, "Perfil inválido.", "VALIDATION_ERROR");
    if (req.body?.active !== undefined && typeof req.body.active !== "boolean")
      fail(400, "Situação inválida.", "VALIDATION_ERROR");
    const active = req.body?.active ?? Boolean(before.active);
    const encoded = req.body?.password
      ? await hashPassword(passwordField(req.body.password))
      : null;
    const user = transaction(db, () => {
      recheckAdmin(req);
      const current = findUser(req.params.id);
      if (current.id === req.user.id && (!active || role !== "admin"))
        fail(
          409,
          "Você não pode remover seu próprio acesso administrativo.",
          "LAST_ADMIN",
        );
      if (
        current.role === "admin" &&
        current.active &&
        (!active || role !== "admin") &&
        db
          .prepare(
            "SELECT count(*) AS count FROM users WHERE role='admin' AND active=1",
          )
          .get().count <= 1
      )
        fail(409, "Mantenha ao menos um administrador ativo.", "LAST_ADMIN");
      if (
        db
          .prepare("SELECT id FROM users WHERE email=? AND id<>?")
          .get(email, current.id)
      )
        fail(409, "Este e-mail já está cadastrado.", "EMAIL_EXISTS");
      db.prepare(
        "UPDATE users SET name=?,email=?,role=?,active=?,passwordHash=? WHERE id=?",
      ).run(
        name,
        email,
        role,
        Number(active),
        encoded || current.passwordHash,
        current.id,
      );
      if (!active || encoded || role !== current.role)
        db.prepare("DELETE FROM sessions WHERE userId=?").run(current.id);
      audit(db, req.user.id, "user.updated", current.id, now);
      return findUser(current.id);
    });
    res.json({ user: publicUser(user) });
  });
  api.delete("/admin/users/:id", admin, (req, res) => {
    transaction(db, () => {
      const user = findUser(req.params.id);
      if (user.id === req.user.id)
        fail(409, "Você não pode desativar sua própria conta.", "LAST_ADMIN");
      if (
        user.role === "admin" &&
        user.active &&
        db
          .prepare(
            "SELECT count(*) AS count FROM users WHERE role='admin' AND active=1",
          )
          .get().count <= 1
      )
        fail(409, "Mantenha ao menos um administrador ativo.", "LAST_ADMIN");
      db.prepare("UPDATE users SET active=0 WHERE id=?").run(user.id);
      db.prepare("DELETE FROM sessions WHERE userId=?").run(user.id);
      audit(db, req.user.id, "user.deactivated", user.id, now);
    });
    res.json({ ok: true });
  });
}
