// Where the page and the sidebar go. Pure: numbers in, numbers out (checks/shell-check.mjs).
// The sidebar is one skinny column at the right (316px under 1400px windows, 340px from there, wider on a large screen: sideWidth) with the 54px rail beside it; the page is centred
// in the room left of both, so no selection and no switch between Edit, Design and Export moves it. A page is always as big as the window's height allows;
// several pages sit beside each other, all in view when the row fits the room, otherwise the view travels sideways from page to page
// (the sidebar floats over the rest). Under PHONE_MAX the column is a bottom sheet.

export const G = 16;
// The sidebar's width: what is left beside two pages of the widest paper, side by side at the height a page is fitted to, so a two-page
// resume is never covered and the width does not change from one resume to the next; never less than it was (316 on a laptop, 340 from
// 1400 wide) and never more than SIDE_MAX, so it does not take over a very large screen. A resume limited to one page (oneUp) never shows
// two, so it may have up to SIDE_ONE_EXTRA more, as long as its one page stays uncovered.
export const SIDE_MAX = 520, SIDE_ONE_EXTRA = 100;
export function sideWidth(vw, vh = 900, oneUp = false){
  const min = vw < 1400 ? 316 : 340, H = vh - 2 * G, free = n => vw - RAIL_W - 4 * G - Math.max(...Object.values(PAGE_SIZE).map(p => n * H * p.w / p.h + (n - 1) * PAGE_GAP * H / p.h));
  const two = Math.max(min, free(2)), w = oneUp ? Math.max(two, Math.min(free(1), min + SIDE_ONE_EXTRA)) : two;
  return Math.round(Math.min(SIDE_MAX, w));
}
// The width the person set with the sidebar's handle (sidewidth.js): never under the narrowest the views are checked at, never over SIDE_CAP or half the window.
export const SIDE_MIN = 316, SIDE_CAP = 640;
export const sideMax = vw => Math.max(SIDE_MIN, Math.min(SIDE_CAP, Math.floor(vw / 2)));
export const clampSide = (w, vw) => Math.max(SIDE_MIN, Math.min(sideMax(vw), Math.round(w)));
export const RAIL_W = 54;                               // the tabs, the screens and the history, left of the sidebar
export const ZOOM_MIN = 0.4, ZOOM_MAX = 4;
export const PAGE_GAP = 24;           // between pages, in page px

export const PAGE_SIZE = {
  'us-letter': { w: 816, h: 1056, mm: [215.9, 279.4] },
  a4: { w: 794, h: 1123, mm: [210, 297] },
  'a4-hu': { w: 794, h: 1123, mm: [210, 297] },
};
export const pageSize = format => PAGE_SIZE[format] ?? PAGE_SIZE.a4;

// Below this width the window is a phone: the page fills the width and the column becomes a bottom sheet.
export const PHONE_MAX = 720;
export const SHEET_VH = 0.42;          // the bottom sheet's share of the height

export const stackHeight = (format, n) => { const { h } = pageSize(format); return n * h + Math.max(0, n - 1) * PAGE_GAP; };
export const clampZoom = z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number.isFinite(z) ? z : 1));

// `wide`: on a phone, the panel is the whole screen.
// zoom: 1 is the whole page fitted to the window.
// `slim`: the start screen and the first questions: the column is 27% of the window (340 to 392px) and has no rail.
// `side`: the person's choice ({ w, off }): a width of their own, or folded to the rail (the column takes no room; the page has it).
export const SLIM_MIN = 340, SLIM_MAX = 392;
export function computeLayout({ vw, vh, format, pages = 1, zoom = 1, wide = false, slim = false, oneUp = false, side = null }){
  const { w, h } = pageSize(format);
  const n = Math.max(1, pages);
  const z = clampZoom(zoom);
  if (vw < PHONE_MAX){
    const scale = (vw - G) / w * z;
    const colH = Math.round(vh * SHEET_VH);
    const height = stackHeight(format, n) * scale;
    return {
      phone: true, wide, scale, fit: (vw - G) / w, zoom: z, spread: false, stack: n > 1,
      sheet: { left: G / 2, top: G / 2, width: w * scale, height },
      col: wide ? { left: 0, top: 0, width: vw, height: vh } : { left: 0, top: vh - colH, width: vw, height: colH },
      pages: { left: 0, top: 0, width: vw, height: G + height, content: G + height, contentW: vw },
      pageStep: (h + PAGE_GAP) * scale, areaW: vw, colW: vw,
      view: null, fullHeight: false,
    };
  }
  const tall = (vh - 2 * G) / h;
  const rowW = k => k * w + (k - 1) * PAGE_GAP;
  const colW = slim ? Math.max(SLIM_MIN, Math.min(SLIM_MAX, Math.round(vw * 0.272))) : side?.off ? 0 : side?.w ? clampSide(side.w, vw) : sideWidth(vw, vh, oneUp);
  const railW = slim ? 0 : RAIL_W;
  // the room the page may have: left of the rail and the column, a gutter at each side of them
  const room = vw - colW - railW - 4 * G;
  const fit = Math.max(0.1, Math.min(tall, room / w));
  const spread = n > 1 && rowW(n) * fit <= room + 1e-6;     // else the view travels from page to page, at the same size
  const scale = fit * z;
  const sheetW = rowW(spread ? n : 1) * fit, pageH = h * fit;      // laid for the fitted page; a zoom is the camera's
  const sheetH = pageH * z;
  const colLeft = vw - G - colW;
  const areaW = colLeft - railW - G;                        // the pages' room: everything left of the rail
  const mid = areaW / 2;
  const left = Math.max(G / 2, mid - sheetW / 2);
  const top = sheetH + 2 * G > vh ? G : Math.max(G, (vh - pageH) / 2);
  return {
    scale, fit, zoom: z, spread, phone: false, wide: false, colW, railW, areaW, mid,
    sheet: { left, top, width: sheetW * z, height: sheetH },
    col: { left: colLeft, top: G, width: colW, height: vh - 2 * G },
    // the camera's view: the room left of the column, and the width the page is fitted to
    view: { left: 0, top: 0, width: Math.max(1, areaW), height: vh, mid, fitW: room + 2 * G },
    pages: { left: 0, top: 0, width: areaW, height: vh, content: top + sheetH + G > vh ? top + sheetH + G : vh, contentW: Math.max(areaW, left + sheetW * z + G) },
    pageStep: (h + PAGE_GAP) * scale,
    fullHeight: z === 1 && Math.abs(fit - tall) < 1e-9,
  };
}

// Which page is in view in a stacked sheet: the one under the window's middle.
export function pageInView(L, scrollTop, n){
  if (!L?.stack || n < 2) return 0;
  const mid = scrollTop + L.pages.height / 2 - L.sheet.top;
  return Math.max(0, Math.min(n - 1, Math.floor(mid / L.pageStep)));
}
export const pageTop = (L, i) => Math.max(0, L.sheet.top + i * L.pageStep - G);

// A CSS px is nominally 1/96 in, which no screen honours, hence the bank-card calibration.
export const CARD_MM = 85.6;
export const NOMINAL_PX_PER_MM = 96 / 25.4;
export const actualScale = pxPerMm => pxPerMm / NOMINAL_PX_PER_MM;
export const calibrationKey = (scr = globalThis.screen, dpr = globalThis.devicePixelRatio) =>
  `rb-calibration:${scr?.width ?? 0}x${scr?.height ?? 0}@${dpr ?? 1}`;
