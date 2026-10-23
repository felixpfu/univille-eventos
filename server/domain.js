import { randomUUID } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message, code = "VALIDATION_ERROR", fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
export const fail = (status, message, code, fields) => {
  throw new HttpError(status, message, code, fields);
};
export const timestamp = (now) => now().toISOString();
export const catalogs = new Set([
  "themes",
  "costCenters",
  "resources",
  "rooms",
  "courses",
]);
export const roles = new Set(["visitor", "requester", "admin"]);
export function textField(value, label, max = 5000, required = false) {
  if (value == null) value = "";
  if (typeof value !== "string")
    fail(400, `${label}: informe um texto.`, "VALIDATION_ERROR");
  const result = value.trim();
  if ((required && !result) || result.length > max)
    fail(
      400,
      `${label}: ${required && !result ? "campo obrigatório" : `máximo de ${max} caracteres`}.`,
      "VALIDATION_ERROR",
    );
  return result;
}
export function emailField(value) {
  const email = textField(value, "E-mail", 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail(400, "Informe um e-mail válido.", "VALIDATION_ERROR");
  return email;
}
export function passwordField(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    fail(
      400,
      "A senha deve ter entre 12 e 128 caracteres.",
      "VALIDATION_ERROR",
    );
  return value;
}
export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function localDate(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now());
  return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}-${parts.find((p) => p.type === "day").value}`;
}
export function publicWindow(now) {
  const today = localDate(now);
  const start = `${today.slice(0, 7)}-01`;
  const endDate = new Date(`${start}T12:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 3);
  return { start, end: endDate.toISOString().slice(0, 10) };
}
export function versionCheck(row, version) {
  if (!Number.isInteger(version) || version !== row.version)
    fail(
      409,
      "Esta solicitação foi atualizada. Recarregue os dados antes de continuar.",
      "STALE_VERSION",
    );
}
const eventProjection = `e.*, t.name AS themeName, r.name AS roomName, c.name AS courseName,
  cc.name AS costCenterName, ac.name AS audienceCourseName, u.name AS authorName`;
const eventJoins = `LEFT JOIN themes t ON t.id=e.themeId LEFT JOIN rooms r ON r.id=e.roomId
  LEFT JOIN courses c ON c.id=e.courseId LEFT JOIN costCenters cc ON cc.id=e.costCenterId
  LEFT JOIN courses ac ON ac.id=e.audienceCourseId JOIN users u ON u.id=e.authorId`;
function serializeEvent(row, resources) {
  return {
    ...row,
    ceremony: row.ceremony == null ? null : Boolean(row.ceremony),
    registration: row.registration == null ? null : Boolean(row.registration),
    certificates: row.certificates == null ? null : Boolean(row.certificates),
    resourceIds: resources.map((resource) => resource.id),
    resourceNames: resources.map((resource) => resource.name),
  };
}
export function getEvent(db, id) {
  const row = db
    .prepare(
      `SELECT ${eventProjection} FROM events e ${eventJoins} WHERE e.id=?`,
    )
    .get(id);
  if (!row) return null;
  const resources = db
    .prepare(
      `SELECT r.id,r.name FROM resources r JOIN eventResources er ON er.resourceId=r.id WHERE er.eventId=? ORDER BY r.name`,
    )
    .all(id);
  return serializeEvent(row, resources);
}
export function eventList(db, where = "1=1", params = [], queueOrder = false) {
  // Filter the original events table before joining so existing predicates,
  // including unqualified IDs, retain their meaning without ambiguous columns.
  const rows = db
    .prepare(
      `SELECT ${eventProjection} FROM (SELECT * FROM events WHERE ${where}) e ${eventJoins}
      ORDER BY ${queueOrder ? "CASE WHEN e.status='pending' THEN 0 ELSE 1 END,CASE WHEN e.status='pending' THEN e.queueSequence END ASC," : ""}e.date ASC,e.startTime ASC,e.createdAt DESC`,
    )
    .all(...params);
  if (!rows.length) return [];
  const resourcesByEvent = new Map(rows.map((row) => [row.id, []]));
  // SQLite builds have different variable limits. Batches of 900 also support
  // the conservative 999-variable limit without one query per event.
  for (let offset = 0; offset < rows.length; offset += 900) {
    const ids = rows.slice(offset, offset + 900).map((row) => row.id);
    const resources = db
      .prepare(
        `SELECT er.eventId,r.id,r.name FROM resources r JOIN eventResources er ON er.resourceId=r.id
        WHERE er.eventId IN (${ids.map(() => "?").join(",")}) ORDER BY r.name`,
      )
      .all(...ids);
    for (const resource of resources)
      resourcesByEvent.get(resource.eventId).push(resource);
  }
  return rows.map((row) => serializeEvent(row, resourcesByEvent.get(row.id)));
}
export function metadata(db, full = true) {
  const result = {};
  for (const entity of catalogs)
    result[entity] = db
      .prepare(`SELECT * FROM ${entity} ORDER BY name COLLATE NOCASE`)
      .all();
  result.rooms = result.rooms.map((room) => ({
    ...room,
    resourceIds: db
      .prepare(
        "SELECT resourceId FROM roomResources WHERE roomId=? ORDER BY resourceId",
      )
      .all(room.id)
      .map((r) => r.resourceId),
  }));
  result.courses = result.courses.map((course) => ({
    ...course,
    costCenterName:
      result.costCenters.find((c) => c.id === course.costCenterId)?.name || "",
  }));
  if (!full) {
    result.rooms = result.rooms.map(({ id, name, description }) => ({
      id,
      name,
      description,
    }));
    result.resources = [];
    result.courses = result.courses.map(({ id, name }) => ({ id, name }));
    result.costCenters = [];
  }
  return result;
}
const eventTextFields = [
  "name",
  "date",
  "startTime",
  "endTime",
  "requesterName",
  "speaker",
  "audience",
  "organizer",
  "audienceSemester",
  "justification",
  "objective",
  "notes",
];
export function normalizeEvent(
  db,
  input,
  existing,
  complete,
  now,
  { requireOrganizer = complete } = {},
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail(400, "Dados da solicitação inválidos.", "VALIDATION_ERROR");
  const data = {};
  for (const field of eventTextFields)
    data[field] = textField(
      input[field] ?? existing?.[field] ?? "",
      field,
      ["justification", "objective", "notes"].includes(field)
        ? 5000
        : field === "name"
          ? 200
          : field === "audienceSemester"
            ? 40
            : 500,
    );
  for (const [field, table] of [
    ["themeId", "themes"],
    ["roomId", "rooms"],
    ["courseId", "courses"],
    ["audienceCourseId", "courses"],
  ]) {
    const id = input[field] !== undefined ? input[field] : existing?.[field];
    data[field] = id === "" || id == null ? null : id;
    if (
      data[field] != null &&
      (typeof data[field] !== "string" ||
        !db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(data[field]))
    )
      fail(400, `Seleção inválida: ${field}.`, "VALIDATION_ERROR", {
        [field]: "Selecione um cadastro existente.",
      });
  }
  data.costCenterId = data.courseId
    ? db
        .prepare("SELECT costCenterId FROM courses WHERE id=?")
        .get(data.courseId).costCenterId
    : null;
  for (const field of ["ceremony", "registration", "certificates"]) {
    const value = input[field] !== undefined ? input[field] : existing?.[field];
    if (value != null && typeof value !== "boolean")
      fail(400, `Selecione Sim ou Não em ${field}.`, "VALIDATION_ERROR");
    data[field] = value == null ? null : value;
  }
  const resourceIds =
    input.resourceIds !== undefined
      ? input.resourceIds
      : existing?.resourceIds || [];
  if (
    !Array.isArray(resourceIds) ||
    resourceIds.length > 100 ||
    resourceIds.some((id) => typeof id !== "string")
  )
    fail(400, "A lista de recursos é inválida.", "VALIDATION_ERROR");
  data.resourceIds = [...new Set(resourceIds)];
  for (const id of data.resourceIds) {
    if (
      !data.roomId ||
      !db
        .prepare("SELECT 1 FROM roomResources WHERE roomId=? AND resourceId=?")
        .get(data.roomId, id)
    )
      fail(
        400,
        "O recurso selecionado não pertence ao ambiente.",
        "INVALID_RESOURCE",
      );
  }
  const fields = {};
  if (data.date && !validDate(data.date))
    fields.date = "Informe uma data válida.";
  if (data.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.startTime))
    fields.startTime = "Horário inválido.";
  if (data.endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.endTime))
    fields.endTime = "Horário inválido.";
  if (complete) {
    for (const field of [
      ...eventTextFields.filter(
        (x) => !["notes", "audienceSemester", "organizer"].includes(x),
      ),
      ...(requireOrganizer ? ["organizer"] : []),
      "themeId",
      "roomId",
      "courseId",
      "ceremony",
      "registration",
      "certificates",
    ]) {
      if (data[field] == null || data[field] === "")
        fields[field] = "Campo obrigatório.";
    }
    if (validDate(data.date) && data.date < localDate(now))
      fields.date = "A data deve ser hoje ou futura.";
    if (data.startTime && data.endTime && data.endTime <= data.startTime)
      fields.endTime = "O término deve ser posterior ao início, no mesmo dia.";
  }
  if (Object.keys(fields).length)
    fail(400, "Revise os campos da solicitação.", "VALIDATION_ERROR", fields);
  return data;
}
export function assertNoConflict(db, data, ignoreId = "") {
  const conflict = db
    .prepare(
      `SELECT id FROM events WHERE status='approved' AND roomId=? AND date=? AND startTime < ? AND endTime > ? AND id<>? LIMIT 1`,
    )
    .get(data.roomId, data.date, data.endTime, data.startTime, ignoreId);
  if (conflict)
    fail(
      409,
      "Este ambiente já possui um evento aprovado nesse intervalo.",
      "SCHEDULE_CONFLICT",
    );
}
export function assertFirstPending(db, event) {
  const earlier = db
    .prepare(
      `SELECT id,queueSequence FROM events WHERE status='pending'
    AND roomId=? AND date=? AND startTime<? AND endTime>?
    AND queueSequence<? AND id<>? ORDER BY queueSequence ASC LIMIT 1`,
    )
    .get(
      event.roomId,
      event.date,
      event.endTime,
      event.startTime,
      event.queueSequence,
      event.id,
    );
  if (earlier)
    fail(
      409,
      `Existe uma solicitação enviada antes para este ambiente e horário (protocolo ${earlier.id.slice(0, 8).toUpperCase()}). Analise esse pedido primeiro.`,
      "EARLIER_REQUEST",
      { earlierRequestId: earlier.id },
    );
}
export function saveEvent(
  db,
  data,
  { existing, authorId, status, now, requeue = false },
) {
  const id = existing?.id || randomUUID();
  const at = timestamp(now);
  const flat = { ...data };
  delete flat.resourceIds;
  if (requeue) {
    const queue = db
      .prepare("INSERT INTO submissionQueue(eventId,submittedAt) VALUES (?,?)")
      .run(id, at);
    flat.submittedAt = at;
    flat.queueSequence = Number(queue.lastInsertRowid);
  }
  for (const field of ["ceremony", "registration", "certificates"])
    flat[field] = flat[field] == null ? null : Number(flat[field]);
  if (existing) {
    const columns = Object.keys(flat);
    db.prepare(
      `UPDATE events SET ${columns.map((key) => `${key}=?`).join(",")},status=?,rejectionReason=?,version=version+1,updatedAt=? WHERE id=?`,
    ).run(
      ...columns.map((key) => flat[key]),
      status,
      status === "rejected" ? existing.rejectionReason : "",
      at,
      id,
    );
    db.prepare("DELETE FROM eventResources WHERE eventId=?").run(id);
  } else {
    const row = { id, authorId, ...flat, status, createdAt: at, updatedAt: at };
    const keys = Object.keys(row);
    db.prepare(
      `INSERT INTO events (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    ).run(...keys.map((key) => row[key]));
  }
  for (const resourceId of data.resourceIds)
    db.prepare(
      "INSERT INTO eventResources(eventId,resourceId) VALUES (?,?)",
    ).run(id, resourceId);
  return getEvent(db, id);
}
export function audit(db, actorId, action, entityId, now) {
  db.prepare(
    "INSERT INTO auditLog(actorId,action,entityId,createdAt) VALUES (?,?,?,?)",
  ).run(actorId, action, entityId, timestamp(now));
}
export function filteredReports(db, query) {
  const where = ["status<>'draft'"];
  const params = [];
  if (query.status && query.status !== "all") {
    if (
      !["pending", "rejected", "approved", "cancelled"].includes(query.status)
    )
      fail(400, "Status inválido.", "VALIDATION_ERROR");
    where.push("status=?");
    params.push(query.status);
  }
  for (const [field, operator] of [
    ["from", ">="],
    ["to", "<="],
  ]) {
    if (query[field]) {
      if (!validDate(query[field]))
        fail(400, "Período inválido.", "VALIDATION_ERROR");
      where.push(`date ${operator} ?`);
      params.push(query[field]);
    }
  }
  if (query.from && query.to && query.from > query.to)
    fail(400, "A data inicial deve ser anterior à final.", "VALIDATION_ERROR");
  for (const field of ["courseId", "themeId"])
    if (query[field]) {
      if (typeof query[field] !== "string")
        fail(400, "Filtro inválido.", "VALIDATION_ERROR");
      where.push(`${field}=?`);
      params.push(query[field]);
    }
  return eventList(db, where.join(" AND "), params);
}
const labels = {
  draft: "Rascunho",
  pending: "Aguardando aprovação",
  rejected: "Rejeitado",
  approved: "Aprovado",
  cancelled: "Cancelado",
};
export function reportCsv(events) {
  const columns = [
    ["name", "Evento"],
    ["date", "Data"],
    ["startTime", "Início"],
    ["endTime", "Fim"],
    ["themeName", "Tema"],
    ["courseName", "Setor/curso"],
    ["costCenterName", "Centro de custo"],
    ["roomName", "Local"],
    ["requesterName", "Solicitante"],
    ["audience", "Público alvo"],
    ["audienceCourseName", "Curso do público"],
    ["audienceSemester", "Semestre do público"],
    ["speaker", "Palestrante/Ministrante"],
    ["organizer", "Realização"],
    ["status", "Status"],
  ];
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      columns.map(([, label]) => cell(label)).join(","),
      ...events.map((event) =>
        columns
          .map(([key]) =>
            cell(key === "status" ? labels[event.status] : event[key]),
          )
          .join(","),
      ),
    ].join("\r\n") +
    "\r\n"
  );
}
