import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { createStore, GameError } from "./store.mjs";
import { createColorHuntRouter } from "./color-hunt.mjs";

export function imageExtension(buffer) {
  if (
    buffer.length > 12 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    buffer.length > 12 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255
  )
    return "jpg";
  if (
    buffer.length > 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  throw new GameError("Please choose a JPEG, PNG, or WebP photo.");
}
export function createApp({ dataDir = resolve(".data") } = {}) {
  const app = express();
  const store = createStore(dataDir);
  const uploadDir = join(dataDir, "uploads");
  mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 12 * 1024 * 1024,
      files: 1,
      fields: 2,
      parts: 3,
      fieldSize: 100,
    },
  });
  app.disable("x-powered-by");
  app.use('/api/v1', createColorHuntRouter({ dataDir }));
  app.use(express.json({ limit: "4kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/uploads",
    express.static(uploadDir, {
      dotfiles: "deny",
      setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff"),
    }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, judging: "demo" }),
  );
  app.post("/api/rooms", (req, res) =>
    res.status(201).json(store.create(req.body)),
  );
  app.get("/api/rooms/:code", (req, res) =>
    res.json(store.get(req.params.code)),
  );
  app.post("/api/rooms/:code/join", (req, res) =>
    res.json(store.join(req.params.code, req.body.name, req.body.playerId)),
  );
  app.patch("/api/rooms/:code/players/:playerId", (req, res) =>
    res.json(store.rename(req.params.code, req.params.playerId, req.body.name)),
  );
  app.post(
    "/api/rooms/:code/submissions",
    upload.single("photo"),
    (req, res) => {
      if (!req.file)
        throw new GameError("Add a photo before submitting your find.");
      const { playerId, challengeId } = req.body;
      store.checkSubmission(req.params.code, playerId, challengeId);
      const extension = imageExtension(req.file.buffer);
      const filename = `${randomUUID()}.${extension}`;
      const path = join(uploadDir, filename);
      writeFileSync(path, req.file.buffer);
      try {
        res
          .status(201)
          .json(
            store.submit(
              req.params.code,
              playerId,
              challengeId,
              `/uploads/${filename}`,
            ),
          );
      } catch (error) {
        unlinkSync(path);
        throw error;
      }
    },
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "This API endpoint does not exist." }),
  );
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError)
      return res
        .status(400)
        .json({
          error:
            error.code === "LIMIT_FILE_SIZE"
              ? "That photo is too large. Choose one under 12 MB."
              : "Upload one photo at a time with the selected challenge.",
        });
    const status = error.status || 500;
    if (status === 500) console.error(error);
    res
      .status(status)
      .json({
        error:
          status === 500
            ? "Something went wrong. Please try again."
            : error.message,
      });
  });
  return app;
}
