# Production Security Verification

## Verification Date / Operator / Result

- Date verified:
- Operator:
- Supabase project/environment:
- SQL files applied:
- Smoke tests run:
- Pass/fail status:
- Follow-up issues opened:

## Purpose And Scope

Use this runbook to verify that the live Supabase production project matches the repository security posture for RLS, policies, grants, and vector-search RPC access.

This is a verification runbook only. It does not require app-code changes.

## Handling Sensitive Output

Do not commit secrets, service-role keys, anon keys, JWTs, screenshots containing tokens, or SQL editor output that includes sensitive values.

If you capture evidence, store only redacted summaries such as pass/fail status, object names, role names, and non-secret timestamps.

## Prerequisites

- Confirm you are connected to the intended production Supabase project.
- Use the Supabase SQL editor, `psql`, or another approved SQL runner.
- Prefer read-only verification queries before applying or reapplying SQL.
- Keep the repo SQL files available for comparison:
  - `01-supabase-documents.sql`
  - `02-supabase-match-documents.sql`
  - `03-supabase-memory.sql`
  - `04-supabase-evals.sql`
  - `05-supabase-fix.sql`

## SQL Verification Queries

### 1. RLS Enabled

Expected: all four tables have `rowsecurity = true`.

```sql
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'documents',
    'user_profiles',
    'session_memories',
    'evals'
  )
order by tablename;
```

### 2. No Anon Or Authenticated Policies On Protected Tables

Expected: `documents`, `user_profiles`, and `session_memories` have no policies for `anon` or `authenticated`. The intended policy for each protected table is service-role-only.

```sql
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'documents',
    'user_profiles',
    'session_memories'
  )
order by tablename, policyname;
```

Review the `roles` column. It should not include `anon`, `authenticated`, or `public` for these protected tables.

### 3. `match_documents` V1 Is Absent

Expected: zero rows.

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'match_documents';
```

### 4. `match_documents_v2` Exists

Expected: exactly one row with arguments equivalent to `vector, integer, text, text`.

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'match_documents_v2';
```

### 5. `match_documents_v2` Execute Privileges

Expected:

- `public_can_execute = false`
- `anon_can_execute = false`
- `authenticated_can_execute = false`
- `service_role_can_execute = true`

```sql
select
  has_function_privilege(
    'public',
    'public.match_documents_v2(vector, integer, text, text)',
    'execute'
  ) as public_can_execute,
  has_function_privilege(
    'anon',
    'public.match_documents_v2(vector, integer, text, text)',
    'execute'
  ) as anon_can_execute,
  has_function_privilege(
    'authenticated',
    'public.match_documents_v2(vector, integer, text, text)',
    'execute'
  ) as authenticated_can_execute,
  has_function_privilege(
    'service_role',
    'public.match_documents_v2(vector, integer, text, text)',
    'execute'
  ) as service_role_can_execute;
```

### 6. Table Grants

Expected:

- `documents`: no direct table privileges for `anon` or `authenticated`; service-role access is allowed.
- `user_profiles`: no direct table privileges for `anon` or `authenticated`; service-role access is allowed.
- `session_memories`: no direct table privileges for `anon` or `authenticated`; service-role access is allowed.
- `evals`: `anon` may insert eval rows; reads should remain service-role-only.

```sql
select
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in (
    'documents',
    'user_profiles',
    'session_memories',
    'evals'
  )
  and grantee in (
    'anon',
    'authenticated',
    'service_role',
    'PUBLIC'
  )
order by table_name, grantee, privilege_type;
```

Also verify effective table privileges by role:

```sql
select
  table_name,
  role_name,
  has_table_privilege(role_name, 'public.' || table_name, 'select') as can_select,
  has_table_privilege(role_name, 'public.' || table_name, 'insert') as can_insert,
  has_table_privilege(role_name, 'public.' || table_name, 'update') as can_update,
  has_table_privilege(role_name, 'public.' || table_name, 'delete') as can_delete
from (
  values
    ('documents'),
    ('user_profiles'),
    ('session_memories'),
    ('evals')
) as tables(table_name)
cross join (
  values
    ('anon'),
    ('authenticated'),
    ('service_role')
) as roles(role_name)
order by table_name, role_name;
```

## Production Smoke Tests

### 1. Upload Still Works Through The App

1. Open the production app.
2. Upload a small non-sensitive test resume.
3. Confirm the UI returns a successful upload state and a `resumeId`.
4. Do not record or commit the uploaded resume contents if they contain personal data.

Expected: upload succeeds through the server route, which uses the service-role key server-side.

### 2. Resume-Grounded Chat Still Works

1. Ask a question that should be answerable from the uploaded test resume.
2. Confirm the answer references the resume content.
3. Confirm the app does not return the fallback answer: `No relevant experience found.`

Expected: chat succeeds through `match_documents_v2` via the server-side service-role client.

### 3. Anon Direct Access To Protected Tables Fails

Use an anon-key client outside the app, with a harmless query against each protected table:

- `documents`
- `user_profiles`
- `session_memories`

Expected: direct access is denied or returns no access because protected tables do not expose anon policies.

Do not paste the anon key into committed files, shell history snippets, issue comments, or screenshots.

### 4. `match_documents_v2` Cannot Be Called With Anon Or Authenticated Client

Use an anon-key client to call `match_documents_v2` with a dummy 1536-dimension embedding vector and non-production test identifiers.

Expected: the RPC call fails with a permission error because `EXECUTE` is revoked from `PUBLIC`, `anon`, and `authenticated`.

Repeat with an authenticated client if that role is available in the environment.

Expected: authenticated RPC call also fails with a permission error.

### 5. Eval Benchmark Still Runs If Applicable

If running the local benchmark is part of the release verification, run the smoke path:

```bash
node scripts/run-eval-benchmark.cjs --smoke
```

Expected: the smoke benchmark completes and writes a local dated result file. Do not commit result files unless that is explicitly part of the release procedure.

## If Verification Fails

Stop and record the failing check in the fill-in section at the top of this document or in a follow-up issue.

Do not paste secrets, raw tokens, or screenshots with visible keys into the issue.

If live SQL does not match the repo posture, reapply the repo SQL files only through an approved operational path and in alphabetical order:

```text
01-supabase-documents.sql
02-supabase-match-documents.sql
03-supabase-memory.sql
04-supabase-evals.sql
05-supabase-fix.sql
```

After applying SQL, rerun all SQL verification queries and production smoke tests.

## Current Known Gaps

- `README.md` and `docs/ARCHITECTURE.md` still mention `match_documents` v1.
- `lib/supabase-types.ts` still declares `match_documents`.
- `scripts/ingest.ts` uses the anon key for document inserts, which is inconsistent with the service-role-only `documents` posture.
