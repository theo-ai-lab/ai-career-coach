/**
 * scripts/ci/check-coverage-counts.mjs
 *
 * Coverage-consistency gate: data/eval-benchmark/COVERAGE.md promises that its
 * current-state grid "reflects on-disk reality" — this script makes CI enforce
 * that by COUNTING the case files actually present under
 * data/eval-benchmark/cases/ and comparing them to the numbers parsed out of
 * the COVERAGE.md current-state Total row (never by grepping prose).
 *
 * Plain Node, zero dependencies (runnable before npm ci):
 *   node scripts/ci/check-coverage-counts.mjs
 *
 * Exits 1 on any mismatch, or if the table can no longer be parsed
 * (fail-closed — a gate that silently matches nothing is not a gate).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const TAG = '[check-coverage-counts]';

/** Count committed case files (.json) in one cases/ subdirectory; a directory
 *  COVERAGE.md documents as not-yet-created counts as 0. */
function countCases(subdir) {
  try {
    return readdirSync(join(repoRoot, 'data/eval-benchmark/cases', subdir)).filter((f) =>
      f.endsWith('.json'),
    ).length;
  } catch {
    return 0;
  }
}

function main() {
  const onDisk = {
    normal: countCases('normal'),
    adversarial: countCases('adversarial'),
    edge: countCases('edge'),
  };
  const onDiskTotal = onDisk.normal + onDisk.adversarial + onDisk.edge;

  const coverage = readFileSync(join(repoRoot, 'data/eval-benchmark/COVERAGE.md'), 'utf8');

  // Scope to the "Current state" section only — the v4 target table further
  // down has its own (aspirational) Total row that must NOT be matched.
  const section = coverage.match(/^## Current state[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (!section) {
    console.error(`${TAG} FAIL: could not locate the "## Current state" section in COVERAGE.md.`);
    process.exit(1);
  }

  const totalRow = section[1].match(
    /^\| \*\*Total\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/m,
  );
  if (!totalRow) {
    console.error(`${TAG} FAIL: could not parse the current-state Total row in COVERAGE.md.`);
    process.exit(1);
  }

  const documented = {
    normal: Number(totalRow[1]),
    adversarial: Number(totalRow[2]),
    edge: Number(totalRow[3]),
    total: Number(totalRow[4]),
  };

  let drift = false;
  for (const key of ['normal', 'adversarial', 'edge']) {
    if (documented[key] !== onDisk[key]) {
      drift = true;
      console.error(
        `${TAG} DRIFT: COVERAGE.md documents ${documented[key]} ${key} case(s), but cases/${key}/ holds ${onDisk[key]} file(s).`,
      );
    }
  }
  if (documented.total !== onDiskTotal) {
    drift = true;
    console.error(
      `${TAG} DRIFT: COVERAGE.md documents N=${documented.total} total, but ${onDiskTotal} case file(s) exist on disk.`,
    );
  }
  if (documented.total !== documented.normal + documented.adversarial + documented.edge) {
    drift = true;
    console.error(
      `${TAG} DRIFT: COVERAGE.md Total row is internally inconsistent (${documented.normal}+${documented.adversarial}+${documented.edge} != ${documented.total}).`,
    );
  }

  if (drift) {
    console.error(
      `${TAG} FAIL: update the COVERAGE.md current-state grid in the same change that adds or removes case files.`,
    );
    process.exit(1);
  }

  console.log(
    `${TAG} OK: COVERAGE.md current-state grid matches disk (normal=${onDisk.normal}, adversarial=${onDisk.adversarial}, edge=${onDisk.edge}, N=${onDiskTotal}).`,
  );
}

main();
