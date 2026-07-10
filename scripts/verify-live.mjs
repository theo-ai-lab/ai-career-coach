#!/usr/bin/env node
/**
 * verify-live.mjs — post-deploy verifier for a hosted deployment.
 *
 * Usage:
 *   node scripts/verify-live.mjs <BASE_URL> [--skip-upload]
 *   npm run verify:live -- <BASE_URL>
 *
 * Exercises the health, demo, query, and upload surfaces and classifies
 * every response into one of the app's DESIGNED states or BROKEN:
 *
 *   LIVE      the designed working state (grounded answers, healthy probe)
 *   DEGRADED  the designed unavailability state (honest 503
 *             service_unavailable payloads, health reporting degraded)
 *   BROKEN    anything the code never intends: generic 500s, a 200 answer
 *             without the signals payload (the masked-dead-backend shape),
 *             unexpected bodies, network failures
 *
 * Exit codes: 0 = fully live; 2 = designed-degraded; 1 = broken.
 *
 * Read-mostly: the only writes are the upload probe (a tiny generated PDF
 * under a throwaway verify-live-* userId) and its follow-up query (sent
 * with skipMemory so no session memory is written). Pass --skip-upload to
 * send nothing but reads. The upload probe and its follow-up query DO
 * spend embedding/generation tokens when the deployment is live.
 *
 * The probe PDF comes from scripts/lib/minimal-pdf.mjs;
 * lib/upload-pipeline.test.ts proves the app's own extractor reads it, so
 * an upload 400 here means the deployed code rejects valid PDFs — broken,
 * not a bad probe.
 */

import { randomUUID } from "node:crypto";
import { buildMinimalPdf } from "./lib/minimal-pdf.mjs";

const TIMEOUT_MS = 30_000;

function usage() {
  console.error("Usage: node scripts/verify-live.mjs <BASE_URL> [--skip-upload]");
  process.exit(1);
}

const args = process.argv.slice(2);
const skipUpload = args.includes("--skip-upload");
const baseArg = args.find((a) => !a.startsWith("--"));
if (!baseArg) usage();
const BASE = baseArg.replace(/\/+$/, "");

/** @type {{name: string, verdict: 'LIVE'|'DEGRADED'|'BROKEN'|'SKIPPED', detail: string}[]} */
const results = [];

function record(name, verdict, detail) {
  results.push({ name, verdict, detail });
  console.log(`  [${verdict.padEnd(8)}] ${name} — ${detail}`);
}

async function request(path, init = {}) {
  return fetch(`${BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function jsonOf(res) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function isServiceUnavailablePayload(json) {
  return Boolean(json) && json.error === "service_unavailable";
}

async function checkHealth() {
  const name = "GET /api/health";
  try {
    const res = await request("/api/health");
    const { json } = await jsonOf(res);
    if (res.status !== 200 || !json || !json.live) {
      record(
        name,
        "BROKEN",
        `expected 200 with a health body, got ${res.status}` +
          (res.status === 404 ? " (deploy predates the health route?)" : ""),
      );
      return;
    }
    const detail = `status=${json.status} configured=${json.live.configured} backendAlive=${json.live.backendAlive}`;
    record(name, json.status === "ok" ? "LIVE" : "DEGRADED", detail);
  } catch (err) {
    record(name, "BROKEN", `request failed: ${err.message}`);
  }
}

async function checkPage(path) {
  const name = `GET ${path}`;
  try {
    const res = await request(path);
    if (res.status === 200) record(name, "LIVE", "200");
    else record(name, "BROKEN", `expected 200, got ${res.status}`);
  } catch (err) {
    record(name, "BROKEN", `request failed: ${err.message}`);
  }
}

async function checkDemoQuery() {
  const name = "POST /api/demo/query";
  try {
    const res = await request("/api/demo/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "What machine learning work has this person done?",
      }),
    });
    const { json } = await jsonOf(res);
    if (
      res.status === 200 &&
      json &&
      typeof json.answer === "string" &&
      json.signals
    ) {
      record(name, "LIVE", "keyless demo answered with gate signals");
    } else {
      record(name, "BROKEN", `expected 200 with answer+signals, got ${res.status}`);
    }
  } catch (err) {
    record(name, "BROKEN", `request failed: ${err.message}`);
  }
}

async function checkQueryValidation() {
  const name = "POST /api/query (invalid body)";
  try {
    const res = await request("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.status === 400) record(name, "LIVE", "designed 400 rejection");
    else record(name, "BROKEN", `expected 400, got ${res.status}`);
  } catch (err) {
    record(name, "BROKEN", `request failed: ${err.message}`);
  }
}

/**
 * Classify a live-query response. Returns the verdict so callers can chain.
 */
async function classifyQuery(name, res) {
  const { json } = await jsonOf(res);
  if (res.status === 503 && isServiceUnavailablePayload(json)) {
    record(
      name,
      "DEGRADED",
      `designed 503 service_unavailable (configured=${json.configured})`,
    );
    return "DEGRADED";
  }
  if (res.status === 200 && json && typeof json.answer === "string") {
    if (!json.signals) {
      // The exact failure class the honesty gate exists to prevent: an
      // answer-shaped 200 with no gate telemetry.
      record(name, "BROKEN", "200 answer WITHOUT signals payload (masked failure shape)");
      return "BROKEN";
    }
    const sources = Array.isArray(json.sources) ? json.sources.length : 0;
    record(name, "LIVE", `200 with signals; sources=${sources}`);
    return "LIVE";
  }
  record(name, "BROKEN", `unexpected response: ${res.status}`);
  return "BROKEN";
}

async function checkQueryUnknownResume() {
  const name = "POST /api/query (unknown resumeId)";
  try {
    const res = await request("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "What experience do I have with Python?",
        resumeId: randomUUID(),
        skipMemory: true,
      }),
    });
    await classifyQuery(name, res);
  } catch (err) {
    record(name, "BROKEN", `request failed: ${err.message}`);
  }
}

async function checkUploadThenQuery() {
  const uploadName = "POST /api/upload (probe PDF)";
  const e2eName = "POST /api/query (uploaded resume)";
  if (skipUpload) {
    record(uploadName, "SKIPPED", "--skip-upload");
    record(e2eName, "SKIPPED", "--skip-upload");
    return;
  }
  try {
    const pdf = buildMinimalPdf(
      "Verify Live Probe Resume\n" +
        "Senior software engineer with eight years of Python experience.\n" +
        "Built retrieval-augmented generation systems and evaluation harnesses.",
    );
    const form = new FormData();
    form.append(
      "file",
      new Blob([pdf], { type: "application/pdf" }),
      "verify-live-probe.pdf",
    );
    form.append("userId", `verify-live-${Date.now()}`);

    const res = await request("/api/upload", { method: "POST", body: form });
    const { json } = await jsonOf(res);

    if (res.status === 503 && isServiceUnavailablePayload(json)) {
      record(
        uploadName,
        "DEGRADED",
        `designed 503 service_unavailable (configured=${json.configured})`,
      );
      record(e2eName, "SKIPPED", "backend unavailable (designed state)");
      return;
    }
    if (
      res.status === 200 &&
      json &&
      json.success === true &&
      typeof json.resumeId === "string" &&
      json.chunks >= 1
    ) {
      record(uploadName, "LIVE", `ingested ${json.chunks} chunk(s)`);
      const queryRes = await request("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "Summarize this candidate's Python experience.",
          resumeId: json.resumeId,
          skipMemory: true,
        }),
      });
      await classifyQuery(e2eName, queryRes);
      return;
    }
    // A 400 means the deployed extractor rejected a PDF that the repo's own
    // tests prove parseable — the valid-PDF-rejection bug, not a bad probe.
    record(
      uploadName,
      "BROKEN",
      `expected 200 ingestion or designed 503, got ${res.status}` +
        (json && json.error ? ` (${json.error})` : ""),
    );
    record(e2eName, "SKIPPED", "upload broken");
  } catch (err) {
    record(uploadName, "BROKEN", `request failed: ${err.message}`);
    record(e2eName, "SKIPPED", "upload broken");
  }
}

console.log(`verify-live: ${BASE}`);
await checkHealth();
await checkPage("/");
await checkPage("/demo");
await checkDemoQuery();
await checkQueryValidation();
await checkQueryUnknownResume();
await checkUploadThenQuery();

const broken = results.filter((r) => r.verdict === "BROKEN");
const degraded = results.filter((r) => r.verdict === "DEGRADED");

if (broken.length > 0) {
  console.log(`\nOVERALL: BROKEN — ${broken.length} surface(s) outside designed states`);
  process.exit(1);
} else if (degraded.length > 0) {
  console.log(
    `\nOVERALL: DEGRADED — all responses are designed states, but the live backend is unavailable (${degraded.length} degraded surface(s))`,
  );
  process.exit(2);
} else {
  console.log("\nOVERALL: LIVE — all surfaces in designed working states");
  process.exit(0);
}
