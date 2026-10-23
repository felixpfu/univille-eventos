import { readFile, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const DEMO_MARKER = "DEMO_UNIVILLE_2026_V1";
const SUFFIX = " · Demonstração";
const CATALOG_DESCRIPTION = `${DEMO_MARKER}: cadastro fictício para demonstração do sistema; não confirma instalações nem a oferta do curso no campus.`;
export const VENUE_DESCRIPTION =
  "Espaço informado pelo responsável para o agendamento de eventos no campus São Bento do Sul.";
export const DEMO_VENUES = new Set(["Auditório", "Miniauditório"]);
const planUrl = new URL("./demo-events.json", import.meta.url);

export async function demoPlan() {
  const plan = JSON.parse(await readFile(planUrl, "utf8"));
  if (!Array.isArray(plan) || plan.length !== 8)
    throw new Error("O conjunto de demonstração deve conter oito eventos.");
  const keys = new Set();
  for (const item of plan) {
    if (
      !/^[a-z-]+$/.test(item.key) ||
      keys.has(item.key) ||
      !/^2026-(?:10|11|12)-\d{2}$/.test(item.date) ||
      !/^\d{2}:\d{2}$/.test(item.startTime) ||
      !/^\d{2}:\d{2}$/.test(item.endTime) ||
      item.startTime >= item.endTime ||
      !DEMO_VENUES.has(item.room) ||
      !item.description?.startsWith("Evento fictício de demonstração") ||
      item.description.length > 2000 ||
      !item.description.includes(item.course) ||
      item.semesters.length > 40
    )
      throw new Error("O conjunto de demonstração contém dados inválidos.");
    keys.add(item.key);
  }
  for (const [index, item] of plan.entries())
    if (
      plan
        .slice(0, index)
        .some(
          (other) =>
            other.room === item.room &&
            other.date === item.date &&
            other.startTime < item.endTime &&
            other.endTime > item.startTime,
        )
    )
      throw new Error("Há sobreposição de horários no conjunto fictício.");
  return plan;
}

export function checkedOrigin(value) {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    (!local && (url.hostname !== "flxpfu.com.br" || url.port)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Use https://flxpfu.com.br ou uma origem HTTP/HTTPS local, sem caminho ou credenciais.",
    );
  return url.origin;
}

const noteFor = (item) =>
  `[${DEMO_MARKER}:${item.key}] Evento fictício para demonstração pública autorizada. Não representa programação oficial.`;
const nameFor = (item) => `${item.name}${SUFFIX}`;

export function demoEventData(item, { themeId, roomId, courseId }) {
  return {
    name: nameFor(item),
    themeId,
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    roomId,
    courseId,
    audienceCourseId: courseId,
    audienceSemester: item.semesters,
    audience: `Estudantes de ${item.course} do ${item.semesters} (participação fictícia).`,
    publicDescription: item.description,
    requesterName: "Equipe !Null · Demonstração",
    speaker: "Equipe de demonstração",
    organizer: "Projeto acadêmico !Null · Demonstração",
    justification:
      "Popular a agenda com exemplos fictícios autorizados para avaliar a consulta pública, os filtros e os relatórios.",
    objective:
      "Demonstrar o agendamento com diferentes datas, horários e públicos acadêmicos fictícios.",
    ceremony: false,
    registration: false,
    certificates: false,
    resourceIds: [],
    notes: noteFor(item),
  };
}

/**
 * Uses the same authenticated HTTP workflow as the administration interface.
 * Defaults to a read-only preview. Never edits/deletes existing records.
 * Do not run two instances concurrently: idempotency is checked by marker and
 * schedule, and the public API deliberately has no arbitrary uniqueness key.
 */
export async function seedDemoEvents({
  origin = "https://flxpfu.com.br",
  credentials,
  publish = false,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  origin = checkedOrigin(origin);
  const plan = await demoPlan();
  const summary = {
    planned: plan.length,
    created: 0,
    resumed: 0,
    skipped: 0,
    approved: 0,
  };
  if (!publish) {
    for (const item of plan)
      log(
        `${item.date} ${item.startTime}–${item.endTime} | ${nameFor(item)} | ${item.room} | ${item.course}: ${item.semesters}`,
      );
    log(
      "Simulação: nenhum acesso autenticado nem alteração. Use --publish para cadastrar e aprovar.",
    );
    return summary;
  }
  if (
    !credentials ||
    typeof credentials.email !== "string" ||
    typeof credentials.password !== "string" ||
    !credentials.email ||
    !credentials.password
  )
    throw new Error("Forneça e-mail e senha por JSON na entrada padrão.");
  let cookie;
  async function request(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${origin}/api${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (path === "/auth/login" && response.ok) {
      const setCookie = response.headers.getSetCookie?.() || [
        response.headers.get("set-cookie"),
      ];
      cookie = setCookie
        .filter(Boolean)
        .map((value) => value.split(";")[0])
        .join("; ");
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        `Resposta inválida da API em ${path} (HTTP ${response.status}).`,
      );
    }
    if (!response.ok)
      throw new Error(
        `Operação interrompida em ${path}: HTTP ${response.status}${result.code ? ` (${result.code})` : ""}. Nenhum registro existente foi substituído.`,
      );
    return result;
  }
  try {
    const session = await request("/auth/login", {
      method: "POST",
      body: credentials,
    });
    if (session.user?.role !== "admin" || !cookie)
      throw new Error("É necessária uma conta administrativa ativa.");
    const metadata = await request("/metadata");
    const own = (await request("/requests")).requests;
    const administrative = (await request("/admin/requests")).requests;
    const existingEvents = [
      ...new Map(
        [...own, ...administrative].map((item) => [item.id, item]),
      ).values(),
    ];

    // Check every marker/collision before the first catalog or event mutation.
    const matches = new Map();
    for (const item of plan) {
      const marked = existingEvents.filter((event) =>
        event.notes?.includes(`[${DEMO_MARKER}:${item.key}]`),
      );
      const collision = existingEvents.some(
        (event) => event.name === nameFor(item) && !marked.includes(event),
      );
      if (marked.length > 1 || collision)
        throw new Error(
          `Há um registro ambíguo para “${nameFor(item)}”; revise-o manualmente.`,
        );
      if (marked.length) {
        const event = marked[0];
        if (!["draft", "pending", "approved"].includes(event.status))
          throw new Error(
            `A demonstração “${nameFor(item)}” está ${event.status}; revisão manual necessária.`,
          );
        if (
          event.status === "draft" &&
          !own.some((record) => record.id === event.id)
        )
          throw new Error(
            "O rascunho fictício pertence a outra conta; revisão manual necessária.",
          );
        matches.set(item.key, event);
      }
    }
    const names = {
      themes: ["Demonstração acadêmica"],
      costCenters: ["Demonstração acadêmica"],
      rooms: [...new Set(plan.map((item) => item.room))],
      courses: [...new Set(plan.map((item) => `${item.course}${SUFFIX}`))],
    };
    for (const [entity, requiredNames] of Object.entries(names))
      for (const name of requiredNames) {
        const candidates = metadata[entity].filter(
          (item) => item.name === name,
        );
        if (
          candidates.length > 1 ||
          (entity !== "rooms" &&
            candidates.length &&
            !candidates[0].description?.includes(DEMO_MARKER))
        )
          throw new Error(
            `O catálogo “${name}” já existe sem identificação exclusiva de demonstração; revisão manual necessária.`,
          );
      }
    async function catalog(entity, name, extra = {}) {
      const existing = metadata[entity].find((item) => item.name === name);
      if (existing) return existing;
      const { item } = await request(`/admin/catalog/${entity}`, {
        method: "POST",
        body: { name, description: CATALOG_DESCRIPTION, ...extra },
      });
      metadata[entity].push(item);
      return item;
    }
    const theme = await catalog("themes", names.themes[0]);
    const cost = await catalog("costCenters", names.costCenters[0]);
    const rooms = new Map();
    for (const name of names.rooms) {
      const room = await catalog("rooms", name, {
        description: VENUE_DESCRIPTION,
        resourceIds: [],
      });
      rooms.set(name, room);
    }
    const courses = new Map();
    for (const name of names.courses) {
      const course = await catalog("courses", name, { costCenterId: cost.id });
      if (course.costCenterId !== cost.id)
        throw new Error(
          `O curso “${name}” mudou de centro de custo; revisão manual necessária.`,
        );
      courses.set(name, course);
    }
    for (const item of plan) {
      const course = courses.get(`${item.course}${SUFFIX}`);
      const data = demoEventData(item, {
        themeId: theme.id,
        roomId: rooms.get(item.room).id,
        courseId: course.id,
      });
      let event = matches.get(item.key);
      if (event) {
        for (const [field, value] of Object.entries(data)) {
          const same = Array.isArray(value)
            ? [...value].sort().join(",") ===
              [...(event[field] || [])].sort().join(",")
            : event[field] === value;
          if (!same)
            throw new Error(
              `A demonstração “${data.name}” difere no campo ${field}; nenhum dado existente foi editado.`,
            );
        }
        if (event.status === "approved") {
          summary.skipped++;
          log(`Já publicado: ${data.name}`);
          continue;
        }
        summary.resumed++;
      } else {
        event = (await request("/requests", { method: "POST", body: data }))
          .request;
        summary.created++;
      }
      if (event.publicDescription !== data.publicDescription)
        throw new Error(
          "A API ainda não preserva descrições públicas. Publique a versão compatível antes de continuar; o rascunho foi mantido.",
        );
      if (event.status === "draft")
        event = (
          await request(`/requests/${event.id}/submit`, {
            method: "POST",
            body: { version: event.version },
          })
        ).request;
      if (event.status !== "pending")
        throw new Error(
          "O estado da demonstração mudou; revisão manual necessária.",
        );
      event = (
        await request(`/admin/requests/${event.id}/approve`, {
          method: "POST",
          body: { version: event.version },
        })
      ).request;
      if (event.status !== "approved")
        throw new Error("A aprovação não foi confirmada pela API.");
      summary.approved++;
      log(
        `Publicado: ${event.date} ${event.startTime}–${event.endTime} | ${event.name}`,
      );
    }
    log(
      `Concluído: ${summary.approved} aprovados nesta execução; ${summary.skipped} já publicados.`,
    );
    return summary;
  } finally {
    if (cookie)
      await request("/auth/logout", { method: "POST", body: {} }).catch(() => {
        log(
          "A sessão não pôde ser encerrada pela API; ela continua sujeita à expiração normal.",
        );
      });
    cookie = undefined;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let origin = "https://flxpfu.com.br";
  let publish = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--origin" && args[index + 1]) origin = args[++index];
    else if (args[index] === "--publish") publish = true;
    else if (args[index] === "--help") {
      console.log(
        'Uso: node scripts/seed-demo.js [--origin https://flxpfu.com.br] [--publish]\nSem --publish: somente simulação. Para publicar, forneça {"email":"…","password":"…"} pela entrada padrão protegida. Nunca informe credenciais nos argumentos.',
      );
      return;
    } else
      throw new Error(
        "Argumento desconhecido. Use --help; credenciais não são aceitas em argumentos.",
      );
  }
  let credentials;
  if (publish) {
    if (process.stdin.isTTY)
      throw new Error(
        "Forneça credenciais JSON pela entrada padrão protegida; não cole senhas no comando.",
      );
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 16384) throw new Error("Entrada padrão muito longa.");
    }
    try {
      credentials = JSON.parse(input);
    } catch {
      throw new Error(
        "A entrada padrão deve conter JSON válido com e-mail e senha.",
      );
    }
    input = "";
  }
  try {
    await seedDemoEvents({ origin, publish, credentials });
  } finally {
    if (credentials) credentials.password = undefined;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
