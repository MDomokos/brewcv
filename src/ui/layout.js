// Where the sheet and the column go. Pure: numbers in, numbers out (checks/shell-check.mjs).
// Several pages sit side by side when that costs less than SPREAD_COST of the sheet's
// height; otherwise they stack and the page area scrolls. The column on the right is the editor
// panel, or the 52px rail it folds to. Under DRAWER_MAX the panel is a drawer over the page's right
// edge: the page never gives up its width to it.

export const G = 16;
export const COL_MIN = 380, COL_MAX = 480;
export const RECORD_MIN = 640, RECORD_MAX = 720;      // the panel in Record: about 640 to 720 px, never more than half the window
export const RAIL_W = 52;
export const DRAWER_MAX = 1280;
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
export const panelWidth = vw => Math.max(COL_MIN, Math.min(COL_MAX, Math.round(vw * 0.32)));
// Record widens the panel (the page slides left and shrinks). Under DRAWER_MAX it is a drawer of 90% of the window, with a sliver of the page
// showing; on a phone it is the whole screen.
export const DRAWER_RECORD = 0.9;
export const recordWidth = vw => (vw < PHONE_MAX ? vw : vw < DRAWER_MAX ? Math.round(vw * DRAWER_RECORD) : Math.max(RECORD_MIN, Math.min(RECORD_MAX, Math.floor(vw * 0.5))));

// mode: 'auto' | 'spread' | 'stack' (an old 'single' means 'stack'). `pages` is the scroller the sheet
// sits in, in screen px; `content` is the height it scrolls through, `contentW` the width.
// folded: the panel is the rail. zoom: 1 is the whole page fitted to the window.
export function computeLayout({ vw, vh, format, pages = 1, mode = 'auto', folded = false, zoom = 1, wide = false }){
  const { w, h } = pageSize(format);
  const n = Math.max(1, pages);
  const z = clampZoom(zoom);
  if (vw < PHONE_MAX){
    const scale = (vw - G) / w * z;
    const colH = Math.round(vh * SHEET_VH);
    const height = stackHeight(format, n) * scale;
    return {
      phone: true, drawer: false, folded: false, wide, scale, fit: (vw - G) / w, zoom: z, spread: false, stack: n > 1, perView: 1,
      sheet: { left: G / 2, top: G / 2, width: w * scale, height },
      col: wide ? { left: 0, top: 0, width: vw, height: vh } : { left: 0, top: vh - colH, width: vw, height: colH },
      pages: { left: 0, top: 0, width: vw, height: G + height, content: G + height, contentW: vw },
      pageStep: (h + PAGE_GAP) * scale, areaW: vw, railW: 0, colW: vw,
      fullHeight: false, canSpread: false,
    };
  }
  const drawer = vw < DRAWER_MAX;
  const colW = wide && !folded ? recordWidth(vw) : panelWidth(vw);
  // the page area: it gives way to the open panel on a wide window, and to the rail (always) otherwise
  const areaW = !drawer && !folded ? vw - colW - 2 * G : vw - RAIL_W - 2 * G;
  const tall = (vh - 2 * G) / h;
  const room = areaW - 2 * G;
  const single = Math.max(0.1, Math.min(tall, room / w));
  const rowW = k => k * w + (k - 1) * PAGE_GAP;
  const spreadScale = n > 1 ? Math.max(0.1, Math.min(tall, room / rowW(n))) : single;
  const spread = n > 1 && (mode === 'spread' || (mode === 'auto' && spreadScale >= (1 - SPREAD_COST) * single));
  const stack = n > 1 && !spread;
  const fit = spread ? spreadScale : single;
  const scale = fit * z;
  const perView = spread ? n : 1;
  const sheetW = rowW(perView) * scale, pageH = h * scale;
  const sheetH = stack ? stackHeight(format, n) * scale : pageH;
  const left = sheetW + 2 * G <= areaW ? (areaW - sheetW) / 2 : G;
  const top = stack || sheetH + 2 * G > vh ? G : Math.max(G, (vh - pageH) / 2);
  const open = !folded;
  return {
    scale, fit, zoom: z, spread, stack, perView, phone: false, drawer, folded, wide: wide && !folded, railW: RAIL_W, colW, areaW,
    sheet: { left, top, width: sheetW, height: sheetH },
    col: open ? { left: vw - G - colW, top: G, width: colW, height: vh - 2 * G } : { left: vw - G - RAIL_W, top: G, width: RAIL_W, height: vh - 2 * G },
    // the scroller runs from the window's left edge to just short of the column (or the rail)
    pages: { left: 0, top: 0, width: areaW, height: vh, content: stack || top + sheetH + G > vh ? top + sheetH + G : vh, contentW: Math.max(areaW, left + sheetW + G) },
    pageStep: (h + PAGE_GAP) * scale,
    fullHeight: z === 1 && Math.abs(scale - tall) < 1e-9,
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
