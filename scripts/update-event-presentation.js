import { readFile, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  checkedOrigin,
  DEMO_MARKER,
  demoEventData,
  demoPlan,
} from "./seed-demo.js";

const SUFFIX = " · Demonstração";
const LEGACY_CATALOG_NAME = "Demonstração acadêmica";
const LEGACY_CATALOG_DESCRIPTION = `${DEMO_MARKER}: cadastro fictício para demonstração do sistema; não confirma instalações nem a oferta do curso no campus.`;
export const PRESENTATION_CATALOGS = Object.freeze({
  sharedName: "Atividades acadêmicas",
  themeDescription:
    "Atividades de ensino, integração e desenvolvimento acadêmico.",
  costCenterDescription:
    "Centro de custo para organização das atividades acadêmicas.",
});
export const presentationCourseDescription = (name) =>
  `Atividades acadêmicas relacionadas ao curso de ${name}.`;
const themeDescription = (name) =>
  `Atividades acadêmicas sobre ${name.toLocaleLowerCase("pt-BR")}.`;

export async function eventPresentationPlan() {
  const plan = JSON.parse(
    await readFile(
      new URL("./event-presentation.json", import.meta.url),
      "utf8",
    ),
  );
  const limits = {
    name: 200,
    theme: 160,
    description: 2000,
    audience: 500,
    requesterName: 500,
    speaker: 500,
    organizer: 500,
    justification: 5000,
    objective: 5000,
  };
  if (!Array.isArray(plan) || plan.length !== 8)
    throw new Error("O plano de apresentação deve conter oito eventos.");
  const keys = new Set();
  for (const item of plan) {
    if (
      !item ||
      typeof item !== "object" ||
      !/^[a-z-]+$/.test(item.key) ||
      keys.has(item.key) ||
      Object.keys(item).some((key) => key !== "key" && !(key in limits)) ||
      Object.entries(limits).some(
        ([key, max]) =>
          typeof item[key] !== "string" ||
          !item[key] ||
          item[key].trim() !== item[key] ||
          item[key].length > max,
      ) ||
      [
        "name",
        "theme",
        "description",
        "audience",
        "requesterName",
        "speaker",
        "organizer",
      ].some((key) => /demonstração|fictíci/iu.test(item[key]))
    )
      throw new Error("O plano de apresentação contém dados inválidos.");
    keys.add(item.key);
  }
  return plan;
}

function equalValue(actual, expected) {
  if (!Array.isArray(expected)) return actual === expected;
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const ordered = [...expected].sort();
  return [...actual].sort().every((value, index) => value === ordered[index]);
}
function matches(actual, expected) {
  return (
    actual &&
    Object.entries(expected).every(([key, value]) =>
      equalValue(actual[key], value),
    )
  );
}
function targetEventData(legacy, presentation, themeId) {
  return {
    ...legacy,
    name: presentation.name,
    themeId,
    publicDescription: presentation.description,
    audience: presentation.audience,
    requesterName: presentation.requesterName,
    speaker: presentation.speaker,
    organizer: presentation.organizer,
    justification: presentation.justification,
    objective: presentation.objective,
  };
}
function catalogData(entity, item) {
  return {
    name: item.name,
    description: item.description,
    ...(entity === "courses" ? { costCenterId: item.costCenterId } : {}),
  };
}

/**
 * Updates only the eight unchanged, approved seed events through the normal
 * administration API. Their private provenance notes and scheduling fields stay
 * intact. Catalog labels are shared, so the six courses and original shared
 * theme/cost center retain their IDs and every existing relationship.
 *
 * Run one instance at a time. Catalog routes have no version/CAS parameter: a
 * fresh read guards each catalog write; event writes also use the API version.
 * Interrupted runs accept only exact legacy or final payloads and may be resumed.
 */
export async function updateEventPresentation({
  origin = "https://flxpfu.com.br",
  credentials,
  publish = false,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  origin = checkedOrigin(origin);
  const [legacyPlan, presentationPlan] = await Promise.all([
    demoPlan(),
    eventPresentationPlan(),
  ]);
  const presentationByKey = new Map(
    presentationPlan.map((item) => [item.key, item]),
  );
  if (legacyPlan.some((item) => !presentationByKey.has(item.key)))
    throw new Error(
      "O plano de apresentação não corresponde aos oito eventos legados.",
    );
  const summary = {
    planned: legacyPlan.length,
    updated: 0,
    skipped: 0,
    catalogsUpdated: 0,
    themesCreated: 0,
  };
  if (!publish) {
    for (const item of legacyPlan) {
      const copy = presentationByKey.get(item.key);
      log(
        `${item.date} ${item.startTime}–${item.endTime} | ${copy.name} | ${copy.theme} | ${item.room}`,
      );
    }
    log(
      "Simulação: nenhum acesso autenticado nem alteração. Use --publish para atualizar a apresentação dos oito eventos aprovados.",
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
        `Operação interrompida em ${path}: HTTP ${response.status}${result.code ? ` (${result.code})` : ""}. As alterações já confirmadas foram preservadas; revise antes de retomar.`,
      );
    return result;
  }

  try {
    const session = await request("/auth/login", {
      method: "POST",
      body: { email: credentials.email, password: credentials.password },
    });
    if (session.user?.role !== "admin" || !cookie)
      throw new Error("É necessária uma conta administrativa ativa.");
    const [metadata, own, administrative] = await Promise.all([
      request("/metadata"),
      request("/requests"),
      request("/admin/requests"),
    ]);
    const events = [
      ...new Map(
        [...own.requests, ...administrative.requests].map((event) => [
          event.id,
          event,
        ]),
      ).values(),
    ];
    const named = (entity, name) => {
      const rows = metadata[entity].filter((row) => row.name === name);
      if (rows.length > 1)
        throw new Error(
          `O catálogo “${name}” está ambíguo; revisão manual necessária.`,
        );
      return rows[0];
    };
    const legacyTheme = named("themes", LEGACY_CATALOG_NAME);
    const sharedTheme =
      legacyTheme || named("themes", PRESENTATION_CATALOGS.sharedName);
    if (!sharedTheme)
      throw new Error(
        "O tema compartilhado original não foi identificado; nenhum registro foi alterado.",
      );
    const catalogOperations = [];
    function planCatalog(
      entity,
      initial,
      legacyName,
      targetName,
      targetDescription,
    ) {
      if (
        !initial ||
        !(
          matches(initial, {
            name: legacyName,
            description: LEGACY_CATALOG_DESCRIPTION,
          }) ||
          matches(initial, { name: targetName, description: targetDescription })
        )
      )
        throw new Error(
          `O catálogo “${legacyName}” foi alterado fora do plano; nenhum registro foi alterado.`,
        );
      const collision = named(entity, targetName);
      if (collision && collision.id !== initial.id)
        throw new Error(
          `O nome “${targetName}” pertence a outro catálogo; nenhum registro foi alterado.`,
        );
      const target = {
        ...catalogData(entity, initial),
        name: targetName,
        description: targetDescription,
      };
      if (!matches(initial, target))
        catalogOperations.push({ entity, initial, target });
    }

    // Finish the complete identity, payload and catalog collision preflight
    // before creating or updating any catalog or event.
    planCatalog(
      "themes",
      sharedTheme,
      LEGACY_CATALOG_NAME,
      PRESENTATION_CATALOGS.sharedName,
      PRESENTATION_CATALOGS.themeDescription,
    );
    const changes = [];
    const courses = new Map();
    const costIds = new Set();
    const themes = new Map();
    for (const item of legacyPlan) {
      const copy = presentationByKey.get(item.key);
      const marked = events.filter((event) =>
        event.notes?.includes(`[${DEMO_MARKER}:${item.key}]`),
      );
      if (marked.length !== 1)
        throw new Error(
          `É necessário exatamente um evento legado para “${copy.name}”; nenhum registro foi alterado.`,
        );
      const event = marked[0];
      if (
        event.status !== "approved" ||
        event.authorId !== session.user.id ||
        !Number.isSafeInteger(event.version) ||
        event.version < 1 ||
        event.rejectionReason !== ""
      )
        throw new Error(
          `“${copy.name}” deve estar aprovado e pertencer à conta administrativa utilizada; nenhum registro foi alterado.`,
        );
      const room = metadata.rooms.find((row) => row.id === event.roomId);
      const course = metadata.courses.find((row) => row.id === event.courseId);
      if (
        !room ||
        room.name !== item.room ||
        !course ||
        event.costCenterId !== course.costCenterId
      )
        throw new Error(
          `Os vínculos de “${copy.name}” diferem do plano legado; nenhum registro foi alterado.`,
        );
      if (courses.has(item.course) && courses.get(item.course).id !== course.id)
        throw new Error(
          `O curso “${item.course}” tem vínculos divergentes; nenhum registro foi alterado.`,
        );
      courses.set(item.course, course);
      costIds.add(course.costCenterId);
      const targetTheme = named("themes", copy.theme);
      themes.set(copy.theme, targetTheme);
      const legacy = demoEventData(item, {
        themeId: sharedTheme.id,
        roomId: room.id,
        courseId: course.id,
      });
      const target = targetEventData(legacy, copy, targetTheme?.id ?? null);
      if (!matches(event, legacy) && !(targetTheme && matches(event, target)))
        throw new Error(
          `“${copy.name}” difere dos dados legados e da apresentação final; nenhum registro foi alterado.`,
        );
      if (
        events.some(
          (other) =>
            other.id !== event.id &&
            [legacy.name, target.name].includes(other.name),
        )
      )
        throw new Error(
          `Há outro evento com o título de “${copy.name}”; nenhum registro foi alterado.`,
        );
      changes.push({ item, copy, event, legacy });
    }
    if (costIds.size !== 1)
      throw new Error(
        "Os cursos legados não compartilham o centro de custo esperado; nenhum registro foi alterado.",
      );
    const cost = metadata.costCenters.find((row) => row.id === [...costIds][0]);
    planCatalog(
      "costCenters",
      cost,
      LEGACY_CATALOG_NAME,
      PRESENTATION_CATALOGS.sharedName,
      PRESENTATION_CATALOGS.costCenterDescription,
    );
    for (const [name, course] of courses)
      planCatalog(
        "courses",
        course,
        `${name}${SUFFIX}`,
        name,
        presentationCourseDescription(name),
      );

    for (const { entity, initial, target } of catalogOperations) {
      const current = (await request(`/admin/catalog/${entity}`)).items.find(
        (row) => row.id === initial.id,
      );
      if (matches(current, target)) continue;
      if (
        !matches(current, { id: initial.id, ...catalogData(entity, initial) })
      )
        throw new Error(
          `O catálogo “${initial.name}” mudou durante a execução; revisão manual necessária.`,
        );
      const { item } = await request(
        `/admin/catalog/${entity}/${encodeURIComponent(initial.id)}`,
        {
          method: "PUT",
          body: target,
        },
      );
      if (!matches(item, { id: initial.id, ...target }))
        throw new Error(
          `A atualização do catálogo “${target.name}” não foi confirmada; revisão manual necessária.`,
        );
      summary.catalogsUpdated++;
    }
    for (const [name, existing] of themes) {
      if (existing) continue;
      const current = (await request("/admin/catalog/themes")).items.filter(
        (row) => row.name === name,
      );
      if (current.length > 1)
        throw new Error(
          `O tema “${name}” ficou ambíguo; revisão manual necessária.`,
        );
      if (current.length) {
        // An existing theme is reused without changing its name or description.
        themes.set(name, current[0]);
        continue;
      }
      const description = themeDescription(name);
      const { item } = await request("/admin/catalog/themes", {
        method: "POST",
        body: { name, description },
      });
      if (!item?.id || !matches(item, { name, description }))
        throw new Error(
          `A criação do tema “${name}” não foi confirmada; revisão manual necessária.`,
        );
      themes.set(name, item);
      summary.themesCreated++;
    }

    for (const { copy, event, legacy } of changes) {
      const target = targetEventData(legacy, copy, themes.get(copy.theme).id);
      const path = `/requests/${encodeURIComponent(event.id)}`;
      const current = (await request(path)).request;
      const invariants = Object.fromEntries(
        [
          "id",
          "authorId",
          "status",
          "costCenterId",
          "createdAt",
          "submittedAt",
          "queueSequence",
          "rejectionReason",
        ].map((key) => [key, event[key]]),
      );
      if (!matches(current, invariants))
        throw new Error(
          `O estado de “${copy.name}” mudou durante a execução; revisão manual necessária.`,
        );
      if (matches(current, target)) {
        summary.skipped++;
        log(`Já atualizado: ${copy.name}`);
        continue;
      }
      if (current.version !== event.version || !matches(current, legacy))
        throw new Error(
          `“${copy.name}” foi editado durante a execução; o registro foi preservado.`,
        );
      const { request: updated } = await request(path, {
        method: "PUT",
        body: { ...target, version: current.version },
      });
      if (
        !matches(updated, {
          ...invariants,
          ...target,
          version: current.version + 1,
        })
      )
        throw new Error(
          `A apresentação de “${copy.name}” não foi confirmada integralmente; revisão manual necessária.`,
        );
      summary.updated++;
      log(
        `Atualizado: ${updated.date} ${updated.startTime}–${updated.endTime} | ${updated.name} | ${copy.theme}`,
      );
    }
    log(
      `Concluído: ${summary.updated} apresentações atualizadas; ${summary.skipped} já corretas; ${summary.catalogsUpdated} catálogos atualizados; ${summary.themesCreated} temas cadastrados.`,
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
        'Uso: node scripts/update-event-presentation.js [--origin https://flxpfu.com.br] [--publish]\nSem --publish: somente simulação anônima. Para atualizar, forneça {"email":"…","password":"…"} pela entrada padrão protegida. Nunca informe credenciais nos argumentos.',
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
    await updateEventPresentation({ origin, publish, credentials });
  } finally {
    if (credentials && typeof credentials === "object")
      credentials.password = undefined;
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
