import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function databasePath() {
  return resolve(process.env.DATA_DIR || "data", "events.sqlite");
}

export function openDatabase(path = databasePath()) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      passwordHash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('visitor','requester','admin')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expiresAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expiresAt);
    CREATE TABLE IF NOT EXISTS themes (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS costCenters (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      costCenterId TEXT NOT NULL REFERENCES costCenters(id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS roomResources (
      roomId TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
      PRIMARY KEY(roomId,resourceId)
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, authorId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      name TEXT NOT NULL DEFAULT '', themeId TEXT REFERENCES themes(id) ON DELETE RESTRICT,
      date TEXT NOT NULL DEFAULT '', startTime TEXT NOT NULL DEFAULT '', endTime TEXT NOT NULL DEFAULT '',
      roomId TEXT REFERENCES rooms(id) ON DELETE RESTRICT,
      courseId TEXT REFERENCES courses(id) ON DELETE RESTRICT,
      costCenterId TEXT REFERENCES costCenters(id) ON DELETE RESTRICT,
      requesterName TEXT NOT NULL DEFAULT '', speaker TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '',
      justification TEXT NOT NULL DEFAULT '', objective TEXT NOT NULL DEFAULT '',
      ceremony INTEGER CHECK(ceremony IS NULL OR ceremony IN (0,1)),
      registration INTEGER CHECK(registration IS NULL OR registration IN (0,1)),
      certificates INTEGER CHECK(certificates IS NULL OR certificates IN (0,1)),
      notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('draft','pending','rejected','approved','cancelled')),
      rejectionReason TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_schedule ON events(roomId,date,status,startTime,endTime);
    CREATE INDEX IF NOT EXISTS events_author ON events(authorId,status);
    CREATE TABLE IF NOT EXISTS eventResources (
      eventId TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
      PRIMARY KEY(eventId,resourceId)
    );
    CREATE TABLE IF NOT EXISTS auditLog (
      id INTEGER PRIMARY KEY, actorId TEXT REFERENCES users(id), action TEXT NOT NULL,
      entityId TEXT NOT NULL, createdAt TEXT NOT NULL
    );
  `);
  migrateEventQueue(db);
  migrateCompanyDetails(db);
  return db;
}

function migrateCompanyDetails(db) {
  if (db.prepare("PRAGMA user_version").get().user_version >= 3) return;
  transaction(db, () => {
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(users)")
        .all()
        .map((row) => row.name),
    );
    // Empty values preserve legacy accounts without inventing company data or
    // preventing an existing user from signing in.
    for (const name of ["companyName", "cnpj"]) {
      if (!columns.has(name))
        db.exec(
          `ALTER TABLE users ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`,
        );
    }
    db.exec("PRAGMA user_version = 3");
  });
}

// Additive migration: published accounts, requests and audit history remain intact.
function migrateEventQueue(db) {
  if (db.prepare("PRAGMA user_version").get().user_version >= 2) return;
  transaction(db, () => {
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(events)")
        .all()
        .map((row) => row.name),
    );
    for (const [name, definition] of [
      ["organizer", "TEXT NOT NULL DEFAULT ''"],
      ["audienceCourseId", "TEXT REFERENCES courses(id) ON DELETE RESTRICT"],
      ["audienceSemester", "TEXT NOT NULL DEFAULT ''"],
      ["submittedAt", "TEXT"],
      ["queueSequence", "INTEGER"],
    ]) {
      if (!columns.has(name))
        db.exec(`ALTER TABLE events ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS submissionQueue (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, eventId TEXT NOT NULL, submittedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_pending_queue ON events(status,queueSequence);
    CREATE UNIQUE INDEX IF NOT EXISTS events_queue_sequence ON events(queueSequence) WHERE queueSequence IS NOT NULL;`);
    // Use the most recent actual send. Pending rows must have a send after their
    // latest rejection. Legacy records without a matching audit use updatedAt,
    // then createdAt, solely as an explicit migration fallback.
    const historical = db
      .prepare(
        `SELECT e.id,e.updatedAt,e.createdAt,
      (SELECT a.createdAt FROM auditLog a WHERE a.entityId=e.id AND a.action='request.submitted'
        AND (e.status<>'pending' OR a.id>COALESCE((SELECT MAX(r.id) FROM auditLog r
          WHERE r.entityId=e.id AND r.action IN ('request.rejected','request.rejectd')),0))
        ORDER BY a.id DESC LIMIT 1) AS sentAt,
      (SELECT MAX(a.id) FROM auditLog a WHERE a.entityId=e.id AND a.action='request.submitted') AS sendAuditId
      FROM events e WHERE e.status<>'draft' AND e.queueSequence IS NULL`,
      )
      .all();
    historical.sort(
      (a, b) =>
        (a.sentAt || a.updatedAt || a.createdAt).localeCompare(
          b.sentAt || b.updatedAt || b.createdAt,
        ) ||
        (a.sendAuditId ?? 0) - (b.sendAuditId ?? 0) ||
        a.id.localeCompare(b.id),
    );
    const insert = db.prepare(
      "INSERT INTO submissionQueue(eventId,submittedAt) VALUES (?,?)",
    );
    const update = db.prepare(
      "UPDATE events SET submittedAt=?,queueSequence=? WHERE id=?",
    );
    for (const row of historical) {
      const at = row.sentAt || row.updatedAt || row.createdAt;
      const result = insert.run(row.id, at);
      update.run(at, Number(result.lastInsertRowid), row.id);
    }
    db.exec("PRAGMA user_version = 2");
  });
}

export function transaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
