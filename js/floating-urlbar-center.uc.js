// ==UserScript==
// @name           Zen Washi Floating URL Bar Center
// @description    让 Cmd+T / Cmd+L 的悬浮地址栏以「侧栏右侧的内容区」为中心，并被垂直居中
// @version        0.1.0
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

/* =============================================================================
 * 为什么必须用 JS 量
 * =============================================================================
 * 纯 CSS 试过不行：#urlbar 是 popover，`left`/`top` 的百分比以**视口**为基准，
 * 想换算成内容区中心得知道侧栏宽度。Zen 确实有个 `--zen-sidebar-width`，但它被
 * 写在 `#navigator-toolbox` 的**内联样式**上 —— popover 进顶层后继承链断开，
 * 取到的是空值，`calc(50% + 0px/2)` 仍等于 `50%`，看起来"改了跟没改一样"。
 *
 * 所以在父进程里直接量 `gBrowser.selectedBrowser` 的矩形，把中心点写成两个
 * 根变量，CSS 只负责消费。这样侧栏展开/折叠、split view、紧凑模式都自动跟随。
 * ============================================================================= */

(() => {
  "use strict";

  const win = window;
  if (win.__zenwashiFloatCenter) {
    return;
  }
  win.__zenwashiFloatCenter = true;

  const PREF = "zenwashi.urlbar.float-centered";
  const ATTR = "zenwashi-float-positioned";

  const doc = win.document;
  const root = doc.documentElement;

  function enabled() {
    try {
      return Services.prefs.getBoolPref(PREF);
    } catch {
      return true;
    }
  }

  function urlbar() {
    return doc.getElementById("urlbar");
  }

  function place() {
    const bar = urlbar();
    if (!bar) {
      return;
    }

    const open = bar.hasAttribute("open") && bar.hasAttribute("zen-floating-urlbar");
    if (!open || !enabled()) {
      root.removeAttribute(ATTR);
      return;
    }

    const browser = win.gBrowser?.selectedBrowser;
    if (!browser) {
      root.removeAttribute(ATTR);
      return;
    }

    const rect = browser.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      root.removeAttribute(ATTR);
      return;
    }

    root.style.setProperty("--zenwashi-float-x", `${rect.left + rect.width / 2}px`);
    root.style.setProperty("--zenwashi-float-y", `${rect.top + rect.height / 2}px`);
    root.setAttribute(ATTR, "true");
  }

  // `open` 是开关属性；zen-floating-urlbar 决定"是不是悬浮形态"。
  const observer = new MutationObserver(place);
  const attach = () => {
    const bar = urlbar();
    if (!bar) {
      return false;
    }
    observer.observe(bar, {
      attributes: true,
      attributeFilter: ["open", "zen-floating-urlbar", "breakout-extend"],
    });
    return true;
  };

  if (!attach()) {
    win.addEventListener("load", attach, { once: true });
  }

  // 窗口尺寸变化时内容区中心会动；面板开着的话顺手重算。
  win.addEventListener("resize", place);
  win.addEventListener("TabSelect", () => {
    if (root.hasAttribute(ATTR)) {
      place();
    }
  });
})();
