/** Functional sweep: every interactive control in the placement flow, on the live site.
 *  Read-only — opens things and closes them; confirms nothing. */
import { Audit, appReady } from '/Users/yarivitzkovich/Code/practicum-v2/scripts/audit-lib.mjs';
const audit = new Audit({ name: 'sweep' });
const errs = [];
await audit.setup();
audit.page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

for (const vp of [{ width: 375, height: 812, tag: 'phone' }, { width: 1400, height: 900, tag: 'desktop' }]) {
  await audit.page.setViewportSize({ width: vp.width, height: vp.height });
  await audit.page.evaluate(() => {
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr-practicum-tashpaz', year: 'תשפ״ז' }));
    localStorage.setItem('practicum_v2_page', 'students');
  });
  await audit.page.reload({ waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1800);

  const r = await audit.page.evaluate(async () => {
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    const out = {};
    out.strips = document.querySelectorAll('[data-placement-strip]').length;
    out.rowsWithoutStrip = [...document.querySelectorAll('li')].filter(li =>
      li.querySelector('.serif') && li.querySelector('[title="ערוך"]') && !li.querySelector('[data-placement-strip]')).length;

    // Rows collapse by default since v1.37, so the chips — and the ⓘ beside each — are
    // not in the DOM until a row is opened. Without this the probe found nothing and
    // reported "0/0" as a FAILURE, which reads like the feature is gone when it was
    // simply never asked for.
    for (const b of document.querySelectorAll('[data-strip-expand="closed"]')) click(b);
    await new Promise(r => setTimeout(r, 400));

    // every ⓘ opens employer details
    let infoOk = 0, infoTotal = 0;
    for (const info of [...document.querySelectorAll('[data-org-info]')].slice(0, 4)) {
      infoTotal++; click(info); await new Promise(r => setTimeout(r, 260));
      const pop = document.querySelector('[data-employer-details]');
      if (pop && pop.innerText.trim().length > 12) infoOk++;
      if (pop) click(info);
      await new Promise(r => setTimeout(r, 160));
    }
    out.info = `${infoOk}/${infoTotal}`;

    // every action button opens its confirmation, and cancels cleanly
    let actOk = 0, actTotal = 0, actNames = [];
    for (const btn of [...document.querySelectorAll('[data-strip-action]')].slice(0, 4)) {
      actTotal++; actNames.push(btn.getAttribute('data-strip-action'));
      click(btn); await new Promise(r => setTimeout(r, 300));
      const dlg = document.querySelector('[data-placement-confirm]');
      if (dlg) {
        actOk++;
        const cancel = [...dlg.querySelectorAll('button')].find(b => b.textContent.trim() === 'ביטול');
        if (cancel) click(cancel);
      }
      await new Promise(r => setTimeout(r, 250));
    }
    out.actions = `${actOk}/${actTotal}`;
    out.actionKinds = [...new Set(actNames)].join(',') || '(none on screen)';
    out.dialogLeftOpen = !!document.querySelector('[data-placement-confirm]');

    // turn filter narrows and restores
    const before = document.querySelectorAll('[data-placement-strip]').length;
    // How many rows are in that turn to begin with. When nobody is, the filter correctly
    // shows an empty list and there is nothing to narrow — reporting that as FAIL reads as
    // a broken filter when the truth is a calm board. (Same defect as the ⓘ probe above,
    // which reported 0/0 and looked like a missing feature — Yariv 2026-08-11.)
    const oursCount = [...document.querySelectorAll('[data-placement-strip]')]
      .filter(s => s.getAttribute('data-turn') === 'ours').length;
    const ours = document.querySelector('[data-turn-filter="ours"]');
    if (ours && oursCount) { click(ours); await new Promise(r => setTimeout(r, 350)); }
    const filtered = oursCount
      ? [...document.querySelectorAll('[data-placement-strip]')].map(s => s.getAttribute('data-turn'))
      : [];
    const all = document.querySelector('[data-turn-filter="all"]');
    if (all) { click(all); await new Promise(r => setTimeout(r, 350)); }
    const after = document.querySelectorAll('[data-placement-strip]').length;
    out.filter = !oursCount ? 'n/a — nobody is in the ours turn right now'
      : (filtered.length && filtered.every(t => t === 'ours') ? `ok (${filtered.length} ours)` : `FAIL [${[...new Set(filtered)].join(',')}]`);
    out.filterRestores = before === after ? `ok (${after})` : `FAIL ${before}→${after}`;

    // chips never escape their strip
    let worst = 0;
    for (const st of document.querySelectorAll('[data-placement-strip]')) {
      const cs = getComputedStyle(st), b = st.getBoundingClientRect();
      const L = b.left + parseFloat(cs.paddingLeft), R = b.right - parseFloat(cs.paddingRight);
      for (const c of st.querySelectorAll('[data-org-chip]')) {
        const cr = c.getBoundingClientRect();
        worst = Math.max(worst, L - cr.left, cr.right - R);
      }
    }
    out.chipOverflow = `${worst.toFixed(1)}px`;
    out.sideScroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;

    // rank order is never reordered
    let orderOk = true;
    for (const st of document.querySelectorAll('[data-placement-strip]')) {
      const ranks = [...st.querySelectorAll('[data-org-chip] span[aria-label^="בחירה"]')].map(x => +x.textContent);
      if (ranks.length > 1 && ranks.some((v, i) => i && v < ranks[i - 1])) orderOk = false;
    }
    out.rankOrder = orderOk ? 'ok' : 'FAIL — out of order';
    return out;
  });

  check(`[${vp.tag}] strips render`, r.strips > 0, `${r.strips} strips, ${r.rowsWithoutStrip} practicum rows without one`);
  check(`[${vp.tag}] ⓘ opens employer details`, r.info.split('/')[0] === r.info.split('/')[1] && r.info !== '0/0', r.info);
  check(`[${vp.tag}] action opens its confirmation`, r.actions.split('/')[0] === r.actions.split('/')[1], `${r.actions} · kinds: ${r.actionKinds}`);
  check(`[${vp.tag}] cancel closes the dialog`, !r.dialogLeftOpen, r.dialogLeftOpen ? 'left open' : 'closed');
  check(`[${vp.tag}] turn filter narrows`, r.filter.startsWith('ok') || r.filter.startsWith('n/a'), r.filter);
  check(`[${vp.tag}] filter restores`, r.filterRestores.startsWith('ok'), r.filterRestores);
  check(`[${vp.tag}] chips inside the box`, parseFloat(r.chipOverflow) <= 0.5, r.chipOverflow);
  check(`[${vp.tag}] no sideways scroll`, r.sideScroll <= 0, `${r.sideScroll}px`);
  check(`[${vp.tag}] ranking order kept`, r.rankOrder === 'ok', r.rankOrder);
}

// employers screen
await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'employers'));
await audit.page.reload({ waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1600);
const e = await audit.page.evaluate(() => ({
  rows: document.querySelectorAll('[data-employer-explain]').length,
  empty: [...document.querySelectorAll('[data-employer-explain]')].filter(x => (x.textContent || '').trim().length < 8).length,
}));
check('[employers] every row explains itself', e.rows > 0 && e.empty === 0, `${e.rows} rows, ${e.empty} empty`);
check('no uncaught page errors', errs.length === 0, errs.length ? errs.join(' | ') : 'none');

const pass = results.filter(r => r.ok).length;
console.log('\n══ FUNCTIONAL SWEEP — PRODUCTION ══');
for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(42)} ${r.detail}`);
console.log(`\n${pass}/${results.length} checks passed`);
await audit.teardown();
