// Runner for src/lib/card-identity.test.mjs — mirrors scripts/test-settlement.mjs.
// Compiles card-identity.ts to CommonJS in a temp dir, copies the .mjs test over,
// and runs node --test.
import { mkdirSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(tmpdir(), 'pokecards-card-identity-test');
mkdirSync(outDir, { recursive: true });

execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'tsc'),
  [
    'src/lib/card-identity.ts',
    '--target', 'ES2022',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--outDir', outDir,
    '--skipLibCheck',
    '--esModuleInterop',
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

cpSync(join(repoRoot, 'src/lib/card-identity.test.mjs'), join(outDir, 'card-identity.test.mjs'));
execFileSync(process.execPath, ['--test', join(outDir, 'card-identity.test.mjs')], { cwd: repoRoot, stdio: 'inherit' });
