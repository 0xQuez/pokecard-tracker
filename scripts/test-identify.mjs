// Runner for src/lib/identify/identify.test.mjs — mirrors scripts/test-card-identity.mjs.
// Compiles the identify TS modules to CommonJS in a temp dir, copies the .mjs
// test over, and runs node --test.
import { mkdirSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(tmpdir(), "pokecards-identify-test");
mkdirSync(outDir, { recursive: true });

execFileSync(
  join(repoRoot, "node_modules", ".bin", "tsc"),
  [
    "src/lib/identify/card-vision.ts",
    "src/lib/identify/identity-matcher.ts",
    "src/lib/identify/pokemontcg-catalog.ts",
    "--target", "ES2022",
    "--module", "commonjs",
    "--moduleResolution", "node",
    "--outDir", outDir,
    "--skipLibCheck",
    "--esModuleInterop",
  ],
  { cwd: repoRoot, stdio: "inherit" }
);

cpSync(join(repoRoot, "src/lib/identify/identify.test.mjs"), join(outDir, "identify.test.mjs"));
execFileSync(process.execPath, ["--test", join(outDir, "identify.test.mjs")], { cwd: repoRoot, stdio: "inherit" });
