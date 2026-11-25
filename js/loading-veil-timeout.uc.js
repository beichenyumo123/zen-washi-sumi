// ==UserScript==
// @name           Zen Washi Loading Veil Timeout
// @description    网页加载柔焦（宣纸微敛）超过 5 秒仍未结束时自动解除模糊与微缩，防止慢站或卡住的脚本让页面一直模糊
// @version        0.1.0
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(() => {
  "use strict";

  const win = window;
  if (win.__zenwashiLoadingTimeout) {
    return;
  }
  win.__zenwashiLoadingTimeout = true;

  const TIMEOUT_MS = 5000;
  const ATTR = "zenwashi-loading-timedout";
  const root = win.document.documentElement;

  // 记录每个标签本次连续 busy 的起始时间：切走再切回已超时的慢标签时不再重新模糊 5 秒
  const busySince = new WeakMap();
  let timer = null;

  function clearTimer() {
    if (timer) {
      win.clearTimeout(timer);
      timer = null;
    }
  }

  function isBusy(tab) {
    return Boolean(tab && tab.hasAttribute("busy"));
  }

  function sync() {
    clearTimer();
    const tab = win.gBrowser?.selectedTab;
    if (!tab || !isBusy(tab)) {
      if (tab) {
        busySince.delete(tab);
      }
      root.removeAttribute(ATTR);
      return;
    }

    const now = Date.now();
    let started = busySince.get(tab);
    if (started === undefined) {
      started = now;
      busySince.set(tab, started);
    }

    const elapsed = now - started;
    if (elapsed >= TIMEOUT_MS) {
      root.setAttribute(ATTR, "true");
      return;
    }

    root.removeAttribute(ATTR);
    timer = win.setTimeout(() => {
      timer = null;
      const current = win.gBrowser?.selectedTab;
      if (current === tab && isBusy(current)) {
        root.setAttribute(ATTR, "true");
      }
    }, TIMEOUT_MS - elapsed);
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const target = m.target;
      if (!target || !target.classList?.contains("tabbrowser-tab")) {
        continue;
      }
      if (m.attributeName === "busy" && !target.hasAttribute("busy")) {
        busySince.delete(target);
      }
    }
    sync();
  });

  const attach = () => {
    const tabs = win.document.getElementById("tabbrowser-tabs");
    if (!tabs) {
      return false;
    }
    observer.observe(tabs, {
      attributes: true,
      subtree: true,
      attributeFilter: ["busy", "selected", "visuallyselected"],
    });
    sync();
    return true;
  };

  if (!attach()) {
    win.addEventListener("load", attach, { once: true });
  }

  win.addEventListener("TabSelect", sync);
  win.addEventListener("TabClose", (e) => {
    if (e.target) {
      busySince.delete(e.target);
    }
  });
})();
