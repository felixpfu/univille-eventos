import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { createAdministrator } from "../scripts/admin.js";
import {
  DEMO_MARKER,
  demoPlan,
  demoEventData,
  seedDemoEvents,
} from "../scripts/seed-demo.js";
import { updateDemoVenues } from "../scripts/update-demo-venues.js";
import {
  eventPresentationPlan,
  updateEventPresentation,
} from "../scripts/update-event-presentation.js";

// Local fixtures only: no real accounts, SMTP, production database or network.
const credentials = {
  email: "admin@example.test",
  password: "Teste ficticio seguro 2026!",
};
const silent = () => {};
const catalogTables = [
  "themes",
  "costCenters",
  "courses",
  "rooms",
  "resources",
  "roomResources",
];
const mutableEventFields = new Set([
  "name",
  "themeId",
  "publicDescription",
  "audience",
  "requesterName",
  "speaker",
  "organizer",
  "justification",
  "objective",
  "version",
  "updatedAt",
]);

function rows(db, table) {
  return db
    .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
    .all()
    .map((row) => ({ ...row }));
}

function businessSnapshot(db) {
  return Object.fromEntries(
    ["users", "events", "eventResources", "auditLog", ...catalogTables].map(
      (table) => [table, rows(db, table)],
    ),
  );
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "univille-presentation-"));
  const dbPath = join(directory, "events.sqlite");
  await createAdministrator({
    dbPath,
    name: "Admin de testes",
    ...credentials,
  });
  const app = createApp({
    dbPath,
    now: () => new Date("2026-10-23T15:00:00Z"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const db = app.locals.db;
  let cookie;
  async function request(path, { method = "GET", body, as } = {}) {
    const selectedCookie = as === null ? undefined : as || cookie;
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(selectedCookie ? { Cookie: selectedCookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    assert.ok(
      response.ok,
      `${path}: ${response.status} ${JSON.stringify(data)}`,
    );
    return {
      ...data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const operations = [];
  async function trackedFetch(url, options = {}) {
    const path = new URL(url).pathname;
    const method = options.method || "GET";
    if (
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      !path.startsWith("/api/auth/")
    )
      operations.push({
        path,
        method,
        body: options.body && JSON.parse(options.body),
      });
    return fetch(url, options);
  }
  const options = {
    origin,
    credentials,
    publish: true,
    fetchImpl: trackedFetch,
    log: silent,
  };
  try {
    const seeded = await seedDemoEvents({
      origin,
      credentials,
      publish: true,
      log: silent,
    });
    assert.equal(seeded.approved, 8);
    const venues = await updateDemoVenues({
      origin,
      credentials,
      publish: true,
      log: silent,
    });
    assert.equal(venues.skipped, 8);
    const login = await request("/auth/login", {
      method: "POST",
      body: credentials,
    });
    cookie = login.cookie;
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    db,
    request,
    options,
    operations,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("Presentation update preserves all eight schedules and a user event sharing catalogs, then makes no writes on rerun", async () => {
  const f = await fixture();
  try {
    const legacyPlan = await demoPlan();
    const targetPlan = await eventPresentationPlan();
    const existingTheme = (
      await f.request("/admin/catalog/themes", {
        method: "POST",
        body: {
          name: targetPlan[0].theme,
          description: "Tema já cadastrado pela instituição.",
        },
      })
    ).item;
    const unrelatedTheme = (
      await f.request("/admin/catalog/themes", {
        method: "POST",
        body: {
          name: "Tema independente",
          description: "Preservar este cadastro.",
        },
      })
    ).item;
    const unrelatedCost = (
      await f.request("/admin/catalog/costCenters", {
        method: "POST",
        body: {
          name: "Centro independente",
          description: "Preservar este centro.",
        },
      })
    ).item;
    const unrelatedCourse = (
      await f.request("/admin/catalog/courses", {
        method: "POST",
        body: {
          name: "Curso independente · Demonstração",
          costCenterId: unrelatedCost.id,
          description:
            "Cadastro externo sem o marcador esperado pela migração.",
        },
      })
    ).item;
    const beforeMetadata = await f.request("/metadata");
    const first = legacyPlan[0];
    const sharedTheme = beforeMetadata.themes.find(
      (item) => item.name === "Demonstração acadêmica",
    );
    const sharedCourse = beforeMetadata.courses.find(
      (item) => item.name === `${first.course} · Demonstração`,
    );
    const room = beforeMetadata.rooms.find((item) => item.name === first.room);
    const resource = (
      await f.request("/admin/catalog/resources", {
        method: "POST",
        body: { name: "Recurso de evento próprio" },
      })
    ).item;
    const userRoom = (
      await f.request("/admin/catalog/rooms", {
        method: "POST",
        body: { name: "Sala de evento próprio", resourceIds: [resource.id] },
      })
    ).item;
    const registration = await f.request("/auth/register", {
      method: "POST",
      as: null,
      body: {
        role: "requester",
        email: "requester@example.test",
        password: credentials.password,
        name: "Pessoa de testes",
        companyName: "Empresa de testes",
        cnpj: "12.345.678/0001-95",
      },
    });
    const data = demoEventData(first, {
      themeId: sharedTheme.id,
      courseId: sharedCourse.id,
      roomId: room.id,
    });
    const userEvent = (
      await f.request("/requests", {
        method: "POST",
        as: registration.cookie,
        body: {
          ...data,
          name: "Evento próprio criado pelo usuário",
          date: "2026-11-18",
          roomId: userRoom.id,
          resourceIds: [resource.id],
          publicDescription:
            "Texto próprio que deve permanecer integralmente preservado.",
          notes: "Observações próprias sem marcador de migração.",
        },
      })
    ).request;
    const pending = (
      await f.request(`/requests/${userEvent.id}/submit`, {
        method: "POST",
        as: registration.cookie,
        body: { version: userEvent.version },
      })
    ).request;
    await f.request(`/admin/requests/${userEvent.id}/approve`, {
      method: "POST",
      body: { version: pending.version },
    });

    const before = businessSnapshot(f.db);
    const summary = await updateEventPresentation(f.options);
    assert.equal(summary.planned, 8);
    assert.equal(summary.updated, 8);
    assert.equal(summary.skipped, 0);
    const after = businessSnapshot(f.db);
    assert.equal(
      after.events.length,
      9,
      "the migration must not create or duplicate events",
    );
    const ownBefore = before.events.find((event) => event.id === userEvent.id);
    assert.deepEqual(
      after.events.find((event) => event.id === userEvent.id),
      ownBefore,
    );
    assert.deepEqual(after.eventResources, before.eventResources);
    assert.deepEqual(after.users, before.users);
    for (const table of ["rooms", "resources", "roomResources"])
      assert.deepEqual(after[table], before[table]);

    for (const item of targetPlan) {
      const old = before.events.find((event) =>
        event.notes.includes(`[${DEMO_MARKER}:${item.key}]`),
      );
      assert.ok(old);
      const updated = after.events.find((event) => event.id === old.id);
      for (const [field, value] of Object.entries(old))
        if (!mutableEventFields.has(field))
          assert.deepEqual(
            updated[field],
            value,
            `${item.key}: ${field} must remain unchanged`,
          );
      assert.equal(updated.version, old.version + 1);
      assert.equal(updated.name, item.name);
      assert.equal(updated.publicDescription, item.description);
      for (const field of [
        "audience",
        "requesterName",
        "speaker",
        "organizer",
        "justification",
        "objective",
      ])
        assert.equal(updated[field], item[field]);
      assert.equal(
        after.themes.find((theme) => theme.id === updated.themeId)?.name,
        item.theme,
      );
    }
    for (const original of before.courses) {
      const updated = after.courses.find((course) => course.id === original.id);
      assert.ok(updated, "course IDs must be retained");
      assert.equal(updated.costCenterId, original.costCenterId);
      if (original.id === unrelatedCourse.id) {
        assert.deepEqual(updated, original);
        continue;
      }
      assert.equal(updated.name, original.name.replace(/ · Demonstração$/, ""));
    }
    assert.equal(after.courses.length, before.courses.length);
    assert.equal(after.costCenters.length, before.costCenters.length);
    assert.equal(after.costCenters[0].id, before.costCenters[0].id);
    assert.equal(after.costCenters[0].name, "Atividades acadêmicas");
    assert.deepEqual(
      after.costCenters.find((cost) => cost.id === unrelatedCost.id),
      unrelatedCost,
    );
    assert.equal(
      after.themes.find((theme) => theme.id === sharedTheme.id)?.name,
      "Atividades acadêmicas",
    );
    assert.deepEqual(
      after.themes.find((theme) => theme.id === existingTheme.id),
      existingTheme,
    );
    assert.deepEqual(
      after.themes.find((theme) => theme.id === unrelatedTheme.id),
      unrelatedTheme,
    );
    const allowedThemeNames = new Set([
      "Atividades acadêmicas",
      unrelatedTheme.name,
      ...targetPlan.map((item) => item.theme),
    ]);
    assert.ok(after.themes.every((theme) => allowedThemeNames.has(theme.name)));
    assert.equal(
      new Set(after.themes.map((theme) => theme.name)).size,
      after.themes.length,
    );
    assert.equal(
      f.operations.filter(
        (op) => op.method === "PUT" && op.path.startsWith("/api/requests/"),
      ).length,
      8,
    );
    assert.ok(
      !f.operations.some(
        (op) => op.method === "POST" && op.path === "/api/requests",
      ),
    );
    assert.ok(!f.operations.some((op) => op.method === "DELETE"));

    const firstRunOperations = f.operations.length;
    const repeated = await updateEventPresentation(f.options);
    assert.equal(repeated.updated, 0);
    assert.equal(repeated.skipped, 8);
    assert.equal(repeated.catalogsUpdated, 0);
    assert.equal(repeated.themesCreated, 0);
    assert.equal(
      f.operations.length,
      firstRunOperations,
      "reruns must not write events or catalogs",
    );
    assert.deepEqual(
      businessSnapshot(f.db),
      after,
      "reruns must preserve versions and audit history",
    );
  } finally {
    await f.close();
  }
});

test("Presentation update refuses a manually changed marked event before any catalog or event write", async () => {
  const f = await fixture();
  try {
    const events = (await f.request("/admin/requests")).requests;
    const last = events.at(-1);
    await f.request(`/requests/${last.id}`, {
      method: "PUT",
      body: {
        publicDescription: "Descrição alterada manualmente pelo responsável.",
        version: last.version,
      },
    });
    const before = businessSnapshot(f.db);
    await assert.rejects(
      updateEventPresentation(f.options),
      /revis|difere|alterad|campo/i,
    );
    assert.deepEqual(
      f.operations,
      [],
      "preflight must finish before the first catalog mutation",
    );
    assert.deepEqual(businessSnapshot(f.db), before);
  } finally {
    await f.close();
  }
});

test("Presentation update resumes after partial catalog writes and a lost event response without repeating completed changes", async () => {
  const f = await fixture();
  try {
    const shared = (await f.request("/admin/requests")).requests[0];
    const registration = await f.request("/auth/register", {
      method: "POST",
      as: null,
      body: {
        role: "requester",
        email: "resume-requester@example.test",
        password: credentials.password,
        name: "Pessoa com evento próprio",
        companyName: "Empresa de testes",
        cnpj: "12.345.678/0001-95",
      },
    });
    const own = (
      await f.request("/requests", {
        method: "POST",
        as: registration.cookie,
        body: {
          ...shared,
          name: "Evento próprio preservado durante retomadas",
          date: "2026-11-19",
          publicDescription: "Conteúdo próprio fora da atualização.",
          notes: "Este pedido não tem marcador de migração.",
        },
      })
    ).request;
    const before = businessSnapshot(f.db);
    const ownBefore = before.events.find((event) => event.id === own.id);
    let catalogPuts = 0;
    await assert.rejects(
      updateEventPresentation({
        ...f.options,
        fetchImpl: async (url, options = {}) => {
          if (
            options.method === "PUT" &&
            new URL(url).pathname.startsWith("/api/admin/catalog/") &&
            ++catalogPuts === 3
          )
            throw new Error(
              "Falha de transporte após dois catálogos confirmados",
            );
          return f.options.fetchImpl(url, options);
        },
      }),
      /Falha de transporte/,
    );
    const partialCatalogs = businessSnapshot(f.db);
    assert.deepEqual(partialCatalogs.events, before.events);
    assert.deepEqual(partialCatalogs.eventResources, before.eventResources);
    assert.equal(f.operations.length, 2);
    assert.ok(
      f.operations.every(
        (op) =>
          op.method === "PUT" && op.path.startsWith("/api/admin/catalog/"),
      ),
    );
    const confirmedCatalogIds = f.operations.map((operation) =>
      operation.path.split("/").at(-1),
    );

    let eventPuts = 0;
    await assert.rejects(
      updateEventPresentation({
        ...f.options,
        fetchImpl: async (url, options = {}) => {
          const response = await f.options.fetchImpl(url, options);
          if (
            options.method === "PUT" &&
            new URL(url).pathname.startsWith("/api/requests/") &&
            ++eventPuts === 1
          ) {
            // The server committed the first event, but the caller never saw
            // its response. Retrying must recognize the final payload.
            assert.equal(response.status, 200);
            await response.arrayBuffer();
            throw new Error(
              "Resposta perdida após confirmar um evento no servidor",
            );
          }
          return response;
        },
      }),
      /Resposta perdida/,
    );
    const partialEvent = businessSnapshot(f.db);
    const changedEvents = partialEvent.events.filter((event) => {
      const original = before.events.find((item) => item.id === event.id);
      return event.version !== original.version;
    });
    assert.equal(changedEvents.length, 1);
    const completed = changedEvents[0];
    const createdThemeIds = partialEvent.themes.map((theme) => theme.id);
    assert.deepEqual(
      partialEvent.events.find((event) => event.id === own.id),
      ownBefore,
    );
    assert.deepEqual(partialEvent.eventResources, before.eventResources);
    for (const id of confirmedCatalogIds)
      assert.equal(
        f.operations.filter((op) => op.path.endsWith(`/${id}`)).length,
        1,
        "confirmed catalog updates must not repeat on resume",
      );

    const recovered = await updateEventPresentation(f.options);
    assert.equal(recovered.updated, 7);
    assert.equal(recovered.skipped, 1);
    assert.equal(recovered.catalogsUpdated, 0);
    assert.equal(recovered.themesCreated, 0);
    const final = businessSnapshot(f.db);
    assert.deepEqual(
      final.events.find((event) => event.id === completed.id),
      completed,
      "the event committed before losing its response must keep its version and timestamps",
    );
    assert.deepEqual(
      final.events.find((event) => event.id === own.id),
      ownBefore,
    );
    assert.deepEqual(final.eventResources, before.eventResources);
    assert.deepEqual(final.users, before.users);
    assert.deepEqual(
      final.themes.map((theme) => theme.id),
      createdThemeIds,
    );
    assert.equal(final.events.length, before.events.length);
    const targetPlan = await eventPresentationPlan();
    for (const item of targetPlan) {
      const original = before.events.find((event) =>
        event.notes.includes(`[${DEMO_MARKER}:${item.key}]`),
      );
      const updated = final.events.find((event) => event.id === original.id);
      assert.equal(
        updated.version,
        original.version + 1,
        "each of the eight events must be written exactly once across all attempts",
      );
      assert.equal(updated.name, item.name);
      assert.equal(updated.publicDescription, item.description);
      for (const [field, value] of Object.entries(original))
        if (!mutableEventFields.has(field))
          assert.deepEqual(updated[field], value);
      assert.equal(
        final.auditLog.filter(
          (entry) =>
            entry.action === "request.edited" && entry.entityId === original.id,
        ).length,
        1,
      );
    }
    assert.equal(
      f.operations.filter(
        (op) => op.method === "PUT" && op.path.startsWith("/api/requests/"),
      ).length,
      8,
    );
    const completedOperations = f.operations.length;
    const repeated = await updateEventPresentation(f.options);
    assert.equal(repeated.updated, 0);
    assert.equal(repeated.skipped, 8);
    assert.equal(f.operations.length, completedOperations);
    assert.deepEqual(businessSnapshot(f.db), final);
  } finally {
    await f.close();
  }
});

test("Presentation update refuses a course-name collision without overwriting, merging or partially updating data", async () => {
  const f = await fixture();
  try {
    const plan = await demoPlan();
    const metadata = await f.request("/metadata");
    await f.request("/admin/catalog/courses", {
      method: "POST",
      body: {
        name: plan.at(-1).course,
        costCenterId: metadata.costCenters[0].id,
        description: "Curso que já existia e não pertence à atualização.",
      },
    });
    const before = businessSnapshot(f.db);
    await assert.rejects(
      updateEventPresentation(f.options),
      /revis|colis|catálogo|nome|existe/i,
    );
    assert.deepEqual(f.operations, []);
    assert.deepEqual(businessSnapshot(f.db), before);
  } finally {
    await f.close();
  }
});

test("Presentation preview performs no requests and rejects untrusted origins before authentication", async () => {
  let requests = 0;
  const logs = [];
  const fetchImpl = async () => {
    requests++;
    throw new Error("Preview must not access the network");
  };
  const result = await updateEventPresentation({
    origin: "http://127.0.0.1:3012",
    fetchImpl,
    log: (message) => logs.push(message),
  });
  assert.equal(result.planned, 8);
  assert.equal(result.updated, 0);
  assert.equal(requests, 0);
  assert.ok(logs.length >= 8);
  assert.ok(logs.join("\n").includes("Simulação"));
  await assert.rejects(
    updateEventPresentation({
      origin: "https://untrusted.example",
      publish: true,
      credentials,
      fetchImpl,
      log: silent,
    }),
  );
  assert.equal(requests, 0);
});
