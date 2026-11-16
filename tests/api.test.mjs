import test from "node:test";
import assert from "node:assert/strict";
import { request, ApiError, Poller, query } from "../js/api.js";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test("health 503 is readable, other 503 cannot become success", async () => {
  const health = await request("/api/health", {
    fetcher: async () =>
      Response.json({ status: "DEGRADED", broker: false }, { status: 503 }),
  });
  assert.equal(health.broker, false);
  await assert.rejects(
    request("/api/nodes", {
      fetcher: async () =>
        Response.json({ detail: "offline" }, { status: 503 }),
    }),
    (error) => error instanceof ApiError && error.status === 503,
  );
});
test("POST happens once with correct JSON even if response is lost", async () => {
  let count = 0;
  await assert.rejects(
    request("/api/nodes/node_01/commands", {
      method: "POST",
      body: { mode: "MANUAL", brightness: 80 },
      fetcher: async (_url, options) => {
        count++;
        assert.equal(options.body, '{"mode":"MANUAL","brightness":80}');
        throw new TypeError("lost response");
      },
    }),
  );
  assert.equal(count, 1);
});
test("CSV error is not downloaded as a blob", async () => {
  await assert.rejects(
    request("/api/experiments/1/export.csv", {
      blob: true,
      fetcher: async () => Response.json({ detail: "error" }, { status: 503 }),
    }),
  );
  const blob = await request("/csv", {
    blob: true,
    fetcher: async () => new Response("a,b\n1,2", { status: 200 }),
  });
  assert.equal(await blob.text(), "a,b\n1,2");
});
test("query keeps UTC and omits undefined", () => {
  assert.equal(
    query({ limit: 1000, from: "2026-11-16T00:00:00Z", empty: undefined }),
    "limit=1000&from=2026-11-16T00%3A00%3A00Z",
  );
});
test("poller does not overlap, respects hidden document, aborts when stopped", async () => {
  let running = 0,
    maximum = 0,
    count = 0,
    visible = true,
    aborted = false;
  const p = new Poller(
    async (signal) => {
      count++;
      running++;
      maximum = Math.max(maximum, running);
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      await wait(15);
      running--;
    },
    3,
    { visible: () => visible },
  );
  p.start();
  p.run();
  p.run();
  await wait(8);
  assert.equal(count, 1);
  await wait(17);
  visible = false;
  await wait(20);
  const before = count;
  await wait(10);
  assert.equal(count, before);
  visible = true;
  await wait(12);
  p.stop();
  assert.equal(maximum, 1);
  assert.ok(aborted);
});
