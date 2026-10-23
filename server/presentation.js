import { readFile } from "node:fs/promises";
import PptxGenJS from "pptxgenjs";

const WIDTH = 13.333333;
const HEIGHT = 7.5;
const GREEN = "00562B";
const COLUMNS = [
  "Evento",
  "Tema",
  "Data",
  "Horário",
  "Local",
  "Público alvo",
  "Palestrante/\nMinistrante",
  "Realização",
];
const COL_WIDTHS = [1.9, 1.85, 1.05, 0.8, 1.5, 1.9, 1.65, 1.683333];
const FONT_SIZE = 10.5;
const TABLE_Y = 1.4;
const HEADER_HEIGHT = 0.48;
const BODY_HEIGHT = 4.35;
const LINE_HEIGHT = 0.195;
const CELL_PADDING = 0.13;
const MAX_LINES = Math.floor((BODY_HEIGHT - CELL_PADDING) / LINE_HEIGHT);

function cleanText(value) {
  // OOXML cannot contain XML 1.0 control characters. Keep user content otherwise.
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}

function dateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}

function glyphWidth(character) {
  if (/[ilI.,:;'!| /]/.test(character)) return 0.3;
  if (/[mwMW@%&]/.test(character)) return 0.96;
  if (/[0-9]/.test(character)) return 0.58;
  if (/[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ]/.test(character)) return 0.72;
  if (character.codePointAt(0) > 0x2fff) return 1.1;
  return 0.6;
}

function wrapText(value, width) {
  const text = cleanText(value) || "—";
  // Explicit line breaks and conservative Arial glyph widths make pagination
  // deterministic in PowerPoint and LibreOffice, including unbroken URLs.
  const capacity = ((width - 0.16) * 72) / FONT_SIZE;
  const lines = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    let used = 0;
    for (const word of paragraph.split(/\s+/)) {
      const wordWidth = [...word].reduce(
        (sum, char) => sum + glyphWidth(char),
        0,
      );
      if (line && used + 0.3 + wordWidth > capacity) {
        lines.push(line);
        line = "";
        used = 0;
      }
      for (const character of word) {
        const next = glyphWidth(character);
        if (used + next > capacity && line) {
          lines.push(line);
          line = "";
          used = 0;
        }
        line += character;
        used += next;
      }
      line += " ";
      used += 0.3;
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  return lines.length ? lines : ["—"];
}

function audienceLabel(event) {
  return [
    cleanText(event.audience),
    cleanText(event.audienceCourseName),
    /^\d+$/.test(String(event.audienceSemester || ""))
      ? `${event.audienceSemester}º semestre`
      : cleanText(event.audienceSemester),
  ]
    .filter(Boolean)
    .join(" · ");
}

function eventCells(event) {
  return [
    event.name,
    event.themeName,
    dateLabel(event.date),
    event.startTime,
    event.roomName,
    audienceLabel(event),
    event.speaker,
    event.organizer,
  ].map((value, index) => wrapText(value, COL_WIDTHS[index]));
}

function paginate(events) {
  const pages = [];
  let rows = [];
  let rowHeights = [];
  let usedHeight = 0;
  const flush = () => {
    if (rows.length) pages.push({ rows, rowHeights });
    rows = [];
    rowHeights = [];
    usedHeight = 0;
  };
  for (const event of events) {
    const cells = eventCells(event);
    const lineCount = Math.max(...cells.map((cell) => cell.length));
    // Ordinary rows stay together. An unusually long event continues on the
    // next slide without omitting fields or reducing the font to unreadable sizes.
    const chunkSize = lineCount > MAX_LINES ? MAX_LINES - 1 : MAX_LINES;
    for (let offset = 0; offset < lineCount; offset += chunkSize) {
      const continuation = offset > 0;
      const chunk = cells.map((cell) => cell.slice(offset, offset + chunkSize));
      if (continuation) chunk[0].unshift("(continuação)");
      const lines = Math.max(...chunk.map((cell) => cell.length));
      const height = Math.max(0.42, lines * LINE_HEIGHT + CELL_PADDING);
      if (rows.length && usedHeight + height > BODY_HEIGHT) flush();
      rows.push(chunk.map((cell) => cell.join("\n")));
      rowHeights.push(height);
      usedHeight += height;
    }
  }
  flush();
  return pages;
}

async function readLogo() {
  // Releases ship dist/, while direct source tests run before Vite builds it.
  for (const path of [
    new URL("../dist/branding/univille-logo.png", import.meta.url),
    new URL("../public/branding/univille-logo.png", import.meta.url),
  ]) {
    try {
      return `image/png;base64,${(await readFile(path)).toString("base64")}`;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("A marca Univille não foi incluída na publicação.");
}

/** Build an editable institutional agenda. Authentication, approval and date
 * filtering belong to the HTTP route; this function receives the selected rows. */
export async function generateAgendaPptx(
  events,
  { from, to, period = "week" } = {},
) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "UNIVILLE", width: WIDTH, height: HEIGHT });
  pptx.layout = "UNIVILLE";
  pptx.author = "Univille · Agenda de eventos";
  pptx.subject = "Agenda institucional de eventos aprovados";
  pptx.company = "Univille campus São Bento do Sul";
  pptx.lang = "pt-BR";
  pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial", lang: "pt-BR" };
  const title =
    period === "year"
      ? "Agenda anual de eventos"
      : period === "custom"
        ? "Agenda de eventos"
        : "Agenda semanal de eventos";
  pptx.title = title;
  const sorted = [...events].sort((a, b) =>
    `${a.date || ""} ${a.startTime || ""} ${a.name || ""}`.localeCompare(
      `${b.date || ""} ${b.startTime || ""} ${b.name || ""}`,
      "pt-BR",
    ),
  );
  const pages = paginate(sorted);
  if (!pages.length) pages.push({ rows: [], rowHeights: [] });
  const logo = await readLogo();
  pages.forEach(({ rows, rowHeights }, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: WIDTH,
      h: 0.88,
      line: { color: GREEN, transparency: 100 },
      fill: { color: GREEN },
    });
    slide.addText(`${title}\nUniville campus São Bento do Sul`, {
      x: 0.5,
      y: 0.13,
      w: WIDTH - 1,
      h: 0.6,
      fontFace: "Arial",
      fontSize: 21,
      bold: true,
      color: "FFFFFF",
      margin: 0,
      align: "center",
      breakLine: false,
      valign: "mid",
    });
    slide.addText(
      from && to
        ? `${dateLabel(from)} a ${dateLabel(to)}`
        : "Eventos aprovados",
      {
        x: 0.5,
        y: 1.05,
        w: WIDTH - 1,
        h: 0.2,
        fontSize: 11,
        color: "505050",
        margin: 0,
        align: "center",
      },
    );
    const header = COLUMNS.map((text) => ({
      text,
      options: { bold: true, fontSize: 10, fill: "F4F4F4", valign: "mid" },
    }));
    slide.addTable([header, ...rows], {
      x: 0.5,
      y: TABLE_Y,
      w: WIDTH - 1,
      colW: COL_WIDTHS,
      rowH: [HEADER_HEIGHT, ...rowHeights],
      fontFace: "Arial",
      fontSize: FONT_SIZE,
      color: "181818",
      fill: "FFFFFF",
      border: { type: "solid", color: "444444", pt: 0.5 },
      margin: [3, 4, 3, 4],
      align: "center",
      valign: "mid",
      autoPage: false,
      paraSpaceAfter: 0,
      lineSpacingMultiple: 1,
      verbose: false,
    });
    if (!rows.length) {
      slide.addText("Nenhum evento aprovado no período selecionado.", {
        x: 0.7,
        y: 3.15,
        w: WIDTH - 1.4,
        h: 0.45,
        fontSize: 16,
        color: "505050",
        align: "center",
        margin: 0,
      });
    }
    slide.addImage({
      data: logo,
      x: (WIDTH - 2.3) / 2,
      y: 6.68,
      w: 2.3,
      h: 2.3 * (50 / 221),
    });
    if (pages.length > 1) {
      slide.addText(`${index + 1} / ${pages.length}`, {
        x: WIDTH - 1.1,
        y: 7.1,
        w: 0.6,
        h: 0.16,
        fontSize: 9,
        color: "666666",
        align: "right",
        margin: 0,
      });
    }
  });
  return pptx.write({ outputType: "nodebuffer", compression: true });
}
