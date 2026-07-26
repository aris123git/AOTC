/**
 * Garde-fou architecture : Règles #2 et #3.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const ENGINES_ROOT = join(REPO_ROOT, "engines");
const CORE_SRC = join(REPO_ROOT, "packages/core/src");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function importsOf(src: string): string[] {
  const re = /from\s+["']([^"']+)["']/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

describe("architecture invariants", () => {
  it("Règle #2 — aucun moteur n'importe @aotc/engine-*", () => {
    const engines = readdirSync(ENGINES_ROOT).filter((d) =>
      statSync(join(ENGINES_ROOT, d)).isDirectory(),
    );
    const violations: string[] = [];
    for (const eng of engines) {
      for (const file of walkTs(join(ENGINES_ROOT, eng))) {
        for (const imp of importsOf(readFileSync(file, "utf8"))) {
          if (imp.startsWith("@aotc/engine-")) {
            violations.push(`${file} imports ${imp}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("Règle #3 — packages/core n'importe aucune infra", () => {
    const banned = [
      "@supabase",
      "ioredis",
      "redis",
      "next",
      "pg",
      "postgres",
      "drizzle",
      "prisma",
    ];
    const violations: string[] = [];
    for (const file of walkTs(CORE_SRC)) {
      for (const imp of importsOf(readFileSync(file, "utf8"))) {
        for (const b of banned) {
          if (imp === b || imp.startsWith(`${b}/`)) {
            violations.push(`${file} imports ${imp}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
