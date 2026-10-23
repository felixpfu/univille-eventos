import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  checkedOrigin,
  DEMO_MARKER,
  demoEventData,
  demoPlan,
  VENUE_DESCRIPTION,
} from "./seed-demo.js";

const SUFFIX = " · Demonstração";
const LEGACY_ROOMS = new Set([
  `Laboratório${SUFFIX}`,
  `Sala multiuso${SUFFIX}`,
  `Auditório${SUFFIX}`,
]);

/**
 * Moves only the eight unchanged, approved demo events to the two venues named
 * by the responsible user. Defaults to an anonymous read-only plan. Catalogs
 * and unrelated events are never overwritten or deleted. Run one instance at a
 * time; the API's version check also rejects concurrently edited events.
 */
export async function updateDemoVenues({
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
    updated: 0,
    skipped: 0,
    roomsCreated: 0,
  };
  if (!publish) {
    for (const item of plan)
      log(
        `${item.date} ${item.startTime}–${item.endTime} | ${item.name}${SUFFIX} → ${item.room}`,
      );
    log(
      "Simulação: nenhum acesso autenticado nem alteração. Use --publish para atualizar os locais dos oito eventos fictícios aprovados.",
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
        `Operação interrompida em ${path}: HTTP ${response.status}${result.code ? ` (${result.code})` : ""}. Os registros já confirmados foram preservados; revise antes de retomar.`,
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
    const events = [
      ...new Map(
        [...own, ...administrative].map((event) => [event.id, event]),
      ).values(),
    ];

    function oneCatalog(entity, name, { optional = false, demo = false } = {}) {
      const matches = metadata[entity].filter((item) => item.name === name);
      if (
        matches.length > 1 ||
        (!optional && matches.length !== 1) ||
        (matches[0] && demo && !matches[0].description?.includes(DEMO_MARKER))
      )
        throw new Error(
          `O catálogo “${name}” não tem identificação inequívoca; revisão manual necessária.`,
        );
      return matches[0];
    }
    const theme = oneCatalog("themes", "Demonstração acadêmica", {
      demo: true,
    });
    const cost = oneCatalog("costCenters", "Demonstração acadêmica", {
      demo: true,
    });
    const rooms = new Map(
      [...new Set(plan.map((item) => item.room))].map((name) => [
        name,
        oneCatalog("rooms", name, { optional: true }),
      ]),
    );
    const legacyResource = oneCatalog("resources", `Projetor${SUFFIX}`, {
      optional: true,
      demo: true,
    });
    const changes = [];

    // Complete all identity, payload, state and conflict checks before the first
    // write. There is deliberately no delete or direct database access here.
    for (const item of plan) {
      const marked = events.filter((event) =>
        event.notes?.includes(`[${DEMO_MARKER}:${item.key}]`),
      );
      if (marked.length !== 1)
        throw new Error(
          `É necessário exatamente um evento de demonstração para “${item.name}”; revisão manual necessária.`,
        );
      const event = marked[0];
      if (
        event.status !== "approved" ||
        event.authorId !== session.user.id ||
        !Number.isSafeInteger(event.version) ||
        event.version < 1
      )
        throw new Error(
          `“${item.name}” deve estar aprovado e pertencer à conta administrativa utilizada; revisão manual necessária.`,
        );
      const course = oneCatalog("courses", `${item.course}${SUFFIX}`, {
        demo: true,
      });
      if (course.costCenterId !== cost.id)
        throw new Error(
          `O curso “${item.course}” mudou de centro de custo; revisão manual necessária.`,
        );
      const expected = demoEventData(item, {
        themeId: theme.id,
        roomId: rooms.get(item.room)?.id,
        courseId: course.id,
      });
      for (const [field, value] of Object.entries(expected)) {
        if (["roomId", "resourceIds"].includes(field)) continue;
        if (event[field] !== value)
          throw new Error(
            `“${item.name}” difere no campo ${field}; nenhum evento foi alterado nesta execução.`,
          );
      }
      if (
        event.costCenterId !== cost.id ||
        events.some(
          (other) => other.id !== event.id && other.name === expected.name,
        )
      )
        throw new Error(
          `A identidade de “${item.name}” mudou; revisão manual necessária.`,
        );
      const currentRoom = metadata.rooms.find(
        (room) => room.id === event.roomId,
      );
      if (
        !currentRoom ||
        (LEGACY_ROOMS.has(currentRoom.name) &&
          !currentRoom.description?.includes(DEMO_MARKER)) ||
        (!LEGACY_ROOMS.has(currentRoom.name) && currentRoom.name !== item.room)
      )
        throw new Error(
          `O local atual de “${item.name}” foi alterado fora deste plano; revisão manual necessária.`,
        );
      if (
        !Array.isArray(event.resourceIds) ||
        event.resourceIds.some((id) => id !== legacyResource?.id) ||
        event.resourceIds.length > 1
      )
        throw new Error(
          `Os recursos de “${item.name}” foram alterados; revisão manual necessária.`,
        );
      const targetRoom = rooms.get(item.room);
      const overlap = events.some(
        (other) =>
          other.id !== event.id &&
          other.status === "approved" &&
          other.roomId === targetRoom?.id &&
          other.date === item.date &&
          other.startTime < item.endTime &&
          other.endTime > item.startTime,
      );
      if (overlap)
        throw new Error(
          `Há um evento aprovado no local e horário planejados de “${item.name}”; nenhum evento foi alterado nesta execução.`,
        );
      changes.push({ item, event, expected });
    }

    for (const [name, room] of rooms) {
      if (room) continue;
      const result = await request("/admin/catalog/rooms", {
        method: "POST",
        body: { name, description: VENUE_DESCRIPTION, resourceIds: [] },
      });
      if (
        result.item?.name !== name ||
        !result.item.id ||
        result.item.resourceIds?.length !== 0
      )
        throw new Error(
          `O novo local “${name}” não foi confirmado pela API; revisão manual necessária.`,
        );
      rooms.set(name, result.item);
      summary.roomsCreated++;
    }
    for (const { item, event, expected } of changes) {
      const roomId = rooms.get(item.room).id;
      if (event.roomId === roomId && event.resourceIds.length === 0) {
        summary.skipped++;
        log(`Já atualizado: ${event.name} | ${item.room}`);
        continue;
      }
      const body = {
        ...expected,
        roomId,
        resourceIds: [],
        version: event.version,
      };
      const { request: updated } = await request(
        `/requests/${encodeURIComponent(event.id)}`,
        { method: "PUT", body },
      );
      if (
        updated?.id !== event.id ||
        updated.status !== "approved" ||
        updated.authorId !== event.authorId ||
        updated.version !== event.version + 1 ||
        updated.roomId !== roomId ||
        updated.resourceIds?.length !== 0
      )
        throw new Error(
          `A atualização de “${item.name}” não foi confirmada pela API; revisão manual necessária.`,
        );
      for (const [field, value] of Object.entries(expected))
        if (
          !["roomId", "resourceIds"].includes(field) &&
          updated[field] !== value
        )
          throw new Error(
            `A API não preservou o campo ${field} de “${item.name}”; revisão manual necessária.`,
          );
      summary.updated++;
      log(
        `Atualizado: ${updated.date} ${updated.startTime}–${updated.endTime} | ${updated.name} | ${item.room}`,
      );
    }
    log(
      `Concluído: ${summary.updated} locais atualizados; ${summary.skipped} já corretos; ${summary.roomsCreated} ambientes cadastrados.`,
    );
    return summary;
  } finally {
    if (cookie)
      await request("/auth/logout", { method: "POST", body: {} }).catch(() =>
        log(
          "A sessão não pôde ser encerrada pela API; ela continua sujeita à expiração normal.",
        ),
      );
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
        'Uso: node scripts/update-demo-venues.js [--origin https://flxpfu.com.br] [--publish]\nSem --publish: somente simulação anônima. Para atualizar, forneça {"email":"…","password":"…"} pela entrada padrão protegida. Nunca informe credenciais nos argumentos.',
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
    await updateDemoVenues({ origin, publish, credentials });
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
