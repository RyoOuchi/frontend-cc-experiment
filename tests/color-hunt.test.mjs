import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createColorHuntRouter } from "../server/color-hunt.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=",
  "base64",
);
async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "color-hunt-test-"));
  let time = 100000;
  let server;
  let origin;
  async function start() {
    const app = express();
    app.use("/api/v1", createColorHuntRouter({ dataDir, now: () => time }));
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  await start();
  const stop = () => new Promise((resolve) => server.close(resolve));
  t.after(async () => {
    await stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  const call = async (
    path,
    { method = "GET", token, body, status = 200 } = {},
  ) => {
    const response = await fetch(`${origin}/api/v1${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  const create = () => call("/games", { method: "POST", status: 201 });
  const setup = async (names = ["あおい", "りく", "はる"], count = 2) => {
    const admin = (await create()).session;
    const game = await call(`/games/${admin.gameId}/rounds`, {
      method: "POST",
      token: admin.token,
      body: {
        prompts: Array.from({ length: count }, (_, i) => ({
          promptText: ["本", "時計"][i % 2],
          acceptedLabels: [i % 2 ? "Clock" : "Book"],
          minConfidence: 85,
        })),
      },
    });
    const players = await Promise.all(
      names.map((displayName) =>
        call("/games/join", {
          method: "POST",
          body: { gameCode: game.gameCode, displayName },
          status: 201,
        }).then((r) => r.session),
      ),
    );
    return { admin, game, players };
  };
  const state = (session) =>
    call(`/games/${session.gameId}/state`, { token: session.token });
  const command = (admin, path) =>
    call(`/games/${admin.gameId}${path}`, {
      method: "POST",
      token: admin.token,
    });
  const submit = async (player, round, elapsed, key = crypto.randomUUID()) => {
    time = round.startAt + elapsed;
    const ticket = await call(`/rounds/${round.roundId}/upload-url`, {
      method: "POST",
      token: player.token,
      body: { contentType: "image/png", size: png.length, idempotencyKey: key },
    });
    const uploaded = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: ticket.headers,
      body: png,
    });
    assert.equal(uploaded.status, 204);
    const body = {
      submissionId: ticket.submissionId,
      imageKey: ticket.imageKey,
      idempotencyKey: key,
    };
    const result = await call(`/rounds/${round.roundId}/submissions`, {
      method: "POST",
      token: player.token,
      body,
      status: 201,
    });
    return { ticket, body, result };
  };
  const judge = (admin, id, status = "CORRECT") =>
    call(`/submissions/${id}/judgment`, {
      method: "PATCH",
      token: admin.token,
      body: { status, reason: "テスト用の手動確認", moderationStatus: "SAFE" },
    });
  return {
    call,
    create,
    setup,
    state,
    command,
    submit,
    judge,
    time: (value) => {
      time = value;
    },
    origin: () => origin,
    restart: async () => {
      await stop();
      await start();
    },
    editStored: async (edit) => {
      const file = join(dataDir, "color-hunt/games.json");
      const value = JSON.parse(await readFile(file, "utf8"));
      edit(value);
      await writeFile(file, JSON.stringify(value));
    },
  };
}

test("lobby validates code, names, duplicates and every prompt rule", async (t) => {
  const f = await fixture(t);
  const { admin, game } = await f.setup(["あおい"]);
  await f.call("/games/join", {
    method: "POST",
    body: { gameCode: "QQQQQQ", displayName: "りく" },
    status: 404,
  });
  for (const displayName of [" ", "a".repeat(21)])
    await f.call("/games/join", {
      method: "POST",
      body: { gameCode: game.gameCode, displayName },
      status: 400,
    });
  await f.call("/games/join", {
    method: "POST",
    body: { gameCode: game.gameCode, displayName: "あおい" },
    status: 409,
  });
  await f.call(`/games/${game.gameId}/rounds`, {
    method: "POST",
    token: admin.token,
    body: {
      prompts: [{ promptText: "本", acceptedLabels: [], minConfidence: 85 }],
    },
    status: 400,
  });
  assert.equal((await f.state(admin)).totalRounds, 2);
});

test("role checks and countdown never expose future prompts or credentials to players", async (t) => {
  const f = await fixture(t);
  const { admin, players } = await f.setup();
  await f.call(`/games/${admin.gameId}/state`, { status: 401 });
  await f.call(`/games/${admin.gameId}/start`, {
    method: "POST",
    token: players[0].token,
    status: 403,
  });
  const before = await f.state(players[0]);
  assert.equal(before.prompts, undefined);
  assert.equal(before.adminToken, undefined);
  assert.equal(before.players[0].token, undefined);
  const started = await f.command(admin, "/start");
  assert.equal(started.status, "COUNTDOWN");
  const countdown = await f.state(players[0]);
  assert.equal(countdown.round.promptText, undefined);
  f.time(started.round.startAt - 1);
  assert.equal((await f.state(players[0])).status, "COUNTDOWN");
  f.time(started.round.startAt);
  const active = await f.state(players[0]);
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.round.promptText, "本");
  assert.equal(active.prompts, undefined);
  await f.call("/games/join", {
    method: "POST",
    body: { gameCode: active.gameCode, displayName: "late" },
    status: 409,
  });
});

test("one submission per round, idempotent retry after deadline, private moderation and photos", async (t) => {
  const f = await fixture(t);
  const { admin, players } = await f.setup();
  const { round } = await f.command(admin, "/start");
  const { ticket, body, result } = await f.submit(players[0], round, 4200);
  assert.equal(result.submissions[0].elapsedMs, 4200);
  assert.equal(result.submissions[0].status, "PENDING");
  assert.equal(result.submissions[0].earnedScore, null);
  assert.equal((await f.state(players[1])).submissions.length, 0);
  const host = await f.state(admin);
  assert.equal(host.submissions[0].photoUrl, undefined);
  assert.ok(host.submissions[0].reviewUrl);
  assert.equal(
    (await fetch(f.origin() + host.submissions[0].reviewUrl)).status,
    200,
  );
  assert.equal(
    (await fetch(`${f.origin()}/api/v1/photos/${ticket.submissionId}`)).status,
    403,
  );
  await f.call(`/rounds/${round.roundId}/upload-url`, {
    method: "POST",
    token: players[0].token,
    body: {
      contentType: "image/png",
      size: png.length,
      idempotencyKey: "another-key",
    },
    status: 409,
  });
  f.time(round.endAt + 1);
  const repeated = await f.call(`/rounds/${round.roundId}/submissions`, {
    method: "POST",
    token: players[0].token,
    body,
  });
  assert.equal(repeated.submissions.length, 1);
  await f.call(`/rounds/${round.roundId}/submissions`, {
    method: "POST",
    token: players[0].token,
    body: { ...body, idempotencyKey: "different" },
    status: 409,
  });
});

test("deadline is exclusive at 15000ms and upload time affects acceptance", async (t) => {
  const f = await fixture(t);
  const { admin, players } = await f.setup();
  const { round } = await f.command(admin, "/start");
  await f.submit(players[0], round, 14999);
  f.time(round.endAt - 1);
  const ticket = await f.call(`/rounds/${round.roundId}/upload-url`, {
    method: "POST",
    token: players[1].token,
    body: {
      contentType: "image/png",
      size: png.length,
      idempotencyKey: "deadline-key",
    },
  });
  assert.equal(
    (
      await fetch(ticket.uploadUrl, {
        method: "PUT",
        body: png,
        headers: ticket.headers,
      })
    ).status,
    204,
  );
  f.time(round.endAt);
  await f.call(`/rounds/${round.roundId}/submissions`, {
    method: "POST",
    token: players[1].token,
    body: {
      submissionId: ticket.submissionId,
      imageKey: ticket.imageKey,
      idempotencyKey: "deadline-key",
    },
    status: 409,
  });
  assert.equal((await f.state(admin)).status, "JUDGING");
});

test("ties use competition ranks; reverse judging order and corrections never double score", async (t) => {
  const f = await fixture(t);
  const { admin, players } = await f.setup(["a", "b", "c", "d"]);
  const { round } = await f.command(admin, "/start");
  const a = await f.submit(players[0], round, 1000);
  const b = await f.submit(players[1], round, 2000);
  const c = await f.submit(players[2], round, 2000);
  const d = await f.submit(players[3], round, 3000);
  f.time(round.endAt);
  await f.judge(admin, d.ticket.submissionId);
  await f.judge(admin, c.ticket.submissionId);
  await f.judge(admin, b.ticket.submissionId);
  assert.equal((await f.state(admin)).status, "JUDGING");
  assert.ok((await f.state(admin)).players.every((p) => p.totalScore === 0));
  let result = await f.judge(admin, a.ticket.submissionId, "INCORRECT");
  assert.equal(result.status, "RESULTS");
  assert.deepEqual(
    result.submissions.map((s) => s.earnedScore),
    [0, 100, 100, 60],
  );
  assert.deepEqual(
    result.submissions.map((s) => s.rank),
    [null, 1, 1, 3],
  );
  result = await f.judge(admin, a.ticket.submissionId);
  assert.deepEqual(
    result.players.map((p) => p.totalScore),
    [100, 80, 80, 40],
  );
  result = await f.judge(admin, a.ticket.submissionId);
  assert.deepEqual(
    result.players.map((p) => p.totalScore),
    [100, 80, 80, 40],
  );
  assert.deepEqual(
    result.players.map((p) => p.rank),
    [1, 2, 2, 4],
  );
});

test("error judging stays unresolved after reload; final game retains total scores", async (t) => {
  const f = await fixture(t);
  const { admin, players } = await f.setup(["a"], 1);
  const { round } = await f.command(admin, "/start");
  const { ticket } = await f.submit(players[0], round, 5000);
  f.time(round.endAt);
  await f.editStored((games) => {
    games[admin.gameId].submissions[0].status = "ERROR";
  });
  await f.restart();
  const pending = await f.state(admin);
  assert.equal(pending.status, "JUDGING");
  assert.equal(pending.submissions[0].earnedScore, null);
  await f.call(`/games/${admin.gameId}/finish`, {
    method: "POST",
    token: admin.token,
    status: 409,
  });
  await f.judge(admin, ticket.submissionId);
  const final = await f.command(admin, "/finish");
  assert.equal(final.status, "FINISHED");
  assert.equal(final.players[0].totalScore, 100);
  await f.restart();
  assert.equal((await f.state(players[0])).status, "FINISHED");
});

test("two rounds progress only on host actions and accumulate scores once", async (t) => {
  const f = await fixture(t);
  const { admin, players } = await f.setup(["a", "b"]);
  let game = await f.command(admin, "/start");
  const first = await f.submit(players[0], game.round, 1000);
  f.time(game.round.endAt);
  await f.judge(admin, first.ticket.submissionId);
  assert.equal((await f.state(admin)).status, "RESULTS");
  game = await f.command(admin, "/rounds/next");
  assert.equal(game.currentRound, 2);
  assert.equal(game.status, "COUNTDOWN");
  const second = await f.submit(players[1], game.round, 2000);
  f.time(game.round.endAt);
  await f.judge(admin, second.ticket.submissionId);
  game = await f.command(admin, "/finish");
  assert.deepEqual(
    game.players.map((p) => p.totalScore),
    [100, 100],
  );
  assert.deepEqual(
    game.players.map((p) => p.rank),
    [1, 1],
  );
});

test("simultaneous confirmation retries create one submission and reject foreign image tickets", async (t) => {
  const f = await fixture(t);
  const { admin, players } = await f.setup(["a", "b"]);
  const { round } = await f.command(admin, "/start");
  f.time(round.startAt + 500);
  const idempotencyKey = "concurrent-confirm";
  const ticket = await f.call(`/rounds/${round.roundId}/upload-url`, {
    method: "POST",
    token: players[0].token,
    body: { contentType: "image/png", size: png.length, idempotencyKey },
  });
  assert.equal(
    (
      await fetch(ticket.uploadUrl, {
        method: "PUT",
        body: png,
        headers: ticket.headers,
      })
    ).status,
    204,
  );
  const body = {
    submissionId: ticket.submissionId,
    imageKey: ticket.imageKey,
    idempotencyKey,
  };
  await f.call(`/rounds/${round.roundId}/submissions`, {
    method: "POST",
    token: players[1].token,
    body,
    status: 400,
  });
  const responses = await Promise.all(
    [0, 1].map(() =>
      fetch(`${f.origin()}/api/v1/rounds/${round.roundId}/submissions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${players[0].token}`,
        },
        body: JSON.stringify(body),
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
  assert.equal((await f.state(admin)).submissions.length, 1);
  f.time(round.endAt);
  const result = await f.judge(admin, ticket.submissionId);
  assert.equal(result.players[0].totalScore, 100);
});
