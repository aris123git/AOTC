import { defineConfig } from "vitest/config";

/** Vite résout parfois `node:sqlite` → `sqlite` ; on force l'external Node. */
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
  },
  plugins: [
    {
      name: "external-node-sqlite",
      enforce: "pre",
      resolveId(id) {
        if (id === "node:sqlite" || id === "sqlite") {
          return { id: "node:sqlite", external: true };
        }
        return null;
      },
    },
  ],
});
