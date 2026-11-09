import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { challenges } from "../shared/challenges.mjs";

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const palette = ["peach", "lavender", "sage", "blue", "yellow"];
const clean = (value, fallback, max) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;

export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "games.json");
  const rooms = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const save = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify(rooms));
    renameSync(`${path}.tmp`, path);
  };
  const get = (code) => {
    const room = rooms[String(code).toUpperCase()];
    if (!room)
      throw new GameError(
        "That party could not be found. Check the code and try again.",
        404,
      );
    return room;
  };
  const member = (room, id) => {
    const player = room.players.find((p) => p.id === id);
    if (!player)
      throw new GameError("Join this party before submitting a find.", 403);
    return player;
  };
  const snapshot = (room) => ({
    ...room,
    challenges,
    players: room.players.map((p) => ({
      ...p,
      points: room.submissions
        .filter((s) => s.playerId === p.id)
        .reduce(
          (n, s) =>
            n + (challenges.find((c) => c.id === s.challengeId)?.points || 0),
          0,
        ),
    })),
  });
  const addPlayer = (room, name) => {
    const player = {
      id: randomUUID(),
      name: clean(name, `Explorer ${room.players.length + 1}`, 24),
      color: palette[room.players.length % palette.length],
    };
    room.players.push(player);
    return player;
  };
  return {
    get: (code) => snapshot(get(code)),
    create({ name, playerName, duration = 30, demo = false } = {}) {
      if (![15, 30, 60].includes(duration))
        throw new GameError("Choose a 15, 30, or 60 minute hunt.");
      let code;
      do {
        code = randomBytes(3).toString("hex").toUpperCase();
      } while (rooms[code]);
      const now = Date.now();
      const room = {
        code,
        name: clean(name, "The neighborhood hunt", 48),
        createdAt: now,
        endsAt: now + duration * 60000,
        demo: Boolean(demo),
        players: [],
        submissions: [],
      };
      const player = addPlayer(room, playerName);
      if (demo) {
        const mia = addPlayer(room, "Mia");
        const leo = addPlayer(room, "Leo");
        const sam = addPlayer(room, "Sam");
        const samples = [
          [mia, "leaf", "/images/leaves.jpg"],
          [mia, "tangerine", "/images/oranges.jpg"],
          [leo, "yellow", "/images/sunlight.jpg"],
          [sam, "leaf", "/images/nature.jpg"],
        ];
        room.submissions = samples.map(([p, id, photo], i) => ({
          id: randomUUID(),
          playerId: p.id,
          challengeId: id,
          photoUrl: photo,
          createdAt: now - (i + 1) * 95000,
          status: "accepted",
          reviewMode: "demo",
          sample: true,
        }));
      }
      rooms[code] = room;
      save();
      return { room: snapshot(room), playerId: player.id };
    },
    join(code, name, existingId) {
      const room = get(code);
      const existing = room.players.find((p) => p.id === existingId);
      if (!existing && room.endsAt <= Date.now())
        throw new GameError(
          "This hunt has finished. Create a new party to keep exploring.",
          410,
        );
      if (!existing && room.players.length >= 30)
        throw new GameError("This party is full (30 explorers).");
      const player = existing || addPlayer(room, name);
      save();
      return { room: snapshot(room), playerId: player.id };
    },
    rename(code, id, name) {
      const room = get(code);
      const player = member(room, id);
      player.name = clean(name, player.name, 24);
      save();
      return snapshot(room);
    },
    checkSubmission(code, playerId, challengeId) {
      const room = get(code);
      member(room, playerId);
      if (room.endsAt <= Date.now())
        throw new GameError("Time’s up! This hunt has finished.", 410);
      if (!challenges.some((c) => c.id === challengeId))
        throw new GameError("Choose an available challenge.");
      if (
        room.submissions.some(
          (s) => s.playerId === playerId && s.challengeId === challengeId,
        )
      )
        throw new GameError(
          "You already found this one. Try another challenge!",
          409,
        );
    },
    submit(code, playerId, challengeId, photoUrl) {
      this.checkSubmission(code, playerId, challengeId);
      const room = get(code);
      const submission = {
        id: randomUUID(),
        playerId,
        challengeId,
        photoUrl,
        createdAt: Date.now(),
        status: "accepted",
        reviewMode: "demo",
        sample: false,
      };
      room.submissions.unshift(submission);
      save();
      return { submission, room: snapshot(room) };
    },
  };
}
