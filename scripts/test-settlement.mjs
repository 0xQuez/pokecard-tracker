import { mkdirSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(tmpdir(), 'pokecards-settlement-test');
mkdirSync(outDir, { recursive: true });

execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'tsc'),
  [
    'src/lib/helpers.ts',
    'src/lib/settlement.ts',
    '--target', 'ES2022',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--outDir', outDir,
    '--skipLibCheck',
    '--esModuleInterop',
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

cpSync(join(repoRoot, 'src/lib/settlement.test.mjs'), join(outDir, 'settlement.test.mjs'));
execFileSync(process.execPath, ['--test', join(outDir, 'settlement.test.mjs')], { cwd: repoRoot, stdio: 'inherit' });
