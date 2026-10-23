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
    PRAGMA user_version = 1;
  `);
  return db;
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
