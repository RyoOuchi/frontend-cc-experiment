import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite;
let api;
before(async () => {
  const previousLocation = globalThis.location;
  globalThis.location = { origin: "http://localhost:5173" };
  try {
    vite = await createServer({
      root: fileURLToPath(new URL("..", import.meta.url)),
      configFile: false,
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: "custom",
    });
    ({ api } = await vite.ssrLoadModule("/src/api.ts"));
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});
after(async () => { await vite?.close(); });

const session = { gameId: "test-game", token: "test-token", role: "ADMIN" };
function pendingRequest(t) {
  let signal;
  let complete;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      complete = () => resolve(new Response(JSON.stringify({ labels: ["Person"], matched: true })));
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return { aborted: () => signal.aborted, complete: () => complete() };
}

test("a suggestion can finish after the normal twelve-second API timeout", async (t) => {
  const request = pendingRequest(t);
  const result = api.suggestLabels(session, "人間");
  t.mock.timers.tick(13_000);
  assert.equal(request.aborted(), false);
  request.complete();
  assert.deepEqual((await result).labels, ["Person"]);
});

test("suggestions still time out after twenty-four seconds", async (t) => {
  const request = pendingRequest(t);
  const result = api.suggestLabels(session, "人間");
  const rejected = assert.rejects(result, /タイムアウト/);
  t.mock.timers.tick(24_000);
  assert.equal(request.aborted(), true);
  await rejected;
});

test("ordinary game requests retain the twelve-second timeout", async (t) => {
  const request = pendingRequest(t);
  const result = api.state(session);
  const rejected = assert.rejects(result, /タイムアウト/);
  t.mock.timers.tick(12_000);
  assert.equal(request.aborted(), true);
  await rejected;
});
