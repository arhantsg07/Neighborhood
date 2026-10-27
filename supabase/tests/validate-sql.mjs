// Embedded PostgreSQL smoke runner. Optionally supply a PGlite module path as argv[2].
// Stubs only the Supabase-owned auth/storage schemas; this is NOT a Storage API test.
// For full integration, run backend.sql against an actual migrated Supabase database.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { PGlite } = process.argv[2]
  ? await import(pathToFileURL(process.argv[2]).href)
  : await import('@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'role'
    $$;
    create table storage.buckets (
      id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id), name text not null,
      unique(bucket_id,name)
    );
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]
    $$;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant all on storage.objects to anon, authenticated, service_role;
  `);
  const migration = await readFile(
    new URL('../migrations/20261027000000_issue_reporter.sql', import.meta.url),
    'utf8',
  );
  await db.exec(migration);
  const results = await db.exec(await readFile(new URL('./backend.sql', import.meta.url), 'utf8'));
  assert(
    results.some((result) =>
      result.rows.some(
        (row) => row.result === 'Backend SQL checks passed (transaction will roll back).',
      ),
    ),
  );
  console.log(
    'PASS: migration parsed/applied and SQL permission, RLS, trigger, RPC, storage visibility, and rolling quota regression checks passed.',
  );
  console.log(
    'Limitations: auth/storage schemas are stubs; no HTTP Storage API, deployed Auth, or multi-connection concurrency test.',
  );
} finally {
  await db.close();
}
