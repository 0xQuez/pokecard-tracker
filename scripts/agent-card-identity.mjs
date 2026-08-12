// Agent bridge: resolve a loose card query into a canonical identity (T18.2).
//
// The Python valuation orchestrator (src/agents/valuation_orchestrator.py)
// shells out to this script when it needs the card-identity gate. It compiles
// src/lib/card-identity.ts to CommonJS in a temp dir (the repo's tsconfig has
// noEmit, so we compile standalone — same pattern as scripts/test-card-identity.mjs),
// calls resolveCardIdentityLive(), and prints the result as a single JSON object
// on stdout. Exit code 0 = success; non-zero = hard failure (catalog down, etc.).
//
// Usage:
//   node scripts/agent-card-identity.mjs "Dragonite ex 90/97" [limit]
//
// Output (CardIdentityResult JSON):
//   { canonical_name, set_name, set_code, card_number, variant, confidence,
//     needs_human_confirmation, candidates:[...], warnings:[...] }

import { mkdirSync, cpSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const query = process.argv[2];
const limit = process.argv[3] ? Number(process.argv[3]) : undefined;

if (!query) {
  process.stderr.write("usage: node agent-card-identity.mjs <query> [limit]\n");
  process.exit(2);
}

const outDir = join(tmpdir(), "pokecards-agent-card-identity");
mkdirSync(outDir, { recursive: true });

try {
  execFileSync(
    join(repoRoot, "node_modules", ".bin", "tsc"),
    [
      "src/lib/card-identity.ts",
      "--target", "ES2022",
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--outDir", outDir,
      "--skipLibCheck",
      "--esModuleInterop",
    ],
    { cwd: repoRoot, stdio: "pipe" }
  );
} catch (e) {
  process.stderr.write("tsc failed: " + (e.stderr?.toString?.() || e.message) + "\n");
  process.exit(1);
}

const modPath = join(outDir, "card-identity.js");
if (!(await import("node:fs").then((fs) => fs.existsSync(modPath)))) {
  process.stderr.write(`compiled module not found: ${modPath}\n`);
  process.exit(1);
}

try {
  const mod = await import(modPath);
  const resolve = mod.resolveCardIdentityLive;
  if (typeof resolve !== "function") {
    process.stderr.write("resolveCardIdentityLive not exported\n");
    process.exit(1);
  }
  const result = await resolve(query, limit);
  process.stdout.write(JSON.stringify(result));
} catch (e) {
  process.stderr.write("resolve failed: " + (e?.message || String(e)) + "\n");
  process.exit(1);
}
