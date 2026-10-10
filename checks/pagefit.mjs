/* Every .page box must have zero overflow, and page 2 of a two-page CV must be full enough to justify existing. */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
const CANDIDATES=[process.env.CHROME_PATH,'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const exe=CANDIDATES.find(p=>{try{return fs.existsSync(p)}catch{return false}});
const DOC=path.resolve(process.argv[2] ?? 'templates/us-letter.html');

const b=await chromium.launch({executablePath:exe});
const p=await b.newPage({viewport:{width:1000,height:1400}});
await p.goto(pathToFileURL(DOC).href,{waitUntil:'networkidle'});
await p.evaluate(()=>document.fonts.ready);
const r=await p.evaluate(()=>{
  const out=[];
  document.querySelectorAll('.page').forEach((pg,i)=>{
    const cs=getComputedStyle(pg);
    const padT=parseFloat(cs.paddingTop), padB=parseFloat(cs.paddingBottom);
    const usable=pg.getBoundingClientRect().height-padT-padB;
    // absolutely positioned furniture (.page-mark) is out of the flow and would peg every page at 100%
    const kids=[...pg.children].filter(el=>{
      const pos=getComputedStyle(el).position;
      return pos!=='absolute' && pos!=='fixed';
    });
    const top=kids[0].getBoundingClientRect().top;
    const bottom=kids[kids.length-1].getBoundingClientRect().bottom;
    const used=bottom-top;
    out.push({page:i+1, usable:+usable.toFixed(1), used:+used.toFixed(1),
      slack:+(usable-used).toFixed(1), fill:+(100*used/usable).toFixed(1),
      overflow:pg.scrollHeight-pg.clientHeight});
  });
  return out;
});
await b.close();
const LINE=18.41;
let bad=0;
for(const o of r){
  const flags=[];
  if(o.overflow>0){flags.push('OVERFLOW'); bad++;}
  if(o.fill>100){flags.push('OVER 100%'); bad++;}
  if(r.length>1 && o.page===r.length && o.fill<60) {flags.push('page too empty: pull back to one page or add content'); bad++;}
  if(o.fill>96 && o.overflow===0) flags.push('above the 88–96% band');
  console.log(`page ${o.page}: ${o.fill}% fill · ${o.used}/${o.usable}px · slack ${o.slack}px (${(o.slack/LINE).toFixed(1)} body lines) · overflow ${o.overflow}px`
    + (flags.length?'  ← '+flags.join(' · '):''));
}
console.log(bad? `\n${bad} problem(s).` : '\nAll pages fit.');
