import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "MutationObserver", "location"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement } = await import("react");
const { render, fireEvent, act, cleanup } = await import("@testing-library/react");
let vite, PlayerGame, api;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  ({ default: PlayerGame } = await vite.ssrLoadModule("/src/components/PlayerGame.tsx"));
  ({ api } = await vite.ssrLoadModule("/src/api.ts"));
});
afterEach(cleanup);
after(async () => { await vite?.close(); dom.window.close(); });

const session = { gameId: "g", playerId: "p", token: "test", role: "PLAYER" };
const round = { roundId: "r", roundNumber: 1, promptText: "本", startAt: 100000, endAt: 115000, uploadDeadlineAt: 119000 };
const game = { gameId: "g", gameCode: "ABCDEF", status: "ACTIVE", currentRound: 1, totalRounds: 1,
  revision: 1, serverTime: 114000, reviewMode: "manual", round, submissions: [],
  players: [{ playerId: "p", displayName: "Test", totalScore: 0, rank: 1, color: 0 }] };

async function startUpload(t, { ticketFails = false } = {}) {
  const track = { stop() {} };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
  t.mock.method(dom.window.HTMLMediaElement.prototype, "play", async () => {});
  t.mock.method(dom.window.HTMLCanvasElement.prototype, "getContext", () => ({ drawImage() {} }));
  t.mock.method(dom.window.HTMLCanvasElement.prototype, "toBlob", (callback) => callback(new Blob(["jpeg"], { type: "image/jpeg" })));
  const ticket = { submissionId: "s", imageKey: "photo", uploadUrl: "https://example.invalid", startedAt: 114000, uploadDeadlineAt: 119000 };
  let attempts = 0;
  const tickets = t.mock.method(api, "uploadTicket", async () => {
    if (ticketFails && attempts++ === 0) throw new Error("lost ticket response");
    return ticket;
  });
  let signal, complete, fail;
  t.mock.method(api, "upload", (_ticket, _photo, abortSignal) => {
    signal = abortSignal;
    return new Promise((resolve, reject) => {
      complete = resolve; fail = reject;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  });
  const accepted = { ...game, status: "JUDGING", submissions: [{ submissionId: "s", roundId: "r", playerId: "p", submittedAt: 114000, elapsedMs: 14000,
    status: "PENDING", moderationStatus: "PENDING", detectedLabels: [], earnedScore: null, rank: null }] };
  const confirm = t.mock.method(api, "confirmPhoto", async () => accepted);
  t.mock.method(api, "state", async () => ({ ...game, status: "JUDGING" }));
  const updates = [];
  const props = { game, session, now: 114000, onUpdate: (value) => updates.push(value), onLeave() {} };
  let view;
  await act(async () => { view = render(createElement(PlayerGame, props)); });
  const video = view.getByLabelText("カメラのライブプレビュー");
  Object.defineProperties(video, { videoWidth: { value: 320 }, videoHeight: { value: 240 } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: /写真を撮る/ })));
  await act(async () => fireEvent.click(view.getByRole("button", { name: "この写真を送信する" })));
  return { ...view, props, tickets, confirm, updates, accepted, get signal() { return signal; }, complete: () => complete(), fail: () => fail(new Error("temporary upload failure")) };
}

test("Send freezes the player's timer and upload survives the 15-second round transition", async (t) => {
  const view = await startUpload(t);
  await act(async () => view.rerender(createElement(PlayerGame, { ...view.props, now: 116000, game: { ...game, status: "JUDGING" } })));
  assert.equal(view.signal.aborted, false);
  assert.equal(view.container.querySelector(".timer b").textContent, "01");
  assert.match(view.container.querySelector(".photo-review-time").textContent, /送信時 残り 1 秒/);
  assert.equal(view.getByRole("dialog").querySelector("#photo-review-status").textContent, "写真をアップロード中…");
  assert.ok(view.getByRole("button", { name: "送信中…" }).disabled);
  await act(async () => view.complete());
  assert.equal(view.confirm.mock.callCount(), 1);
  assert.equal(view.updates.length, 1);
});

test("an unfinished upload is aborted at 19 seconds and never confirmed", async (t) => {
  const view = await startUpload(t);
  await act(async () => view.rerender(createElement(PlayerGame, { ...view.props, now: 119000, game: { ...game, status: "RESULTS" } })));
  assert.equal(view.signal.aborted, true);
  assert.equal(view.confirm.mock.callCount(), 0);
  assert.ok(view.getByRole("heading", { name: "時間切れ" }));
});

test("retry within grace keeps the same ticket and disables retaking the photo", async (t) => {
  const view = await startUpload(t);
  await act(async () => view.fail());
  await act(async () => view.rerender(createElement(PlayerGame, { ...view.props, now: 116000, game: { ...game, status: "JUDGING" } })));
  assert.equal(view.getByRole("button", { name: "撮り直す" }).disabled, true);
  await act(async () => fireEvent.click(view.getByRole("button", { name: "写真を再送信" })));
  assert.equal(view.tickets.mock.callCount(), 1);
  await act(async () => view.complete());
  assert.equal(view.confirm.mock.callCount(), 1);
});

test("a lost ticket response can retry the same send request during grace", async (t) => {
  const view = await startUpload(t, { ticketFails: true });
  await act(async () => view.rerender(createElement(PlayerGame, { ...view.props, now: 116000, game: { ...game, status: "JUDGING" } })));
  await act(async () => fireEvent.click(view.getByRole("button", { name: "写真を再送信" })));
  assert.equal(view.tickets.mock.callCount(), 2);
  assert.equal(view.tickets.mock.calls[0].arguments[3], view.tickets.mock.calls[1].arguments[3]);
  await act(async () => view.complete());
  assert.equal(view.confirm.mock.callCount(), 1);
});
