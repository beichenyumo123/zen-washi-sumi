// ==UserScript==
// @name           Zen Washi Tab Close
// @description    真·和纸抽离式标签关闭动效（横向滑出 14px + WAAPI 让位收拢）
// @version        1.1.0
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(() => {
  "use strict";

  const win = window;
  if (win.__zenwashiTabClose) {
    return;
  }
  win.__zenwashiTabClose = true;

  // ---- 可调参数 -----------------------------------------------------------
  const PREF_MODE = "zenwashi.tab.close-animation";
  const PREF_SIMPLIFY = "zenwashi.tab.close-simplify-switch";
  const PREF_RIGHT_SIDE = "zen.tabs.vertical.right-side";
  const MODE_OFF = 0;
  const MODE_SLIDE = 1; // 默认：180ms 向侧栏外侧滑出 14px + 淡出 + 让位
  const MODE_FADE = 2; // 130ms 纯淡出 + 让位
  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
  const EXIT_MS = 180;
  const FADE_MS = 130;
  const SLIDE_PX = 14;
  const MAX_ANIM = 6;
  const ABORT_FRAMES = 12;

  const ATTR_CLOSING = "zenwashi-closing";
  const ATTR_SWITCH = "zenwashi-tab-closing";

  let activeCloses = 0;
  const rootAttrTimers = new Map();

  function prefInt(name, fallback) {
    try {
      return Services.prefs.getIntPref(name);
    } catch (e) {
      return fallback;
    }
  }

  function prefBool(name, fallback) {
    try {
      return Services.prefs.getBoolPref(name);
    } catch (e) {
      return fallback;
    }
  }

  function pulseRootAttr(name, ms) {
    const root = win.document.documentElement;
    root.setAttribute(name, "");
    const previous = rootAttrTimers.get(name);
    if (previous) {
      win.clearTimeout(previous);
    }
    rootAttrTimers.set(
      name,
      win.setTimeout(() => {
        rootAttrTimers.delete(name);
        root.removeAttribute(name);
      }, ms)
    );
  }

  function measureItem(item) {
    const rect = item.getBoundingClientRect();
    const style = win.getComputedStyle(item);
    const marginTop = parseFloat(style.marginTop) || 0;
    const marginBottom = parseFloat(style.marginBottom) || 0;
    const opacity = parseFloat(style.opacity);
    return {
      height: rect.height + marginTop + marginBottom,
      marginBottom,
      opacity: Number.isFinite(opacity) ? opacity : 1,
    };
  }

  // ---- 关闭动画 -----------------------------------------------------------
  function animateClose(item) {
    if (!item || !item.isConnected) {
      return Promise.resolve();
    }
    if (item.hasAttribute("zen-essential")) {
      return Promise.resolve();
    }
    if (item.group?.hasAttribute("split-view-group")) {
      return Promise.resolve();
    }

    const mode = prefInt(PREF_MODE, MODE_SLIDE);
    const duration = mode === MODE_FADE ? FADE_MS : EXIT_MS;

    // 无论关闭动效是否开启、是否触发并发上限，关闭触发的自动切页都应跳过按压与切换缩放
    if (prefBool(PREF_SIMPLIFY, true)) {
      pulseRootAttr(ATTR_SWITCH, (mode === MODE_OFF ? 0 : duration) + 60);
    }

    if (win.gReduceMotion || win.document.hidden || mode === MODE_OFF) {
      return Promise.resolve();
    }

    const { height, marginBottom, opacity } = measureItem(item);
    if (height < 1 || activeCloses >= MAX_ANIM) {
      return Promise.resolve();
    }

    // 向侧栏外侧抽离：右侧栏向右滑出 +14px，左侧栏向左滑出 -14px
    const dir = prefBool(PREF_RIGHT_SIDE, false) ? 1 : -1;
    const slideX = mode === MODE_FADE ? 0 : dir * SLIDE_PX;

    item.setAttribute(ATTR_CLOSING, "");
    activeCloses++;

    let animation;
    try {
      animation = item.animate(
        [
          {
            opacity,
            translate: "0px 0px",
            marginBottom: `${marginBottom}px`,
          },
          {
            opacity: 0,
            translate: `${slideX}px 0px`,
            marginBottom: `${marginBottom - height}px`,
          },
        ],
        { duration, easing: EASE, fill: "forwards" }
      );
    } catch (e) {
      console.error("[zen-washi] tab close animation failed:", e);
      item.removeAttribute(ATTR_CLOSING);
      activeCloses = Math.max(0, activeCloses - 1);
      return Promise.resolve();
    }

    return new Promise(resolve => {
      win.setTimeout(() => {
        resolve();
        activeCloses = Math.max(0, activeCloses - 1);

        let frames = 0;
        const settle = () => {
          if (item.isConnected && frames++ < ABORT_FRAMES) {
            win.requestAnimationFrame(settle);
            return;
          }
          if (item.isConnected) {
            try {
              animation.cancel();
            } catch (e) {
              // ignore AbortError
            }
            item.removeAttribute(ATTR_CLOSING);
          }
        };
        win.requestAnimationFrame(settle);
      }, duration);
    });
  }

  function install() {
    const manager = win.gZenVerticalTabsManager;
    if (!manager || typeof manager.animateItemClose !== "function") {
      return false;
    }
    if (manager.__zenwashiPatched) {
      return true;
    }
    manager.__zenwashiPatched = true;
    manager.animateItemClose = animateClose;
    return true;
  }

  if (!install()) {
    let tries = 0;
    const timer = win.setInterval(() => {
      if (install() || ++tries > 100) {
        win.clearInterval(timer);
      }
    }, 100);
  }
})();
