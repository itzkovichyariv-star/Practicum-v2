#!/usr/bin/env node
/**
 * backup-storage.mjs — download every object in a Supabase Storage bucket.
 *
 * WHY THIS EXISTS
 * ---------------
 *   `pg_dump` copies the database. It does NOT copy Storage, and Storage is where
 *   every candidate's CV lives (bucket `candidate-uploads`, written by /register and
 *   /cv-update, read by the coordinator and sent to employers). A backup that skips
 *   it restores a system that knows a CV exists and cannot produce it.
 *
 *   So the nightly backup runs pg_dump AND this. Together they are the whole state.
 *
 * USAGE
 *   node scripts/backup-storage.mjs <bucket> <out-dir>
 *   node scripts/backup-storage.mjs candidate-uploads ./backup/storage
 *
 * ENVIRONMENT
 *   SUPABASE_URL          https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY  the SERVICE ROLE key, not the publishable/anon one.
 *                         The anon key is bound by RLS and would silently back up
 *                         a subset — the worst possible failure for a backup, because
 *                         it looks like it worked. There is no fallback on purpose.
 *
 * WHAT IT WRITES
 *   <out-dir>/<object path>      every object, directory structure preserved
 *   <out-dir>/_manifest.json     one row per object: path, size, mime, timestamps
 *
 *   The manifest is the part you read when something is missing: it says what the
 *   bucket held at backup time, so "the file is not in the restore" and "the file was
 *   never in the bucket" stop looking identical.
 *
 * EXIT CODES
 *   0  every object listed was downloaded
 *   1  a precondition is missing (env, args) or at least one object failed to download
 *
 *   A partial download is a FAILURE, not a warning. A backup you cannot trust
 *   completely is one you will not use when it matters.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const [bucket, outDir] = process.argv.slice(2);
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!bucket || !outDir) die('usage: node scripts/backup-storage.mjs <bucket> <out-dir>');
if (!SUPABASE_URL) die('SUPABASE_URL is not set.');
if (!SERVICE_KEY) {
  die(
    'SUPABASE_SERVICE_KEY is not set.\n' +
    '   It must be the SERVICE ROLE key (Supabase dashboard → Project Settings → API).\n' +
    '   The publishable/anon key is filtered by RLS and would back up only part of the\n' +
    '   bucket while reporting success.',
  );
}

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

/** List one directory level. Supabase returns folders as rows whose `id` is null. */
async function listDir(prefix) {
  const out = [];
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) die(`listing "${prefix || '/'}" failed: HTTP ${r.status} ${await r.text()}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** Walk the whole bucket depth-first. Returns a flat list of object rows. */
async function walk(prefix = '') {
  const rows = await listDir(prefix);
  const files = [];
  for (const row of rows) {
    const path = prefix ? `${prefix}/${row.name}` : row.name;
    // A folder placeholder: no id, no metadata. Recurse into it.
    if (row.id === null || row.id === undefined) {
      files.push(...(await walk(path)));
    } else {
      files.push({
        path,
        size: row.metadata?.size ?? null,
        mimetype: row.metadata?.mimetype ?? null,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
      });
    }
  }
  return files;
}

async function download(objectPath) {
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
  const r = await fetch(url, { headers });
  if (!r.ok) return { ok: false, status: r.status };
  const dest = join(outDir, objectPath);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await r.arrayBuffer()));
  return { ok: true };
}

console.log(`Listing bucket "${bucket}" …`);
const files = await walk();
console.log(`${files.length} object(s) to download.`);

await mkdir(outDir, { recursive: true });

let bytes = 0;
const failed = [];
for (const [i, f] of files.entries()) {
  const res = await download(f.path);
  if (res.ok) {
    bytes += f.size || 0;
  } else {
    failed.push({ path: f.path, status: res.status });
    console.error(`  ✗ ${f.path} — HTTP ${res.status}`);
  }
  if ((i + 1) % 25 === 0 || i + 1 === files.length) {
    console.log(`  ${i + 1}/${files.length}`);
  }
}

await writeFile(
  join(outDir, '_manifest.json'),
  JSON.stringify({ bucket, taken_at: new Date().toISOString(), count: files.length, files }, null, 2),
);

const mb = (bytes / 1024 / 1024).toFixed(1);
if (failed.length) {
  console.error(`\n✗ ${failed.length} of ${files.length} object(s) failed. This backup is INCOMPLETE.`);
  process.exit(1);
}
console.log(`\n✓ ${files.length} object(s), ~${mb} MB, plus _manifest.json.`);
