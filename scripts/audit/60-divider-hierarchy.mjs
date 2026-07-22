#!/usr/bin/env node
/**
 * 60-divider-hierarchy.mjs — on the STUDENTS LIST, the two dividers form a clear hierarchy.
 *
 *   DIVIDER-hierarchy  The line between two students (the row separator) is the PRIMARY
 *                      divider — thicker (2px) and on the stronger --divider-strong token —
 *                      while the student↔org split WITHIN a card is SECONDARY: a thin (1px),
 *                      lighter (--divider) hairline, inset from the card's top/bottom edges.
 *                      The card-open (edit) icon keeps clearance from that hairline (does not
 *                      sit on it).
 *
 * Yariv 2026-07-22: "thicken the separator a bit, but MORE the line between 2 students, so
 * it's clear the student↔org split is secondary" + "the edit icon must not step on the line."
 *
 * Regression trap this guards: a global `.border-b { border-color: var(--divider) !important }`
 * rule pins any `border-b` element to the WEAK token. The row separator must therefore set its
 * border inline (no `border-b` class) — if someone re-adds the class, the primary divider
 * silently drops back to the weak colour. This cell fails if that happens.
 *
 * Seeds a temp placed student + employer; removes both.
 */
import { Audit } from '../audit-lib.mjs';

const SB='https://vpqgmcmavnszcnakhiat.supabase.co', ANON='sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H={apikey:ANON,Authorization:`Bearer ${ANON}`,'Content-Type':'application/json'};
const readRow=async()=>(await (await fetch(`${SB}/rest/v1/practicum_data?org_id=eq.default&select=data,version`,{headers:H})).json())[0];
const writeData=async(data,version)=>{const r=await fetch(`${SB}/rest/v1/practicum_data?org_id=eq.default&version=eq.${version}`,{method:'PATCH',headers:{...H,Prefer:'return=representation'},body:JSON.stringify({data,version:version+1,updated_at:new Date().toISOString()})});const j=await r.json().catch(()=>null);return Array.isArray(j)&&j.length>0;};

const ts=Date.now();
const EMP_ID=`zdv-emp-${ts}`, EMP_NAME=`ארגון קו ${ts}`;
const STU_ID=`zdv-${ts.toString(36).slice(-5)}`, STU_NAME=`קו הפרדה ${ts}`;

let seedOk=false, courseId='';
for(let i=0;i<6&&!seedOk;i++){try{
  const row=await readRow(); const d=row.data;
  courseId=((d.courses||[]).find(c=>c?.type==='practicum')||(d.courses||[])[0])?.id||'';
  const emp={id:EMP_ID,name:EMP_NAME,approvalStatus:'approved',contactStatus:'approved',addedBy:'admin',courseIds:[courseId],positionsTotal:1,contactPhone:'0501112222',contactEmail:'org@audit.local',vacancySlots:[]};
  const stu={id:STU_ID,name:STU_NAME,email:`${STU_ID}@audit.local`,phone:'0539999999',courseId,acceptedOrg:EMP_NAME,submissionStatus:'placed',placedAt:'2026-07-01'};
  seedOk=await writeData({...d,employers:[...(d.employers||[]).filter(e=>e.id!==EMP_ID),emp],students:[...(d.students||[]).filter(s=>s.id!==STU_ID),stu]},row.version);
}catch(e){console.log(`seed ${i}: ${e.message.slice(0,80)}`);}}

const audit=new Audit({name:'divider-hierarchy'});
await audit.setup();
await audit.page.setViewportSize({width:390,height:844}); // the user's device
await audit.page.evaluate(({c})=>{localStorage.setItem('practicum_v2_context',JSON.stringify({courseId:c||'__all__',year:'__all__'}));localStorage.setItem('practicum_v2_page','students');},{c:courseId});
await audit.page.reload({waitUntil:'networkidle'});
await audit.page.waitForTimeout(1200);

let geo={};
if(seedOk){
  const search=audit.page.locator('input[type="search"]').first();
  await search.fill(STU_NAME).catch(()=>{});
  await audit.page.waitForTimeout(800);
  geo=await audit.page.evaluate(()=>{
    const placed=[...document.querySelectorAll('[data-info-row]')].find(li=>li.querySelector('button[title="ערוך"]') && li.querySelector('span.font-semibold'));
    if(!placed) return {error:'no placed row'};
    placed.scrollIntoView({block:'center'});
    const wrap=placed.querySelector(':scope > div');
    const flex=wrap.querySelector('div.flex.items-stretch');
    const vdiv=[...flex.children].find(k=>{const r=k.getBoundingClientRect(); return r.width>0&&r.width<3;});
    const edit=placed.querySelector('button[title="ערוך"]');
    if(!vdiv||!edit) return {error:'divider/edit not found'};
    const rV=vdiv.getBoundingClientRect(), rE=edit.getBoundingClientRect(), rF=flex.getBoundingClientRect();
    const csW=getComputedStyle(wrap), csV=getComputedStyle(vdiv), csE=getComputedStyle(edit);
    const alpha=s=>{const m=/rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(s||''); return m?parseFloat(m[1]):(s&&s.includes('rgb')?1:0);};
    // the open-card (edit) pencil must be BARE (no capsule border/fill) and live in the tag
    // block, not the bottom contact row — so that row mirrors the org's call/WhatsApp/mail.
    const contactRow=[...placed.querySelectorAll('div')].find(d=>d.className.includes('mt-auto')&&d.querySelector('button[title^="התקשר"],button[title^="WhatsApp"],button[title^="מייל"]'));
    const editInContactRow=!!(contactRow&&[...contactRow.querySelectorAll('button')].some(b=>b.getAttribute('title')==='ערוך'));
    return {
      hWidthPx: parseFloat(csW.borderBottomWidth),
      hAlpha: alpha(csW.borderBottomColor),
      vWidthPx: parseFloat(csV.width),
      vAlpha: alpha(csV.backgroundColor),
      vInsetTop:+(rV.top-rF.top).toFixed(1), vInsetBottom:+(rF.bottom-rV.bottom).toFixed(1),
      editClearance:+(rE.left-rV.right).toFixed(1),
      hasBorderBClass: wrap.classList.contains('border-b'),
      editBare: (csE.borderStyle==='none'||parseFloat(csE.borderTopWidth)===0) && (csE.backgroundColor==='rgba(0, 0, 0, 0)'||csE.backgroundColor==='transparent'),
      editInContactRow,
      // in the tag block = the pencil's parent row also holds the flex-wrap tags container
      editInTagBlock: !!edit.parentElement?.querySelector('.flex-wrap'),
    };
  });
}

// The between-students line must be strictly heavier than the within-card hairline:
//   thicker (≥2px vs ~1px) AND more opaque (strong token 0.42 vs weak 0.18), and NOT via
//   the border-b class (which the !important rule would pin to the weak token).
const hPrimary  = geo.hWidthPx>=2 && geo.hAlpha>0.3 && geo.hasBorderBClass===false;
const vSecondary= geo.vWidthPx>0 && geo.vWidthPx<geo.hWidthPx && geo.vAlpha<0.25 && geo.vInsetTop>=2 && geo.vInsetBottom>=2;
// The open-card (edit) pencil: BARE (no capsule), in the tag block (not the contact row so that
// row mirrors the org's), and clear of — never crossing — the student↔org hairline.
const editClear = geo.editClearance>=8;
const editPencil= geo.editBare===true && geo.editInContactRow===false && geo.editInTagBlock===true;
const pass = seedOk ? (hPrimary && vSecondary && editClear && editPencil) : null;

const shot=await audit.shot('divider-hierarchy');
audit.recordCell({
  id:'DIVIDER-hierarchy',
  tableRef:'StudentsPage StudentRow — divider weights + bare-pencil edit placement',
  expected:'row separator (between students) is PRIMARY: ≥2px, strong token (α≈0.42), NOT the border-b class; student↔org split is SECONDARY: thinner (1px), lighter (α≈0.18), inset ≥2px top/bottom; open-card pencil is BARE (no capsule), sits in the tag block (not the contact row), and stays ≥8px clear of the hairline',
  observed: seedOk?`H=${geo.hWidthPx}px α${geo.hAlpha} borderBClass=${geo.hasBorderBClass} | V=${geo.vWidthPx}px α${geo.vAlpha} inset(${geo.vInsetTop}/${geo.vInsetBottom}) | editClear=${geo.editClearance}px bare=${geo.editBare} inContactRow=${geo.editInContactRow} inTagBlock=${geo.editInTagBlock}${geo.error?' ERR:'+geo.error:''}`:'seed failed',
  pass,
  after:shot,
  notes: pass===false?(!hPrimary?'Row separator is NOT the strong primary divider (thin/weak or still using the border-b class the !important rule pins to --divider).':!vSecondary?'Student↔org hairline is not clearly secondary (too thick/opaque or not inset).':!editClear?'Edit pencil sits on/too close to the student↔org hairline.':!editPencil?'Open-card control is not a bare pencil in the tag block (still a capsule, or back in the contact row).':''):'',
});

// cleanup
let cleaned=false;
for(let i=0;i<6&&!cleaned;i++){try{const row=await readRow();cleaned=await writeData({...row.data,students:(row.data.students||[]).filter(s=>s.id!==STU_ID),employers:(row.data.employers||[]).filter(e=>e.id!==EMP_ID)},row.version);}catch(e){audit.log(`cleanup ${i}: ${e.message.slice(0,80)}`);}}
audit.log(cleaned?'Cleanup: removed temp student + employer':'⚠ Cleanup FAILED.');

await audit.teardown();
process.exit(audit.cells.some(c=>c.pass===false)?1:0);
