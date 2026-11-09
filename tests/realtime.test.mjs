import assert from "node:assert/strict";
import { test } from "node:test";
import { connectGameEvents } from "../src/realtime.ts";

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function setup(t, overrides = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sockets = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    messages = [];
    constructor(url) {
      this.url = String(url);
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    send(data) {
      this.messages.push(JSON.parse(data));
    }
    message(data) {
      this.onmessage?.({
        data: typeof data === "string" ? data : JSON.stringify(data),
      });
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const original = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  t.after(() => {
    globalThis.WebSocket = original;
  });
  let changes = 0;
  let revision = 4;
  const getTicket = t.mock.fn(async () => ({
    ticket: `ticket-${getTicket.mock.callCount() + 1}`,
  }));
  const stop = connectGameEvents({
    url: "wss://example.test/dev",
    gameId: "game-1",
    ticketParameter: "ticket",
    events: ["PLAYER_JOINED", "SUBMISSION_RECEIVED", "ROUND_RESULT"],
    heartbeatIntervalMs: 30_000,
    heartbeatTimeoutMs: 10_000,
    reconnectMaxMs: 30_000,
    getTicket,
    getRevision: () => revision,
    onChange: () => {
      changes++;
    },
    ...overrides,
  });
  t.after(stop);
  return {
    sockets,
    stop,
    getTicket,
    changes: () => changes,
    accept: (value) => {
      revision = value;
    },
  };
}

test("socket events refresh only the active game and newer revisions", async (t) => {
  const f = setup(t);
  await settle();
  const ws = f.sockets[0];
  assert.equal(new URL(ws.url).searchParams.get("ticket"), "ticket-1");
  ws.open();
  assert.equal(f.changes(), 1);
  assert.deepEqual(ws.messages, [{ action: "ping" }]);
  for (const message of [
    "bad JSON",
    null,
    [],
    { type: "PONG" },
    { type: "SUBMISSION_RECEIVED", gameId: "other", revision: 5 },
    { type: "SUBMISSION_RECEIVED", gameId: "game-1", revision: 4 },
    { type: "SUBMISSION_RECEIVED", gameId: "game-1", revision: "5" },
    { type: "unknown", gameId: "game-1", revision: 5 },
  ])
    ws.message(message);
  assert.equal(f.changes(), 1);
  ws.message({ type: "SUBMISSION_RECEIVED", gameId: "game-1", revision: 5 });
  assert.equal(f.changes(), 2);
  f.accept(5);
  ws.message({ type: "SUBMISSION_RECEIVED", gameId: "game-1", revision: 5 });
  assert.equal(f.changes(), 2);
});

test("reconnect obtains a fresh ticket and refreshes state; cleanup stops retries", async (t) => {
  const f = setup(t);
  await settle();
  const old = f.sockets[0];
  old.open();
  old.message({ type: "PONG" });
  old.close();
  t.mock.timers.tick(1000);
  await settle();
  const ws = f.sockets[1];
  assert.equal(new URL(ws.url).searchParams.get("ticket"), "ticket-2");
  ws.open();
  ws.message({ type: "PONG" });
  assert.equal(f.changes(), 2);
  old.message({ type: "ROUND_RESULT", gameId: "game-1", revision: 100 });
  assert.equal(f.changes(), 2);
  f.stop();
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(ws.readyState, 3);
  assert.equal(f.getTicket.mock.callCount(), 2);
});

test("missing PONG closes a dead socket and reconnects", async (t) => {
  const f = setup(t);
  await settle();
  const ws = f.sockets[0];
  ws.open();
  ws.message({ type: "PONG" });
  t.mock.timers.tick(30_000);
  assert.equal(ws.messages.length, 2);
  t.mock.timers.tick(10_000);
  assert.equal(ws.readyState, 3);
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(f.sockets.length, 2);
});

test("failed ticket requests retry with backoff", async (t) => {
  let calls = 0;
  const f = setup(t, {
    getTicket: async () => {
      calls++;
      if (calls < 3) throw new Error("offline");
      return { ticket: "recovered" };
    },
  });
  await settle();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(calls, 2);
  t.mock.timers.tick(1999);
  await settle();
  assert.equal(calls, 2);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(f.sockets.length, 1);
});

test("leaving during ticket acquisition cannot open a late connection", async (t) => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const f = setup(t, { getTicket: () => pending });
  f.stop();
  resolve({ ticket: "late" });
  await settle();
  assert.equal(f.sockets.length, 0);
});
