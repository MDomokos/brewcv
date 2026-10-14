// Where the page and the sidebar go. Pure: numbers in, numbers out (checks/shell-check.mjs).
// The sidebar is one column at the right with one width, wide enough for its widest body; the page is centred in the room left of it,
// so no selection and no switch between Edit, Design and Export moves it. Several pages sit side by side when that costs less than
// SPREAD_COST of a page's size; otherwise they travel one at a time. Under PHONE_MAX the column is a bottom sheet.

export const G = 16;
export const SIDE_W = 560;                              // the sidebar's width
export const ZOOM_MIN = 0.4, ZOOM_MAX = 4;
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

export const stackHeight = (format, n) => { const { h } = pageSize(format); return n * h + Math.max(0, n - 1) * PAGE_GAP; };
export const clampZoom = z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number.isFinite(z) ? z : 1));

// mode: 'auto' | 'spread' | 'stack' (an old 'single' means 'stack'). `wide`: on a phone, the panel is the whole screen.
// zoom: 1 is the whole page fitted to the window.
// `slim`: the start screen and the first questions: the column is 32% of the window (380 to 480px) instead of SIDE_W.
export const SLIM_MIN = 380, SLIM_MAX = 480;
export function computeLayout({ vw, vh, format, pages = 1, mode = 'auto', zoom = 1, wide = false, slim = false }){
  const { w, h } = pageSize(format);
  const n = Math.max(1, pages);
  const z = clampZoom(zoom);
  if (vw < PHONE_MAX){
    const scale = (vw - G) / w * z;
    const colH = Math.round(vh * SHEET_VH);
    const height = stackHeight(format, n) * scale;
    return {
      phone: true, wide, scale, fit: (vw - G) / w, zoom: z, spread: false, stack: n > 1, perView: 1,
      sheet: { left: G / 2, top: G / 2, width: w * scale, height },
      col: wide ? { left: 0, top: 0, width: vw, height: vh } : { left: 0, top: vh - colH, width: vw, height: colH },
      pages: { left: 0, top: 0, width: vw, height: G + height, content: G + height, contentW: vw },
      pageStep: (h + PAGE_GAP) * scale, areaW: vw, colW: vw,
      view: null, fullHeight: false, canSpread: false,
    };
  }
  const tall = (vh - 2 * G) / h;
  const rowW = k => k * w + (k - 1) * PAGE_GAP;
  const colW = slim ? Math.max(SLIM_MIN, Math.min(SLIM_MAX, Math.round(vw * 0.32))) : SIDE_W;
  // the room the page may have: left of the column, a gutter at each side of it
  const room = vw - colW - 4 * G;
  const single = Math.max(0.1, Math.min(tall, room / w));
  const spreadScale = n > 1 ? Math.max(0.1, Math.min(tall, room / rowW(n))) : single;
  const spread = n > 1 && (mode === 'spread' || (mode === 'auto' && spreadScale >= (1 - SPREAD_COST) * single));
  const stack = n > 1 && !spread;
  const fit = spread ? spreadScale : single;
  const scale = fit * z;
  const perView = spread ? n : 1;
  const sheetW = rowW(perView) * fit, pageH = h * fit;      // laid for the fitted page; a zoom is the camera's
  const sheetH = stack ? stackHeight(format, n) * scale : pageH * z;
  const colLeft = vw - G - colW;
  const areaW = colLeft - G;                                // the pages' room: everything left of the column
  const mid = areaW / 2;
  const left = Math.max(G / 2, mid - sheetW / 2);
  const top = stack || sheetH + 2 * G > vh ? G : Math.max(G, (vh - pageH) / 2);
  return {
    scale, fit, zoom: z, spread, stack, perView, phone: false, wide: false, colW, areaW, mid,
    sheet: { left, top, width: sheetW * z, height: sheetH },
    col: { left: colLeft, top: G, width: colW, height: vh - 2 * G },
    // the camera's view: the room left of the column, and the width the page is fitted to
    view: { left: 0, top: 0, width: Math.max(1, areaW), height: vh, mid, fitW: room + 2 * G },
    pages: { left: 0, top: 0, width: areaW, height: vh, content: stack || top + sheetH + G > vh ? top + sheetH + G : vh, contentW: Math.max(areaW, left + sheetW * z + G) },
    pageStep: (h + PAGE_GAP) * scale,
    fullHeight: z === 1 && Math.abs(fit - tall) < 1e-9,
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
