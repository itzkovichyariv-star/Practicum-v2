// Reproduce: click a row action from the OUTER card and see what actually happens.
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'he-IL' });
const p = await ctx.newPage();
p.on('console', m => { if (m.type() === 'error') console.log('  CONSOLE ERROR:', m.text().slice(0, 140)); });
p.on('pageerror', e => console.log('  PAGE ERROR:', e.message.slice(0, 140)));
await p.goto('http://localhost:4325/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => {
  localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב בדיקה', email: 'yarivi@ariel.ac.il' } }));
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr-practicum-tashpaz', year: 'תשפ״ז' }));
  localStorage.setItem('practicum_v2_page', 'students');
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('[data-placement-strip]', { timeout: 25000 });
await p.waitForTimeout(1200);

// open every collapsed strip
await p.evaluate(() => document.querySelectorAll('[data-strip-expand="closed"]').forEach(b => b.click()));
await p.waitForTimeout(600);

const inventory = await p.evaluate(() => [...document.querySelectorAll('[data-placement-strip]')].map(s => ({
  state: s.getAttribute('data-placement-strip'),
  name: s.closest('li')?.querySelector('.serif')?.textContent?.trim().slice(0, 22) || '?',
  actions: [...s.querySelectorAll('[data-strip-action]')].map(b => b.getAttribute('data-strip-action')),
})).filter(x => x.actions.length));
console.log('rows with actions:');
inventory.forEach(r => console.log(`  ${r.name} · ${r.state} → [${r.actions}]`));

// click the first place_direct we can find, from the ROW
const target = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('[data-strip-action="place_direct"]')][0];
  if (!btn) return null;
  const li = btn.closest('li');
  btn.click();
  return li?.querySelector('.serif')?.textContent?.trim().slice(0, 22) || '?';
});
console.log('\nclicked place_direct on:', target);
await p.waitForTimeout(900);
const afterClick = await p.evaluate(() => ({
  confirmOpen: !!document.querySelector('[data-placement-confirm]'),
  confirmFor: document.querySelector('[data-placement-confirm]')?.getAttribute('data-placement-confirm') || null,
  confirmText: document.querySelector('[data-placement-confirm]')?.innerText.replace(/\s+/g, ' ').slice(0, 130) || '',
}));
console.log('after click →', JSON.stringify(afterClick));

if (afterClick.confirmOpen) {
  await p.evaluate(() => document.querySelector('[data-confirm-go]')?.click());
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => ({
    editorOpen: !!document.querySelector('button[aria-label="סגור"]'),
    toast: [...document.querySelectorAll('div')].map(d => d.textContent || '')
      .filter(t => /נשמר|שגיאה|לא נשלח/.test(t)).slice(-1)[0]?.replace(/\s+/g, ' ').slice(0, 80) || '(none)',
    stillConfirm: !!document.querySelector('[data-placement-confirm]'),
  }));
  console.log('after confirm →', JSON.stringify(after));
}
await p.screenshot({ path: '/private/tmp/claude-501/-Users-yarivitzkovich-Code-family-tasks/af30e257-39b3-4752-924d-24c6f88da363/scratchpad/repro.png' });
await b.close();
