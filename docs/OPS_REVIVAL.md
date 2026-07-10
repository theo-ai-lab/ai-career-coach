# Backend Revival Runbook

Procedure for standing the hosted deployment's live path back up (or standing
up a fresh deployment) and verifying it end to end. Written 2026-07-10, when
the hosted deployment's Supabase backend was dead: the keyless `/demo` path
worked, but the live upload -> query path did not. **Status: the live
re-verification below is pending — nothing in this document claims the hosted
deployment is currently live.**

The app is built to degrade honestly while that is true: every key-requiring
route returns a designed `503 service_unavailable` payload (env presence via
`lib/service-config.ts`, backend reachability via the shared cached probe in
`lib/backend-liveness-server.ts`), and `GET /api/health` reports the same
truths keylessly.

No secrets, project identifiers, or key values belong in this file — env var
NAMES only.

## 1. Environment variables

Set these in the hosting platform for the Production environment (and locally
in `.env.local` for a local run). Names and roles are documented in
[.env.example](../.env.example), which is the source of truth.

Required for the live path:

| Variable | Used for |
|---|---|
| `OPENAI_API_KEY` | Embeddings (`text-embedding-3-small`) + generation/judge (`gpt-4o-mini`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (`https://<project>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client/anon-role reads and eval inserts |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side documents/memory access (bypasses RLS — keep secret) |

Optional (the app runs without them): `NEXT_PUBLIC_POSTHOG_KEY`,
`NEXT_PUBLIC_POSTHOG_HOST` (analytics), `PACIOLI_RECONCILE_URL` and the other
`PACIOLI_*` vars (post-generation grounding gate; unset = gate reports
`skipped`).

If the previous Supabase project is dead or paused, create/restore an active
project first, then point the three Supabase vars above at it. Rotate any key
that may have been exposed while debugging.

## 2. Database migrations

Apply the five SQL files at the repo root **in numeric order** — the order
encodes the dependency chain. Paste each into the Supabase SQL editor (or run
via `psql -f`) against the target project:

| Order | File | What it does |
|---|---|---|
| 1 | `01-supabase-documents.sql` | `vector` extension, `documents` table (`vector(1536)`), HNSW cosine index, enables RLS |
| 2 | `02-supabase-match-documents.sql` | Drops legacy `match_documents` v1; creates `match_documents_v2` (resume/user-scoped retrieval RPC) |
| 3 | `03-supabase-memory.sql` | `uuid-ossp` extension; `user_profiles` + `session_memories` tables with service-role-only RLS |
| 4 | `04-supabase-evals.sql` | `evals` table + indexes; anon INSERT / service-role SELECT policies |
| 5 | `05-supabase-fix.sql` | Canonical RLS for `documents` (service-role-only); idempotent policy cleanup |

All five are idempotent (`IF NOT EXISTS` / `DROP ... IF EXISTS`), so re-running
the full sequence on a partially provisioned project is safe.

## 3. Deploy

1. Redeploy the app after the env vars change (env edits do not apply to
   already-built deployments).
2. Check the platform's alias list after deploying and remove any
   auto-created public alias that should not serve the app
   (`vercel alias ls` / `vercel alias rm <alias>` on Vercel).

## 4. Post-deploy verification

Run the verifier against the deployment:

```sh
node scripts/verify-live.mjs https://<deployment-host>
# or: npm run verify:live -- https://<deployment-host>
```

Expected: every surface `LIVE`, exit code 0. `DEGRADED` (exit 2) means the
designed unavailability states are showing — configuration or backend still
down (the health line says which: `configured=false` vs `backendAlive=false`).
`BROKEN` (exit 1) means a surface answered outside its designed states; fix
before announcing anything.

Note: the upload probe and its follow-up query spend real OpenAI tokens and
insert a throwaway `verify-live-*` resume into the documents table. Use
`--skip-upload` for a read-only pass.

Manual equivalent (the upload -> query end-to-end):

```sh
# 1. Health — expect status "ok", configured true, backendAlive true
curl -s https://<deployment-host>/api/health

# 2. Upload a small PDF — expect {"success":true,"resumeId":"...","chunks":N}
curl -s -X POST https://<deployment-host>/api/upload \
  -F "file=@/path/to/resume.pdf;type=application/pdf" \
  -F "userId=revival-check"

# 3. Query against the returned resumeId — expect a grounded answer with
#    non-empty sources and a signals payload
curl -s -X POST https://<deployment-host>/api/query \
  -H "Content-Type: application/json" \
  -d '{"query":"Summarize this candidate'\''s experience.","resumeId":"<resumeId from step 2>","skipMemory":true}'
```

The keyless demo (`POST /api/demo/query`) must work in every state — if it
does not, the problem is the deployment itself, not configuration.

## 5. Recovery behavior and rollback

- The backend-liveness verdict is cached ~30s per server instance. After the
  backend comes back, routes recover on the next probe — no redeploy needed.
  A `503` with `"configured": true` within seconds of a fix is the cache, not
  a failure; re-check after the TTL.
- Rollback = redeploy the previous build from the platform's deployment list.
  The SQL files are additive/idempotent; they do not need a rollback step.
- Cost guard: none of the gates spend OpenAI tokens. A dead or unconfigured
  backend answers 503 before any embedding or generation call.
