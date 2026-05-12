/**
 * Direct ingest for the red-team runner.
 *
 * Bypasses /api/upload (which requires a PDF that pdf-parse can read — see
 * scripts/red-team.mjs preamble for why hand-rolled PDFs are fragile here).
 * Instead, embeds the markdown resume directly via OpenAI's HTTP API and
 * inserts chunks into the `documents` table via Supabase REST. The query
 * route's match_documents_v2 RPC only needs metadata.resume_id to scope, so
 * the rest of the red-team flow is unchanged.
 *
 * Usage:
 *   node scripts/red-team-ingest.cjs
 *
 * Output: prints "RESUME_ID=<uuid>" on success. Caller (red-team.mjs) reads
 * env RED_TEAM_RESUME_ID to skip the upload step.
 */

const { readFile } = require('fs/promises');
const { resolve } = require('path');
const { randomUUID } = require('crypto');

require('dotenv').config({ path: resolve(__dirname, '..', '.env.local') });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [k, v] of [
  ['OPENAI_API_KEY', OPENAI_API_KEY],
  ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_KEY],
]) {
  if (!v) {
    console.error(`FATAL: ${k} missing from .env.local`);
    process.exit(1);
  }
}

const RESUME_MD = resolve(__dirname, '..', 'data/eval-benchmark/personas/synthetic-redteam-resume.md');

function mdToPlainText(md) {
  let text = md;
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4);
    if (end !== -1) text = text.slice(end + 5);
  }
  text = text.replace(/^#+\s+/gm, '');
  text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// Approximate RecursiveCharacterTextSplitter behavior: chunkSize=1000, overlap=200.
// Splits on paragraph boundaries first, packs into <=1000-char chunks, then
// adds 200-char tail of each chunk to the head of the next for overlap.
function chunk(text, target = 1000, overlap = 200) {
  const paras = text.split(/\n\n+/);
  const chunks = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > target && buf.length > 0) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
  }
  if (buf) chunks.push(buf);
  // Add overlap from previous chunk's tail
  const out = [chunks[0]];
  for (let i = 1; i < chunks.length; i++) {
    const tail = chunks[i - 1].slice(-overlap);
    out.push(tail + '\n' + chunks[i]);
  }
  return out;
}

async function embed(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const json = await res.json();
  return json.data.map((d) => d.embedding);
}

async function insertDocuments(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`Supabase insert ${res.status}: ${(await res.text()).slice(0, 800)}`);
  }
}

async function main() {
  const md = await readFile(RESUME_MD, 'utf8');
  const txt = mdToPlainText(md);
  const chunks = chunk(txt);
  console.error(`[ingest] ${chunks.length} chunks (avg ${Math.round(txt.length / chunks.length)} chars)`);

  const embeddings = await embed(chunks);
  console.error(`[ingest] embedded ${embeddings.length} chunks`);

  const resumeId = randomUUID();
  const userId = `redteam-${Date.now()}`;
  const rows = chunks.map((content, i) => ({
    content,
    embedding: embeddings[i],
    metadata: {
      source: 'synthetic-redteam-resume.md',
      user_id: userId,
      resume_id: resumeId,
    },
  }));
  await insertDocuments(rows);
  console.error(`[ingest] inserted ${rows.length} rows for resume_id=${resumeId}`);
  // stdout: machine-readable
  console.log(`RESUME_ID=${resumeId}`);
  console.log(`USER_ID=${userId}`);
}

main().catch((err) => {
  console.error(`[ingest] FATAL: ${err.message}`);
  process.exit(1);
});
