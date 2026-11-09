import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";

const photo = readFileSync(
  new URL("../public/images/oranges.jpg", import.meta.url),
);
async function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "hue-hunt-test-"));
  const app = createApp({ dataDir });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });
  const request = (path, body, method = "POST") =>
    fetch(`${base}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const create = async (body = {}) =>
    (
      await request("/rooms", {
        name: "Test adventure",
        playerName: "Ryo",
        duration: 30,
        ...body,
      })
    ).json();
  const submit = (
    session,
    challengeId = "tangerine",
    bytes = photo,
    filename = "photo.jpg",
  ) => {
    const form = new FormData();
    form.append("playerId", session.playerId);
    form.append("challengeId", challengeId);
    form.append("photo", new Blob([bytes]), filename);
    return fetch(`${base}/api/rooms/${session.room.code}/submissions`, {
      method: "POST",
      body: form,
    });
  };
  return { base, dataDir, request, create, submit };
}

test("a party code joins two different players without authentication and scores persist", async (t) => {
  const { base, dataDir, request, create, submit } = await setup(t);
  const host = await create();
  assert.match(host.room.code, /^[A-F0-9]{6}$/);
  assert.equal(host.room.players.length, 1);
  const guest = await (
    await request(`/rooms/${host.room.code.toLowerCase()}/join`, {
      name: "Friend",
    })
  ).json();
  assert.notEqual(guest.playerId, host.playerId);
  assert.equal(guest.room.players.length, 2);
  const uploaded = await submit(guest);
  assert.equal(uploaded.status, 201);
  const result = await uploaded.json();
  assert.equal(result.submission.reviewMode, "demo");
  const shared = await (
    await fetch(`${base}/api/rooms/${host.room.code}`)
  ).json();
  assert.equal(shared.players.find((p) => p.id === guest.playerId).points, 100);
  assert.equal(shared.players.find((p) => p.id === host.playerId).points, 0);
  const storedPhoto = await fetch(`${base}${result.submission.photoUrl}`);
  assert.equal(storedPhoto.status, 200);
  assert.equal(storedPhoto.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await storedPhoto.arrayBuffer()).compare(photo), 0);
  const restarted = createStore(dataDir).get(host.room.code);
  assert.equal(restarted.submissions.length, 1);
  assert.equal(
    restarted.players.find((p) => p.id === guest.playerId).points,
    100,
  );
});

test("duplicate and simultaneous submissions can only award points once", async (t) => {
  const { create, submit, dataDir } = await setup(t);
  const host = await create();
  const results = await Promise.all([submit(host), submit(host)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const room = createStore(dataDir).get(host.room.code);
  assert.equal(room.players[0].points, 100);
  assert.equal(room.submissions.length, 1);
  assert.equal(readdirSync(join(dataDir, "uploads")).length, 1);
});

test("rejects missing rooms, non-members, and unknown challenges", async (t) => {
  const { create, request, submit } = await setup(t);
  const host = await create();
  assert.equal(
    (await request("/rooms/XXXXXX/join", { name: "Friend" })).status,
    404,
  );
  assert.equal(
    (await submit({ ...host, playerId: "not-in-room" })).status,
    403,
  );
  assert.equal((await submit(host, "nonexistent")).status, 400);
});

test("rejects non-images, oversized files, and empty submissions without persisting uploads", async (t) => {
  const { base, dataDir, create, submit } = await setup(t);
  const host = await create();
  assert.equal(
    (
      await submit(
        host,
        "tangerine",
        Buffer.from('<svg onload="alert(1)"></svg>'),
      )
    ).status,
    400,
  );
  assert.equal(
    (await submit(host, "tangerine", Buffer.alloc(12 * 1024 * 1024 + 1)))
      .status,
    400,
  );
  const empty = new FormData();
  empty.append("playerId", host.playerId);
  empty.append("challengeId", "tangerine");
  assert.equal(
    (
      await fetch(`${base}/api/rooms/${host.room.code}/submissions`, {
        method: "POST",
        body: empty,
      })
    ).status,
    400,
  );
  assert.equal(readdirSync(join(dataDir, "uploads")).length, 0);
});

test("expired hunts reject joins and photos, retain the final standings", async (t) => {
  const { dataDir, create } = await setup(t);
  const host = await create();
  const file = join(dataDir, "games.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  data[host.room.code].endsAt = Date.now() - 1;
  writeFileSync(file, JSON.stringify(data));
  const store = createStore(dataDir);
  assert.throws(
    () =>
      store.submit(host.room.code, host.playerId, "tangerine", "/photo.jpg"),
    (e) => e.status === 410,
  );
  assert.throws(
    () => store.join(host.room.code, "Late friend"),
    (e) => e.status === 410,
  );
  assert.equal(store.get(host.room.code).players.length, 1);
  assert.equal(
    store.join(host.room.code, "Ryo", host.playerId).playerId,
    host.playerId,
  );
});

test("names are bounded, durations are validated, and rejoining keeps the same player", async (t) => {
  const { create, request } = await setup(t);
  assert.equal((await request("/rooms", { duration: -1 })).status, 400);
  const host = await create({
    name: "x".repeat(100),
    playerName: "y".repeat(50),
  });
  assert.equal(host.room.name.length, 48);
  assert.equal(host.room.players[0].name.length, 24);
  const rejoined = await (
    await request(`/rooms/${host.room.code}/join`, { playerId: host.playerId })
  ).json();
  assert.equal(rejoined.room.players.length, 1);
  assert.equal(rejoined.playerId, host.playerId);
  const renamed = await (
    await request(
      `/rooms/${host.room.code}/players/${host.playerId}`,
      { name: "New name" },
      "PATCH",
    )
  ).json();
  assert.equal(renamed.players[0].name, "New name");
});
