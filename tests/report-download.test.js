import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
import { readPdf } from "./pdf-reader.js";

test("PDF download requires administration, validates periods and exports only approved events matching all filters", async () => {
  const app = createApp({ dbPath: ":memory:" });
  const db = app.locals.db;
  let server;
  try {
    const password = "Senha fictícia para testes!";
    const hash = await hashPassword(password);
    for (const role of ["admin", "visitor", "requester"])
      db.prepare(
        "INSERT INTO users(id,name,email,passwordHash,role,createdAt) VALUES (?,?,?,?,?,?)",
      ).run(
        role,
        role,
        `${role}@pdf.example.test`,
        hash,
        role,
        "2026-10-23T15:00:00Z",
      );
    db.exec(`INSERT INTO costCenters(id,name) VALUES ('center','Extensão');
      INSERT INTO courses(id,name,costCenterId) VALUES ('course','Engenharia','center'),('other-course','Administração','center');
      INSERT INTO rooms(id,name) VALUES ('room','Auditório');
      INSERT INTO themes(id,name) VALUES ('theme','Comunidade'),('other-theme','Tecnologia');`);
    const insert =
      db.prepare(`INSERT INTO events(id,authorId,name,date,startTime,endTime,courseId,themeId,roomId,status,createdAt,updatedAt)
      VALUES (?,'admin',?,?,'19:00','21:00',?,?,'room',?,'2026-10-23T15:00:00Z','2026-10-23T15:00:00Z')`);
    for (const [id, date, course, theme, status] of [
      ["selecionado", "2026-10-23", "course", "theme", "approved"],
      ["pendente", "2026-10-23", "course", "theme", "pending"],
      ["fora-do-periodo", "2026-11-01", "course", "theme", "approved"],
      ["outro-setor", "2026-10-23", "other-course", "theme", "approved"],
      ["outro-tema", "2026-10-23", "course", "other-theme", "approved"],
    ])
      insert.run(id, `EVENTO-${id}`, date, course, theme, status);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const query = new URLSearchParams({
      from: "2026-10-18",
      to: "2026-10-31",
      period: "custom",
      courseId: "course",
      themeId: "theme",
      status: "pending",
    });
    async function download(cookie, parameters = query) {
      return fetch(`${origin}/api/admin/agenda.pdf?${parameters}`, {
        headers: cookie ? { Cookie: cookie } : {},
      });
    }
    const anonymous = await download();
    assert.equal(anonymous.status, 401);
    await anonymous.arrayBuffer();
    for (const role of ["visitor", "requester", "admin"]) {
      const login = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `${role}@pdf.example.test`, password }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      await login.arrayBuffer();
      const response = await download(cookie);
      if (role !== "admin") {
        assert.equal(response.status, 403);
        await response.arrayBuffer();
        continue;
      }
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.equal(
        response.headers.get("content-disposition"),
        "attachment; filename=agenda-univille-2026-10-18-2026-10-31.pdf",
      );
      const buffer = Buffer.from(await response.arrayBuffer());
      assert.equal(
        Number(response.headers.get("content-length")),
        buffer.length,
      );
      const { text } = await readPdf(buffer);
      assert.match(text, /EVENTO-selecionado/);
      for (const absent of [
        "pendente",
        "fora-do-periodo",
        "outro-setor",
        "outro-tema",
      ])
        assert.ok(!text.includes(`EVENTO-${absent}`), absent);
      assert.match(text, /18\/10\/2026 a 31\/10\/2026/);
      for (const invalid of [
        { to: "2026-10-31" },
        { from: "2026-10-18" },
        { from: "2026-10-32", to: "2026-10-31" },
        { from: "2026-11-01", to: "2026-10-31" },
        { from: "2026-10-18", to: "2026-10-31", period: "invalid" },
      ]) {
        const rejected = await download(cookie, new URLSearchParams(invalid));
        assert.equal(rejected.status, 400, JSON.stringify(invalid));
        await rejected.arrayBuffer();
      }
      const empty = await download(
        cookie,
        new URLSearchParams({ from: "2027-01-01", to: "2027-01-31" }),
      );
      assert.equal(empty.status, 200);
      assert.match(
        (await readPdf(Buffer.from(await empty.arrayBuffer()))).text,
        /Nenhum evento aprovado/,
      );
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
