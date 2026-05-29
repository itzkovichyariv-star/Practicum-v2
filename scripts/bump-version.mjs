#!/usr/bin/env node
/**
 * Bump the app version in src/lib/version.ts.
 *
 * Scheme: SemVer + monotonic build counter + git SHA  →  v<major>.<minor>.<patch>+build.<n>.<sha>
 *
 *   major  — breaking change (schema migration, removed flow, full redesign)
 *   minor  — new user-facing capability (new section, field, screen, flow)
 *   patch  — fix / copy tweak / refactor, no new capability
 *   build  — deploy counter; auto-increments on every deploy, never resets
 *   sha    — short git commit the build was produced from (traceability)
 *
 * SemVer and the build counter are ORTHOGONAL:
 *   - semver bumps (patch/minor/major) change only the semver triple and DROP the SHA
 *     (the new code has not been deployed yet, so there is no deploy-SHA to show)
 *   - the deploy path (no arg) bumps the build counter AND stamps the current git SHA
 *
 * Usage:
 *   node scripts/bump-version.mjs              bump build + stamp git SHA (deploy; default)
 *   node scripts/bump-version.mjs patch        bump patch  (1.2.3 -> 1.2.4), drop SHA
 *   node scripts/bump-version.mjs minor        bump minor  (1.2.3 -> 1.3.0), drop SHA
 *   node scripts/bump-version.mjs major        bump major  (1.2.3 -> 2.0.0), drop SHA
 *   node scripts/bump-version.mjs --set 2.0.0  set explicit semver, keep build, drop SHA
 *   node scripts/bump-version.mjs --print      print current version, change nothing
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = join(__dirname, '..', 'src', 'lib', 'version.ts');
// Captures semver + build; optional trailing ".<sha>" is matched but not captured (it gets replaced).
const RE = /v(\d+)\.(\d+)\.(\d+)\+build\.(\d+)(?:\.[0-9a-f]+)?/;

function readVersion() {
  const src = readFileSync(VERSION_FILE, 'utf8');
  const m = src.match(RE);
  if (!m) {
    throw new Error(
      `Could not find a version string matching v<major>.<minor>.<patch>+build.<n> in ${VERSION_FILE}`
    );
  }
  return {
    src,
    matched: m[0],
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    build: Number(m[4]),
    sha: null, // we never carry the old SHA forward; it's recomputed only on the deploy path
  };
}

function gitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || null;
  } catch {
    return null; // not a git repo / git unavailable — degrade to no SHA
  }
}

function format({ major, minor, patch, build, sha }) {
  return `v${major}.${minor}.${patch}+build.${build}` + (sha ? `.${sha}` : '');
}

const arg = process.argv[2];
const v = readVersion();
const current = format(v);

if (arg === '--print') {
  process.stdout.write(current + '\n');
  process.exit(0);
}

let next = { ...v };

switch (arg) {
  case 'major':
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
    next.sha = null;
    break;
  case 'minor':
    next.minor += 1;
    next.patch = 0;
    next.sha = null;
    break;
  case 'patch':
    next.patch += 1;
    next.sha = null;
    break;
  case '--set': {
    const target = process.argv[3];
    const sm = target && target.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (!sm) {
      console.error(`--set requires a semver like 2.0.0 (got: ${target ?? '<none>'})`);
      process.exit(1);
    }
    next.major = Number(sm[1]);
    next.minor = Number(sm[2]);
    next.patch = Number(sm[3]);
    next.sha = null;
    break;
  }
  case undefined:
  case 'build':
    // Deploy path: increment the build counter and stamp the current git SHA.
    next.build += 1;
    next.sha = gitShortSha();
    break;
  default:
    console.error(`Unknown argument: ${arg}`);
    console.error('Use one of: patch | minor | major | --set <x.y.z> | --print | (no arg = bump build)');
    process.exit(1);
}

const nextStr = format(next);
writeFileSync(VERSION_FILE, v.src.replace(v.matched, nextStr), 'utf8');
console.log(`version: ${current}  ->  ${nextStr}`);
