import assert from "node:assert/strict";
import test from "node:test";
import { generateAgendaPdf } from "../server/pdf.js";
import { readPdf } from "./pdf-reader.js";

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
  authorName: "AUTOR-PRIVADO-NÃO-EXIBIR",
  justification: "JUSTIFICATIVA-PRIVADA-NÃO-EXIBIR",
  status: "approved",
};
const compact = (value) => value.replace(/\s/g, "");

test("PDF agenda embeds Unicode fonts, the official logo and the eight institutional columns in chronological order", async () => {
  const buffer = await generateAgendaPdf(
    [
      { ...event, name: "Último & <evento>", date: "2026-10-24" },
      { ...event, name: "Primeiro evento" },
    ],
    { from: "2026-10-19", to: "2026-10-25" },
  );
  assert.ok(Buffer.isBuffer(buffer));
  assert.match(buffer.subarray(0, 8).toString(), /^%PDF-1\.7/);
  const { pages, text, metadata } = await readPdf(buffer);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].width, 841.89);
  assert.equal(pages[0].height, 595.28);
  assert.equal(metadata.info.Title, "Agenda semanal de eventos");
  for (const value of [
    "Agenda semanal de eventos",
    "Univille campus São Bento do Sul",
    "19/10/2026 a 25/10/2026",
    "Evento",
    "Tema",
    "Data",
    "Horário",
    "Local",
    "Público alvo",
    "Palestrante/ Ministrante",
    "Realização",
    "23/10/2026",
    "Miniauditório",
    "Coordenação de extensão",
    "Engenharia de Software",
    "3º semestre",
    "Último & <evento>",
  ])
    assert.ok(compact(text).includes(compact(value)), value);
  assert.ok(text.indexOf("Primeiro") < text.indexOf("Último"));
  assert.ok(!text.includes(event.authorName));
  assert.ok(!text.includes(event.justification));
  const raw = buffer.toString("latin1");
  assert.match(raw, /\/FontFile2/);
  assert.match(raw, /NotoSans-Regular/);
  assert.match(raw, /NotoSans-Bold/);
  assert.ok(pages[0].hasImage);
});

test("annual PDF preserves all long text across pages, repeats its header and keeps text above the logo", async () => {
  const longName = `INÍCIO ${"Texto longo e editável Á&<> ".repeat(150)} FIM-DO-EVENTO`;
  const audience = `Público detalhado ${"participantes de extensão ".repeat(160)} FIM-DO-PÚBLICO`;
  const organizer = `${"Organização".repeat(50)} FIM-DA-REALIZAÇÃO`;
  const rows = Array.from({ length: 55 }, (_, index) => ({
    ...event,
    name: `Evento ${index + 1}`,
  }));
  rows.push({ ...event, name: longName, audience, organizer });
  const { pages, text } = await readPdf(
    await generateAgendaPdf(rows, {
      from: "2026-01-01",
      to: "2026-12-31",
      period: "year",
    }),
  );
  assert.ok(pages.length > 5);
  assert.ok(text.includes("(continuação)"));
  const columnText = (left, right) =>
    compact(
      pages
        .flatMap((page) =>
          page.items
            .filter(
              (item) =>
                item.transform[4] >= left &&
                item.transform[4] < right &&
                item.transform[5] < 449 &&
                item.transform[5] >= 595.28 - 516,
            )
            .map((item) => item.str),
        )
        .join(""),
    ).replace(/\(continuação\)/g, "");
  assert.ok(
    columnText(34, 149).includes(compact(longName)),
    "all event text is selectable and complete",
  );
  assert.ok(
    columnText(488, 603).includes(compact(audience)),
    "all audience text is selectable and complete",
  );
  assert.ok(
    columnText(713, 814).includes(compact(organizer)),
    "all organizer text is selectable and complete",
  );
  for (const [index, page] of pages.entries()) {
    assert.ok(compact(page.text).includes("Agendaanualdeeventos"));
    assert.ok(compact(page.text).includes("UnivillecampusSãoBentodoSul"));
    assert.ok(compact(page.text).includes(`${index + 1}/${pages.length}`));
    assert.ok(page.hasImage, "every page repeats the official logo");
    const bodyItems = page.items.filter(
      (item) => Math.abs(item.height - 9.5) < 0.01,
    );
    assert.ok(bodyItems.length);
    assert.ok(
      bodyItems.every((item) => item.transform[5] >= 595.28 - 516),
      "table text does not overlap the institutional footer",
    );
    for (const header of [
      "Evento",
      "Tema",
      "Data",
      "Horário",
      "Local",
      "Público alvo",
      "Palestrante/",
      "Ministrante",
      "Realização",
    ])
      assert.ok(compact(page.text).includes(compact(header)), header);
  }
});

test("empty PDF preserves its institutional template and explains that the period has no approved events", async () => {
  const { pages, text } = await readPdf(
    await generateAgendaPdf([], {
      from: "2027-01-01",
      to: "2027-01-31",
      period: "custom",
    }),
  );
  assert.equal(pages.length, 1);
  assert.ok(text.includes("Agenda de eventos"));
  assert.ok(text.includes("01/01/2027 a 31/01/2027"));
  assert.ok(text.includes("Nenhum evento aprovado no período selecionado."));
  assert.ok(text.includes("Realização"));
  assert.ok(text.includes("1 / 1"));
});
