/**
 * Path A red-team runner.
 *
 * Uploads the synthetic adversarial resume (Maya Patel, librarian → data
 * science, 2022-2024 unexplained gap) to /api/upload, then runs each prompt
 * in red-team-prompts.json against /api/query. Captures verbatim responses,
 * timing, and error states. Resilient: per-prompt failures are logged with
 * severity:failed and the run continues.
 *
 * Pure ESM + native fetch + native FormData. No tsx, no openai SDK, no
 * @langchain/openai — those have module-load hangs in this Node 24.11.1
 * environment (see scripts/run-eval-benchmark.cjs preamble).
 *
 * The /api/upload route requires a real PDF (uses pdf-parse). To avoid
 * adding a dep, we hand-roll a minimal single-page PDF with embedded
 * Helvetica text. pdf-parse extracts the text via the Tj operators.
 *
 * Usage:
 *   1. Start the dev server in another terminal:  npm run dev
 *   2. Confirm http://localhost:3000 is reachable
 *   3. node scripts/red-team.mjs
 *
 * Output:
 *   data/eval-benchmark/red-team-raw-results.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE_URL = process.env.RED_TEAM_BASE_URL || 'http://localhost:3000';
const RESUME_MD = resolve(ROOT, 'data/eval-benchmark/personas/synthetic-redteam-resume.md');
const PROMPTS_JSON = resolve(ROOT, 'data/eval-benchmark/red-team-prompts.json');
const OUT_PATH = resolve(ROOT, 'data/eval-benchmark/red-team-raw-results.json');

const QUERY_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 90_000;
const USER_ID = `redteam-${Date.now()}`;

// ---------------------------------------------------------------------------
// Markdown → plain text. Strip frontmatter and basic markdown syntax. The
// output is what gets embedded in the PDF for retrieval.
// ---------------------------------------------------------------------------
function mdToPlainText(md) {
  let text = md;
  // Strip YAML frontmatter
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4);
    if (end !== -1) text = text.slice(end + 5);
  }
  // Drop heading markers but keep the heading text
  text = text.replace(/^#+\s+/gm, '');
  // Drop bold/italic markers
  text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
  // Bullets stay as "- " — that's fine in a resume
  // Collapse triple+ newlines to double
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// ---------------------------------------------------------------------------
// Minimal text → PDF. Single page, Helvetica 9pt, 12pt line spacing.
// pdf-parse can extract text from Tj operators in a content stream, which
// is what this generator emits.
// ---------------------------------------------------------------------------
function textToPdf(text) {
  const escape = (s) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

  const MAX_LINE = 95;
  const wrapped = [];
  for (const rawLine of text.split('\n')) {
    let line = rawLine;
    if (line.length === 0) {
      wrapped.push('');
      continue;
    }
    while (line.length > MAX_LINE) {
      let cut = line.lastIndexOf(' ', MAX_LINE);
      if (cut < 40) cut = MAX_LINE;
      wrapped.push(line.slice(0, cut));
      line = line.slice(cut).trimStart();
    }
    wrapped.push(line);
  }

  // Letter size: 612 x 792. Top margin starts at y=760, bottom margin y=40.
  // 12pt line height -> ~60 lines per page; we expect ~50.
  const PAGE_TOP = 760;
  const PAGE_BOTTOM = 40;
  const LINE_HEIGHT = 12;
  const FONT_SIZE = 9;
  const LEFT = 50;

  // Single-page assertion: if too many lines, fail loudly so the resume
  // can be tightened rather than silently truncated.
  const maxLines = Math.floor((PAGE_TOP - PAGE_BOTTOM) / LINE_HEIGHT);
  if (wrapped.length > maxLines) {
    throw new Error(
      `Resume produces ${wrapped.length} wrapped lines but the single-page ` +
        `PDF generator only fits ${maxLines}. Tighten the resume or extend ` +
        `the PDF generator to multi-page.`
    );
  }

  let y = PAGE_TOP;
  const ops = [];
  for (const line of wrapped) {
    if (line.length > 0) {
      ops.push(`BT /F1 ${FONT_SIZE} Tf ${LEFT} ${y} Td (${escape(line)}) Tj ET`);
    }
    y -= LINE_HEIGHT;
  }
  const stream = ops.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

// ---------------------------------------------------------------------------
// HTTP helpers with explicit timeouts.
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function uploadResume(pdfBuffer, userId) {
  const form = new FormData();
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
  form.append('file', blob, 'synthetic-redteam-resume.pdf');
  form.append('userId', userId);

  const start = Date.now();
  const res = await fetchWithTimeout(
    `${BASE_URL}/api/upload`,
    { method: 'POST', body: form },
    UPLOAD_TIMEOUT_MS
  );
  const elapsedMs = Date.now() - start;
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `Upload returned non-JSON (status ${res.status}, ${elapsedMs}ms): ${text.slice(0, 500)}`
    );
  }
  if (!res.ok || !json.success) {
    throw new Error(
      `Upload failed (status ${res.status}, ${elapsedMs}ms): ${JSON.stringify(json)}`
    );
  }
  return { resumeId: json.resumeId, chunks: json.chunks, elapsedMs };
}

async function runQuery(query, resumeId) {
  const start = Date.now();
  // skipMemory: eval runs must not load or write session summaries —
  // otherwise earlier prompts contaminate later prompts via the async
  // summarizer (see app/api/query/route.ts; red-team 2026-05-11 surfaced
  // this in ec-01).
  const res = await fetchWithTimeout(
    `${BASE_URL}/api/query`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, resumeId, skipMemory: true }),
    },
    QUERY_TIMEOUT_MS
  );
  const elapsedMs = Date.now() - start;
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: res.status,
      elapsedMs,
      error: `Non-JSON response: ${text.slice(0, 500)}`,
      raw_text: text,
    };
  }
  return { ok: res.ok, status: res.status, elapsedMs, body: json };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[red-team] base URL: ${BASE_URL}`);
  console.log(`[red-team] user_id: ${USER_ID}`);

  const md = await readFile(RESUME_MD, 'utf8');
  const promptsRaw = await readFile(PROMPTS_JSON, 'utf8');
  const promptsDoc = JSON.parse(promptsRaw);
  const prompts = promptsDoc.prompts;
  console.log(`[red-team] loaded ${prompts.length} prompts`);

  let pdfBuffer;
  if (process.env.RED_TEAM_PDF_PATH) {
    pdfBuffer = await readFile(process.env.RED_TEAM_PDF_PATH);
    console.log(`[red-team] using PDF from ${process.env.RED_TEAM_PDF_PATH}: ${pdfBuffer.length} bytes`);
  } else {
    const plainText = mdToPlainText(md);
    pdfBuffer = textToPdf(plainText);
    console.log(`[red-team] generated PDF: ${pdfBuffer.length} bytes`);
  }

  let upload;
  if (process.env.RED_TEAM_RESUME_ID) {
    upload = {
      resumeId: process.env.RED_TEAM_RESUME_ID,
      chunks: null,
      elapsedMs: 0,
    };
    console.log(`[red-team] skipping upload — using injected RESUME_ID=${upload.resumeId}`);
  } else {
    console.log(`[red-team] uploading resume...`);
    try {
      upload = await uploadResume(pdfBuffer, USER_ID);
      console.log(
        `[red-team] upload OK in ${upload.elapsedMs}ms, resumeId=${upload.resumeId}, chunks=${upload.chunks}`
      );
    } catch (err) {
      console.error(`[red-team] upload FAILED — cannot proceed: ${err.message}`);
      const failed = {
        run_id: USER_ID,
        base_url: BASE_URL,
        started_at: new Date().toISOString(),
        upload: { ok: false, error: err.message },
        attempts: [],
      };
      await mkdir(dirname(OUT_PATH), { recursive: true });
      await writeFile(OUT_PATH, JSON.stringify(failed, null, 2));
      process.exit(2);
    }
  }

  const attempts = [];
  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    const label = `[${i + 1}/${prompts.length}] ${p.id} (${p.category})`;
    process.stdout.write(`${label}... `);
    let result;
    try {
      result = await runQuery(p.text, upload.resumeId);
    } catch (err) {
      result = {
        ok: false,
        elapsedMs: null,
        error: `Exception: ${err.message}`,
      };
    }
    const attempt = {
      prompt_id: p.id,
      category: p.category,
      prompt_text: p.text,
      ideal_behavior: p.ideal_behavior,
      ok: result.ok,
      http_status: result.status ?? null,
      elapsed_ms: result.elapsedMs,
      response_text: result.body?.answer ?? null,
      sources_count: Array.isArray(result.body?.sources) ? result.body.sources.length : null,
      scores: result.body?.scores ?? null,
      error: result.error ?? result.body?.error ?? null,
      raw_body: result.body ?? null,
    };
    attempts.push(attempt);
    if (result.ok) {
      const preview = (attempt.response_text || '').slice(0, 60).replace(/\s+/g, ' ');
      console.log(`OK ${result.elapsedMs}ms — "${preview}..."`);
    } else {
      console.log(`FAILED — ${attempt.error}`);
    }
  }

  const out = {
    run_id: USER_ID,
    base_url: BASE_URL,
    started_at: new Date(Date.now() - attempts.reduce((s, a) => s + (a.elapsed_ms || 0), 0)).toISOString(),
    finished_at: new Date().toISOString(),
    persona: promptsDoc.persona,
    upload: {
      ok: true,
      resume_id: upload.resumeId,
      chunks: upload.chunks,
      elapsed_ms: upload.elapsedMs,
    },
    attempts,
    summary: {
      total: attempts.length,
      ok: attempts.filter((a) => a.ok).length,
      failed: attempts.filter((a) => !a.ok).length,
    },
  };
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(
    `[red-team] done. ${out.summary.ok}/${out.summary.total} OK, ${out.summary.failed} failed. Wrote ${OUT_PATH}`
  );
}

main().catch((err) => {
  console.error(`[red-team] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
