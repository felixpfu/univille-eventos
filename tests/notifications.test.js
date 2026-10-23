import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { openDatabase } from "../server/db.js";
import { tokenHash } from "../server/security.js";
import {
  initNotificationSchema,
  notificationConfig,
  registerNotificationRoutes,
  enqueueEventNotifications,
  enqueueDailyReminders,
  processNotifications,
  saoPauloTime,
} from "../server/notifications.js";

const configured = () =>
  notificationConfig({
    SMTP_HOST: "smtp.example.test",
    SMTP_FROM: "agenda@example.test",
    SMTP_PORT: "587",
    PUBLIC_ORIGIN: "https://agenda.example.test",
  });

async function fixture({
  available = true,
  date = "2026-10-23T15:00:00Z",
} = {}) {
  const db = openDatabase(":memory:");
  initNotificationSchema(db);
  let instant = new Date(date);
  const now = () => new Date(instant);
  const config = available ? configured() : notificationConfig({});
  const mails = [];
  const transport = {
    async sendMail(mail) {
      mails.push(mail);
      return { accepted: [mail.to], rejected: [] };
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = db
      .prepare("SELECT * FROM users WHERE id=? AND active=1")
      .get(req.get("x-test-user") || "");
    next();
  });
  const router = express.Router();
  registerNotificationRoutes(router, {
    db,
    now,
    config,
    auth: (req, res, next) =>
      req.user ? next() : res.status(401).json({ code: "UNAUTHENTICATED" }),
  });
  app.use("/api", router);
  app.use((error, req, res, next) =>
    res
      .status(error.status || 500)
      .json({ error: error.message, code: error.code }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  function user(id, extra = {}) {
    const row = {
      id,
      email: `${id}@example.test`,
      active: 1,
      role: "visitor",
      ...extra,
    };
    db.prepare(
      "INSERT INTO users(id,name,email,passwordHash,role,active,createdAt) VALUES (?,?,?,?,?,?,?)",
    ).run(
      id,
      `Pessoa ${id}`,
      row.email,
      "unused-test-hash",
      row.role,
      row.active,
      now().toISOString(),
    );
    return row;
  }
  function optIn(person, preferences = {}) {
    db.prepare(
      `INSERT INTO notificationPreferences(userId,publications,reminders,courseId,verifiedEmail,verifiedAt,updatedAt)
      VALUES (?,?,?,?,?,?,?)`,
    ).run(
      person.id,
      Number(preferences.publications ?? true),
      Number(preferences.reminders ?? true),
      preferences.courseId || null,
      preferences.verified === false ? null : person.email,
      preferences.verified === false ? null : now().getTime(),
      now().getTime(),
    );
  }
  function event(id, changes = {}) {
    const row = {
      id,
      authorId: "author",
      name: '<img src=x onerror="alert(1)"> Evento',
      status: "approved",
      date: "2026-10-24",
      startTime: "19:00",
      endTime: "20:00",
      version: 1,
      courseId: null,
      ...changes,
    };
    db.prepare(
      `INSERT INTO events(id,authorId,name,status,date,startTime,endTime,version,courseId,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      row.id,
      row.authorId,
      row.name,
      row.status,
      row.date,
      row.startTime,
      row.endTime,
      row.version,
      row.courseId,
      now().toISOString(),
      now().toISOString(),
    );
    return row;
  }
  async function request(path, { method = "GET", body, as } = {}) {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        ...(as ? { "x-test-user": as.id } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const content = await response.text();
    return {
      status: response.status,
      data: response.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(content)
        : content,
    };
  }
  return {
    db,
    now,
    config,
    mails,
    transport,
    user,
    optIn,
    event,
    request,
    setTime(value) {
      instant = new Date(value);
    },
    process(options = {}) {
      return processNotifications({ db, now, config, transport, ...options });
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}

test("Notification preferences require an account, preserve opt-out without SMTP and survive schema initialization", async () => {
  const f = await fixture({ available: false });
  try {
    const visitor = f.user("visitor");
    assert.equal((await f.request("/notifications/preferences")).status, 401);
    let response = await f.request("/notifications/preferences", {
      as: visitor,
    });
    assert.equal(response.data.available, false);
    assert.equal(response.data.verified, false);
    assert.deepEqual(response.data.preferences, {
      publications: false,
      reminders: false,
      courseId: null,
    });
    assert.equal(
      (
        await f.request("/notifications/preferences", {
          method: "PUT",
          as: visitor,
          body: { publications: "true" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/notifications/preferences", {
          method: "PUT",
          as: visitor,
          body: { email: "stranger@example.test" },
        })
      ).status,
      400,
    );
    response = await f.request("/notifications/preferences", {
      method: "PUT",
      as: visitor,
      body: { publications: true, reminders: true },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.preferences.publications, true);
    initNotificationSchema(f.db);
    assert.equal(
      f.db
        .prepare(
          "SELECT publications FROM notificationPreferences WHERE userId=?",
        )
        .get(visitor.id).publications,
      1,
    );
    response = await f.request("/notifications/verify-request", {
      method: "POST",
      as: visitor,
      body: {},
    });
    assert.equal(response.status, 503);
    assert.equal(response.data.sent, false);
    assert.equal(response.data.queued, false);
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM notificationOutbox").get().n,
      0,
    );
    assert.equal((await f.process()).sent, 0);
    response = await f.request("/notifications/preferences", {
      method: "PUT",
      as: visitor,
      body: { publications: false, reminders: false },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.preferences.reminders, false);
  } finally {
    await f.close();
  }
});

test("Account email verification is queued, single use, hash stored, and unsubscribing requires an explicit POST", async () => {
  const f = await fixture();
  try {
    const visitor = f.user("visitor");
    f.optIn(visitor, { verified: false });
    let response = await f.request("/notifications/verify-request", {
      method: "POST",
      as: visitor,
      body: {},
    });
    assert.equal(response.status, 202);
    assert.equal(response.data.queued, true);
    assert.equal(response.data.sent, false);
    assert.equal(f.mails.length, 0);
    assert.equal(
      (
        await f.request("/notifications/verify-request", {
          method: "POST",
          as: visitor,
          body: {},
        })
      ).status,
      429,
    );
    assert.equal((await f.process()).sent, 1);
    assert.equal(f.mails[0].to, visitor.email);
    const token = f.mails[0].text.match(/#email-verify=([\w-]+)/)[1];
    const unsubscribe = f.mails[0].text.match(/#email-unsubscribe=([\w-]+)/)[1];
    assert.ok(
      f.db
        .prepare("SELECT hash FROM notificationTokens WHERE hash=?")
        .get(tokenHash(token)),
    );
    assert.equal(
      JSON.stringify(
        f.db.prepare("SELECT * FROM notificationTokens").all(),
      ).includes(token),
      false,
    );
    assert.equal(
      JSON.stringify(
        f.db.prepare("SELECT * FROM notificationOutbox").all(),
      ).includes(token),
      false,
    );
    response = await f.request("/notifications/verify", {
      method: "POST",
      body: { token },
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await f.request("/notifications/preferences", { as: visitor })).data
        .verified,
      true,
    );
    assert.equal(
      (
        await f.request("/notifications/verify", {
          method: "POST",
          body: { token },
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request(`/notifications/unsubscribe?token=${unsubscribe}`))
        .status,
      404,
    );
    assert.equal(
      (await f.request("/notifications/preferences", { as: visitor })).data
        .preferences.publications,
      true,
    );
    response = await f.request("/notifications/unsubscribe", {
      method: "POST",
      body: { token: unsubscribe },
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await f.request("/notifications/preferences", { as: visitor })).data
        .preferences.publications,
      false,
    );
    assert.equal(
      (
        await f.request("/notifications/unsubscribe", {
          method: "POST",
          body: { token: unsubscribe },
        })
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});

test("Email changes and expired links revoke verification without blocking account preferences", async () => {
  const f = await fixture();
  try {
    const visitor = f.user("visitor");
    f.optIn(visitor, { verified: false });
    await f.request("/notifications/verify-request", {
      method: "POST",
      as: visitor,
      body: {},
    });
    await f.process();
    const token = f.mails[0].text.match(/#email-verify=([\w-]+)/)[1];
    f.setTime("2026-10-25T15:00:00Z");
    assert.equal(
      (
        await f.request("/notifications/verify", {
          method: "POST",
          body: { token },
        })
      ).status,
      400,
    );
    f.db
      .prepare(
        "UPDATE notificationPreferences SET verifiedEmail=?,verifiedAt=? WHERE userId=?",
      )
      .run(visitor.email, f.now().getTime(), visitor.id);
    f.db
      .prepare("UPDATE users SET email=? WHERE id=?")
      .run("changed@example.test", visitor.id);
    const preference = await f.request("/notifications/preferences", {
      as: visitor,
    });
    assert.equal(preference.data.verified, false);
    assert.equal(preference.data.email, "changed@example.test");
    assert.equal(
      (
        await f.request("/notifications/preferences", {
          method: "PUT",
          as: visitor,
          body: { reminders: false, publications: false },
        })
      ).status,
      200,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT verifiedAt FROM notificationPreferences WHERE userId=?",
        )
        .get(visitor.id).verifiedAt,
      null,
    );
  } finally {
    await f.close();
  }
});

test("Publication outbox deduplicates, filters sectors and consent, cancels stale versions, escapes HTML and rechecks changed emails", async () => {
  const f = await fixture();
  try {
    f.db.exec(
      "INSERT INTO costCenters(id,name) VALUES ('cc','CC'); INSERT INTO courses(id,name,costCenterId) VALUES ('course-a','Curso A','cc'),('course-b','Curso B','cc')",
    );
    const author = f.user("author", { role: "requester" });
    const visitor = f.user("visitor");
    const different = f.user("different");
    const changed = f.user("changed");
    const unverified = f.user("unverified");
    f.optIn(author, { publications: false });
    f.optIn(visitor, { courseId: "course-a" });
    f.optIn(different, { courseId: "course-b" });
    f.optIn(changed);
    f.optIn(unverified, { verified: false });
    const event = f.event("event", { courseId: "course-a" });
    assert.equal(enqueueEventNotifications(f.db, event, { now: f.now }), 2);
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM notificationOutbox WHERE userId=? AND kind='approval'",
        )
        .get(author.id).n,
      0,
      "Reminder-only consent must not enqueue an approval confirmation",
    );
    const optedIn = await f.request("/notifications/preferences", {
      method: "PUT",
      as: author,
      body: { publications: true },
    });
    assert.equal(optedIn.status, 200);
    assert.equal(enqueueEventNotifications(f.db, event, { now: f.now }), 1);
    assert.equal(enqueueEventNotifications(f.db, event, { now: f.now }), 0);
    assert.equal(f.mails.length, 0);
    f.db.prepare("UPDATE events SET version=2 WHERE id=?").run(event.id);
    assert.equal((await f.process()).cancelled, 3);
    assert.equal(f.mails.length, 0);
    assert.equal(
      enqueueEventNotifications(f.db, { ...event, version: 2 }, { now: f.now }),
      3,
    );
    f.db
      .prepare("UPDATE users SET email='new-address@example.test' WHERE id=?")
      .run(changed.id);
    const processed = await f.process();
    assert.equal(processed.sent, 2);
    assert.equal(processed.cancelled, 1);
    assert.deepEqual(
      f.mails.map((mail) => mail.to).sort(),
      [author.email, visitor.email].sort(),
    );
    const publication = f.mails.find((mail) => mail.to === visitor.email);
    assert.match(publication.html, /&lt;img/);
    assert.equal(publication.html.includes("<img src=x"), false);
    assert.match(publication.text, /https:\/\/agenda\.example\.test\//);
    assert.equal(publication.html.includes('src="http'), false);
    assert.equal((await f.process()).sent, 0);
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM notificationOutbox WHERE status='sent'",
        )
        .get().n,
      2,
    );
    const ownConsentEvent = f.event("own-consent-event");
    assert.equal(
      enqueueEventNotifications(f.db, ownConsentEvent, { now: f.now }),
      1,
    );
    const optedOut = await f.request("/notifications/preferences", {
      method: "PUT",
      as: author,
      body: { publications: false },
    });
    assert.equal(optedOut.data.preferences.reminders, true);
    assert.equal(optedOut.data.preferences.publications, false);
    assert.equal((await f.process()).cancelled, 1);
    assert.equal(
      f.mails.filter((mail) => mail.to === author.email).length,
      1,
      "Queued approval must recheck publication consent even when reminders remain enabled",
    );
  } finally {
    await f.close();
  }
});

test("Reminders follow São Paulo date, future start time, opt-in and cancellation, with no repeated daily send", async () => {
  const f = await fixture({ date: "2026-10-24T01:00:00Z" });
  try {
    const author = f.user("author", { role: "requester" });
    const visitor = f.user("visitor");
    f.optIn(visitor, { publications: false });
    assert.deepEqual(saoPauloTime(f.now()), {
      date: "2026-10-23",
      time: "22:00",
    });
    f.event("tonight", {
      date: "2026-10-23",
      startTime: "23:00",
      endTime: "23:30",
    });
    f.event("past", {
      date: "2026-10-23",
      startTime: "21:00",
      endTime: "21:30",
    });
    f.event("tomorrow", { date: "2026-10-24" });
    f.event("cancelled", {
      date: "2026-10-23",
      startTime: "23:10",
      status: "cancelled",
    });
    assert.equal(enqueueDailyReminders(f.db, { now: f.now }), 1);
    assert.equal(enqueueDailyReminders(f.db, { now: f.now }), 0);
    assert.equal((await f.process()).sent, 1);
    assert.match(f.mails[0].subject, /Hoje/);
    assert.equal((await f.process()).sent, 0);
    const cancelled = f.event("later-cancelled", {
      date: "2026-10-23",
      startTime: "23:10",
    });
    assert.equal(enqueueDailyReminders(f.db, { now: f.now }), 1);
    f.db
      .prepare("UPDATE events SET status='cancelled' WHERE id=?")
      .run(cancelled.id);
    assert.equal((await f.process()).cancelled, 1);
    const optedOut = f.event("later-opted-out", {
      date: "2026-10-23",
      startTime: "23:20",
    });
    assert.equal(enqueueDailyReminders(f.db, { now: f.now }), 1);
    await f.request("/notifications/preferences", {
      method: "PUT",
      as: visitor,
      body: { publications: false, reminders: false },
    });
    assert.equal((await f.process()).sent, 0);
    assert.equal(
      f.db
        .prepare("SELECT status FROM notificationOutbox WHERE eventId=?")
        .get(optedOut.id).status,
      "cancelled",
    );
    assert.equal(f.mails.length, 1);
    assert.equal(author.id, "author");
  } finally {
    await f.close();
  }
});

test("Worker retries with backoff, stores sanitized error codes and excludes concurrent workers", async () => {
  const f = await fixture();
  try {
    const author = f.user("author", { role: "requester" });
    f.optIn(author);
    const event = f.event("event");
    enqueueEventNotifications(f.db, event, { now: f.now });
    const failing = {
      async sendMail() {
        throw Object.assign(new Error("password=private recipient=private"), {
          code: "EAUTH",
        });
      },
    };
    let result = await f.process({ transport: failing });
    assert.equal(result.failed, 1);
    const job = f.db.prepare("SELECT * FROM notificationOutbox").get();
    assert.equal(job.attempts, 1);
    assert.equal(job.lastError, "EAUTH");
    assert.equal(JSON.stringify(job).includes("password=private"), false);
    assert.equal(job.nextAttemptAt, f.now().getTime() + 60000);
    assert.equal((await f.process()).sent, 0);
    f.setTime("2026-10-23T15:01:00Z");
    let release;
    let started;
    const startedPromise = new Promise((resolve) => {
      started = resolve;
    });
    const waiting = {
      async sendMail(mail) {
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
        f.mails.push(mail);
        return { accepted: [mail.to], rejected: [] };
      },
    };
    const first = f.process({ transport: waiting });
    await startedPromise;
    assert.equal((await f.process()).busy, true);
    release();
    result = await first;
    assert.equal(result.sent, 1);
    assert.equal(f.mails.length, 1);
    assert.equal(
      f.db.prepare("SELECT status,attempts FROM notificationOutbox").get()
        .status,
      "sent",
    );
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM notificationWorkerLock").get().n,
      0,
    );
  } finally {
    await f.close();
  }
});

test("SMTP configuration rejects insecure origin and incomplete credentials without exposing secrets", () => {
  assert.equal(configured().available, true);
  assert.equal(
    notificationConfig({
      SMTP_HOST: "smtp.example.test",
      SMTP_FROM: "agenda@example.test",
      PUBLIC_ORIGIN: "http://agenda.example.test",
    }).available,
    false,
  );
  assert.equal(
    notificationConfig({
      SMTP_HOST: "smtp.example.test",
      SMTP_FROM: "agenda@example.test",
      SMTP_USER: "user",
      PUBLIC_ORIGIN: "https://agenda.example.test",
    }).available,
    false,
  );
  assert.equal(
    notificationConfig({
      SMTP_HOST: "smtp.example.test",
      SMTP_FROM: "agenda@example.test\r\nBcc:other@example.test",
      PUBLIC_ORIGIN: "https://agenda.example.test",
    }).available,
    false,
  );
});
