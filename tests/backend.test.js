import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../server/db.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { createAdministrator } from "../scripts/admin.js";
import { verifyPassword } from "../server/security.js";
const PASSWORD = "Teste ficticio seguro 2026!";
const fixedNow = () => new Date("2026-10-23T15:00:00Z");

async function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "univille-test-"));
  const dbPath = join(directory, "events.sqlite");
  await createAdministrator({
    dbPath,
    name: "Admin fictício",
    email: "admin@example.test",
    password: PASSWORD,
  });
  const app = createApp({ dbPath, now: fixedNow, ...options });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const basePath = options.basePath || "";
  async function request(
    path,
    { method = "GET", body, cookie, origin: overrideOrigin, ...rest } = {},
  ) {
    const response = await fetch(`${origin}${basePath}/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(overrideOrigin ? { Origin: overrideOrigin } : {}),
        ...rest.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const data = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? JSON.parse(text)
      : text;
    return {
      status: response.status,
      data,
      headers: response.headers,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const login = await request("/auth/login", {
    method: "POST",
    body: { email: "admin@example.test", password: PASSWORD },
    origin: options.production ? options.publicOrigin : undefined,
  });
  assert.equal(login.status, 200);
  return {
    app,
    db: app.locals.db,
    request,
    admin: login.cookie,
    dbPath,
    origin,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      app.locals.db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
async function register(
  f,
  email = "requester@example.test",
  role = "requester",
) {
  const result = await f.request("/auth/register", {
    method: "POST",
    body: { name: "Pessoa fictícia", email, password: PASSWORD, role },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { cookie: result.cookie, user: result.data.user };
}
async function catalog(f) {
  const add = async (entity, body) => {
    const result = await f.request(`/admin/catalog/${entity}`, {
      method: "POST",
      cookie: f.admin,
      body,
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.item;
  };
  const theme = await add("themes", { name: "Ciência fictícia" });
  const cost = await add("costCenters", { name: "CC fictício" });
  const course = await add("courses", {
    name: "Curso fictício",
    costCenterId: cost.id,
  });
  const resource = await add("resources", { name: "Projetor fictício" });
  const room = await add("rooms", {
    name: "Auditório fictício A",
    resourceIds: [resource.id],
  });
  const otherRoom = await add("rooms", {
    name: "Auditório fictício B",
    resourceIds: [],
  });
  return { theme, cost, course, resource, room, otherRoom };
}
function eventData(catalogs, changes = {}) {
  return {
    name: "Evento fictício",
    themeId: catalogs.theme.id,
    date: "2026-10-24",
    startTime: "19:00",
    endTime: "20:00",
    roomId: catalogs.room.id,
    courseId: catalogs.course.id,
    requesterName: "Nome informado livremente",
    speaker: "Palestrante fictícia",
    audience: "Comunidade acadêmica",
    justification: "Discussão acadêmica",
    objective: "Compartilhar conhecimento",
    ceremony: false,
    registration: false,
    certificates: true,
    resourceIds: [catalogs.resource.id],
    notes: "",
    ...changes,
  };
}
async function draft(f, cookie, data) {
  const result = await f.request("/requests", {
    method: "POST",
    cookie,
    body: data,
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.request;
}
async function submit(f, cookie, event) {
  const result = await f.request(`/requests/${event.id}/submit`, {
    method: "POST",
    cookie,
    body: { version: event.version },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.request;
}
async function approve(f, event) {
  const result = await f.request(`/admin/requests/${event.id}/approve`, {
    method: "POST",
    cookie: f.admin,
    body: { version: event.version },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.request;
}

test("Authentication: roles, hashed passwords, sessions, origin checks and deactivation", async () => {
  const f = await fixture();
  try {
    assert.deepEqual((await f.request("/auth/me")).data, { user: null });
    const forbidden = await f.request("/auth/register", {
      method: "POST",
      body: {
        name: "Inválido",
        email: "invalid@example.test",
        password: PASSWORD,
        role: "admin",
      },
    });
    assert.equal(forbidden.status, 403);
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM users WHERE role='admin'").get()
        .n,
      1,
    );
    const visitor = await register(f, "visitor@example.test", "visitor");
    assert.equal(
      (await f.request("/requests", { cookie: visitor.cookie })).status,
      403,
    );
    assert.equal(
      (await f.request("/admin/users", { cookie: visitor.cookie })).status,
      403,
    );
    assert.equal((await f.request("/admin/users")).status, 401);
    const user = await register(f);
    const stored = f.db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(user.user.id);
    assert.notEqual(stored.passwordHash, PASSWORD);
    assert.ok(stored.passwordHash.startsWith("scrypt$"));
    assert.equal(await verifyPassword(PASSWORD, stored.passwordHash), true);
    const rawToken = user.cookie.split("=")[1];
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM sessions WHERE tokenHash=?")
        .get(rawToken).n,
      0,
    );
    assert.equal(
      (await f.request("/auth/me", { cookie: user.cookie })).data.user.email,
      "requester@example.test",
    );
    const deniedOrigin = await f.request("/auth/logout", {
      method: "POST",
      cookie: user.cookie,
      origin: "https://malicious.example",
      body: {},
    });
    assert.equal(deniedOrigin.status, 403);
    assert.match(
      (
        await f.request("/auth/login", {
          method: "POST",
          body: { email: "requester@example.test", password: PASSWORD },
        })
      ).headers.get("set-cookie"),
      /HttpOnly/,
    );
    assert.equal(
      (
        await f.request(`/admin/users/${user.user.id}`, {
          method: "DELETE",
          cookie: f.admin,
        })
      ).status,
      200,
    );
    assert.deepEqual(
      (await f.request("/auth/me", { cookie: user.cookie })).data,
      { user: null },
    );
    assert.equal(
      (
        await f.request("/auth/login", {
          method: "POST",
          body: { email: "requester@example.test", password: PASSWORD },
        })
      ).status,
      401,
    );
    const adminUser = (await f.request("/auth/me", { cookie: f.admin })).data
      .user;
    assert.equal(
      (
        await f.request(`/admin/users/${adminUser.id}`, {
          method: "PUT",
          cookie: f.admin,
          body: { role: "visitor" },
        })
      ).status,
      409,
    );
  } finally {
    await f.close();
  }
});

test("Workflow preserves ownership, incomplete drafts, rejection reason, resubmission and cancellation", async () => {
  const f = await fixture();
  try {
    const c = await catalog(f);
    const user = await register(f);
    const other = await register(f, "other@example.test");
    let event = await draft(f, user.cookie, { name: "Incompleto" });
    assert.equal(event.status, "draft");
    let result = await f.request(`/requests/${event.id}/submit`, {
      method: "POST",
      cookie: user.cookie,
      body: { version: event.version },
    });
    assert.equal(result.status, 400);
    assert.ok(result.data.fields.date);
    assert.equal(
      (await f.request(`/requests/${event.id}`, { cookie: other.cookie }))
        .status,
      404,
    );
    assert.equal(
      (await f.request("/admin/requests", { cookie: f.admin })).data.requests
        .length,
      0,
    );
    result = await f.request(`/requests/${event.id}`, {
      method: "PUT",
      cookie: user.cookie,
      body: {
        ...eventData(c),
        version: event.version,
        authorId: other.user.id,
        status: "approved",
        costCenterId: "forged",
      },
    });
    assert.equal(result.status, 200);
    event = result.data.request;
    assert.equal(event.authorId, user.user.id);
    assert.equal(event.status, "draft");
    assert.equal(event.costCenterId, c.cost.id);
    assert.notEqual(event.requesterName, event.authorName);
    event = await submit(f, user.cookie, event);
    assert.equal(event.status, "pending");
    assert.equal(event.ceremony, false);
    assert.equal(
      (
        await f.request(`/requests/${event.id}`, {
          method: "DELETE",
          cookie: user.cookie,
          body: { version: event.version },
        })
      ).status,
      403,
    );
    result = await f.request(`/admin/requests/${event.id}/reject`, {
      method: "POST",
      cookie: f.admin,
      body: { version: event.version, reason: "  " },
    });
    assert.equal(result.status, 400);
    result = await f.request(`/admin/requests/${event.id}/reject`, {
      method: "POST",
      cookie: f.admin,
      body: { version: event.version, reason: "Ajuste a justificativa." },
    });
    assert.equal(result.status, 200);
    event = result.data.request;
    assert.equal(event.status, "rejected");
    assert.equal(event.rejectionReason, "Ajuste a justificativa.");
    assert.equal(
      (await f.request(`/requests/${event.id}`, { cookie: user.cookie })).data
        .request.rejectionReason,
      "Ajuste a justificativa.",
    );
    event = await submit(f, user.cookie, event);
    assert.equal(event.rejectionReason, "");
    event = await approve(f, event);
    assert.equal(
      (
        await f.request(`/requests/${event.id}`, {
          method: "PUT",
          cookie: user.cookie,
          body: { version: event.version, name: "Alteração indevida" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(`/requests/${event.id}/cancel`, {
          method: "POST",
          cookie: user.cookie,
          body: { version: event.version },
        })
      ).status,
      403,
    );
    const cancelled = await f.request(`/requests/${event.id}/cancel`, {
      method: "POST",
      cookie: f.admin,
      body: { version: event.version },
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.request.status, "cancelled");
    assert.equal((await f.request("/events")).data.events.length, 0);
    assert.equal(
      f.db.prepare("SELECT status FROM events WHERE id=?").get(event.id).status,
      "cancelled",
    );
    const deletable = await draft(f, user.cookie, {});
    assert.equal(
      (
        await f.request(`/requests/${deletable.id}`, {
          method: "DELETE",
          cookie: user.cookie,
          body: { version: deletable.version },
        })
      ).status,
      200,
    );
    assert.equal(
      f.db.prepare("SELECT id FROM events WHERE id=?").get(deletable.id),
      undefined,
    );
  } finally {
    await f.close();
  }
});

test("Scheduling validates time/date/resources and atomically prevents conflicting approvals", async () => {
  const f = await fixture();
  try {
    const c = await catalog(f);
    const user = await register(f);
    const invalid = await draft(
      f,
      user.cookie,
      eventData(c, { date: "2026-10-22", endTime: "18:00" }),
    );
    assert.equal(
      (
        await f.request(`/requests/${invalid.id}/submit`, {
          method: "POST",
          cookie: user.cookie,
          body: { version: invalid.version },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/requests", {
          method: "POST",
          cookie: user.cookie,
          body: eventData(c, { date: "2026-02-30" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/requests", {
          method: "POST",
          cookie: user.cookie,
          body: eventData(c, { roomId: c.otherRoom.id }),
        })
      ).status,
      400,
    );
    let first = await submit(
      f,
      user.cookie,
      await draft(f, user.cookie, eventData(c)),
    );
    const second = await submit(
      f,
      user.cookie,
      await draft(
        f,
        user.cookie,
        eventData(c, {
          name: "Concorrente",
          startTime: "19:30",
          endTime: "21:00",
        }),
      ),
    );
    const simultaneous = await Promise.all(
      [first, second].map((event) =>
        f.request(`/admin/requests/${event.id}/approve`, {
          method: "POST",
          cookie: f.admin,
          body: { version: event.version },
        }),
      ),
    );
    assert.deepEqual(
      simultaneous.map((result) => result.status).sort(),
      [200, 409],
    );
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM events WHERE status='approved'")
        .get().n,
      1,
    );
    first = simultaneous.find((result) => result.status === 200).data.request;
    const overlap = await draft(
      f,
      user.cookie,
      eventData(c, { startTime: first.startTime, endTime: first.endTime }),
    );
    const failedSubmit = await f.request(`/requests/${overlap.id}/submit`, {
      method: "POST",
      cookie: user.cookie,
      body: { version: overlap.version },
    });
    assert.equal(failedSubmit.status, 409);
    assert.equal(failedSubmit.data.code, "SCHEDULE_CONFLICT");
    const adjacent = await submit(
      f,
      user.cookie,
      await draft(
        f,
        user.cookie,
        eventData(c, { startTime: first.endTime, endTime: "23:00" }),
      ),
    );
    await approve(f, adjacent);
    const parallelRoom = await submit(
      f,
      user.cookie,
      await draft(
        f,
        user.cookie,
        eventData(c, { roomId: c.otherRoom.id, resourceIds: [] }),
      ),
    );
    await approve(f, parallelRoom);
    assert.equal(
      (
        await f.request(`/requests/${first.id}`, {
          method: "PUT",
          cookie: f.admin,
          body: { version: first.version, endTime: "23:00" },
        })
      ).status,
      409,
    );
    const missingVersion = await f.request(`/requests/${first.id}`, {
      method: "PUT",
      cookie: f.admin,
      body: { name: "Sem versão" },
    });
    assert.equal(missingVersion.status, 409);
    assert.equal(missingVersion.data.code, "STALE_VERSION");
    assert.equal(
      (
        await f.request(`/requests/${first.id}`, {
          method: "PUT",
          cookie: f.admin,
          body: { version: first.version - 1, name: "Antigo" },
        })
      ).status,
      409,
    );
    const publicEvents = (await f.request("/events")).data.events;
    assert.equal(publicEvents.length, 3);
    assert.ok(
      publicEvents.every(
        (event) =>
          !("authorId" in event) &&
          !("justification" in event) &&
          !("requesterName" in event),
      ),
    );
  } finally {
    await f.close();
  }
});

test("Catalog references and reports preserve exact filters, columns and CSV safety", async () => {
  const f = await fixture();
  try {
    const c = await catalog(f);
    const user = await register(f);
    const approved = await approve(
      f,
      await submit(
        f,
        user.cookie,
        await draft(
          f,
          user.cookie,
          eventData(c, { name: '=HYPERLINK("ficticio")' }),
        ),
      ),
    );
    await submit(
      f,
      user.cookie,
      await draft(f, user.cookie, eventData(c, { date: "2026-11-10" })),
    );
    await draft(f, user.cookie, eventData(c, { date: "2026-12-10" }));
    const report = await f.request(
      `/admin/reports?from=2026-10-24&to=2026-10-24&courseId=${c.course.id}&themeId=${c.theme.id}`,
      { cookie: f.admin },
    );
    assert.equal(report.status, 200);
    assert.equal(report.data.events.length, 1);
    assert.equal(report.data.events[0].id, approved.id);
    const csv = await f.request(
      `/admin/reports.csv?from=2026-10-24&to=2026-10-24&courseId=${c.course.id}&themeId=${c.theme.id}`,
      { cookie: f.admin },
    );
    assert.equal(csv.status, 200);
    assert.match(csv.data, /Centro de custo/);
    assert.match(csv.data, /"'=HYPERLINK/);
    assert.equal(csv.data.trim().split("\r\n").length, 2);
    assert.match(csv.headers.get("content-disposition"), /attachment/);
    assert.equal(
      (
        await f.request("/admin/reports?from=2026-11-10&to=2026-10-24", {
          cookie: f.admin,
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request("/admin/reports", { cookie: user.cookie })).status,
      403,
    );
    assert.equal(
      (await f.request("/admin/reports", { cookie: f.admin })).data.events
        .length,
      2,
    );
    for (const [entity, id] of [
      ["themes", c.theme.id],
      ["courses", c.course.id],
      ["costCenters", c.cost.id],
      ["resources", c.resource.id],
      ["rooms", c.room.id],
    ]) {
      assert.equal(
        (
          await f.request(`/admin/catalog/${entity}/${id}`, {
            method: "DELETE",
            cookie: f.admin,
          })
        ).status,
        409,
      );
    }
    assert.equal(
      (
        await f.request(`/admin/catalog/rooms/${c.room.id}`, {
          method: "PUT",
          cookie: f.admin,
          body: { resourceIds: [] },
        })
      ).status,
      409,
    );
    assert.equal((await f.request("/metadata")).data.courses.length, 0);
    assert.equal(
      (await f.request("/metadata", { cookie: user.cookie })).data.courses[0]
        .costCenterName,
      c.cost.name,
    );
  } finally {
    await f.close();
  }
});

test("Public agenda uses São Paulo month boundaries; password changes revoke old sessions", async () => {
  const f = await fixture();
  try {
    const c = await catalog(f);
    const user = await register(f);
    for (const date of ["2026-10-24", "2026-11-10", "2026-12-31", "2027-01-01"])
      await approve(
        f,
        await submit(
          f,
          user.cookie,
          await draft(f, user.cookie, eventData(c, { date })),
        ),
      );
    const past = await draft(
      f,
      user.cookie,
      eventData(c, { date: "2026-10-01" }),
    );
    f.db.prepare("UPDATE events SET status='approved' WHERE id=?").run(past.id);
    assert.deepEqual(
      (await f.request("/events")).data.events.map((event) => event.date),
      ["2026-10-01", "2026-10-24", "2026-11-10", "2026-12-31"],
    );
    const login = await f.request("/auth/login", {
      method: "POST",
      body: { email: "requester@example.test", password: PASSWORD },
    });
    const changed = await f.request("/auth/password", {
      method: "POST",
      cookie: user.cookie,
      body: {
        currentPassword: PASSWORD,
        newPassword: "Uma nova senha fictícia 2026!",
      },
    });
    assert.equal(changed.status, 200);
    assert.ok(changed.cookie);
    assert.equal(
      (await f.request("/auth/me", { cookie: user.cookie })).data.user,
      null,
    );
    assert.equal(
      (await f.request("/auth/me", { cookie: login.cookie })).data.user,
      null,
    );
    assert.equal(
      (await f.request("/auth/me", { cookie: changed.cookie })).data.user.id,
      user.user.id,
    );
    assert.equal(
      (
        await f.request("/auth/login", {
          method: "POST",
          body: { email: "requester@example.test", password: PASSWORD },
        })
      ).status,
      401,
    );
  } finally {
    await f.close();
  }
});

test("Production cookie and CSRF origin policy work with configurable base path", async () => {
  const f = await fixture({
    basePath: "/eventos",
    production: true,
    publicOrigin: "https://flxpfu.com.br",
  });
  try {
    assert.equal((await f.request("/health")).status, 200);
    assert.equal(
      (
        await f.request("/auth/logout", {
          method: "POST",
          cookie: f.admin,
          body: {},
        })
      ).status,
      403,
    );
    const login = await f.request("/auth/login", {
      method: "POST",
      origin: "https://flxpfu.com.br",
      body: { email: "admin@example.test", password: PASSWORD },
    });
    const setCookie = login.headers.get("set-cookie");
    assert.match(setCookie, /__Host-univille_session/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\//);
    assert.equal(
      (
        await f.request("/auth/logout", {
          method: "POST",
          cookie: login.cookie,
          origin: "https://flxpfu.com.br",
          body: {},
        })
      ).status,
      200,
    );
  } finally {
    await f.close();
  }
});

test("Database starts empty and persists accounts and catalogs across app restarts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "univille-persistence-"));
  const dbPath = join(directory, "events.sqlite");
  let app = createApp({ dbPath, now: fixedNow });
  try {
    assert.equal(
      app.locals.db.prepare("SELECT count(*) AS n FROM users").get().n,
      0,
    );
    assert.equal(
      app.locals.db.prepare("SELECT count(*) AS n FROM events").get().n,
      0,
    );
    app.locals.db
      .prepare(
        "INSERT INTO themes(id,name) VALUES ('fictitious-theme','Tema persistido fictício')",
      )
      .run();
    app.locals.db.close();
    await createAdministrator({
      dbPath,
      name: "Admin fictício",
      email: "persistent@example.test",
      password: PASSWORD,
    });
    app = createApp({ dbPath, now: fixedNow });
    assert.equal(
      app.locals.db
        .prepare("SELECT name FROM themes WHERE id='fictitious-theme'")
        .get().name,
      "Tema persistido fictício",
    );
    assert.equal(
      app.locals.db.prepare("SELECT email FROM users").get().email,
      "persistent@example.test",
    );
    assert.equal(
      app.locals.db.prepare("PRAGMA foreign_keys").get().foreign_keys,
      1,
    );
    await assert.rejects(
      createAdministrator({
        dbPath,
        name: "Admin fictício",
        email: "persistent@example.test",
        password: PASSWORD,
      }),
      /já cadastrado/,
    );
  } finally {
    app.locals.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Protected writes enforce ownership, visitor permissions and session expiry", async () => {
  let instant = new Date("2026-10-23T15:00:00Z");
  const f = await fixture({ now: () => instant });
  try {
    const c = await catalog(f);
    const owner = await register(f, "owner-boundary@example.test");
    const stranger = await register(f, "stranger-boundary@example.test");
    const visitor = await register(
      f,
      "visitor-boundary@example.test",
      "visitor",
    );
    const event = await draft(f, owner.cookie, eventData(c));
    for (const [method, suffix, extra] of [
      ["PUT", "", { name: "Alteração não autorizada" }],
      ["DELETE", "", {}],
      ["POST", "/submit", {}],
      ["POST", "/cancel", {}],
    ]) {
      const result = await f.request(`/requests/${event.id}${suffix}`, {
        method,
        cookie: stranger.cookie,
        body: { version: event.version, ...extra },
      });
      assert.equal(result.status, 404, `${method} ${suffix} leaked ownership`);
      assert.equal(result.data.code, "NOT_FOUND");
    }
    assert.equal(
      (await f.request(`/requests/${event.id}`, { cookie: f.admin })).status,
      404,
      "Even administrators cannot inspect someone else's private draft",
    );
    assert.equal(
      (
        await f.request("/requests", {
          method: "POST",
          cookie: visitor.cookie,
          body: eventData(c),
        })
      ).status,
      403,
    );
    for (const path of [
      "/admin/reports",
      "/admin/reports.csv",
      "/admin/catalog/courses",
    ]) {
      assert.equal(
        (await f.request(path, { cookie: visitor.cookie })).status,
        403,
      );
      assert.equal((await f.request(path)).status, 401);
    }
    const pending = await submit(f, owner.cookie, event);
    assert.equal(
      (
        await f.request(`/requests/${pending.id}/cancel`, {
          method: "POST",
          cookie: stranger.cookie,
          body: { version: pending.version },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(`/admin/requests/${pending.id}/approve`, {
          method: "POST",
          cookie: owner.cookie,
          body: { version: pending.version },
        })
      ).status,
      403,
    );
    const persisted = f.db
      .prepare("SELECT name,status,version FROM events WHERE id=?")
      .get(event.id);
    assert.equal(persisted.name, event.name);
    assert.equal(persisted.status, "pending");
    assert.equal(persisted.version, pending.version);
    instant = new Date(instant.getTime() + 8 * 60 * 60 * 1000);
    assert.equal(
      (await f.request("/auth/me", { cookie: owner.cookie })).data.user,
      null,
    );
    assert.equal(
      (
        await f.request(`/requests/${pending.id}/cancel`, {
          method: "POST",
          cookie: owner.cookie,
          body: { version: pending.version },
        })
      ).status,
      401,
    );
    assert.equal(
      f.db.prepare("SELECT status FROM events WHERE id=?").get(event.id).status,
      "pending",
    );
  } finally {
    await f.close();
  }
});

test("Administrator CLI provisions through the current-release symlink used in production", () => {
  const directory = mkdtempSync(join(tmpdir(), "univille-cli-"));
  try {
    const link = join(directory, "current");
    symlinkSync(fileURLToPath(new URL("../", import.meta.url)), link, "dir");
    const result = spawnSync(
      process.execPath,
      [join(link, "scripts/admin.js")],
      {
        input: JSON.stringify({
          email: "bootstrap@example.test",
          name: "Admin CLI fictício",
          password: PASSWORD,
        }),
        env: { ...process.env, DATA_DIR: join(directory, "state") },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Administrador configurado/);
    const db = openDatabase(join(directory, "state/events.sqlite"));
    try {
      const user = db.prepare("SELECT email,role,active FROM users").get();
      assert.equal(user.email, "bootstrap@example.test");
      assert.equal(user.role, "admin");
      assert.equal(user.active, 1);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
