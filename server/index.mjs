import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = createApp({ dataDir: resolve(root, ".data") });
const server = createServer(app);
const port = Number(process.env.PORT || 5173);
let vite;
if (process.argv.includes("--production")) {
  app.use(express.static(resolve(root, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve(root, "dist/index.html")),
  );
} else {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({
    root,
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
server.listen(port, "0.0.0.0", () => {
  console.log(`\n  Color Hunt is ready\n  Local:   http://localhost:${port}`);
  for (const addresses of Object.values(networkInterfaces()))
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal)
        console.log(`  Network: http://${address.address}:${port}`);
    }
  console.log("  Local demo service · Judging: manual · Host: /admin\n");
});
async function stop() {
  await vite?.close();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
