import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.js";
import { openDatabase } from "../server/db.js";
import { roomImages } from "../server/room-media.js";
import { createAdministrator } from "../scripts/admin.js";

const PASSWORD = "Senha ficticia salas 2026!";
const NOW = "2026-10-23T15:00:00.000Z";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "univille-rooms-"));
  const dbPath = join(directory, "events.sqlite");
  await createAdministrator({
    dbPath,
    name: "Admin de teste",
    email: "rooms-admin@example.test",
    password: PASSWORD,
  });
  const app = createApp({ dbPath, now: () => new Date(NOW) });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = "GET", body, rawBody, cookie } = {}) {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined || rawBody !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body !== undefined || rawBody !== undefined
        ? { body: rawBody ?? JSON.stringify(body) }
        : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const login = await request("/auth/login", {
    method: "POST",
    body: { email: "rooms-admin@example.test", password: PASSWORD },
  });
  assert.equal(login.status, 200);
  return {
    db: app.locals.db,
    request,
    admin: login.cookie,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      app.locals.db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function add(f, entity, body) {
  const result = await f.request(`/admin/catalog/${entity}`, {
    method: "POST",
    cookie: f.admin,
    body,
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.item;
}

test("fresh room schema is empty and defaults to unknown capacity and no image", () => {
  const db = openDatabase(":memory:");
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 5);
    for (const table of ["rooms", "users", "events", "resources"])
      assert.equal(
        db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count,
        0,
      );
    db.prepare("INSERT INTO rooms(id,name) VALUES (?,?)").run(
      "empty-room",
      "Sala sem dados",
    );
    assert.deepEqual(
      { ...db.prepare("SELECT * FROM rooms").get() },
      {
        id: "empty-room",
        name: "Sala sem dados",
        description: "",
        capacity: null,
        imageKey: "",
      },
    );
    assert.throws(
      () => db.prepare("UPDATE rooms SET capacity=0").run(),
      /constraint/i,
    );
    assert.throws(
      () => db.prepare("UPDATE rooms SET capacity=1.5").run(),
      /constraint/i,
    );
  } finally {
    db.close();
  }
});

test("v4 to v5 migration preserves accounts, event versions, all catalogs and resource references idempotently", () => {
  const directory = mkdtempSync(join(tmpdir(), "univille-rooms-migration-"));
  const path = join(directory, "events.sqlite");
  let db = openDatabase(path);
  const tables = [
    "users",
    "sessions",
    "themes",
    "costCenters",
    "resources",
    "courses",
    "roomResources",
    "events",
    "eventResources",
    "auditLog",
    "submissionQueue",
  ];
  const snapshot = () =>
    Object.fromEntries(
      tables.map((table) => [
        table,
        db
          .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
          .all()
          .map((row) => ({ ...row })),
      ]),
    );
  try {
    db.exec(`
      INSERT INTO users(id,name,email,passwordHash,role,active,createdAt,companyName,cnpj)
        VALUES ('user','Nome preservado','migration@example.test','HASH-FICTICIO','requester',1,'${NOW}','Empresa preservada','12345678000195');
      INSERT INTO sessions VALUES ('TOKEN-HASH-FICTICIO','user',1900000000000);
      INSERT INTO themes VALUES ('theme','Tema preservado','Descrição do tema');
      INSERT INTO costCenters VALUES ('cost','Centro preservado','Descrição interna');
      INSERT INTO resources VALUES ('resource','Recurso preservado','Descrição do recurso');
      INSERT INTO rooms(id,name,description) VALUES ('room','Auditório','Descrição preservada');
      INSERT INTO courses VALUES ('course','Curso preservado','Descrição do curso','cost');
      INSERT INTO roomResources VALUES ('room','resource');
      INSERT INTO submissionQueue(sequence,eventId,submittedAt) VALUES (41,'event','${NOW}');
      INSERT INTO events(id,authorId,name,themeId,date,startTime,endTime,roomId,courseId,costCenterId,requesterName,speaker,audience,justification,objective,ceremony,registration,certificates,notes,status,rejectionReason,version,createdAt,updatedAt,organizer,audienceCourseId,audienceSemester,submittedAt,queueSequence,publicDescription)
        VALUES ('event','user','Evento preservado','theme','2026-11-01','08:00','10:00','room','course','cost','Solicitante preservado','Palestrante','Público','Justificativa privada','Objetivo privado',0,1,1,'Notas privadas','approved','',7,'${NOW}','${NOW}','Realização','course','3','${NOW}',41,'Descrição pública preservada');
      INSERT INTO eventResources VALUES ('event','resource');
      INSERT INTO auditLog(actorId,action,entityId,createdAt) VALUES ('user','request.approved','event','${NOW}');
      ALTER TABLE rooms DROP COLUMN capacity;
      ALTER TABLE rooms DROP COLUMN imageKey;
      PRAGMA user_version=4;
    `);
    const before = snapshot();
    const roomBefore = { ...db.prepare("SELECT * FROM rooms").get() };
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 5);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(
      { ...db.prepare("SELECT * FROM rooms").get() },
      { ...roomBefore, capacity: null, imageKey: "" },
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    db.prepare("UPDATE rooms SET capacity=?,imageKey=? WHERE id='room'").run(
      300,
      "auditorio-sbs",
    );
    const after = { ...db.prepare("SELECT * FROM rooms").get() };
    db.close();
    db = openDatabase(path);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual({ ...db.prepare("SELECT * FROM rooms").get() }, after);
    assert.equal(db.prepare("SELECT version FROM events").get().version, 7);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("anonymous metadata exposes room capacity and curated local media without private catalog fields", async () => {
  const f = await fixture();
  try {
    const resource = await add(f, "resources", {
      name: "RECURSO-INTERNO-NÃO-PÚBLICO",
    });
    await add(f, "costCenters", { name: "CENTRO-INTERNO-NÃO-PÚBLICO" });
    const room = await add(f, "rooms", {
      name: "Auditório",
      capacity: 300,
      imageKey: "auditorio-sbs",
      resourceIds: [resource.id],
    });
    const result = await f.request("/metadata");
    assert.equal(result.status, 200);
    const publicRoom = result.data.rooms.find((item) => item.id === room.id);
    assert.deepEqual(Object.keys(publicRoom).sort(), [
      "capacity",
      "description",
      "id",
      "imageKey",
      "name",
    ]);
    assert.equal(publicRoom.capacity, 300);
    assert.equal(publicRoom.imageKey, "auditorio-sbs");
    assert.deepEqual(result.data.resources, []);
    assert.deepEqual(result.data.costCenters, []);
    assert.ok(!JSON.stringify(result.data).includes(resource.name));
    assert.ok(!JSON.stringify(result.data).includes("passwordHash"));
    assert.deepEqual(result.data.roomImages, roomImages);
    for (const image of result.data.roomImages) {
      assert.deepEqual(Object.keys(image).sort(), [
        "alt",
        "credit",
        "key",
        "kind",
        "label",
        "path",
        "sourceUrl",
      ]);
      assert.match(image.path, /^\/venues\/[a-z-]+\.webp$/);
      assert.ok(["photo", "illustration"].includes(image.kind));
      assert.ok(image.label && image.alt && image.credit);
    }
    const full = await f.request("/metadata", { cookie: f.admin });
    assert.equal(full.data.rooms[0].capacity, 300);
    assert.deepEqual(full.data.rooms[0].resourceIds, [resource.id]);
    assert.deepEqual(full.data.roomImages, result.data.roomImages);
  } finally {
    await f.close();
  }
});

test("only administrators can create or update room capacity and image selections", async () => {
  const f = await fixture();
  try {
    const room = await add(f, "rooms", { name: "Auditório", capacity: 300 });
    for (const role of ["visitor", "requester"]) {
      const registration = await f.request("/auth/register", {
        method: "POST",
        body: {
          email: `rooms-${role}@example.test`,
          password: PASSWORD,
          role,
          ...(role === "requester"
            ? {
                name: "Solicitante fictício",
                companyName: "Empresa fictícia",
                cnpj: "12345678000195",
              }
            : {}),
        },
      });
      assert.equal(registration.status, 201);
      for (const [path, method, body] of [
        [
          "/admin/catalog/rooms",
          "POST",
          { name: "Sala não autorizada", capacity: 120 },
        ],
        [
          `/admin/catalog/rooms/${room.id}`,
          "PUT",
          { capacity: 120, imageKey: "miniauditorio-ilustrativo" },
        ],
      ]) {
        assert.equal(
          (await f.request(path, { method, body, cookie: registration.cookie }))
            .status,
          403,
        );
        assert.equal((await f.request(path, { method, body })).status, 401);
      }
    }
    assert.equal(
      f.db.prepare("SELECT count(*) AS count FROM rooms").get().count,
      1,
    );
    assert.equal(
      f.db.prepare("SELECT capacity FROM rooms").get().capacity,
      300,
    );
  } finally {
    await f.close();
  }
});

test("room edits preserve omitted fields and legacy defaults, and can explicitly clear capacity and image", async () => {
  const f = await fixture();
  try {
    const resource = await add(f, "resources", { name: "Recurso fictício" });
    const room = await add(f, "rooms", {
      name: "Auditório",
      description: "Descrição preservada",
      capacity: 300,
      imageKey: "auditorio-sbs",
      resourceIds: [resource.id],
    });
    const renamed = await f.request(`/admin/catalog/rooms/${room.id}`, {
      method: "PUT",
      cookie: f.admin,
      body: { name: "Auditório principal" },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.item.capacity, 300);
    assert.equal(renamed.data.item.imageKey, "auditorio-sbs");
    assert.equal(renamed.data.item.description, "Descrição preservada");
    assert.deepEqual(renamed.data.item.resourceIds, [resource.id]);
    const changed = await f.request(`/admin/catalog/rooms/${room.id}`, {
      method: "PUT",
      cookie: f.admin,
      body: { capacity: 120, imageKey: "miniauditorio-ilustrativo" },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.item.capacity, 120);
    assert.equal(changed.data.item.imageKey, "miniauditorio-ilustrativo");
    const cleared = await f.request(`/admin/catalog/rooms/${room.id}`, {
      method: "PUT",
      cookie: f.admin,
      body: { capacity: null, imageKey: "" },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.item.capacity, null);
    assert.equal(cleared.data.item.imageKey, "");
    assert.deepEqual(cleared.data.item.resourceIds, [resource.id]);
    const legacy = await add(f, "rooms", { name: "Sala sem dados antigos" });
    assert.equal(legacy.capacity, null);
    assert.equal(legacy.imageKey, "");
    const editedLegacy = await f.request(`/admin/catalog/rooms/${legacy.id}`, {
      method: "PUT",
      cookie: f.admin,
      body: { description: "Descrição atualizada" },
    });
    assert.equal(editedLegacy.status, 200);
    assert.equal(editedLegacy.data.item.capacity, null);
    assert.equal(editedLegacy.data.item.imageKey, "");
    for (const capacity of [1, 100000])
      assert.equal(
        (await add(f, "rooms", { name: `Sala ${capacity}`, capacity }))
          .capacity,
        capacity,
      );
  } finally {
    await f.close();
  }
});

test("invalid capacities and image keys return 400 without changing rooms or their resource links", async () => {
  const f = await fixture();
  try {
    const resource = await add(f, "resources", { name: "Recurso fictício" });
    const room = await add(f, "rooms", {
      name: "Auditório",
      capacity: 300,
      imageKey: "auditorio-sbs",
      resourceIds: [resource.id],
    });
    const before = {
      ...f.db.prepare("SELECT * FROM rooms WHERE id=?").get(room.id),
    };
    const invalid = [
      ...[0, -1, 1.5, 100001, "300", "-1", "", true, [], {}].map(
        (capacity) => ({ capacity }),
      ),
      ...[
        null,
        120,
        [],
        {},
        "unknown",
        "https://example.test/photo.webp",
        "/venues/auditorio-sbs.webp",
        "../image.webp",
      ].map((imageKey) => ({ imageKey })),
    ];
    for (const body of invalid) {
      const result = await f.request(`/admin/catalog/rooms/${room.id}`, {
        method: "PUT",
        cookie: f.admin,
        body,
      });
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.equal(result.data.code, "VALIDATION_ERROR");
    }
    const infinity = await f.request(`/admin/catalog/rooms/${room.id}`, {
      method: "PUT",
      cookie: f.admin,
      rawBody: '{"capacity":1e400}',
    });
    assert.equal(infinity.status, 400);
    const badCreate = await f.request("/admin/catalog/rooms", {
      method: "POST",
      cookie: f.admin,
      body: { name: "Sala inválida", capacity: -5 },
    });
    assert.equal(badCreate.status, 400);
    assert.deepEqual(
      { ...f.db.prepare("SELECT * FROM rooms WHERE id=?").get(room.id) },
      before,
    );
    assert.deepEqual(
      f.db
        .prepare("SELECT resourceId FROM roomResources WHERE roomId=?")
        .all(room.id)
        .map((row) => row.resourceId),
      [resource.id],
    );
    assert.equal(
      f.db.prepare("SELECT count(*) AS count FROM rooms").get().count,
      1,
    );
  } finally {
    await f.close();
  }
});
