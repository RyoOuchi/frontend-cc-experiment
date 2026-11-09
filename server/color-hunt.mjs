// Local development service for the Color Hunt frontend contract.
// Judging and moderation are MANUAL. This is not the production AWS backend.
import express from "express";
import {
  randomBytes,
  randomUUID,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

const fail = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
const required = (condition, message, status = 400) => {
  if (!condition) fail(message, status);
};
const points = [100, 80, 60, 40, 20];
const publicPlayer = ({ playerId, displayName, totalScore, rank, color }) => ({
  playerId,
  displayName,
  totalScore,
  rank,
  color,
});
export function createColorHuntRouter({ dataDir, now = Date.now } = {}) {
  const router = express.Router();
  const directory = join(dataDir, "color-hunt");
  const photos = join(directory, "photos");
  mkdirSync(photos, { recursive: true });
  const file = join(directory, "games.json");
  const games = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const secretFile = join(directory, "signing-key");
  if (!existsSync(secretFile))
    writeFileSync(secretFile, randomBytes(32), { mode: 0o600 });
  const secret = readFileSync(secretFile);
  const uploads = new Map();
  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(games), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  const bump = (game) => {
    game.revision++;
    save();
  };
  const getGame = (id) =>
    games[id] ||
    fail("ゲームが見つかりません。コードを確認してください。", 404);
  const current = (game) => game.rounds[game.currentRound - 1];
  const unresolved = (game, round) =>
    game.submissions.some(
      (s) =>
        s.roundId === round.roundId && ["PENDING", "ERROR"].includes(s.status),
    );
  function score(game) {
    for (const player of game.players) player.totalScore = 0;
    for (const round of game.rounds) {
      const submissions = game.submissions.filter(
        (s) => s.roundId === round.roundId,
      );
      if (!round.closed || unresolved(game, round)) {
        for (const submission of submissions) {
          submission.earnedScore = null;
          submission.rank = null;
        }
        continue;
      }
      const correct = submissions
        .filter((s) => s.status === "CORRECT")
        .sort((a, b) => a.submittedAt - b.submittedAt);
      for (const submission of submissions) {
        submission.earnedScore = 0;
        submission.rank = null;
      }
      for (const submission of correct) {
        submission.rank =
          correct.findIndex((s) => s.submittedAt === submission.submittedAt) +
          1;
        submission.earnedScore = points[Math.min(submission.rank - 1, 4)];
        game.players.find(
          (p) => p.playerId === submission.playerId,
        ).totalScore += submission.earnedScore;
      }
    }
    const ordered = [...game.players].sort(
      (a, b) => b.totalScore - a.totalScore,
    );
    for (const player of game.players)
      player.rank =
        ordered.findIndex((p) => p.totalScore === player.totalScore) + 1;
  }
  function advance(game) {
    const round = current(game);
    let changed = false;
    if (game.status === "COUNTDOWN" && now() >= round.startAt) {
      game.status = "ACTIVE";
      changed = true;
    }
    if (game.status === "ACTIVE" && now() >= round.endAt) {
      game.status = "JUDGING";
      round.closed = true;
      changed = true;
    }
    if (game.status === "JUDGING" && !unresolved(game, round)) {
      game.status = "RESULTS";
      changed = true;
    }
    if (changed) {
      score(game);
      bump(game);
    }
    return game;
  }
  function identity(req, game, role) {
    const token = req.get("Authorization")?.replace(/^Bearer /, "");
    const player = game.players.find((p) => p.token === token);
    const actor =
      token && token === game.adminToken
        ? { role: "ADMIN" }
        : player
          ? { role: "PLAYER", playerId: player.playerId }
          : null;
    required(
      actor,
      "セッションの有効期限が切れました。もう一度参加してください。",
      401,
    );
    required(
      !role || actor.role === role,
      "この操作には管理者の権限が必要です。",
      403,
    );
    return actor;
  }
  const signature = (id, expires) =>
    createHmac("sha256", secret).update(`${id}:${expires}`).digest("hex");
  function photoLink(req, id) {
    const expires = Math.ceil(now() / 60_000) * 60_000 + 60_000;
    return `${req.baseUrl}/photos/${id}?expires=${expires}&signature=${signature(id, expires)}`;
  }
  function snapshot(req, game, actor) {
    advance(game);
    const round = current(game);
    const visiblePrompt = !["DRAFT", "LOBBY", "COUNTDOWN"].includes(
      game.status,
    );
    return {
      gameId: game.gameId,
      gameCode: game.gameCode,
      status: game.status,
      currentRound: game.currentRound,
      totalRounds: game.rounds.length,
      serverTime: now(),
      revision: game.revision,
      reviewMode: "manual",
      players: game.players.map(publicPlayer),
      ...(actor.role === "ADMIN"
        ? {
            prompts: game.rounds.map(
              ({ roundId, promptText, acceptedLabels, minConfidence }) => ({
                roundId,
                promptText,
                acceptedLabels,
                minConfidence,
              }),
            ),
          }
        : {}),
      round: round
        ? {
            roundId: round.roundId,
            roundNumber: game.currentRound,
            ...(visiblePrompt ? { promptText: round.promptText } : {}),
            startAt: round.startAt,
            endAt: round.endAt,
          }
        : null,
      submissions: game.submissions
        .filter(
          (s) =>
            s.roundId === round?.roundId &&
            (actor.role === "ADMIN" || s.playerId === actor.playerId),
        )
        .map((s) => {
          const {
            imageKey: _imageKey,
            idempotencyKey: _key,
            audit: _audit,
            ...safe
          } = s;
          const link = photoLink(req, s.submissionId);
          return {
            ...safe,
            ...(s.moderationStatus === "SAFE" || s.playerId === actor.playerId
              ? { photoUrl: link }
              : {}),
            ...(actor.role === "ADMIN" && s.moderationStatus === "PENDING"
              ? { reviewUrl: link }
              : {}),
          };
        }),
    };
  }
  function findRound(id) {
    const game = Object.values(games).find((g) =>
      g.rounds.some((r) => r.roundId === id),
    );
    required(game, "ラウンドが見つかりません。", 404);
    return {
      game: advance(game),
      round: game.rounds.find((r) => r.roundId === id),
    };
  }
  function checkActive(game, round) {
    advance(game);
    required(
      game.status === "ACTIVE" &&
        current(game) === round &&
        now() >= round.startAt &&
        now() < round.endAt,
      "受付時間が終了しました。次のラウンドをお待ちください。",
      409,
    );
  }
  function startRound(game) {
    game.currentRound++;
    const round = current(game);
    round.startAt = now() + 3000;
    round.endAt = round.startAt + 15000;
    game.status = "COUNTDOWN";
    bump(game);
  }
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "64kb" }));
  router.post("/games", (req, res) => {
    let gameCode;
    do {
      gameCode = randomBytes(3).toString("hex").toUpperCase();
    } while (Object.values(games).some((g) => g.gameCode === gameCode));
    const game = {
      gameId: randomUUID(),
      gameCode,
      status: "DRAFT",
      currentRound: 0,
      adminToken: randomBytes(32).toString("hex"),
      revision: 1,
      rounds: [],
      players: [],
      submissions: [],
      createdAt: now(),
    };
    games[game.gameId] = game;
    save();
    res
      .status(201)
      .json({
        session: { gameId: game.gameId, role: "ADMIN", token: game.adminToken },
        game: snapshot(req, game, { role: "ADMIN" }),
      });
  });
  router.post("/games/join", (req, res) => {
    const { gameCode, displayName } = req.body || {};
    required(
      typeof gameCode === "string" && /^[A-Z0-9]{6}$/.test(gameCode),
      "ゲームコードは英数字6文字で入力してください。",
    );
    const game = Object.values(games).find((g) => g.gameCode === gameCode);
    required(game, "ゲームが見つかりません。コードを確認してください。", 404);
    advance(game);
    required(
      game.status === "LOBBY",
      game.status === "FINISHED"
        ? "このゲームは終了しました。"
        : "このゲームは参加を受け付けていません。",
      409,
    );
    required(
      typeof displayName === "string" &&
        displayName.trim().length >= 1 &&
        [...displayName.trim()].length <= 20,
      "表示名は1〜20文字で入力してください。",
    );
    const name = displayName.trim();
    required(
      !game.players.some(
        (p) =>
          p.displayName.normalize("NFKC").toLowerCase() ===
          name.normalize("NFKC").toLowerCase(),
      ),
      "この表示名はすでに使われています。別の名前を入力してください。",
      409,
    );
    required(game.players.length < 50, "参加人数が上限に達しました。", 409);
    const player = {
      playerId: randomUUID(),
      displayName: name,
      token: randomBytes(32).toString("hex"),
      totalScore: 0,
      rank: 1,
      color: game.players.length % 6,
    };
    game.players.push(player);
    bump(game);
    const actor = { role: "PLAYER", playerId: player.playerId };
    res
      .status(201)
      .json({
        session: { gameId: game.gameId, token: player.token, ...actor },
        game: snapshot(req, game, actor),
      });
  });
  router.get("/games/:gameId/state", (req, res) => {
    const game = getGame(req.params.gameId);
    res.json(snapshot(req, game, identity(req, game)));
  });
  router.post("/games/:gameId/rounds", (req, res) => {
    const game = getGame(req.params.gameId);
    const actor = identity(req, game, "ADMIN");
    required(
      ["DRAFT", "LOBBY"].includes(game.status),
      "開始後はお題を変更できません。",
      409,
    );
    const prompts = req.body?.prompts;
    required(
      Array.isArray(prompts) && prompts.length > 0 && prompts.length <= 30,
      "お題は1〜30個登録してください。",
    );
    const rounds = prompts.map((p) => {
      required(
        p &&
          typeof p.promptText === "string" &&
          p.promptText.trim() &&
          p.promptText.trim().length <= 60,
        "各お題を60文字以内で入力してください。",
      );
      required(
        Array.isArray(p.acceptedLabels) &&
          p.acceptedLabels.length >= 1 &&
          p.acceptedLabels.length <= 20 &&
          p.acceptedLabels.every(
            (l) => typeof l === "string" && l.trim() && l.length <= 80,
          ),
        "各お題に正解ラベルを1つ以上設定してください。",
      );
      required(
        Number.isFinite(p.minConfidence) &&
          p.minConfidence >= 0 &&
          p.minConfidence <= 100,
        "信頼度は0〜100%で設定してください。",
      );
      return {
        roundId: randomUUID(),
        promptText: p.promptText.trim(),
        acceptedLabels: [...new Set(p.acceptedLabels.map((l) => l.trim()))],
        minConfidence: p.minConfidence,
      };
    });
    game.rounds = rounds;
    game.status = "LOBBY";
    bump(game);
    res.json(snapshot(req, game, actor));
  });
  router.post("/games/:gameId/start", (req, res) => {
    const game = getGame(req.params.gameId);
    const actor = identity(req, game, "ADMIN");
    required(
      game.status === "LOBBY" &&
        game.players.length > 0 &&
        game.rounds.length > 0,
      "お題を設定し、参加者が集まってから開始してください。",
      409,
    );
    startRound(game);
    res.json(snapshot(req, game, actor));
  });
  router.post("/games/:gameId/rounds/next", (req, res) => {
    const game = advance(getGame(req.params.gameId));
    const actor = identity(req, game, "ADMIN");
    required(
      game.status === "RESULTS" && game.currentRound < game.rounds.length,
      "判定完了後に次のラウンドを開始できます。",
      409,
    );
    startRound(game);
    res.json(snapshot(req, game, actor));
  });
  router.post("/games/:gameId/finish", (req, res) => {
    const game = advance(getGame(req.params.gameId));
    const actor = identity(req, game, "ADMIN");
    required(
      game.status === "RESULTS" && game.currentRound === game.rounds.length,
      "すべてのラウンドの判定完了後に終了できます。",
      409,
    );
    game.status = "FINISHED";
    game.finishedAt = now();
    bump(game);
    res.json(snapshot(req, game, actor));
  });
  router.post("/rounds/:roundId/upload-url", (req, res) => {
    const { game, round } = findRound(req.params.roundId);
    const actor = identity(req, game, "PLAYER");
    checkActive(game, round);
    required(
      !game.submissions.some(
        (s) => s.roundId === round.roundId && s.playerId === actor.playerId,
      ),
      "このラウンドの写真は送信済みです。",
      409,
    );
    const { contentType, size, idempotencyKey } = req.body || {};
    required(
      ["image/jpeg", "image/png"].includes(contentType) &&
        Number.isInteger(size) &&
        size > 0 &&
        size <= 2 * 1024 * 1024,
      "JPEG・PNG形式で2MB以下の写真を送信してください。",
    );
    required(
      typeof idempotencyKey === "string" &&
        idempotencyKey.length >= 8 &&
        idempotencyKey.length <= 100,
      "送信IDが無効です。",
    );
    let ticket = [...uploads.values()].find(
      (t) =>
        t.roundId === round.roundId &&
        t.playerId === actor.playerId &&
        t.key === idempotencyKey,
    );
    if (!ticket) {
      const submissionId = randomUUID();
      ticket = {
        submissionId,
        imageKey: submissionId,
        roundId: round.roundId,
        playerId: actor.playerId,
        gameId: game.gameId,
        token: randomBytes(24).toString("hex"),
        contentType,
        size,
        key: idempotencyKey,
        endAt: round.endAt,
      };
      uploads.set(submissionId, ticket);
    }
    res.json({
      submissionId: ticket.submissionId,
      imageKey: ticket.imageKey,
      uploadUrl: `${req.protocol}://${req.get("host")}${req.baseUrl}/uploads/${ticket.submissionId}?ticket=${ticket.token}`,
      headers: { "Content-Type": contentType },
    });
  });
  router.put(
    "/uploads/:id",
    express.raw({ type: ["image/jpeg", "image/png"], limit: "2mb" }),
    (req, res) => {
      const ticket = uploads.get(req.params.id);
      required(
        ticket && req.query.ticket === ticket.token,
        "アップロードURLが無効です。",
        403,
      );
      const { game, round } = findRound(ticket.roundId);
      checkActive(game, round);
      required(
        !game.submissions.some((s) => s.submissionId === ticket.submissionId),
        "写真はすでに受け付けられています。",
        409,
      );
      const buffer = req.body;
      required(
        Buffer.isBuffer(buffer) && buffer.length === ticket.size,
        "画像サイズが一致しません。",
      );
      const jpeg =
        buffer.length > 12 &&
        buffer[0] === 255 &&
        buffer[1] === 216 &&
        buffer[2] === 255;
      const png =
        buffer.length > 12 &&
        buffer
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      required(
        (ticket.contentType === "image/jpeg" && jpeg) ||
          (ticket.contentType === "image/png" && png),
        "画像形式が正しくありません。",
      );
      writeFileSync(join(photos, ticket.imageKey), buffer, { mode: 0o600 });
      ticket.uploaded = true;
      res.sendStatus(204);
    },
  );
  router.post("/rounds/:roundId/submissions", (req, res) => {
    const { game, round } = findRound(req.params.roundId);
    const actor = identity(req, game, "PLAYER");
    const { submissionId, imageKey, idempotencyKey } = req.body || {};
    const existing = game.submissions.find(
      (s) => s.roundId === round.roundId && s.playerId === actor.playerId,
    );
    if (existing) {
      required(
        existing.idempotencyKey === idempotencyKey &&
          existing.submissionId === submissionId &&
          existing.imageKey === imageKey,
        "このラウンドの写真は送信済みです。",
        409,
      );
      return res.json(snapshot(req, game, actor));
    }
    checkActive(game, round);
    const ticket = uploads.get(submissionId);
    required(
      ticket?.uploaded &&
        ticket.playerId === actor.playerId &&
        ticket.roundId === round.roundId &&
        ticket.imageKey === imageKey &&
        ticket.key === idempotencyKey,
      "写真のアップロードを確認できませんでした。",
    );
    const submittedAt = now();
    game.submissions.push({
      submissionId,
      roundId: round.roundId,
      playerId: actor.playerId,
      imageKey,
      idempotencyKey,
      submittedAt,
      elapsedMs: submittedAt - round.startAt,
      status: "PENDING",
      moderationStatus: "PENDING",
      earnedScore: null,
      rank: null,
      detectedLabels: [],
      audit: [],
    });
    bump(game);
    res.status(201).json(snapshot(req, game, actor));
  });
  router.patch("/submissions/:id/judgment", (req, res) => {
    const game = Object.values(games).find((g) =>
      g.submissions.some((s) => s.submissionId === req.params.id),
    );
    required(game, "提出が見つかりません。", 404);
    const actor = identity(req, game, "ADMIN");
    advance(game);
    const submission = game.submissions.find(
      (s) => s.submissionId === req.params.id,
    );
    required(
      submission.roundId === current(game)?.roundId &&
        game.status !== "FINISHED",
      "確定したゲームの判定は変更できません。",
      409,
    );
    const { status, reason, moderationStatus } = req.body || {};
    required(
      ["CORRECT", "INCORRECT"].includes(status),
      "正解または不正解を選択してください。",
    );
    required(
      typeof reason === "string" && reason.trim() && reason.length <= 300,
      "判定の理由を入力してください。",
    );
    required(
      ["SAFE", "BLOCKED"].includes(
        moderationStatus || submission.moderationStatus,
      ),
      "写真の安全性を確認してください。",
    );
    required(
      moderationStatus !== "BLOCKED" || status === "INCORRECT",
      "非公開の写真を正解にはできません。",
    );
    submission.audit.push({
      at: now(),
      actor: "local-admin",
      from: submission.status,
      to: status,
      reason: reason.trim(),
    });
    submission.status = status;
    submission.moderationStatus =
      moderationStatus || submission.moderationStatus;
    score(game);
    bump(game);
    res.json(snapshot(req, game, actor));
  });
  router.post("/submissions/:id/retry", (req, res) => {
    const game = Object.values(games).find((g) =>
      g.submissions.some((s) => s.submissionId === req.params.id),
    );
    required(game, "提出が見つかりません。", 404);
    identity(req, game, "ADMIN");
    fail(
      "ローカル版は手動判定です。写真を確認して正解・不正解を選択してください。",
      409,
    );
  });
  router.get("/photos/:id", (req, res) => {
    const { expires, signature: provided } = req.query;
    required(
      typeof expires === "string" &&
        typeof provided === "string" &&
        Number(expires) > now() &&
        /^[a-f0-9]{64}$/.test(provided),
      "写真URLの有効期限が切れました。",
      403,
    );
    const expected = signature(req.params.id, expires);
    required(
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected)),
      "写真URLが無効です。",
      403,
    );
    const submission = Object.values(games)
      .flatMap((g) => g.submissions)
      .find((s) => s.submissionId === req.params.id);
    required(
      submission && existsSync(join(photos, submission.imageKey)),
      "写真が見つかりません。",
      404,
    );
    const buffer = readFileSync(join(photos, submission.imageKey));
    res
      .set("Content-Type", buffer[0] === 255 ? "image/jpeg" : "image/png")
      .set("X-Content-Type-Options", "nosniff")
      .send(buffer);
  });
  // Opportunistic local retention: remove finished-game photos after 24h and results after 7d.
  router.use((error, _req, res, _next) =>
    res
      .status(error.status || 500)
      .json({
        error: error.status
          ? error.message
          : "サーバーでエラーが発生しました。",
      }),
  );
  for (const game of Object.values(games)) {
    if (game.finishedAt && now() - game.finishedAt >= 86_400_000) {
      for (const submission of game.submissions)
        rmSync(join(photos, submission.imageKey), { force: true });
      if (now() - game.finishedAt >= 7 * 86_400_000) delete games[game.gameId];
    }
  }
  save();
  return router;
}
