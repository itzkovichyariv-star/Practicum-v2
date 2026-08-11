#!/usr/bin/env node
/**
 * 59-org-contact-from-list.mjs — from the STUDENTS LIST, the coordinator can contact
 * the hosting ORG (employer), not just the student.
 *
 *   ORGCONTACT-list  A placed student's row shows, next to the org name, a WhatsApp
 *                    and a mail icon that reach the EMPLOYER — WhatsApp opens wa.me
 *                    with the employer's phone (972-normalised), mail opens a mailto
 *                    to the employer's address. Distinct from the student-contact icons.
 *
 * Yariv 2026-07-22: "in the student view … add a whatsapp/mail … so from the students
 * page I can approach the org." Resolved fuzzily from acceptedOrg → employer.
 *
 * Seeds a temp placed student + a temp employer (with phone+email); removes both.
 */
import { Audit, sbQuery, appReady } from '../audit-lib.mjs';

const SB='https://vpqgmcmavnszcnakhiat.supabase.co', ANON='sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H={apikey:ANON,Authorization:`Bearer ${ANON}`,'Content-Type':'application/json'};
const readRow=async()=>(await (await fetch(`${SB}/rest/v1/practicum_data?org_id=eq.default&select=data,version`,{headers:H})).json())[0];
const writeData=async(data,version)=>{const r=await fetch(`${SB}/rest/v1/practicum_data?org_id=eq.default&version=eq.${version}`,{method:'PATCH',headers:{...H,Prefer:'return=representation'},body:JSON.stringify({data,version:version+1,updated_at:new Date().toISOString()})});const j=await r.json().catch(()=>null);return Array.isArray(j)&&j.length>0;};

const ts=Date.now();
const EMP_ID=`zoc-emp-${ts}`, EMP_NAME=`ארגון קשר ${ts}`, EMP_PHONE='0501112222', EMP_EMAIL='org-contact@audit.local';
const STU_ID=`zoc-${ts.toString(36).slice(-5)}`, STU_NAME=`קשר ארגון ${ts}`;

let seedOk=false, courseId='';
for(let i=0;i<6&&!seedOk;i++){try{
  const row=await readRow(); const d=row.data;
  courseId=((d.courses||[]).find(c=>c?.type==='practicum')||(d.courses||[])[0])?.id||'';
  const emp={id:EMP_ID,name:EMP_NAME,approvalStatus:'approved',contactStatus:'approved',addedBy:'admin',courseIds:[courseId],positionsTotal:1,contactPhone:EMP_PHONE,contactEmail:EMP_EMAIL,vacancySlots:[]};
  const stu={id:STU_ID,name:STU_NAME,email:`${STU_ID}@audit.local`,phone:'0539999999',courseId,acceptedOrg:EMP_NAME,submissionStatus:'placed',placedAt:'2026-07-01'};
  seedOk=await writeData({...d,employers:[...(d.employers||[]).filter(e=>e.id!==EMP_ID),emp],students:[...(d.students||[]).filter(s=>s.id!==STU_ID),stu]},row.version);
}catch(e){console.log(`seed ${i}: ${e.message.slice(0,80)}`);}}

const audit=new Audit({name:'org-contact-from-list'});
await audit.setup();
await audit.page.evaluate(({c})=>{localStorage.setItem('practicum_v2_context',JSON.stringify({courseId:c||'__all__',year:'__all__'}));localStorage.setItem('practicum_v2_page','students');},{c:courseId});
await audit.page.reload({waitUntil:'networkidle'});
await appReady(audit.page);
await audit.page.waitForTimeout(1200);

let callSeen=false, waSeen=false, mailSeen=false, waUrl='', mailUsedEmployer=false;
if(seedOk){
  // filter to our student
  const search=audit.page.locator('input[type="search"]').first();
  await search.fill(STU_NAME).catch(()=>{});
  await audit.page.waitForTimeout(800);
  const callBtn=audit.page.locator(`button[title="התקשר לארגון ${EMP_NAME}"]`).first();
  const waBtn=audit.page.locator(`button[title="WhatsApp לארגון ${EMP_NAME}"]`).first();
  const mailBtn=audit.page.locator(`button[title="מייל לארגון ${EMP_NAME}"]`).first();
  callSeen=(await callBtn.count())>0;
  waSeen=(await waBtn.count())>0;
  mailSeen=(await mailBtn.count())>0;
  if(waSeen){
    // capture the wa.me popup URL
    audit.page.context().on('page',p=>{ try{ waUrl=p.url(); }catch(e){} p.close().catch(()=>{}); });
    await audit.page.evaluate(()=>{ const _o=window.open; window.__lastOpen=''; window.open=(u)=>{window.__lastOpen=u; return null;}; });
    await waBtn.click().catch(()=>{});
    await audit.page.waitForTimeout(400);
    waUrl=await audit.page.evaluate(()=>window.__lastOpen||'');
  }
  // employer phone 0501112222 → 972501112222
  mailUsedEmployer = waUrl.includes('972501112222');
}

const shot=await audit.shot('org-contact-from-list');
audit.recordCell({
  id:'ORGCONTACT-list',
  tableRef:'StudentsPage StudentRow — org-contact (WhatsApp/mail to employer)',
  expected:'a placed student\'s list row shows the org chip with call + WhatsApp + mail reaching the hosting EMPLOYER; WhatsApp opens wa.me with the employer\'s 972-normalised phone (phone added for orgs without WA)',
  observed: seedOk?`callIcon=${callSeen}, waIcon=${waSeen}, mailIcon=${mailSeen}, waUrl="${waUrl.slice(0,48)}", usesEmployerPhone=${mailUsedEmployer}`:'seed failed',
  pass: seedOk?(callSeen&&waSeen&&mailSeen&&mailUsedEmployer):null,
  after:shot,
  notes:!callSeen?'No org-call (phone) icon — orgs without WhatsApp cannot be reached.':!waSeen?'No org-WhatsApp icon on the placed row.':!mailSeen?'No org-mail icon.':!mailUsedEmployer?`WhatsApp did not target the employer phone (url=${waUrl}).`:'',
});

// cleanup
let cleaned=false;
for(let i=0;i<6&&!cleaned;i++){try{const row=await readRow();cleaned=await writeData({...row.data,students:(row.data.students||[]).filter(s=>s.id!==STU_ID),employers:(row.data.employers||[]).filter(e=>e.id!==EMP_ID)},row.version);}catch(e){audit.log(`cleanup ${i}: ${e.message.slice(0,80)}`);}}
audit.log(cleaned?'Cleanup: removed temp student + employer':'⚠ Cleanup FAILED.');

await audit.teardown();
process.exit(audit.cells.some(c=>c.pass===false)?1:0);
