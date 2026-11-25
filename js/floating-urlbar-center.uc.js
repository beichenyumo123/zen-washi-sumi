// ==UserScript==
// @name           Zen Washi Floating URL Bar Center & Smooth Height
// @description    让 Cmd+T / Cmd+L 悬浮地址栏水平居中于内容区、顶部锚定防跳动，并在候选项增减时平滑过渡高度
// @version        0.2.0
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

/* =============================================================================
 * 职责
 * =============================================================================
 * 1. 内容区水平居中 + 顶部锚定（28% 处）：
 *    纯 CSS 拿不到跨顶层的侧栏宽度，且用 translate(-50%, -50%) 垂直居中会导致
 *    打字时候选项数量变化、输入框跟着上下跳动。改为按内容区上沿 28% 锚定顶边
 *    （Raycast / Spotlight 风格），输入框纹丝不动，只有结果区向下伸缩。
 * 2. 高度变化平滑过渡（WAAPI）：
 *    监听 #urlbar-results 变化，仅对 .urlbarView 做 210ms 高度过渡与 overflow: hidden，
 *    外层 #urlbar 与 .urlbar-background 的漫射投影随高度自然同步、绝不被裁切。
 * 3. 初次展开标记（zenwashi-urlbar-opening）：
 *    只在面板刚打开的 380ms 内触发候选项阶梯入场动画，后续打字刷新不再重播闪烁。
 * ============================================================================= */

(() => {
  "use strict";

  const win = window;
  if (win.__zenwashiFloatCenter) {
    return;
  }
  win.__zenwashiFloatCenter = true;

  const PREF = "zenwashi.urlbar.float-centered";
  const ATTR_POS = "zenwashi-float-positioned";
  const ATTR_OPENING = "zenwashi-urlbar-opening";

  const doc = win.document;
  const root = doc.documentElement;

  const reducedMotion = () =>
    win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

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

  function urlbarView() {
    return urlbar()?.querySelector(".urlbarView") || null;
  }

  function urlbarResults() {
    return doc.getElementById("urlbar-results");
  }

  let wasOpen = false;
  let openingTimer = null;
  let heightAnim = null;
  let lastViewHeight = 0;
  let rafId = 0;

  function clearHeightAnim() {
    if (rafId) {
      win.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (heightAnim) {
      heightAnim.cancel();
      heightAnim = null;
    }
    const view = urlbarView();
    if (view) {
      view.style.overflow = "";
    }
  }

  function clearOpeningFlag() {
    if (openingTimer) {
      win.clearTimeout(openingTimer);
      openingTimer = null;
    }
    root.removeAttribute(ATTR_OPENING);
  }

  function animateViewHeight() {
    rafId = 0;
    const bar = urlbar();
    const view = urlbarView();
    if (!bar || !view || !bar.hasAttribute("open")) {
      lastViewHeight = 0;
      return;
    }

    // 读取当前视觉高度（若动画正在跑，从当前帧无缝衔接）
    const currentH = heightAnim
      ? view.getBoundingClientRect().height
      : lastViewHeight;

    if (heightAnim) {
      heightAnim.cancel();
      heightAnim = null;
    }
    view.style.overflow = "";

    const targetH = view.getBoundingClientRect().height;
    lastViewHeight = targetH;

    // 首次打开或变化微小时不做高度插值，避免从 0 弹跳
    if (
      reducedMotion() ||
      currentH <= 0 ||
      targetH <= 0 ||
      Math.abs(targetH - currentH) < 2
    ) {
      return;
    }

    view.style.overflow = "hidden";
    heightAnim = view.animate(
      [{ height: `${currentH}px` }, { height: `${targetH}px` }],
      {
        duration: 210,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      }
    );

    const cleanup = () => {
      view.style.overflow = "";
      heightAnim = null;
      if (bar.hasAttribute("open")) {
        lastViewHeight = view.getBoundingClientRect().height;
      }
    };
    heightAnim.onfinish = cleanup;
    heightAnim.oncancel = () => {
      view.style.overflow = "";
      heightAnim = null;
    };
  }

  function scheduleHeightCheck() {
    const bar = urlbar();
    if (!bar || !bar.hasAttribute("open")) {
      return;
    }
    if (rafId) {
      return;
    }
    rafId = win.requestAnimationFrame(animateViewHeight);
  }

  function place() {
    const bar = urlbar();
    if (!bar) {
      return;
    }

    const isOpen = bar.hasAttribute("open");
    const isFloating = isOpen && bar.hasAttribute("zen-floating-urlbar");

    if (isOpen && !wasOpen) {
      wasOpen = true;
      clearHeightAnim();
      lastViewHeight = 0;
      clearOpeningFlag();
      root.setAttribute(ATTR_OPENING, "true");
      openingTimer = win.setTimeout(() => {
        openingTimer = null;
        root.removeAttribute(ATTR_OPENING);
      }, 380);
      // 记录首帧高度作为后续增减候选项的过渡起点
      rafId = win.requestAnimationFrame(() => {
        rafId = 0;
        const view = urlbarView();
        lastViewHeight = view ? view.getBoundingClientRect().height : 0;
      });
    } else if (!isOpen && wasOpen) {
      wasOpen = false;
      lastViewHeight = 0;
      clearHeightAnim();
      clearOpeningFlag();
    }

    if (!isFloating || !enabled()) {
      root.removeAttribute(ATTR_POS);
      return;
    }

    const browser = win.gBrowser?.selectedBrowser;
    if (!browser) {
      root.removeAttribute(ATTR_POS);
      return;
    }

    const rect = browser.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      root.removeAttribute(ATTR_POS);
      return;
    }

    // 水平居中于内容区，顶边锚定在内容区约 28% 处（输入框高度稳定不跳动）
    const anchorTop = Math.round(rect.top + Math.min(Math.max(rect.height * 0.28, 120), 280));
    root.style.setProperty("--zenwashi-float-x", `${rect.left + rect.width / 2}px`);
    root.style.setProperty("--zenwashi-float-y", `${anchorTop}px`);
    root.setAttribute(ATTR_POS, "true");
  }

  const barObserver = new MutationObserver(place);
  const resultsObserver = new MutationObserver(scheduleHeightCheck);

  const attach = () => {
    const bar = urlbar();
    if (!bar) {
      return false;
    }
    barObserver.observe(bar, {
      attributes: true,
      attributeFilter: ["open", "zen-floating-urlbar", "breakout-extend"],
    });
    const results = urlbarResults();
    if (results) {
      resultsObserver.observe(results, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden", "type", "style"],
      });
    }
    return true;
  };

  if (!attach()) {
    win.addEventListener("load", attach, { once: true });
  }

  win.addEventListener("resize", place);
  win.addEventListener("TabSelect", () => {
    if (root.hasAttribute(ATTR_POS)) {
      place();
    }
  });
})();
