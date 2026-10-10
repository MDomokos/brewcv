import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
const DOC  = path.resolve(process.argv[2] ?? 'templates/us-letter.html');
const MOCK = path.resolve(process.argv[3] ?? 'b2-mockup-reference.html');
import fs from 'fs';
import { withIdentity } from '../scripts/lib/identity.mjs';
const CANDIDATES=[process.env.CHROME_PATH,'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const exe=CANDIDATES.find(p=>{try{return fs.existsSync(p)}catch{return false}});
const b=await chromium.launch({executablePath:exe});

async function probe(src, rootSel){
  const p=await b.newPage({viewport:{width:900,height:1300}});
  await p.goto(pathToFileURL(src).href,{waitUntil:'networkidle'});
  await p.evaluate(()=>document.fonts.ready);
  const data = await p.evaluate(rs=>{
    const root=document.querySelector(rs);
    const rr=root.getBoundingClientRect();
    const out=[];
    const walk=el=>{
      for(const c of el.children){
        const hasBlockKid=[...c.children].some(k=>getComputedStyle(k).display!=='inline'&&k.tagName!=='BR'&&k.tagName!=='SPAN'&&k.tagName!=='A');
        if(!hasBlockKid){
          const t=(c.innerText||'').replace(/\s+/g,' ').trim();
          if(t){ const r=c.getBoundingClientRect();
            out.push({t:t.slice(0,44), x:+(r.x-rr.x).toFixed(2), y:+(r.y-rr.y).toFixed(2), w:+r.width.toFixed(2), h:+r.height.toFixed(2)}); }
        } else walk(c);
      }
    };
    walk(root);
    // also the marker swipe
    const nm=document.querySelector('.namemark, .col > div[style*="position: relative"]');
    let swipe=null;
    if(nm){ const cs=getComputedStyle(nm,'::before');
      swipe={left:cs.left,right:cs.right,bottom:cs.bottom,height:cs.height,transform:cs.transform,bg:cs.backgroundColor}; }
    return {out, swipe, contentH: root.scrollHeight};
  }, rootSel);
  await p.close();
  return data;
}

// The reference is either a mockup (.sheet > div) or another document from this repo (.page).
const A = await withIdentity(DOC, f => probe(f,'.page'));
const B = await withIdentity(MOCK, f => probe(f, /<div class="sheet"/.test(fs.readFileSync(f,'utf8')) ? '.sheet > div' : '.page'));

const key=s=>s.replace(/\s+/g,'').toLowerCase().slice(0,30);
let maxdx=0, unmatched=0;
const bmap=new Map(B.out.map(o=>[key(o.t),o]));
console.log('dx    dy    dw    dh   | text');
let maxdy=0;
for(const a of A.out){
  const m=bmap.get(key(a.t));
  if(!m){ console.log('  (no match in reference)          |', a.t); unmatched++; continue; }
  const d=[a.x-m.x,a.y-m.y,a.w-m.w,a.h-m.h].map(v=>(+v.toFixed(2)).toString().padStart(6));
  maxdy=Math.max(maxdy,Math.abs(a.y-m.y));
  maxdx=Math.max(maxdx,Math.abs(a.x-m.x));
  console.log(d.join(''),'| ',a.t);
}
console.log(`\nmax |dx| = ${maxdx.toFixed(2)}px   max |dy| = ${maxdy.toFixed(2)}px   ${A.out.length} blocks, ${unmatched} unmatched`);
console.log(maxdx===0 && maxdy===0 && !unmatched
  ? 'geometry: identical, 0.00px in both axes.'
  : 'geometry: NOT identical.');
console.log('\nmine swipe  :', JSON.stringify(A.swipe));
console.log('mockup swipe:', JSON.stringify(B.swipe));
await b.close();
