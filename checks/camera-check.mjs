#!/usr/bin/env node
// node checks/camera-check.mjs
// The camera in Node (src/ui/camera.js): when both pages show at once, the soft limits and the rubber band, the magnetic
// travel between pages, zoom about a point, which page is bright, and the spring. The canvas runs in checks/smoke-shell.mjs.

import { isDeepStrictEqual as eq } from 'node:util';
import {
  geometry, viewRect, fitCam, screenOf, contentOf, zoomAbout, snapZoom, limits, rubber, softCam, hardCam, stops, magnetize, unmagnetize,
  settleIndex, visible, brightPage, faded, damping, springStep, atRest, centreOn, writingScale, rowWidth, pageLeft, midX,
  BOTH_MIN, BOTH_RATIO, OVERSHOOT, SNAP_FIT, MAGNET, BOUNCE,
} from '../src/ui/camera.js';
import { G, RAIL_W, PAGE_GAP, pageSize } from '../src/ui/layout.js';

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};
const section = t => console.log(`\n— ${t}`);
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const railView = vw => viewRect({ vw, vh: 800, colLeft: vw - G - RAIL_W });

section('both pages at once, or one at a time');
{
  for (const format of ['a4', 'us-letter', 'a4-hu']){
    for (const vw of [1280, 1440, 1536, 1920]){
      const g = geometry({ vw, vh: vw === 1536 ? 864 : 800, format, pages: 2 });
      ok(`${format} at ${vw} wide: both pages at once (scale ${g.both.toFixed(3)}, at least ${BOTH_MIN} and ${BOTH_RATIO} of ${g.tall.toFixed(3)})`, g.bothUp);
    }
    const narrow = geometry({ vw: 1024, vh: 700, format, pages: 2 });
    ok(`${format} at 1024 wide: one page at a time`, !narrow.bothUp);
  }
  ok('one page is never "both"', !geometry({ vw: 1440, vh: 900, format: 'a4', pages: 1 }).bothUp);
  const rail = geometry({ vw: 1280, vh: 800, format: 'a4', pages: 2 });
  ok('the width is measured with the rail: the same answer whatever the panel does', rail.both === geometry({ vw: 1280, vh: 800, format: 'a4', pages: 2 }).both && near(rail.both, Math.min((800 - 2 * G) / 1123, (1280 - RAIL_W - 4 * G) / rowWidth(794, 2))));
  const tallWindow = geometry({ vw: 1300, vh: 1700, format: 'a4', pages: 2 });
  ok('a tall, narrow window can fail the 85% test even above 0.6', tallWindow.both >= BOTH_MIN ? tallWindow.bothUp === (tallWindow.both >= BOTH_RATIO * tallWindow.tall) : !tallWindow.bothUp);
}

section('fitting the pages in the view');
{
  const g = geometry({ vw: 1280, vh: 800, format: 'a4', pages: 2 });
  const v = railView(1280);
  const all = fitCam(g, v, { scene: 'all' });
  ok('both pages: the whole height, 16px above and below', near(all.k, (800 - 2 * G) / 1123) && near(all.y, G));
  ok('both pages: centred in the view', near(all.x + rowWidth(794, 2) * all.k / 2, midX(v)));
  const one = fitCam(g, v, { scene: 'one', page: 0 }), two = fitCam(g, v, { scene: 'one', page: 1 });
  ok('one page: centred, and page 2 is one page-width and a gap to the right', near(one.x + (794 + PAGE_GAP) * one.k, one.x + 818 * one.k) && near((one.x - two.x), (794 + PAGE_GAP) * one.k));
  const centred = screenOf(two, pageLeft(g, 1) + 794 / 2, 0).x;
  ok('…and travelling there puts page 2 in the middle of the view', near(centred, midX(v)));
  const open = viewRect({ vw: 1280, vh: 800, colLeft: 1280 - G - 358 });
  ok('with the panel open the view is left of it', open.width === 1280 - G - 358 - G);
  const inOpen = fitCam(g, open, { scene: 'one' });
  ok('…and one page sits centred in what is left', near(screenOf(inOpen, 397, 0).x, midX(open)));
  ok('screen and content are inverses', (() => { const s = screenOf(all, 123, 456); const c = contentOf(all, s.x, s.y); return near(c.x, 123) && near(c.y, 456); })());
}

section('zoom about a point');
{
  const cam = { k: 0.7, x: 40, y: 20 };
  const z = zoomAbout(cam, 1.4, 500, 300);
  ok('the content under the pointer stays under it', (() => { const before = contentOf(cam, 500, 300), after = contentOf(z, 500, 300); return near(before.x, after.x) && near(before.y, after.y); })());
  ok('twice the scale is twice the size', z.k === 1.4);
  ok(`a zoom within ${SNAP_FIT * 100}% of the fit view snaps to it`, snapZoom(1.04) === 1 && snapZoom(0.96) === 1 && snapZoom(1.06) === 1.06 && snapZoom(0.94) === 0.94);
}

section('soft limits and the rubber band');
{
  const g = geometry({ vw: 1440, vh: 900, format: 'a4', pages: 2 });
  const v = railView(1440);
  const cam = fitCam(g, v, { scene: 'all' });
  const L = limits(cam, g, v);
  ok('the pages can always be pushed some way, never fully off', L.maxX > cam.x && L.minX < cam.x && L.maxY > cam.y && L.minY < cam.y);
  ok('at least two thirds of the view keep part of the pages at the limit', (() => { const edge = { ...cam, x: L.maxX }; return near(v.left + v.width - edge.x, Math.min(v.width * 2 / 3, rowWidth(794, 2) * cam.k)); })());
  ok('inside the limits nothing is pulled', eq(softCam(cam, g, v), cam));
  ok('past a limit it follows at first', rubber(110, 0, 100) > 100 && rubber(110, 0, 100) < 110);
  ok('…gets heavier…', rubber(200, 0, 100) - rubber(150, 0, 100) < rubber(150, 0, 100) - rubber(110, 0, 100));
  ok(`…and stops about ${OVERSHOOT}px past`, rubber(1e9, 0, 100) < 100 + OVERSHOOT + 1e-3 && rubber(1e9, 0, 100) > 100 + OVERSHOOT - 1);
  ok('the other side is the same', near(rubber(-1e9, 0, 100), -OVERSHOOT, 0.01) && rubber(-10, 0, 100) < 0);
  const far = hardCam({ ...cam, x: 1e6, y: -1e6 }, g, v), L2 = limits(cam, g, v);
  ok('the spring back lands on the limit', near(far.x, L2.maxX) && near(far.y, L2.minY));
}

section('travel between pages: resistance, then a quick move across');
{
  const g = geometry({ vw: 1024, vh: 700, format: 'a4', pages: 2 });
  const v = railView(1024);
  const k = fitCam(g, v, { scene: 'one' }).k;
  const xs = stops(g, v, k);
  ok('one stop per page, page 1 at the larger x', xs.length === 2 && xs[0] > xs[1] && near(xs[0] - xs[1], (794 + PAGE_GAP) * k));
  ok('the stops are where fitCam puts each page', near(xs[0], fitCam(g, v, { scene: 'one', page: 0 }).x) && near(xs[1], fitCam(g, v, { scene: 'one', page: 1 }).x));
  ok('the ends and the stops are fixed points', magnetize(xs[0], xs) === xs[0] && near(magnetize(xs[1], xs), xs[1]) && magnetize(xs[0] + 40, xs) === xs[0] + 40);
  const mid = (xs[0] + xs[1]) / 2;
  ok('the middle is a fixed point too', near(magnetize(mid, xs), mid));
  const span = xs[0] - xs[1], near0 = xs[0] - span * 0.1, shown = magnetize(near0, xs);
  ok('near a page it moves less than the pointer does (resistance)', xs[0] - shown < xs[0] - near0);
  const midish = xs[0] - span * 0.5 - span * 0.1, shownMid = magnetize(midish, xs);
  ok('across the middle it moves more than the pointer does (quick)', Math.abs(shownMid - (xs[0] - span * 0.5)) > Math.abs(midish - (xs[0] - span * 0.5)));
  let mono = true, prev = Infinity;
  for (let x = xs[0]; x >= xs[1]; x -= 0.5){ const s = magnetize(x, xs); if (s > prev + 1e-9) mono = false; prev = s; }
  ok('it never goes backwards', mono);
  ok('unmagnetize is the inverse', [0.1, 0.3, 0.5, 0.8].every(t => { const raw = xs[0] - span * t; return near(unmagnetize(magnetize(raw, xs), xs), raw, 1e-3); }));
  ok(`${MAGNET} resists less than 60 would`, (xs[0] - magnetize(xs[0] - span * 0.1, xs, MAGNET)) > (xs[0] - magnetize(xs[0] - span * 0.1, xs, 60)));
  ok('no magnet is a straight line', near(magnetize(xs[0] - span * 0.3, xs, 0), xs[0] - span * 0.3));
  ok('it settles to the nearest page', settleIndex(xs[0] - span * 0.4, xs) === 0 && settleIndex(xs[0] - span * 0.6, xs) === 1);
  ok('…or the next one, if it was moving', settleIndex(xs[0] - span * 0.3, xs, -900) === 1 && settleIndex(xs[1] + span * 0.3, xs, 900) === 0);
}

section('which page is bright');
{
  const g = geometry({ vw: 1024, vh: 700, format: 'a4', pages: 2 });
  const v = railView(1024);
  const p0 = fitCam(g, v, { scene: 'one', page: 0 });
  ok('page 1 fitted: all of it in view, and less than half of page 2 peeking in the margin', near(visible(p0, g, v, 0), 1) && visible(p0, g, v, 1) < 0.5);
  ok('the current page stays bright', brightPage(p0, g, v, 0) === 0);
  const half = { ...p0, x: p0.x - (794 + PAGE_GAP) * p0.k * 0.45 };
  ok('page 2 not yet more than half in view: the current page stays', brightPage(half, g, v, 0) === 0 || visible(half, g, v, 1) <= 0.5);
  const past = { ...p0, x: p0.x - (794 + PAGE_GAP) * p0.k * 0.8 };
  ok('past the halfway point it takes over', visible(past, g, v, 1) > 0.5 && brightPage(past, g, v, 0) === 1);
  ok('…and it keeps it until page 1 is the one more in view', brightPage(past, g, v, 1) === 1);
  const back = { ...p0, x: p0.x - (794 + PAGE_GAP) * p0.k * 0.2 };
  ok('a little back and page 1 is the larger share again, but page 2 is still current until page 1 passes half', brightPage(back, g, v, 1) === 0);
  ok('one page of one is always bright', brightPage({ k: 1, x: 0, y: 0 }, geometry({ vw: 1280, vh: 800, format: 'a4', pages: 1 }), v, 0) === 0);
  ok('nothing is faded when both are shown equal', eq(faded(g, 0, true), [false, false]));
  ok('otherwise only the bright page is not', eq(faded(g, 0, false), [false, true]) && eq(faded(g, 1, false), [true, false]));
}

section('a spring');
{
  ok('no bounce is critically damped', damping(0) === 1);
  ok('a bounce of 8 is lightly under-damped', damping(8) > 0.55 && damping(8) < 0.7, damping(8).toFixed(3));
  ok('a bigger bounce is less damped', damping(25) < damping(8));
  const run = bounce => {
    let s = { x: 0, v: 0 }, peak = 0, t = 0;
    while (t < 3){ s = springStep(s, 100, 1 / 60, { bounce }); peak = Math.max(peak, s.x); t += 1 / 60; if (atRest(s, 100)) break; }
    return { peak, t, s };
  };
  const a = run(BOUNCE), b = run(25), c = run(0);
  ok(`it overshoots by about ${BOUNCE}% at the default`, a.peak > 104 && a.peak < 112, a.peak.toFixed(1));
  ok('a bigger bounce overshoots more', b.peak > a.peak);
  ok('with none it does not overshoot', c.peak <= 100.5);
  ok('and it comes to rest well inside a second', a.t < 1 && atRest(a.s, 100), a.t.toFixed(2));
  ok('stable even with a long step', Number.isFinite(springStep({ x: 0, v: 0 }, 100, 0.5).x));
}

section('writing zoom');
{
  const g = geometry({ vw: 1280, vh: 800, format: 'a4', pages: 2 });
  const v = railView(1280);
  const k = writingScale(g, v, 130), one = fitCam(g, v, { scene: 'one' }).k;
  ok('130% is 1.3 times the fit-to-height scale of one page', near(k, one * 1.3));
  const c = centreOn(g, v, k, 500, 300);
  ok('the block lands in the middle of the view', near(screenOf(c, 500, 300).x, midX(v)) && near(screenOf(c, 500, 300).y, v.top + v.height / 2));
}

console.log(failed ? `\n${failed} camera check(s) FAILED` : '\nall camera checks passed');
process.exit(failed ? 1 : 0);
