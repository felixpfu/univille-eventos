import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.js";
import { eventList, getEvent } from "../server/domain.js";

function fixture() {
  const db = openDatabase(":memory:");
  db.prepare(
    "INSERT INTO users(id,name,email,passwordHash,role,createdAt) VALUES (?,?,?,?,?,?)",
  ).run(
    "author-a",
    "Autor A",
    "author-a@example.test",
    "unused",
    "requester",
    "2026-01-01T00:00:00Z",
  );
  db.prepare(
    "INSERT INTO users(id,name,email,passwordHash,role,createdAt) VALUES (?,?,?,?,?,?)",
  ).run(
    "author-b",
    "Autor B",
    "author-b@example.test",
    "unused",
    "requester",
    "2026-01-01T00:00:00Z",
  );
  db.exec(`INSERT INTO themes(id,name) VALUES ('theme','Tema');
    INSERT INTO rooms(id,name) VALUES ('room','Ambiente');
    INSERT INTO costCenters(id,name) VALUES ('cost','Centro');
    INSERT INTO courses(id,name,costCenterId) VALUES ('course','Curso organizador','cost'),('audience-course','Curso do público','cost');
    INSERT INTO resources(id,name) VALUES ('resource-z','zebra'),('resource-a','Computador'),('resource-accent','Áudio');`);
  const add = (id, overrides = {}) => {
    const row = {
      id,
      authorId: "author-a",
      name: `Evento ${id}`,
      themeId: "theme",
      date: "2026-10-23",
      startTime: "10:00",
      endTime: "11:00",
      roomId: "room",
      courseId: "course",
      costCenterId: "cost",
      organizer: "Organização explícita",
      audience: "Alunos",
      audienceCourseId: "audience-course",
      audienceSemester: "2",
      ceremony: null,
      registration: 0,
      certificates: 1,
      status: "approved",
      submittedAt: "2026-10-20T12:00:00Z",
      queueSequence: null,
      createdAt: "2026-10-20T12:00:00Z",
      updatedAt: "2026-10-21T12:00:00Z",
      ...overrides,
    };
    const keys = Object.keys(row);
    db.prepare(
      `INSERT INTO events (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    ).run(...Object.values(row));
  };
  const link = (event, resource) =>
    db
      .prepare("INSERT INTO eventResources(eventId,resourceId) VALUES (?,?)")
      .run(event, resource);
  return { db, add, link };
}
function legacyList(db, where = "1=1", params = [], queueOrder = false) {
  return db
    .prepare(
      `SELECT id FROM events WHERE ${where} ORDER BY ${queueOrder ? "CASE WHEN status='pending' THEN 0 ELSE 1 END,CASE WHEN status='pending' THEN queueSequence END ASC," : ""}date ASC,startTime ASC,createdAt DESC`,
    )
    .all(...params)
    .map((row) => getEvent(db, row.id));
}

test("batched event listing preserves complete records, resource ordering, filters and pending queue order", () => {
  const { db, add, link } = fixture();
  try {
    add("later", { date: "2026-10-24", authorId: "author-b" });
    add("earlier", {
      startTime: "09:00",
      endTime: "10:00",
      ceremony: 1,
      registration: null,
      certificates: 0,
    });
    add("newer-created", { createdAt: "2026-10-22T12:00:00Z" });
    add("older-created");
    add("pending-first", {
      status: "pending",
      queueSequence: 1,
      date: "2026-11-01",
    });
    add("pending-second", {
      status: "pending",
      queueSequence: 2,
      date: "2026-10-01",
    });
    add("draft", {
      status: "draft",
      themeId: null,
      roomId: null,
      courseId: null,
      costCenterId: null,
      audienceCourseId: null,
      submittedAt: null,
    });
    link("earlier", "resource-z");
    link("earlier", "resource-accent");
    link("earlier", "resource-a");
    link("later", "resource-z");
    link("pending-first", "resource-a");
    for (const [where, params, queue] of [
      ["1=1", [], false],
      ["status=?", ["approved"], false],
      ["authorId=?", ["author-b"], false],
      ["status<>'draft'", [], true],
      [
        "date>=? AND date<=? AND courseId=? AND themeId=?",
        ["2026-10-23", "2026-10-24", "course", "theme"],
        false,
      ],
      ["id=?", ["earlier"], false],
      ["status=?", ["cancelled"], false],
    ])
      assert.deepEqual(
        eventList(db, where, params, queue),
        legacyList(db, where, params, queue),
      );
    const earlier = eventList(db, "id=?", ["earlier"])[0];
    assert.deepEqual(earlier.resourceNames, ["Computador", "zebra", "Áudio"]);
    assert.equal(earlier.audienceCourseName, "Curso do público");
    assert.equal(earlier.organizer, "Organização explícita");
    assert.equal(earlier.ceremony, true);
    assert.equal(earlier.registration, null);
    assert.equal(earlier.certificates, false);
    assert.deepEqual(
      eventList(db, "status<>'draft'", [], true)
        .slice(0, 2)
        .map((row) => row.id),
      ["pending-first", "pending-second"],
    );
  } finally {
    db.close();
  }
});

test("event listing batches more than SQLite's conservative parameter limit with bounded query count", () => {
  const { db, add, link } = fixture();
  try {
    db.exec("BEGIN");
    for (let i = 0; i < 1100; i += 1) {
      add(`bulk-${i}`);
      if (i % 2 === 0) link(`bulk-${i}`, "resource-a");
    }
    db.exec("COMMIT");
    let queries = 0;
    const counted = {
      prepare(sql) {
        queries += 1;
        return db.prepare(sql);
      },
    };
    const rows = eventList(counted);
    assert.equal(rows.length, 1100);
    assert.equal(
      queries,
      3,
      "one joined row query plus two resource batches, rather than per-event queries",
    );
    assert.deepEqual(rows, legacyList(db));
    queries = 0;
    assert.deepEqual(eventList(counted, "status=?", ["cancelled"]), []);
    assert.equal(queries, 1, "empty results skip resource loading");
  } finally {
    db.close();
  }
});
