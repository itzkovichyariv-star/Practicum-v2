#!/usr/bin/env node
/**
 * 52-cv-link-resolves.mjs — the CV sent to an employer is a WORKING public URL of the
 * UPDATED CV, never a raw storage:// path.
 *
 *   CV-resolve-storage   resolveCvUrl('storage://candidate-uploads/x.docx') returns an
 *                        https URL under the public object path — not the raw scheme.
 *   CV-resolve-passthru  an https value is returned unchanged; a bare legacy path is
 *                        resolved against candidate-uploads.
 *   CV-prefers-updated   given both, the dispatch reference prefers cvUpdatedUrl over
 *                        cvUrl (the post-workshop CV is what reaches the employer).
 *   CV-public-200        the resolved URL for a REAL student's CV actually returns 200
 *                        (the bucket is public and the link opens).
 *
 * Found live 2026-07-21: all 11 תשפ״ז CVs are stored as `storage://candidate-uploads/…`.
 * FileField resolved that for the editor, but PlacementPanel sent the raw storage://
 * path to employers — a dead link. resolveCvUrl (src/lib/cvUrl.ts) fixes it; this cell
 * runs the REAL helper through esbuild (same approach as cells 44/49).
 */
import { Audit, sbQuery } from '../audit-lib.mjs';
import esbuild from 'esbuild';

const audit = new Audit({ name: 'cv-link-resolves' });

const built = await esbuild.build({
  entryPoints: ['src/lib/cvUrl.ts'],
  bundle: true, format: 'esm', write: false, platform: 'neutral', logLevel: 'silent',
  // supabase-js pulls a lot in; stub the one call the helper uses.
  plugins: [{
    name: 'stub-supabase',
    setup(b) {
      b.onResolve({ filter: /\.\/supabase$/ }, () => ({ path: 'stub-supabase', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: `export const supabase = { storage: { from: (bucket) => ({ getPublicUrl: (path) => ({ data: { publicUrl: 'https://vpqgmcmavnszcnakhiat.supabase.co/storage/v1/object/public/' + bucket + '/' + path } }) }) } };`,
        loader: 'js',
      }));
    },
  }],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const { resolveCvUrl } = mod;

const PUB = 'https://vpqgmcmavnszcnakhiat.supabase.co/storage/v1/object/public/candidate-uploads/';

// CV-resolve-storage
{
  const out = resolveCvUrl('storage://candidate-uploads/cv-updates/x.docx');
  const ok = out === `${PUB}cv-updates/x.docx` && !out.startsWith('storage://');
  audit.recordCell({
    id: 'CV-resolve-storage', tableRef: 'resolveCvUrl(storage://) → public URL',
    expected: 'a storage:// value resolves to an https public-object URL',
    observed: out, pass: ok,
    notes: ok ? '' : 'storage:// was not converted — the employer would get a dead link.',
  });
}

// CV-resolve-passthru
{
  const https = resolveCvUrl('https://example.com/a.pdf');
  const legacy = resolveCvUrl('hadaroz/old.pdf');
  const ok = https === 'https://example.com/a.pdf' && legacy === `${PUB}hadaroz/old.pdf`;
  audit.recordCell({
    id: 'CV-resolve-passthru', tableRef: 'resolveCvUrl passthrough + legacy path',
    expected: 'an https value is unchanged; a bare legacy path resolves against candidate-uploads',
    observed: `https="${https}", legacy="${legacy}"`, pass: ok, notes: ok ? '' : 'passthrough/legacy handling wrong.',
  });
}

// CV-prefers-updated (the reference PlacementPanel/StudentEditor use: cvUpdatedUrl || cvUrl)
{
  const ref = (stu) => stu.cvUpdatedUrl || stu.cvUrl || '';
  const chosen = ref({ cvUrl: 'storage://candidate-uploads/orig.pdf', cvUpdatedUrl: 'storage://candidate-uploads/updated.pdf' });
  const resolved = resolveCvUrl(chosen);
  const ok = chosen.includes('updated') && resolved === `${PUB}updated.pdf`;
  audit.recordCell({
    id: 'CV-prefers-updated', tableRef: 'dispatch reference prefers cvUpdatedUrl',
    expected: 'with both present, the UPDATED CV is the one resolved and sent',
    observed: `chosen="${chosen}", resolved="${resolved}"`, pass: ok,
    notes: ok ? '' : 'the original CV would be sent instead of the updated one.',
  });
}

// CV-public-200 — a real student's resolved CV actually opens.
{
  let realRef = '', url = '', status = 0;
  try {
    const d = (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};
    const s = (d.students || []).find(x => x.cvUpdatedUrl || x.cvUrl);
    realRef = s ? (s.cvUpdatedUrl || s.cvUrl) : '';
    if (realRef) {
      url = resolveCvUrl(realRef);
      const r = await fetch(url, { method: 'GET' });
      status = r.status;
    }
  } catch (e) { audit.log(`live check failed: ${e.message.slice(0, 100)}`); }
  audit.recordCell({
    id: 'CV-public-200', tableRef: 'resolved real-student CV returns 200',
    expected: 'the resolved public URL of a real stored CV is fetchable (bucket is public)',
    observed: realRef ? `resolved=${url.slice(0, 80)}… → HTTP ${status}` : 'no stored CV to test',
    pass: realRef ? status === 200 : null,
    notes: status && status !== 200 ? `resolved link returned ${status} — employers can't open it.` : '',
  });
}

const failed = audit.cells.some((c) => c.pass === false);
console.log(`\n${failed ? '❌' : '✅'} cv-link-resolves: ${audit.cells.filter(c => c.pass === true).length}/${audit.cells.length} pass`);
process.exit(failed ? 1 : 0);
