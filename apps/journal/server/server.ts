import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runLot1Demo } from "@aotc/simulation-journal";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT ?? 8787);

app.post("/api/demo", async (_req, res) => {
  try {
    const result = await runLot1Demo();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "demo_failed",
    });
  }
});

const staticDir = join(__dirname, "..", "dist");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(join(staticDir, "index.html"));
  });
}

app.listen(port, "0.0.0.0", () => {
  console.log(`AOTC App → http://0.0.0.0:${port}`);
});
