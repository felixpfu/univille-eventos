import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { generateAgendaPptx } from "../server/presentation.js";

// Read the ZIP container without adding a test-only dependency to production.
function unpack(buffer) {
  const files = new Map();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  assert.ok(end >= 0, "PPTX must have a ZIP central directory");
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString();
    const start =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + size);
    assert.ok(method === 0 || method === 8);
    files.set(name, method === 8 ? inflateRawSync(raw) : raw);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
function slideXml(files) {
  return [...files]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(
      ([a], [b]) =>
        Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]),
    )
    .map(([, contents]) => contents.toString());
}
const event = {
  name: "Evento de extensão",
  themeName: "Formação e comunidade",
  date: "2026-10-23",
  startTime: "19:00",
  endTime: "21:00",
  roomName: "Miniauditório",
  audience: "Alunos",
  audienceCourseName: "Engenharia de Software",
  audienceSemester: "3",
  speaker: "Palestrante convidado",
  organizer: "Coordenação de extensão",
  authorName: "Autor que não organiza",
  status: "approved",
};

test("PowerPoint agenda uses an editable eight-column native table, official logo and escaped data", async () => {
  const buffer = await generateAgendaPptx(
    [
      { ...event, name: "Z & <evento>", date: "2026-10-24" },
      { ...event, name: "Primeiro evento" },
    ],
    { from: "2026-10-19", to: "2026-10-25" },
  );
  assert.ok(Buffer.isBuffer(buffer));
  const files = unpack(buffer);
  const slides = slideXml(files);
  assert.equal(slides.length, 1);
  const xml = slides[0];
  assert.match(xml, /<a:tbl>/);
  assert.equal((xml.match(/<a:gridCol\b/g) || []).length, 8);
  const readable = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
    .map((match) => match[1])
    .join(" ")
    .replace(/\s+/g, " ");
  for (const text of [
    "Agenda semanal de eventos",
    "Univille campus São Bento do Sul",
    "Realização",
    "23/10/2026",
    "Coordenação de extensão",
    "Engenharia de Software",
    "3º semestre",
  ])
    assert.ok(readable.includes(text), text);
  assert.ok(
    xml.indexOf("Primeiro evento") < xml.indexOf("Z &amp; &lt;evento&gt;"),
  );
  assert.ok(!xml.includes(event.authorName));
  assert.ok(
    [...files.keys()].some((name) => /^ppt\/media\/.*\.png$/.test(name)),
  );
  assert.match(
    files.get("ppt/presentation.xml").toString(),
    /cx="12192000" cy="6858000"/,
  );
});

test("annual agenda paginates many events and preserves long cells within slide bounds", async () => {
  const longName = `INÍCIO ${"Texto longo e editável Á&<> ".repeat(150)} FIM-DO-EVENTO`;
  const rows = Array.from({ length: 55 }, (_, index) => ({
    ...event,
    name: `Evento ${index + 1}`,
  }));
  rows.push({
    ...event,
    name: longName,
    audience: "Público detalhado ".repeat(160),
    organizer: "Organização".repeat(50),
  });
  const files = unpack(
    await generateAgendaPptx(rows, {
      from: "2026-01-01",
      to: "2026-12-31",
      period: "year",
    }),
  );
  const slides = slideXml(files);
  assert.ok(slides.length > 5);
  const combined = slides.join("");
  assert.match(combined, /FIM-DO-EVENTO/);
  assert.match(combined, /\(continuação\)/);
  const cells = slides.flatMap((xml) =>
    [...xml.matchAll(/<a:tr[^>]*>([\s\S]*?)<\/a:tr>/g)]
      .slice(1)
      .map((row) => row[1].match(/<a:tc[^>]*>([\s\S]*?)<\/a:tc>/)[1]),
  );
  const texts = cells
    .flatMap((cell) =>
      [...cell.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]),
    )
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '\"')
    .replace(/&apos;/g, "'")
    .replace(/\s|\(continuação\)/g, "");
  assert.ok(
    texts.includes(longName.replace(/\s/g, "")),
    "long event text remains editable and complete",
  );
  for (const xml of slides) {
    assert.match(xml, /Agenda anual de eventos/);
    assert.equal((xml.match(/<a:gridCol\b/g) || []).length, 8);
    const height = [...xml.matchAll(/<a:tr h="(\d+)"/g)].reduce(
      (sum, match) => sum + Number(match[1]),
      0,
    );
    assert.ok(
      height <= (4.35 + 0.48) * 914400 + 10,
      "table stays above the institutional footer",
    );
    assert.match(xml, /<p:pic>/);
  }
});

test("empty agenda preserves template and a clear empty state", async () => {
  const slides = slideXml(
    unpack(
      await generateAgendaPptx([], {
        from: "2027-01-01",
        to: "2027-01-31",
        period: "custom",
      }),
    ),
  );
  assert.equal(slides.length, 1);
  assert.match(slides[0], /Nenhum evento aprovado no período selecionado/);
  assert.match(slides[0], /Agenda de eventos/);
  assert.match(slides[0], /01\/01\/2027 a 31\/01\/2027/);
  assert.match(slides[0], /<a:tbl>/);
});
