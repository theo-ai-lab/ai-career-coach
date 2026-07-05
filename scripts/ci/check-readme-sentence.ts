/**
 * scripts/ci/check-readme-sentence.ts
 *
 * Claims-drift gate for the README's headline MEASURED sentence. The README
 * promises that its measured cascade sentence "is regenerated from the
 * committed cascade-replay.json by buildMeasuredSentence(), so the docs and
 * the code cannot disagree" — this script makes CI enforce that promise.
 *
 * It calls the real buildMeasuredSentence() (which reads the committed
 * lib/quality-gates/cascade-replay.json), extracts the blockquoted sentence
 * from README.md, and fails (exit 1) unless the two BYTE-MATCH. Fail-closed:
 * zero or multiple candidate blockquotes is also an error.
 *
 * Run: npx tsx scripts/ci/check-readme-sentence.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildMeasuredSentence } from '../../lib/quality-gates/cascade-telemetry';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const TAG = '[check-readme-sentence]';

function main() {
  const expected = buildMeasuredSentence();

  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
  // The sentence lives in a one-line blockquote; anchor on its stable opening
  // words rather than its (drift-prone) numbers.
  const candidates = readme
    .split('\n')
    .filter((line) => /^>\s*On the committed\b/.test(line))
    .map((line) => line.replace(/^>\s*/, ''));

  if (candidates.length !== 1) {
    console.error(
      `${TAG} FAIL: expected exactly 1 README blockquote starting with "On the committed", found ${candidates.length}.`,
    );
    process.exit(1);
  }

  const documented = candidates[0];
  if (documented !== expected) {
    console.error(`${TAG} DRIFT: README measured sentence != buildMeasuredSentence().`);
    console.error(`${TAG}   README:    ${JSON.stringify(documented)}`);
    console.error(`${TAG}   generated: ${JSON.stringify(expected)}`);
    console.error(
      `${TAG} FAIL: paste the generated sentence into the README blockquote (or fix cascade-replay.json via scripts/calibrate-ood-gate.ts if the data changed).`,
    );
    process.exit(1);
  }

  console.log(`${TAG} OK: README measured sentence byte-matches buildMeasuredSentence().`);
}

main();
