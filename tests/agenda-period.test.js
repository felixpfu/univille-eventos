import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { agendaPeriod } from "../client/agenda-period.js";

test("agenda initially selects the anchor and its next two months", () => {
  assert.deepEqual(agendaPeriod("2026-10"), {
    selectedMonth: "2026-10",
    windowMonth: "2026-10",
    months: [
      { key: "2026-10", offset: 0 },
      { key: "2026-11", offset: 1 },
      { key: "2026-12", offset: 2 },
    ],
    offset: 0,
    windowOffset: 0,
    minOffset: -1521,
    maxOffset: 95678,
  });
});

test("advancing beyond December opens January–March and preserves the selected month", () => {
  for (const [offset, selectedMonth] of [
    [3, "2027-01"],
    [4, "2027-02"],
    [5, "2027-03"],
  ]) {
    const result = agendaPeriod("2026-10", offset);
    assert.equal(result.selectedMonth, selectedMonth);
    assert.equal(result.windowMonth, "2027-01");
    assert.equal(result.windowOffset, 3);
    assert.deepEqual(result.months, [
      { key: "2027-01", offset: 3 },
      { key: "2027-02", offset: 4 },
      { key: "2027-03", offset: 5 },
    ]);
  }
});

test("negative offsets use preceding complete groups rather than truncating toward zero", () => {
  const september = agendaPeriod("2026-10", -1);
  assert.equal(september.selectedMonth, "2026-09");
  assert.equal(september.windowMonth, "2026-07");
  assert.equal(september.windowOffset, -3);
  assert.deepEqual(september.months, [
    { key: "2026-07", offset: -3 },
    { key: "2026-08", offset: -2 },
    { key: "2026-09", offset: -1 },
  ]);
  assert.equal(agendaPeriod("2026-10", -3).selectedMonth, "2026-07");
  assert.equal(agendaPeriod("2026-10", -3).windowMonth, "2026-07");
  assert.equal(agendaPeriod("2026-10", -4).selectedMonth, "2026-06");
  assert.equal(agendaPeriod("2026-10", -4).windowMonth, "2026-04");
});

test("month arithmetic crosses February and leap years without day rollover", () => {
  for (const anchor of ["1900-02", "2000-02", "2023-02", "2024-02"]) {
    const year = anchor.slice(0, 4);
    assert.equal(agendaPeriod(anchor, 1).selectedMonth, `${year}-03`);
    assert.equal(agendaPeriod(anchor, -1).selectedMonth, `${year}-01`);
  }
  assert.equal(agendaPeriod("2024-02", 12).selectedMonth, "2025-02");
});

test("the lower boundary clamps selection and still returns January–March 1900", () => {
  const result = agendaPeriod("1900-01", -Number.MAX_SAFE_INTEGER);
  assert.equal(result.selectedMonth, "1900-01");
  assert.equal(result.windowMonth, "1900-01");
  assert.equal(result.offset, 0);
  assert.equal(result.windowOffset, 0);
  assert.equal(result.minOffset, 0);
  assert.equal(result.maxOffset, 97199);
  assert.deepEqual(
    result.months.map((month) => month.key),
    ["1900-01", "1900-02", "1900-03"],
  );
});

test("the upper boundary clamps selection and keeps the window at October–December 9999", () => {
  const result = agendaPeriod("9999-12", Number.MAX_SAFE_INTEGER);
  assert.equal(result.selectedMonth, "9999-12");
  assert.equal(result.windowMonth, "9999-10");
  assert.equal(result.offset, 0);
  assert.equal(result.windowOffset, -2);
  assert.equal(result.minOffset, -97199);
  assert.equal(result.maxOffset, 0);
  assert.deepEqual(result.months, [
    { key: "9999-10", offset: -2 },
    { key: "9999-11", offset: -1 },
    { key: "9999-12", offset: 0 },
  ]);
});

test("boundary windows can shift relative to the anchor while retaining valid month offsets", () => {
  assert.deepEqual(agendaPeriod("1900-02", -1).months, [
    { key: "1900-01", offset: -1 },
    { key: "1900-02", offset: 0 },
    { key: "1900-03", offset: 1 },
  ]);
  assert.equal(agendaPeriod("1900-02", -1).windowOffset, -1);
  const future = agendaPeriod("2026-10", Number.MAX_SAFE_INTEGER);
  assert.equal(future.selectedMonth, "9999-12");
  assert.equal(future.offset, future.maxOffset);
  assert.equal(future.windowMonth, "9999-10");
  const past = agendaPeriod("2026-10", -Number.MAX_SAFE_INTEGER);
  assert.equal(past.selectedMonth, "1900-01");
  assert.equal(past.offset, past.minOffset);
});

test("programming errors in anchor or offset arguments fail explicitly", () => {
  for (const value of [undefined, null, 202610, [], {}, new Date()])
    assert.throws(() => agendaPeriod(value), TypeError);
  for (const value of [
    "2026-1",
    "2026-10-01",
    " 2026-10",
    "2026-10 ",
    "invalid",
  ])
    assert.throws(() => agendaPeriod(value), TypeError);
  for (const value of ["1899-12", "0000-01", "2026-00", "2026-13"])
    assert.throws(() => agendaPeriod(value), RangeError);
  for (const value of [null, "1", [], {}, 1n])
    assert.throws(() => agendaPeriod("2026-10", value), TypeError);
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => agendaPeriod("2026-10", value), RangeError);
});

test("results remain identical under Brazilian, UTC and extreme positive time zones", () => {
  const helper = new URL("../client/agenda-period.js", import.meta.url).href;
  const script = `import { agendaPeriod } from ${JSON.stringify(helper)}; console.log(JSON.stringify([agendaPeriod("2024-02",1),agendaPeriod("2026-10",3),agendaPeriod("2026-10",-1)]));`;
  const expected = [
    agendaPeriod("2024-02", 1),
    agendaPeriod("2026-10", 3),
    agendaPeriod("2026-10", -1),
  ];
  for (const timezone of ["America/Sao_Paulo", "UTC", "Pacific/Kiritimati"]) {
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        env: { ...process.env, TZ: timezone },
      },
    );
    assert.deepEqual(JSON.parse(output), expected, timezone);
  }
});
