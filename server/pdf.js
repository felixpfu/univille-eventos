import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdfkit";

const GREEN = "#00562B";
const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 28;
const TABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TABLE_TOP = 108;
const HEADER_HEIGHT = 38;
const BODY_BOTTOM = 516;
const BODY_HEIGHT = BODY_BOTTOM - TABLE_TOP - HEADER_HEIGHT;
const FONT_SIZE = 9.5;
const LINE_HEIGHT = 13.1;
const CELL_PADDING = 6;
const MIN_ROW_HEIGHT = 31;
const COLUMN_WEIGHTS = [1.9, 1.85, 1.05, 0.9, 1.45, 1.9, 1.65, 1.683333];
const TOTAL_WEIGHT = COLUMN_WEIGHTS.reduce((sum, value) => sum + value, 0);
const WIDTHS = COLUMN_WEIGHTS.map(
  (value) => (value / TOTAL_WEIGHT) * TABLE_WIDTH,
);
const HEADERS = [
  "Evento",
  "Tema",
  "Data",
  "Horário",
  "Local",
  "Público alvo",
  "Palestrante/\nMinistrante",
  "Realização",
];

function cleanText(value) {
  return String(value ?? "")
    .toWellFormed()
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/g, "")
    .trim();
}

function dateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "-";
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

async function readAsset(relative) {
  // Tests use the current source assets; releases ship only Vite's dist copies.
  for (const base of ["../public/", "../dist/"]) {
    try {
      return await readFile(new URL(base + relative, import.meta.url));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    `O arquivo institucional ${relative} não foi incluído na publicação.`,
  );
}

function wrapText(doc, value, width) {
  const text = cleanText(value) || "-";
  const lines = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/u)) {
      const candidate = line ? `${line} ${word}` : word;
      if (doc.widthOfString(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      // Break very long words/URLs using real embedded-font metrics. Never
      // truncate cells or reduce their font to make them fit a single page.
      for (const character of word) {
        if (line && doc.widthOfString(line + character) > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ["-"];
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
  ];
}

function paginate(doc, events) {
  const pages = [];
  let rows = [];
  let used = 0;
  const flush = () => {
    if (rows.length) pages.push(rows);
    rows = [];
    used = 0;
  };
  const maxLines = Math.floor((BODY_HEIGHT - CELL_PADDING * 2) / LINE_HEIGHT);
  for (const event of events) {
    const cells = eventCells(event).map((value, index) =>
      wrapText(doc, value, WIDTHS[index] - CELL_PADDING * 2),
    );
    const lineCount = Math.max(...cells.map((cell) => cell.length));
    // Rows that fit remain together. Larger rows continue on subsequent pages,
    // with an extra label line that does not consume or replace original text.
    const chunkSize = lineCount > maxLines ? maxLines - 1 : maxLines;
    for (let offset = 0; offset < lineCount; offset += chunkSize) {
      const chunk = cells.map((cell) => cell.slice(offset, offset + chunkSize));
      if (offset) chunk[0].unshift("(continuação)");
      const lines = Math.max(...chunk.map((cell) => cell.length));
      const height = Math.max(
        MIN_ROW_HEIGHT,
        lines * LINE_HEIGHT + CELL_PADDING * 2,
      );
      if (rows.length && used + height > BODY_HEIGHT) flush();
      rows.push({ cells: chunk, height });
      used += height;
    }
  }
  flush();
  return pages.length ? pages : [[]];
}

function textLine(
  doc,
  text,
  x,
  y,
  width,
  {
    font = "Agenda",
    size = FONT_SIZE,
    color = "181818",
    align = "center",
  } = {},
) {
  doc
    .font(font)
    .fontSize(size)
    .fillColor(`#${color.replace(/^#/, "")}`)
    .text(text, x, y, {
      width,
      lineBreak: false,
      align,
    });
}

function drawRow(doc, cells, y, height, { header = false } = {}) {
  let x = MARGIN;
  cells.forEach((lines, index) => {
    doc
      .fillColor(header ? "#F2F5F3" : "#FFFFFF")
      .strokeColor("#68746C")
      .lineWidth(0.45)
      .rect(x, y, WIDTHS[index], height)
      .fillAndStroke();
    const lineHeight = header ? 12 : LINE_HEIGHT;
    const top = y + (height - lines.length * lineHeight) / 2;
    lines.forEach((line, lineIndex) => {
      textLine(
        doc,
        line,
        x + CELL_PADDING,
        top + lineIndex * lineHeight,
        WIDTHS[index] - CELL_PADDING * 2,
        {
          font: header ? "AgendaBold" : "Agenda",
          size: header ? 9 : FONT_SIZE,
        },
      );
    });
    x += WIDTHS[index];
  });
}

/** Generate the already-filtered, approved agenda without database access.
 * Text stays selectable; fonts and the official logo are embedded in the PDF. */
export async function generateAgendaPdf(
  events,
  { from, to, period = "week" } = {},
) {
  const [logo, regular, bold] = await Promise.all([
    readAsset("branding/univille-logo.png"),
    readAsset("fonts/NotoSans-Regular.ttf"),
    readAsset("fonts/NotoSans-Bold.ttf"),
  ]);
  const title =
    period === "year"
      ? "Agenda anual de eventos"
      : period === "custom"
        ? "Agenda de eventos"
        : "Agenda semanal de eventos";
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    margin: 0,
    pdfVersion: "1.7",
    lang: "pt-BR",
    info: {
      Title: title,
      Author: "Univille · Agenda de eventos",
      Subject: "Agenda institucional de eventos aprovados",
      Creator: "Agenda Univille - campus São Bento do Sul",
    },
  });
  doc.registerFont("Agenda", regular);
  doc.registerFont("AgendaBold", bold);
  doc.font("Agenda").fontSize(FONT_SIZE);
  const sorted = [...events].sort((a, b) =>
    `${a.date || ""} ${a.startTime || ""} ${a.name || ""}`.localeCompare(
      `${b.date || ""} ${b.startTime || ""} ${b.name || ""}`,
      "pt-BR",
    ),
  );
  const pages = paginate(doc, sorted);
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  pages.forEach((rows, index) => {
    doc.addPage();
    doc.fillColor("#FFFFFF").rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill();
    doc.fillColor(GREEN).rect(0, 0, PAGE_WIDTH, 67).fill();
    textLine(doc, title, MARGIN, 10, TABLE_WIDTH, {
      font: "AgendaBold",
      size: 19,
      color: "FFFFFF",
    });
    textLine(doc, "Univille campus São Bento do Sul", MARGIN, 37, TABLE_WIDTH, {
      font: "AgendaBold",
      size: 16,
      color: "FFFFFF",
    });
    textLine(
      doc,
      from && to
        ? `${dateLabel(from)} a ${dateLabel(to)}`
        : "Eventos aprovados",
      MARGIN,
      80,
      TABLE_WIDTH,
      { size: 10, color: "505050" },
    );
    drawRow(
      doc,
      HEADERS.map((header) => header.split("\n")),
      TABLE_TOP,
      HEADER_HEIGHT,
      { header: true },
    );
    let y = TABLE_TOP + HEADER_HEIGHT;
    rows.forEach((row) => {
      drawRow(doc, row.cells, y, row.height);
      y += row.height;
    });
    if (!rows.length)
      textLine(
        doc,
        "Nenhum evento aprovado no período selecionado.",
        MARGIN,
        288,
        TABLE_WIDTH,
        { size: 14, color: "505050" },
      );
    const logoWidth = 155;
    doc.image(logo, (PAGE_WIDTH - logoWidth) / 2, 543, { width: logoWidth });
    textLine(doc, `${index + 1} / ${pages.length}`, MARGIN, 573, TABLE_WIDTH, {
      size: 8,
      color: "606060",
      align: "right",
    });
  });
  doc.end();
  return completed;
}
