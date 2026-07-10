/**
 * upload-pipeline.ts
 *
 * The /api/upload ingestion path (PDF -> text -> chunks -> embeddings ->
 * documents rows) as an injectable pipeline, plus the multipart boundary
 * validation. The route stays a thin adapter; everything decision-shaped
 * lives here and is unit-testable offline (embedding and insertion are
 * injected, matching the quality-gates layer's pattern).
 *
 * WHY THIS EXISTS
 * ---------------
 * The upload route used to collapse every failure into HTTP 500 "Internal
 * error during upload.": a text field posted as "file" (TypeError), an
 * unparseable PDF, a dead Supabase backend — all indistinguishable, all
 * after the OpenAI embedding spend. Separating validation (400s), PDF
 * problems (400s), and backend failures (503 through the designed
 * service-unavailable surface) makes the route degrade honestly and spend
 * nothing when the input or the backend cannot possibly work.
 *
 * KNOWN DEPENDENCY TRAP (locked by tests)
 * ---------------------------------------
 * pdf-parse's bundled pdf.js (v1.10.100) mishandles Node Buffer instances:
 * its fake-worker clone re-wraps typed arrays via `value.constructor` and
 * its stream layer dereferences `bytes.buffer` with absolute offsets, so a
 * Buffer (pooled or not — verified for Buffer.alloc, Buffer.from(string),
 * Buffer.from(arrayBuffer), the route's exact pattern) makes it parse the
 * wrong bytes and reject VALID documents with "bad XRef entry" — the
 * /api/upload 500 failure class on real uploads (reproduced on Node 24
 * against pdf-parse@1.1.4). A plain Uint8Array copy with its own
 * ArrayBuffer parses correctly, so extractPdfText() normalizes to that.
 */

import { randomUUID } from 'crypto';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import type { DocumentInsert } from './supabase-types';

// ---------------------------------------------------------------------------
// Multipart boundary validation
// ---------------------------------------------------------------------------

export type UploadFormValidation =
  | { ok: true; file: File; userId: string }
  | { ok: false; error: string };

/**
 * Validate the two multipart fields of POST /api/upload. FormData.get()
 * returns File | string | null; every combination that is not
 * (File, non-empty string) is a designed 400, never a TypeError.
 */
export function validateUploadForm(
  file: unknown,
  userId: unknown,
): UploadFormValidation {
  if (file == null || userId == null) {
    // Legacy message — the shape shipped since the first release.
    return { ok: false, error: 'Missing file or userId' };
  }
  if (
    typeof file === 'string' ||
    typeof (file as File).arrayBuffer !== 'function'
  ) {
    return {
      ok: false,
      error: 'The "file" field must be an uploaded file, not a text value.',
    };
  }
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    return {
      ok: false,
      error: 'The "userId" field must be a non-empty string.',
    };
  }
  return { ok: true, file: file as File, userId };
}

// ---------------------------------------------------------------------------
// Real dependency implementations (what the route injects in production)
// ---------------------------------------------------------------------------

/**
 * Extract text from PDF bytes with pdf-parse. Accepts any Uint8Array flavor
 * (including Node Buffers) and normalizes to a plain, unpooled Uint8Array —
 * see the dependency-trap note in the module header. Throws when the bytes
 * are not a readable PDF; the pipeline maps that to 'unparseable-pdf'.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default;
  // new Uint8Array(view) COPIES into a fresh ArrayBuffer (plain Uint8Array
  // class, byteOffset 0, exact length) — the only shape pdf-parse's pdf.js
  // reads reliably. Node Buffer instances (any flavor) trip its fake-worker
  // clone/stream layer and valid PDFs come back "bad XRef entry".
  const data = await pdfParse(new Uint8Array(bytes));
  return data.text;
}

/**
 * Chunk resume text for embedding. Same parameters the route has always
 * used: 1000-char chunks with 200-char overlap.
 */
export async function splitResumeText(text: string): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const docs = await splitter.createDocuments([text]);
  return docs.map((d) => d.pageContent);
}

// ---------------------------------------------------------------------------
// Ingestion orchestration
// ---------------------------------------------------------------------------

export interface UploadIngestionDeps {
  /** PDF bytes -> extracted text; throws on unreadable bytes. */
  extractPdfText(bytes: Uint8Array): Promise<string>;
  /** Text -> chunks to embed. */
  splitText(text: string): Promise<string[]>;
  /** Chunks -> one embedding vector per chunk (the OpenAI spend). */
  embedChunks(chunks: string[]): Promise<number[][]>;
  /** Insert rows into the documents table; error follows the Supabase shape. */
  insertDocuments(
    rows: DocumentInsert[],
  ): Promise<{ error: { message: string } | null }>;
  /** Injectable id source for deterministic tests. Defaults to randomUUID. */
  newResumeId?: () => string;
}

export type UploadIngestionResult =
  | { status: 'ok'; resumeId: string; chunks: number }
  /** The bytes could not be read as a PDF — a client problem (400). */
  | { status: 'unparseable-pdf' }
  /** A readable PDF with no extractable text — a client problem (400). */
  | { status: 'empty-pdf' }
  /** The documents insert failed — a service problem (503 + reportDead). */
  | { status: 'backend-error'; message: string };

export interface UploadIngestionInput {
  buffer: Uint8Array;
  fileName: string;
  userId: string;
}

/**
 * Run the ingestion pipeline. Client-input problems and backend failures
 * come back as designed results (never thrown); only genuinely unexpected
 * upstream faults (e.g. the embedding call itself failing) propagate to the
 * route's generic handler. Extraction failures cost nothing: the embedding
 * call only happens once real text exists.
 */
export async function runUploadIngestion(
  input: UploadIngestionInput,
  deps: UploadIngestionDeps,
): Promise<UploadIngestionResult> {
  let text: string;
  try {
    text = await deps.extractPdfText(input.buffer);
  } catch {
    return { status: 'unparseable-pdf' };
  }

  if (!text.trim()) {
    return { status: 'empty-pdf' };
  }

  const chunks = await deps.splitText(text);
  const vectors = await deps.embedChunks(chunks);
  const resumeId = (deps.newResumeId ?? randomUUID)();

  const rows: DocumentInsert[] = chunks.map((content, i) => ({
    content,
    embedding: vectors[i],
    metadata: {
      source: input.fileName,
      user_id: input.userId,
      resume_id: resumeId,
    },
  }));

  const { error } = await deps.insertDocuments(rows);
  if (error) {
    return { status: 'backend-error', message: error.message };
  }

  return { status: 'ok', resumeId, chunks: rows.length };
}
