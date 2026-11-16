import test from "node:test";
import assert from "node:assert/strict";
import {
  uint64,
  duration,
  utcFromInput,
  localInput,
  commandBody,
  canConnect,
  series,
  CommandTracker,
  escapeHtml,
  number,
} from "../js/core.js";
import { chart } from "../js/charts.js";
const row = (seq, uptime, continuity = "run/a") => ({
  quality: "ACCEPTED",
  continuity,
  received_at: new Date(1700000000000 + Number(uptime)).toISOString(),
  telemetry: {
    boot_id: "12345678",
    seq: String(seq),
    uptime_ms: String(uptime),
    brightness_applied: 25,
    power_sim_w: 6,
  },
});

test("uint64 stays exact beyond JS safe integer", () => {
  assert.equal(uint64("18446744073709551615"), 18446744073709551615n);
  assert.equal(duration("3600000"), "1 giờ 0 phút 0 giây");
  for (const bad of ["01", "-1", "1.0", "18446744073709551616", 1, true])
    assert.throws(() => uint64(bad));
});
test("Vietnam clock input converts to UTC and rejects invalid date", () => {
  assert.equal(utcFromInput("2026-11-16T13:00"), "2026-11-16T06:00:00.000Z");
  assert.equal(
    localInput(new Date("2026-11-16T06:00:00Z")),
    "2026-11-16T13:00",
  );
  assert.throws(() => utcFromInput("2026-02-30T13:00"));
  assert.throws(() => utcFromInput("bad"));
});
test("command is explicit integer and AUTO omits brightness", () => {
  assert.deepEqual(commandBody("AUTO", 80), { mode: "AUTO" });
  assert.deepEqual(commandBody("MANUAL", "80"), {
    mode: "MANUAL",
    brightness: 80,
  });
  for (const bad of ["-1", "101", "80.5", "true", "", true])
    assert.throws(() => commandBody("MANUAL", bad));
});
test("series breaks boot/continuity/order/gap/quality instead of interpolation", () => {
  const a = row(1, 1000),
    b = row(2, 3000);
  assert.ok(canConnect(a, b));
  assert.equal(series([a, b], "power_sim_w").length, 1);
  for (const changed of [
    { ...b, continuity: "run/b" },
    { ...b, continuity: undefined },
    { ...b, quality: "OUT_OF_ORDER" },
    row(2, 8000),
    { ...b, telemetry: { ...b.telemetry, boot_id: "11111111" } },
    { ...b, telemetry: { ...b.telemetry, seq: "1" } },
  ])
    assert.equal(canConnect(a, changed), false);
  assert.equal(
    series([a, { ...b, quality: "BAD" }, row(3, 5000)], "power_sim_w").length,
    2,
  );
});
test("big uptimes use BigInt differences without rounding", () => {
  const a = row("9007199254740993", 0),
    b = row("9007199254740994", 2000);
  a.telemetry.uptime_ms = "9007199254740993";
  b.telemetry.uptime_ms = "9007199254742993";
  assert.ok(canConnect(a, b));
});
test("submit locks synchronously, no retry or fake success from telemetry", () => {
  const t = new CommandTracker();
  assert.ok(t.begin("node_01"));
  assert.equal(t.begin("node_01"), false);
  t.accepted("node_01", { command_id: "a", result: "PENDING" });
  assert.ok(t.locked("node_01"));
  t.observe({
    node_id: "node_01",
    pending_command_id: null,
    freshness: "FRESH",
  });
  assert.equal(t.get("node_01").kind, "PENDING");
  t.accepted("node_01", { command_id: "a", result: "APPLIED" });
  assert.equal(t.locked("node_01"), false);
});
test("unknown POST result waits for reconciliation, does not label TIMEOUT/APPLIED", () => {
  const t = new CommandTracker();
  t.begin("node_01");
  t.failed("node_01", { status: 503, message: "unavailable" });
  assert.equal(t.get("node_01").kind, "UNCERTAIN");
  assert.ok(t.locked("node_01"));
  t.observe({
    node_id: "node_01",
    pending_command_id: null,
    freshness: "STALE",
  });
  assert.ok(t.locked("node_01"));
  t.observe({
    node_id: "node_01",
    pending_command_id: "a",
    freshness: "FRESH",
  });
  assert.equal(t.get("node_01").kind, "PENDING");
});
test("uncertain request without pending can allow new explicit action after fresh sync", () => {
  const t = new CommandTracker();
  t.failed("node_01", { status: 0, message: "network" });
  t.observe({
    node_id: "node_01",
    pending_command_id: null,
    freshness: "FRESH",
  });
  assert.equal(t.get("node_01").kind, "UNCERTAIN");
  assert.equal(t.locked("node_01"), false);
  assert.ok(t.begin("node_01"));
});
test("formatters keep empty values empty and metadata escaped", () => {
  assert.equal(number(null), "—");
  assert.equal(number(NaN), "—");
  assert.equal(escapeHtml("<img src=x>"), "&lt;img src=x&gt;");
  assert.equal(number(0), "0");
});
test("SVG charts have labels, no fake line through disconnected singletons", () => {
  const result = chart([row(1, 0), row(2, 10000)], "power_sim_w", {
    label: "Power <bad>",
    unit: "W",
    color: "#2563eb",
  });
  assert.ok(result.includes('role="img"'));
  assert.ok(result.includes("Power &lt;bad&gt;"));
  assert.equal((result.match(/<circle/g) || []).length, 2);
  assert.equal((result.match(/<path/g) || []).length, 0);
});

test("terminal REJECTED/TIMEOUT retain backend reason and release pending lock", () => {
  for (const [result, reason] of [
    ["REJECTED", "EXPIRED"],
    ["TIMEOUT", "ACK_TIMEOUT"],
  ]) {
    const tracker = new CommandTracker();
    tracker.begin("node_01");
    tracker.accepted("node_01", { command_id: "a", result: "PENDING" });
    tracker.accepted("node_01", { command_id: "a", result, reason });
    assert.equal(tracker.get("node_01").kind, result);
    assert.equal(tracker.get("node_01").detail, reason);
    assert.equal(tracker.locked("node_01"), false);
  }
});
