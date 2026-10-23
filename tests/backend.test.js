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
import { verifyPassword, hashPassword } from "../server/security.js";
import { cnpjField } from "../server/domain.js";
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
    body: {
      name: "Pessoa fictícia",
      email,
      password: PASSWORD,
      role,
      ...(role === "requester"
        ? {
            companyName: "Empresa fictícia de testes",
            cnpj: "12.345.678/0001-95",
          }
        : {}),
    },
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
    organizer: "Curso fictício",
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
    assert.equal(
      simultaneous.find((result) => result.status === 200).data.request.id,
      first.id,
      "the first sent request must win, regardless of arrival order of approval requests",
    );
    first = simultaneous.find((result) => result.status === 200).data.request;
    assert.equal(
      (
        await f.request(`/requests/${second.id}/cancel`, {
          method: "POST",
          cookie: user.cookie,
          body: { version: second.version },
        })
      ).status,
      200,
    );
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
    const publicCourses = (await f.request("/metadata")).data.courses;
    assert.equal(publicCourses.length, 1);
    assert.deepEqual(Object.keys(publicCourses[0]).sort(), ["id", "name"]);
    assert.deepEqual(
      (await f.request(`/events?courseId=${c.course.id}`)).data.events.map(
        (e) => e.id,
      ),
      [approved.id],
    );
    assert.equal(
      (await f.request("/events?courseId=unknown")).data.events.length,
      0,
    );
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

test("Submission queue uses send order, survives ties and requeues only meaningful changes", async () => {
  let instant = new Date("2026-10-23T15:00:00Z");
  const f = await fixture({ now: () => instant });
  try {
    const c = await catalog(f);
    const user = await register(f);
    const oldDraft = await draft(
      f,
      user.cookie,
      eventData(c, { name: "Rascunho antigo" }),
    );
    instant = new Date("2026-10-23T15:01:00Z");
    let first = await submit(
      f,
      user.cookie,
      await draft(f, user.cookie, eventData(c, { name: "Primeiro enviado" })),
    );
    let second = await submit(f, user.cookie, oldDraft);
    assert.ok(oldDraft.createdAt < first.createdAt);
    assert.equal(
      first.submittedAt,
      second.submittedAt,
      "fixture deliberately submits in the same millisecond",
    );
    assert.ok(first.queueSequence < second.queueSequence);
    assert.deepEqual(
      (
        await f.request("/admin/requests?status=pending", { cookie: f.admin })
      ).data.requests.map((e) => e.id),
      [first.id, second.id],
    );
    let blocked = await f.request(`/admin/requests/${second.id}/approve`, {
      method: "POST",
      cookie: f.admin,
      body: { version: second.version },
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, "EARLIER_REQUEST");
    assert.match(
      blocked.data.error,
      new RegExp(first.id.slice(0, 8).toUpperCase()),
    );
    const originalSequence = first.queueSequence;
    const edited = await f.request(`/requests/${first.id}`, {
      method: "PUT",
      cookie: user.cookie,
      body: { version: first.version, name: "Correção sem mudar a reserva" },
    });
    assert.equal(edited.status, 200);
    first = edited.data.request;
    assert.equal(first.queueSequence, originalSequence);
    const moved = await f.request(`/requests/${first.id}`, {
      method: "PUT",
      cookie: user.cookie,
      body: { version: first.version, startTime: "19:15" },
    });
    assert.equal(moved.status, 200);
    first = moved.data.request;
    assert.ok(first.queueSequence > second.queueSequence);
    blocked = await f.request(`/admin/requests/${first.id}/approve`, {
      method: "POST",
      cookie: f.admin,
      body: { version: first.version },
    });
    assert.equal(blocked.data.code, "EARLIER_REQUEST");
    const rejected = await f.request(`/admin/requests/${second.id}/reject`, {
      method: "POST",
      cookie: f.admin,
      body: { version: second.version, reason: "Ajustar justificativa" },
    });
    assert.equal(rejected.status, 200);
    second = await submit(f, user.cookie, rejected.data.request);
    assert.ok(
      second.queueSequence > first.queueSequence,
      "resubmission takes a new place in the queue",
    );
    first = await approve(f, first);
    blocked = await f.request(`/admin/requests/${second.id}/approve`, {
      method: "POST",
      cookie: f.admin,
      body: { version: second.version },
    });
    assert.equal(blocked.data.code, "SCHEDULE_CONFLICT");
  } finally {
    await f.close();
  }
});

test("Organizer, audience details and report status filters are validated", async () => {
  const f = await fixture();
  try {
    const c = await catalog(f);
    const user = await register(f);
    const incomplete = await draft(
      f,
      user.cookie,
      eventData(c, { organizer: "" }),
    );
    const missing = await f.request(`/requests/${incomplete.id}/submit`, {
      method: "POST",
      cookie: user.cookie,
      body: { version: incomplete.version },
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.data.fields.organizer, "Campo obrigatório.");
    for (const changes of [
      { audienceCourseId: "missing" },
      { audienceSemester: "x".repeat(41) },
    ]) {
      assert.equal(
        (
          await f.request("/requests", {
            method: "POST",
            cookie: user.cookie,
            body: eventData(c, changes),
          })
        ).status,
        400,
      );
    }
    const approved = await approve(
      f,
      await submit(
        f,
        user.cookie,
        await draft(
          f,
          user.cookie,
          eventData(c, {
            audienceCourseId: c.course.id,
            audienceSemester: " 3º semestre ",
          }),
        ),
      ),
    );
    assert.equal(approved.audienceCourseName, c.course.name);
    assert.equal(approved.audienceSemester, "3º semestre");
    await submit(
      f,
      user.cookie,
      await draft(f, user.cookie, eventData(c, { date: "2026-10-25" })),
    );
    assert.equal(
      (await f.request("/admin/reports?status=approved", { cookie: f.admin }))
        .data.events.length,
      1,
    );
    assert.equal(
      (await f.request("/admin/reports?status=pending", { cookie: f.admin }))
        .data.events.length,
      1,
    );
    assert.equal(
      (await f.request("/admin/reports?status=draft", { cookie: f.admin }))
        .status,
      400,
    );
    assert.equal(
      (await f.request("/admin/agenda.pptx", { cookie: f.admin })).status,
      400,
    );
    assert.equal(
      (
        await f.request("/admin/agenda.pptx?from=2026-10-24&to=2026-10-23", {
          cookie: f.admin,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/admin/agenda.pptx?from=2026-10-24&to=2026-10-25", {
          cookie: user.cookie,
        })
      ).status,
      403,
    );
    const ppt = await f.request(
      "/admin/agenda.pptx?from=2026-10-24&to=2026-10-25&status=pending",
      { cookie: f.admin },
    );
    assert.equal(ppt.status, 200);
    assert.match(
      ppt.headers.get("content-type"),
      /presentationml.presentation/,
    );
    assert.match(ppt.headers.get("content-disposition"), /\.pptx/);
    assert.ok(ppt.data.startsWith("PK"));
  } finally {
    await f.close();
  }
});

test("Version 1 migration preserves requests and reconstructs last actual send order idempotently", () => {
  const directory = mkdtempSync(join(tmpdir(), "univille-migration-"));
  const dbPath = join(directory, "events.sqlite");
  let db = openDatabase(dbPath);
  try {
    db.exec(`INSERT INTO users(id,name,email,passwordHash,role,createdAt) VALUES ('owner','Legacy owner','legacy@example.test','dummy','requester','2026-10-01T10:00:00.000Z');
      DROP INDEX events_pending_queue; DROP INDEX events_queue_sequence;
      DROP TABLE submissionQueue;`);
    for (const column of [
      "organizer",
      "audienceCourseId",
      "audienceSemester",
      "submittedAt",
      "queueSequence",
    ])
      db.exec(`ALTER TABLE events DROP COLUMN ${column}`);
    db.exec("PRAGMA user_version=1");
    const add = db.prepare(
      "INSERT INTO events(id,authorId,name,status,createdAt,updatedAt) VALUES (?,'owner',?,'pending',?,?)",
    );
    add.run(
      "old-draft",
      "Rascunho antigo enviado depois",
      "2026-10-01T10:00:00.000Z",
      "2026-10-20T10:00:00.000Z",
    );
    add.run(
      "first-send",
      "Primeiro envio",
      "2026-10-10T10:00:00.000Z",
      "2026-10-22T10:00:00.000Z",
    );
    add.run(
      "resent",
      "Reenvio",
      "2026-10-01T10:00:00.000Z",
      "2026-10-21T10:00:00.000Z",
    );
    add.run(
      "missing-audit",
      "Sem auditoria histórica",
      "2026-10-01T10:00:00.000Z",
      "2026-10-22T10:00:00.000Z",
    );
    const audit = db.prepare(
      "INSERT INTO auditLog(action,entityId,createdAt) VALUES (?,?,?)",
    );
    audit.run("request.submitted", "resent", "2026-10-02T10:00:00.000Z");
    audit.run("request.submitted", "first-send", "2026-10-10T10:00:00.000Z");
    audit.run("request.submitted", "old-draft", "2026-10-20T10:00:00.000Z");
    audit.run("request.rejectd", "resent", "2026-10-20T11:00:00.000Z");
    audit.run("request.submitted", "resent", "2026-10-21T10:00:00.000Z");
    db.close();
    db = openDatabase(dbPath);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
    const rows = db
      .prepare(
        "SELECT id,name,submittedAt,queueSequence,organizer FROM events ORDER BY queueSequence",
      )
      .all();
    assert.deepEqual(
      rows.map((e) => e.id),
      ["first-send", "old-draft", "resent", "missing-audit"],
    );
    assert.equal(
      rows[0].submittedAt,
      "2026-10-10T10:00:00.000Z",
      "last edit must not change historical send order",
    );
    assert.equal(rows[2].submittedAt, "2026-10-21T10:00:00.000Z");
    assert.ok(rows.every((e) => e.organizer === ""));
    assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM auditLog").get().n, 5);
    db.close();
    db = openDatabase(dbPath);
    assert.deepEqual(
      db
        .prepare(
          "SELECT id,name,submittedAt,queueSequence,organizer FROM events ORDER BY queueSequence",
        )
        .all(),
      rows,
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Registration explicitly selects a profile; visitors need only email/password and requesters supply private company details", async () => {
  const f = await fixture();
  try {
    const base = { email: "minimal@example.test", password: PASSWORD };
    assert.equal(
      (await f.request("/auth/register", { method: "POST", body: base }))
        .status,
      400,
    );
    const visitor = await f.request("/auth/register", {
      method: "POST",
      body: { ...base, role: "visitor" },
    });
    assert.equal(visitor.status, 201);
    assert.equal(visitor.data.user.name, "Visitante");
    assert.equal(visitor.data.user.companyName, "");
    assert.equal(visitor.data.user.cnpj, "");
    const requesterBody = {
      role: "requester",
      name: "Solicitante fictício",
      email: "company@example.test",
      password: PASSWORD,
      companyName: "  Empresa de testes  ",
      cnpj: "12.abc.345/01de-35",
    };
    for (const field of ["name", "companyName", "cnpj"]) {
      const body = { ...requesterBody };
      delete body[field];
      const result = await f.request("/auth/register", {
        method: "POST",
        body,
      });
      assert.equal(result.status, 400, `Missing ${field} must fail`);
    }
    assert.equal(
      (
        await f.request("/auth/register", {
          method: "POST",
          body: { ...requesterBody, cnpj: "12.ABC.345/01DE-34" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/auth/register", {
          method: "POST",
          body: { ...requesterBody, companyName: "X".repeat(201) },
        })
      ).status,
      400,
    );
    const requester = await f.request("/auth/register", {
      method: "POST",
      body: requesterBody,
    });
    assert.equal(requester.status, 201, JSON.stringify(requester.data));
    assert.equal(requester.data.user.companyName, "Empresa de testes");
    assert.equal(requester.data.user.cnpj, "12ABC34501DE35");
    const stored = f.db
      .prepare("SELECT companyName,cnpj FROM users WHERE id=?")
      .get(requester.data.user.id);
    assert.equal(stored.companyName, "Empresa de testes");
    assert.equal(stored.cnpj, "12ABC34501DE35");
    const login = await f.request("/auth/login", {
      method: "POST",
      body: { email: requesterBody.email, password: PASSWORD },
    });
    assert.equal(login.status, 200);
    assert.deepEqual(login.data.user, requester.data.user);
    assert.deepEqual(
      (await f.request("/auth/me", { cookie: login.cookie })).data.user,
      requester.data.user,
    );
    const listed = (
      await f.request("/admin/users", { cookie: f.admin })
    ).data.users.find((u) => u.id === requester.data.user.id);
    assert.equal(listed.companyName, stored.companyName);
    assert.equal(listed.cnpj, stored.cnpj);
    f.db
      .prepare(
        "INSERT INTO events(id,authorId,name,status,date,startTime,endTime,createdAt,updatedAt) VALUES (?,?,?,'approved','2026-10-24','10:00','11:00',?,?)",
      )
      .run(
        "company-public-test",
        requester.data.user.id,
        "Evento fictício público",
        fixedNow().toISOString(),
        fixedNow().toISOString(),
      );
    const publicAgenda = await f.request("/events");
    assert.equal(publicAgenda.data.events.length, 1);
    for (const path of ["/events", "/metadata", "/auth/me"]) {
      const output = JSON.stringify((await f.request(path)).data);
      assert.ok(
        !output.includes("companyName") && !output.includes("cnpj"),
        path,
      );
      assert.ok(
        !output.includes(stored.companyName) && !output.includes(stored.cnpj),
        path,
      );
    }
    assert.equal(
      (await f.request("/admin/users", { cookie: visitor.cookie })).status,
      403,
    );
  } finally {
    await f.close();
  }
});

test("CNPJ validates numeric and alphanumeric check digits and rejects malformed values without discarding letters", () => {
  assert.equal(cnpjField("12.345.678/0001-95", true), "12345678000195");
  assert.equal(cnpjField("12.ABC.345/01DE-35", true), "12ABC34501DE35");
  assert.equal(cnpjField("  12abc34501de35  ", true), "12ABC34501DE35");
  assert.equal(cnpjField(""), "");
  for (const value of [
    "",
    "00000000000000",
    "11111111111111",
    "12345678000194",
    "12ABC34501DE34",
    "12ABC34501DE3A",
    "12.ABC.345/01DE35",
    "12 ABC34501DE35",
    "12ABC34501DÉ35",
    "12ABC34501DE35!",
    12345678000195,
  ])
    assert.throws(
      () => cnpjField(value, true),
      (error) => error.status === 400,
      String(value),
    );
});

test("Administrative company changes require complete valid details while preserving legacy requester edits", async () => {
  const f = await fixture();
  try {
    const base = {
      name: "Conta fictícia",
      email: "admin-created-requester@example.test",
      password: PASSWORD,
      role: "requester",
    };
    assert.equal(
      (
        await f.request("/admin/users", {
          method: "POST",
          cookie: f.admin,
          body: base,
        })
      ).status,
      400,
    );
    const created = await f.request("/admin/users", {
      method: "POST",
      cookie: f.admin,
      body: {
        ...base,
        companyName: "Empresa criada pelo administrador",
        cnpj: "12.345.678/0001-95",
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.user.cnpj, "12345678000195");
    const update = (id, body) =>
      f.request(`/admin/users/${id}`, { method: "PUT", cookie: f.admin, body });
    assert.equal(
      (await update(created.data.user.id, { companyName: "", cnpj: "" }))
        .status,
      400,
    );
    const renamed = await update(created.data.user.id, {
      name: "Nome alterado",
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.user.companyName, created.data.user.companyName);
    assert.equal(renamed.data.user.cnpj, created.data.user.cnpj);
    const changed = await update(created.data.user.id, {
      companyName: "Empresa alterada",
      cnpj: "12abc34501de35",
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.user.cnpj, "12ABC34501DE35");
    f.db
      .prepare(
        "INSERT INTO users(id,name,email,passwordHash,role,createdAt) VALUES ('legacy-requester','Conta antiga','legacy-requester@example.test','unused','requester',?)",
      )
      .run(fixedNow().toISOString());
    const legacy = await update("legacy-requester", {
      name: "Conta antiga revisada",
      companyName: "",
      cnpj: "",
    });
    assert.equal(legacy.status, 200);
    assert.equal(legacy.data.user.companyName, "");
    assert.equal(legacy.data.user.cnpj, "");
    assert.equal(
      (await update("legacy-requester", { companyName: "Empresa incompleta" }))
        .status,
      400,
    );
    assert.equal(
      (
        await update("legacy-requester", {
          companyName: "Empresa válida",
          cnpj: "12345678000195",
        })
      ).status,
      200,
    );
    const visitor = await register(
      f,
      "promoted-visitor@example.test",
      "visitor",
    );
    assert.equal(
      (await update(visitor.user.id, { role: "requester" })).status,
      400,
    );
    assert.equal(
      (
        await update(visitor.user.id, {
          role: "requester",
          companyName: "Empresa de promoção",
          cnpj: "12345678000195",
        })
      ).status,
      200,
    );
  } finally {
    await f.close();
  }
});

test("Version 2 company migration is additive, preserves existing data and allows legacy login after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "univille-company-migration-"));
  const dbPath = join(directory, "events.sqlite");
  let db = openDatabase(dbPath);
  let server;
  try {
    const encoded = await hashPassword(PASSWORD);
    db.prepare(
      "INSERT INTO users(id,name,email,passwordHash,role,createdAt) VALUES ('legacy-owner','Pessoa antiga','legacy-owner@example.test',?,'requester',?)",
    ).run(encoded, fixedNow().toISOString());
    db.exec(`INSERT INTO events(id,authorId,name,status,createdAt,updatedAt) VALUES ('legacy-event','legacy-owner','Pedido preservado','draft','2026-10-22T10:00:00.000Z','2026-10-22T10:00:00.000Z');
      INSERT INTO sessions(tokenHash,userId,expiresAt) VALUES ('legacy-session','legacy-owner',9999999999999);
      INSERT INTO themes(id,name) VALUES ('legacy-theme','Tema preservado');
      INSERT INTO auditLog(actorId,action,entityId,createdAt) VALUES ('legacy-owner','request.created','legacy-event','2026-10-22T10:00:00.000Z');
      ALTER TABLE users DROP COLUMN companyName;
      ALTER TABLE users DROP COLUMN cnpj;
      PRAGMA user_version=2;`);
    const snapshot = Object.fromEntries(
      ["users", "events", "sessions", "themes", "auditLog"].map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table}`).all(),
      ]),
    );
    db.close();
    const app = createApp({ dbPath, now: fixedNow });
    db = app.locals.db;
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
    const migrated = db
      .prepare("SELECT * FROM users WHERE id='legacy-owner'")
      .get();
    assert.equal(migrated.companyName, "");
    assert.equal(migrated.cnpj, "");
    const { companyName, cnpj, ...legacyUser } = migrated;
    assert.deepEqual(legacyUser, { ...snapshot.users[0] });
    for (const table of ["events", "sessions", "themes", "auditLog"])
      assert.deepEqual(
        db.prepare(`SELECT * FROM ${table}`).all(),
        snapshot[table],
      );
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const login = await fetch(
      `http://127.0.0.1:${server.address().port}/api/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "legacy-owner@example.test",
          password: PASSWORD,
        }),
      },
    );
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.companyName, "");
    await new Promise((resolve) => server.close(resolve));
    server = null;
    db.prepare(
      "UPDATE users SET companyName='Empresa adicionada depois',cnpj='12345678000195' WHERE id='legacy-owner'",
    ).run();
    const saved = db.prepare("SELECT * FROM users").all();
    db.close();
    db = openDatabase(dbPath);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
    assert.deepEqual(db.prepare("SELECT * FROM users").all(), saved);
    assert.equal(db.prepare("SELECT count(*) AS n FROM events").get().n, 1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
