// ==UserScript==
// @name           Zen Washi PDF Page Radius
// @description    将 zenwashi.pdf.page-radius（支持纯数字或带单位，如 10 / 10px）通过 nsIStyleSheetService 实时注入 out-of-process PDF 阅读器
// @version        0.1.0
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(() => {
  "use strict";

  const win = window;
  if (win.__zenwashiPdfPageRadius) {
    return;
  }
  win.__zenwashiPdfPageRadius = true;

  const PREF = "zenwashi.pdf.page-radius";
  const DEFAULT_RADIUS = "6px";

  let sss = null;
  try {
    sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(
      Ci.nsIStyleSheetService
    );
  } catch (e) {
    console.error("[zen-washi] nsIStyleSheetService unavailable:", e);
    return;
  }

  let registeredUri = null;

  function readRawPref() {
    try {
      return Services.prefs.getStringPref(PREF, DEFAULT_RADIUS);
    } catch {
      try {
        return String(Services.prefs.getIntPref(PREF));
      } catch {
        return DEFAULT_RADIUS;
      }
    }
  }

  function normalizeRadius(raw) {
    const s = String(raw ?? "").trim();
    if (!s) {
      return DEFAULT_RADIUS;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(s)) {
      return `${Math.max(0, parseFloat(s))}px`;
    }
    const match = s.match(/^(-?\d+(?:\.\d+)?)(px|rem|em|pt|%)$/i);
    if (match) {
      return `${Math.max(0, parseFloat(match[1]))}${match[2].toLowerCase()}`;
    }
    return DEFAULT_RADIUS;
  }

  function makeSheetUri(radius) {
    const css = `:root:has(link[href^="resource://pdf.js"]){--zenwashi-pdf-page-radius-custom:${radius};}`;
    return Services.io.newURI(`data:text/css;charset=utf-8,${encodeURIComponent(css)}`);
  }

  function unregisterCurrent() {
    if (!registeredUri) {
      return;
    }
    try {
      if (sss.sheetRegistered(registeredUri, sss.USER_SHEET)) {
        sss.unregisterSheet(registeredUri, sss.USER_SHEET);
      }
    } catch {}
    registeredUri = null;
  }

  function apply() {
    const radius = normalizeRadius(readRawPref());
    const nextUri = makeSheetUri(radius);
    if (registeredUri && registeredUri.spec === nextUri.spec) {
      return;
    }
    unregisterCurrent();
    try {
      if (!sss.sheetRegistered(nextUri, sss.USER_SHEET)) {
        sss.loadAndRegisterSheet(nextUri, sss.USER_SHEET);
      }
      registeredUri = nextUri;
    } catch (e) {
      console.error("[zen-washi] failed to register PDF radius sheet:", e);
    }
  }

  function hasOtherBrowserWindows() {
    try {
      const enumerator = Services.wm.getEnumerator("navigator:browser");
      while (enumerator.hasMoreElements()) {
        const other = enumerator.getNext();
        if (other !== win && !other.closed) {
          return true;
        }
      }
    } catch {}
    return false;
  }

  const prefObserver = {
    observe() {
      apply();
    },
  };

  apply();
  try {
    Services.prefs.addObserver(PREF, prefObserver);
  } catch {}

  win.addEventListener(
    "unload",
    () => {
      try {
        Services.prefs.removeObserver(PREF, prefObserver);
      } catch {}
      if (!hasOtherBrowserWindows()) {
        unregisterCurrent();
      }
      delete win.__zenwashiPdfPageRadius;
    },
    { once: true }
  );
})();
