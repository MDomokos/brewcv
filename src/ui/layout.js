// Where the sheet and the column go. Pure: numbers in, numbers out (checks/shell-check.mjs).
// Several pages sit side by side when that costs less than SPREAD_COST of the sheet's
// height; otherwise they stack and the page area scrolls.

export const G = 16;
export const COL_MIN = 340, COL_MAX = 420;
export const PAGE_GAP = 24;           // between pages, in page px
export const SPREAD_COST = 0.15;

export const PAGE_SIZE = {
  'us-letter': { w: 816, h: 1056, mm: [215.9, 279.4] },
  a4: { w: 794, h: 1123, mm: [210, 297] },
  'a4-hu': { w: 794, h: 1123, mm: [210, 297] },
};
export const pageSize = format => PAGE_SIZE[format] ?? PAGE_SIZE.a4;

// Below this width the window is a phone: the page fills the width and the column becomes a bottom sheet.
export const PHONE_MAX = 720;
export const SHEET_VH = 0.42;          // the bottom sheet's share of the height

export const THUMB_SCALE = 0.17;
export const stackHeight = (format, n) => { const { h } = pageSize(format); return n * h + Math.max(0, n - 1) * PAGE_GAP; };

// mode: 'auto' | 'spread' | 'stack' (an old 'single' means 'stack'). `pages` is the
// scroller the sheet sits in, in screen px; `content` is the height it scrolls through.
export function computeLayout({ vw, vh, format, pages = 1, mode = 'auto' }){
  const { w, h } = pageSize(format);
  const n = Math.max(1, pages);
  if (vw < PHONE_MAX){
    const scale = (vw - G) / w;
    const colH = Math.round(vh * SHEET_VH);
    const height = stackHeight(format, n) * scale;
    return {
      phone: true, scale, spread: false, stack: n > 1, perView: 1,
      sheet: { left: G / 2, top: G / 2, width: w * scale, height },
      col: { left: 0, top: vh - colH, width: vw, height: colH },
      pages: { left: 0, top: 0, width: vw, height: G + height, content: G + height },
      career: null, pageStep: (h + PAGE_GAP) * scale,
      fullHeight: false, canSpread: false,
    };
  }
  const tall = (vh - 2 * G) / h;
  const room = vw - 3 * G - COL_MIN;
  const single = Math.max(0.1, Math.min(tall, room / w));
  const rowW = k => k * w + (k - 1) * PAGE_GAP;
  const spreadScale = n > 1 ? Math.max(0.1, Math.min(tall, room / rowW(n))) : single;
  const spread = n > 1 && (mode === 'spread' || (mode === 'auto' && spreadScale >= (1 - SPREAD_COST) * single));
  const stack = n > 1 && !spread;
  const scale = spread ? spreadScale : single;
  const perView = spread ? n : 1;
  const sheetW = rowW(perView) * scale, pageH = h * scale;
  const sheetH = stack ? stackHeight(format, n) * scale : pageH;
  const colW = Math.max(COL_MIN, Math.min(COL_MAX, vw - 3 * G - sheetW));
  const pairW = sheetW + G + colW;
  const left = Math.max(G, (vw - pairW) / 2);
  const top = stack ? G : Math.max(G, (vh - pageH) / 2);
  const colLeft = left + sheetW + G;
  const cw = Math.max(320, colLeft - 2 * G), ch = vh - 2 * G;
  const tw = w * THUMB_SCALE, th = h * THUMB_SCALE;
  return {
    scale, spread, stack, perView,
    sheet: { left, top, width: sheetW, height: sheetH },
    col: { left: colLeft, top: G, width: colW, height: vh - 2 * G },
    // the scroller runs from the window's left edge to just short of the column
    pages: { left: 0, top: 0, width: colLeft - 4, height: vh, content: stack ? top + sheetH + G : vh },
    career: {
      panel: { left: G, top: G, width: cw, height: ch },
      thumb: { left: G + cw - tw - 20, top: G + ch - th - 20, width: tw, height: th, scale: THUMB_SCALE },
    },
    pageStep: (h + PAGE_GAP) * scale,
    fullHeight: Math.abs(scale - tall) < 1e-9,
    canSpread: n > 1,
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
