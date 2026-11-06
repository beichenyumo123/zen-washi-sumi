// ==UserScript==
// @name           Zen Washi Tab Ink Indicator
// @description    垂直标签页切换时的瞬态墨痕（前缘/后缘错峰，抵达即化开）
// @version        0.1.0
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

/* =============================================================================
 * 为什么是“瞬态”，而不是一条常驻的左侧指示线
 * =============================================================================
 * FlClash 的液体感来自一条规则：指示条的前缘和后缘用两条不同的曲线走。
 * 前缘 0–60% 就抵达，后缘 35% 才出发，于是整条在途中被拉长、在终点收束。
 * （FlClash 源码：lib/ui/sidebar.dart:497-570，_SelectionIndicator）
 *
 * 主题第 6 节明确删掉了原生左侧指示线（userChrome.css §6），选中态用和纸卡片表达。
 * 所以这里不保留常驻条：
 *   · 只在 TabSelect 后的 320ms 内画一道两端渐隐的墨痕；
 *   · 抵达时 opacity 归零，静止态什么都不留；
 *   · 任何拿不准的情况（关闭、滚动、文件夹、长跳、减弱动态）都直接不画。
 *
 * 渲染方式：
 *   · 一个 position:fixed 的裁剪层，尺寸正好是标签滚动视口；
 *   · 墨痕是层内绝对定位的子元素，逐帧写 top/height；
 *   · 不碰 #tabbrowser-tabs / #zen-tabs-wrapper 的布局，也不碰 shadow DOM。
 *   · 墨痕是 4px 实心圆头，不做两端渐隐（渐隐会让圆头看起来发虚、发细）。
 *
 * 坐标系全部是 getBoundingClientRect() 的物理坐标：
 *   · 竖排标签的“行内起点”在 LTR 是左边、RTL 是右边；
 *   · 墨痕的 x 只在切换开始时取一次，y 逐帧插值。
 *
 * 边界：
 *   · 关闭当前标签会触发 TabSelect，但 js/tab-close.uc.js 会在根元素打
 *     zenwashi-tab-closing；检测到就直接不画（与 §11 的关闭降级一致）。
 *   · 滚动发生在 #tabbrowser-arrowscrollbox 的 shadow scrollbox 里，scroll
 *     事件不跨 shadow 边界；这里在开始的一帧取坐标，320ms 内不追滚动，
 *     窗口 resize 时直接取消，不会留下错位元素。
 *   · 跨度过大（> 视口 62% 或 460px）不画贯穿侧栏的长线，改为在目标标签处
 *     画一段 20px 的局部墨痕：目标在下方就向下流入，在上方就向上流入。
 *   · 横向标签模式暂不支持：orient !== "vertical" 时静默跳过。
 * ============================================================================= */

(() => {
  "use strict";

  const win = window;
  if (win.__zenwashiTabInk) {
    return;
  }
  win.__zenwashiTabInk = true;

  // ---- 可调参数 -----------------------------------------------------------
  const PREF = "zenwashi.tab.indicator"; // 0 关 / 1 墨痕
  const DURATION = 320; // 与 FlClash 的 _indicatorDuration 一致
  const LEAD_PORTION = 0.6; // 前缘在这个比例内走完
  const TRAIL_START = 0.35; // 后缘从这个比例才开始
  const BAR_LENGTH = 16; // 静止时的墨痕长度（FlClash 的 _indicatorHeight）
  const BAR_WIDTH = 4; // 实心圆头；3px 在 2x 屏上偏细
  const MAX_TRAVEL = 460; // 绝对上限；另受视口 62% 约束
  const MAX_VIEWPORT_RATIO = 0.62;
  const LONG_PULSE = 20; // 超长距离时，目标处局部墨痕的行进距离
  const LONG_PULSE_DURATION = 220; // 局部墨痕的时长，比全程略短
  const LAYER_ID = "zenwashi-tab-ink-layer";
  const STROKE_ID = "zenwashi-tab-ink";
  const CLOSING_ATTR = "zenwashi-tab-closing";
  const INSTALL_TRIES = 100; // 最多等 10 秒（Sine 可能早于 Zen 初始化）

  // ---- 状态 ---------------------------------------------------------------
  let tabContainer = null;
  let scrollbox = null;
  let layer = null;
  let stroke = null;
  let lastTab = null;
  let raf = 0;
  let started = 0;
  let duration = DURATION;
  let fromY = 0;
  let toY = 0;
  let closeGuardUntil = 0;
  let installed = false;

  // ---- 小工具 -------------------------------------------------------------
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeInOutCubic = t =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function prefInt(name, fallback) {
    try {
      return Services.prefs.getIntPref(name);
    } catch (e) {
      return fallback;
    }
  }

  function enabled() {
    return prefInt(PREF, 0) === 1;
  }

  function reducedMotion() {
    try {
      return (
        win.gReduceMotion === true ||
        win.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch (e) {
      return false;
    }
  }

  function isVertical() {
    return tabContainer?.getAttribute("orient") === "vertical";
  }

  // ---- 测量 ---------------------------------------------------------------
  /**
   * 取一张标签的可见卡片矩形；不在主滚动列表里、hidden、aria-hidden、
   * 或者尺寸为 0 时返回 null。pinned/essential 在别的容器里，自然被排除。
   */
  function measure(tab) {
    if (!tab || !tab.isConnected) {
      return null;
    }
    if (!tab.closest("#tabbrowser-arrowscrollbox")) {
      return null;
    }
    if (tab.hidden || tab.getAttribute("aria-hidden") === "true") {
      return null;
    }
    const background = tab.querySelector(".tab-background") || tab;
    const rect = background.getBoundingClientRect();
    if (rect.height < 8 || rect.width < 8) {
      return null;
    }
    const rtl = win.getComputedStyle(tab).direction === "rtl";
    return {
      rect,
      rtl,
      // 卡片中心，再换算成一根 16px 墨痕的顶部
      barTop: rect.top + (rect.height - BAR_LENGTH) / 2,
    };
  }

  function ensureVisuals() {
    if (layer && stroke) {
      return;
    }
    layer = win.document.createElement("div");
    layer.id = LAYER_ID;
    layer.setAttribute("aria-hidden", "true");
    // 关键样式内联兜底：即使主题 CSS 没加载，也不会在 <html> 末尾占布局。
    layer.style.cssText =
      "position:fixed;overflow:hidden;pointer-events:none;" +
      "z-index:2147483000;contain:strict;";
    stroke = win.document.createElement("div");
    stroke.id = STROKE_ID;
    stroke.setAttribute("aria-hidden", "true");
    // 定位同样内联兜底：即使主题 CSS 没加载，墨痕也不会变成层里的静态块。
    stroke.style.position = "absolute";
    stroke.style.opacity = "0";
    layer.appendChild(stroke);
    win.document.documentElement.appendChild(layer);
  }

  function placeLayer() {
    if (!layer || !scrollbox) {
      return null;
    }
    const rect = scrollbox.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) {
      return null;
    }
    layer.style.left = rect.left + "px";
    layer.style.top = rect.top + "px";
    layer.style.width = rect.width + "px";
    layer.style.height = rect.height + "px";
    return rect;
  }

  // ---- 动画 ---------------------------------------------------------------
  function stop() {
    if (raf) {
      win.cancelAnimationFrame(raf);
      raf = 0;
    }
    if (stroke) {
      stroke.style.opacity = "0";
    }
  }

  function frame(now) {
    const t = clamp01((now - started) / duration);
    const lead = easeOutCubic(clamp01(t / LEAD_PORTION));
    const trail = easeInOutCubic(clamp01((t - TRAIL_START) / (1 - TRAIL_START)));

    // 与 FlClash 一致：向下切换时下缘先走，向上切换时上缘先走。
    const forward = toY >= fromY;
    const top = forward ? lerp(fromY, toY, trail) : lerp(fromY, toY, lead);
    const bottom = forward ? lerp(fromY, toY, lead) : lerp(fromY, toY, trail);

    stroke.style.top = top + "px";
    stroke.style.height = bottom - top + BAR_LENGTH + "px";

    // 入场 32ms；最后 16% 化开；抵达时归零。
    const fadeIn = easeOutCubic(clamp01(t / 0.1));
    const fadeOut = t <= 0.84 ? 1 : 1 - (t - 0.84) / 0.16;
    stroke.style.opacity = String(clamp01(0.9 * fadeIn * fadeOut));

    if (t < 1) {
      raf = win.requestAnimationFrame(frame);
      return;
    }
    raf = 0;
    stroke.style.opacity = "0";
  }

  function animate(from, to) {
    ensureVisuals();
    const viewport = placeLayer();
    if (!viewport) {
      stop();
      return;
    }

    const fromBarTop = from.barTop - viewport.top;
    const toBarTop = to.barTop - viewport.top;

    // 目标不在视口里时没有“目标处”可画（选中标签通常会被滚进来，这里只兜底）。
    if (toBarTop + BAR_LENGTH < 0 || toBarTop > viewport.height) {
      stop();
      return;
    }

    const signedTravel = toBarTop - fromBarTop;
    const limit = Math.min(MAX_TRAVEL, viewport.height * MAX_VIEWPORT_RATIO);
    let startBarTop = fromBarTop;
    duration = DURATION;

    // 超长距离：不画贯穿侧栏的长线，改成目标处一小段“流入”。
    // 目标在下方 → 从目标上方 20px 往下流；目标在上方 → 从目标下方 20px 往上流。
    if (Math.abs(signedTravel) > limit) {
      const direction = signedTravel >= 0 ? 1 : -1;
      startBarTop = toBarTop - direction * LONG_PULSE;
      startBarTop = Math.max(
        0,
        Math.min(viewport.height - BAR_LENGTH, startBarTop)
      );
      duration = LONG_PULSE_DURATION;
    }

    if (Math.abs(toBarTop - startBarTop) < 4) {
      stop();
      return;
    }

    // 墨痕贴在卡片的行内起点：LTR 左边、RTL 右边。
    const edge = to.rect;
    const left = to.rtl
      ? edge.right - viewport.left - BAR_WIDTH - 2
      : edge.left - viewport.left + 2;
    stroke.style.left = left + "px";
    stroke.style.width = BAR_WIDTH + "px";

    fromY = startBarTop;
    toY = toBarTop;
    stroke.style.top = fromY + "px";
    stroke.style.height = BAR_LENGTH + "px";
    stroke.style.opacity = "0";

    started = win.performance.now();
    win.cancelAnimationFrame(raf);
    raf = win.requestAnimationFrame(frame);
  }

  // ---- 事件 ---------------------------------------------------------------
  function onTabSelect(event) {
    const target = event.target;
    const toTab = target?.localName === "tab" ? target : win.gBrowser.selectedTab;
    const fromTab = event.detail?.previousTab || lastTab;

    lastTab = toTab;

    if (!enabled() || reducedMotion() || win.document.hidden) {
      stop();
      return;
    }

    // 关闭当前标签会走 TabSelect。两条独立的判据：
    //   1. js/tab-close.uc.js 在同一帧给根元素打的 zenwashi-tab-closing；
    //   2. 自己的 TabClose 守卫（不依赖另一个脚本是否安装）。
    if (
      win.document.documentElement.hasAttribute(CLOSING_ATTR) ||
      win.performance.now() < closeGuardUntil
    ) {
      stop();
      return;
    }

    if (!isVertical() || !fromTab || fromTab === toTab) {
      stop();
      return;
    }

    const from = measure(fromTab);
    const to = measure(toTab);
    if (!from || !to) {
      stop();
      return;
    }

    animate(from, to);
  }

  function onTabClose(event) {
    // 只在“被关掉的是当前标签”时设守卫；关后台标签不影响下一次切换。
    if (event.target === win.gBrowser.selectedTab) {
      closeGuardUntil = win.performance.now() + 600;
    }
  }

  function onResize() {
    stop();
  }

  function onPrefChange() {
    if (!enabled()) {
      stop();
    }
  }

  function destroy() {
    stop();
    if (tabContainer) {
      tabContainer.removeEventListener("TabSelect", onTabSelect);
      tabContainer.removeEventListener("TabClose", onTabClose);
    }
    win.removeEventListener("resize", onResize, true);
    try {
      Services.prefs.removeObserver(PREF, onPrefChange);
    } catch (e) {
      // 已经移除或从未注册成功，忽略。
    }
    layer?.remove();
    layer = null;
    stroke = null;
    tabContainer = null;
    scrollbox = null;
    installed = false;
    delete win.__zenwashiTabInk;
  }

  // ---- 安装 ---------------------------------------------------------------
  function install() {
    if (installed) {
      return true;
    }
    const browser = win.gBrowser;
    if (!browser?.tabContainer) {
      return false;
    }
    tabContainer = browser.tabContainer;
    scrollbox = win.document.getElementById("tabbrowser-arrowscrollbox");
    if (!scrollbox) {
      return false;
    }

    lastTab = browser.selectedTab;
    tabContainer.addEventListener("TabSelect", onTabSelect);
    tabContainer.addEventListener("TabClose", onTabClose);
    win.addEventListener("resize", onResize, true);
    win.addEventListener("unload", destroy, { once: true });
    try {
      Services.prefs.addObserver(PREF, onPrefChange);
    } catch (e) {
      // 极少数情况下 prefs 服务不可用；动效仍可工作，只是不能即时关掉。
    }
    installed = true;
    return true;
  }

  if (!install()) {
    let tries = 0;
    const timer = win.setInterval(() => {
      if (install() || ++tries > INSTALL_TRIES) {
        win.clearInterval(timer);
      }
    }, 100);
  }
})();
