// ==UserScript==
// @name           Zen Washi Tab Close
// @description    和纸抽离式标签关闭动效（WAAPI 时间轴 + 让位收拢）
// @version        1.0.0
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

/* =============================================================================
 * 为什么关闭动效必须用 JS，而不是 CSS
 * =============================================================================
 * Zen 1.23.x 的关闭链路（见 MAINTENANCE_GUIDE §5.8）：
 *
 *   gBrowser.removeTab()
 *     → #beginRemoveTab() 只做 `tab.closing = true`（普通 JS 属性，不是 attribute）
 *     → gZenVerticalTabsManager.animateItemClose(tab)   ← 本脚本 override 的就是它
 *        WAAPI：opacity 1→0、scale 1→0.95、非末项时 margin-bottom 0→-height，0.1s/easeOut
 *     → promise 结束后 _endRemoveTab() 同步删除节点
 *
 * 因此 CSS 的 [closing] 永远匹配不到；节点又会在动画结束时立刻删除，
 * 所以时间轴、曲线、让位方式只能在 JS 侧接管。
 *
 * =============================================================================
 * 本脚本做的四件事
 * =============================================================================
 * 1. 视觉离场：整行 opacity（从当前值，兼容休眠标签的 0.6）+ 2px 上浮，
 *    不再整行 scale（避免文字亚像素发虚）。
 * 2. 空间让位：动画关闭项自己的 margin-bottom，让后续行平滑上移。
 *    为什么不用 transform FLIP：标签列表里混有 zen-folder，文件夹的贯穿导轨
 *    是 ::after 按容器高度定位的；只移动「后续行」的话，文件夹盒子要等 DOM
 *    删除那一帧才收缩，导轨底边会突然跳一截，滚动条也要等删除后才更新。
 *    margin 方案与 Zen 原生同源：同一帧里多个 margin 变化只合并成一次布局
 *    （不是 N 次），文件夹 / 导轨 / 滚动条都自然跟随。
 * 3. 批量保护：同时关闭多个标签时最多 6 条动画，超出的直接交由 DOM 删除。
 * 4. 切换降级：关闭当前标签会顺带触发 0.42–0.58s 的内容切换动效，
 *    这里在关闭同一帧给根元素打标记，让切换直接落位（可选，默认开）。
 *
 * =============================================================================
 * 可维护性
 * =============================================================================
 * - animateItemClose 在 Zen 1.23.2b→1.23.4b 之间从 ZenUIManager 搬到了
 *   ZenVerticalTabsManager。脚本用轮询 + 特性检测安装，方法不存在时会安静放弃，
 *   不会在控制台刷错误；Zen 升级后先检查这里，再看 §5.8。
 * - 所有可调参数集中在下方常量，时间轴改动不需要碰逻辑。
 */

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
  const MODE_OFF = 0;
  const MODE_SLIDE = 1; // 默认：170ms 淡出 + 2px 上浮 + 让位
  const MODE_FADE = 2; // 130ms 淡出 + 让位，无上浮（更短、更克制）
  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
  const EXIT_MS = 170;
  const FADE_MS = 130;
  const MAX_ANIM = 6; // 同一时刻最多跑几条关闭动画，超出的直接删除
  const ABORT_FRAMES = 12; // 关闭被中止时，最多等多少帧再回滚动画

  const ATTR_CLOSING = "zenwashi-closing";
  const ATTR_SWITCH = "zenwashi-tab-closing";
  const ATTR_JUST_CLOSED = "zenwashi-tab-just-closed";

  let activeCloses = 0;
  const rootAttrTimers = new Map();

  // ---- 小工具 -------------------------------------------------------------
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

  // 同一个属性可能被连续多次关闭反复设置，重置计时器而不是叠加。
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

  // 关闭项的高度 = margin box 高度；移除后整个列表会上移这么多。
  // 同时取样当前 opacity：休眠标签是 0.6，从 1 开始淡出会闪一下。
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
  // 返回值必须是一个 Promise：removeTab 会在它 resolve 之后调用 _endRemoveTab()。
  function animateClose(item) {
    if (!item || !item.isConnected) {
      return Promise.resolve();
    }
    // 与 Zen 原生保持一致：Essentials、分屏组、减弱动效、后台窗口都不做。
    if (item.hasAttribute("zen-essential")) {
      return Promise.resolve();
    }
    if (item.group?.hasAttribute("split-view-group")) {
      return Promise.resolve();
    }
    if (win.gReduceMotion || win.document.hidden) {
      return Promise.resolve();
    }

    const mode = prefInt(PREF_MODE, MODE_SLIDE);
    if (mode === MODE_OFF) {
      return Promise.resolve();
    }

    const { height, marginBottom, opacity } = measureItem(item);
    // 不可见（折叠文件夹里的标签、display:none）没有动画的意义，也不该拖延关闭。
    if (height < 1) {
      return Promise.resolve();
    }
    if (activeCloses >= MAX_ANIM) {
      return Promise.resolve();
    }

    const duration = mode === MODE_FADE ? FADE_MS : EXIT_MS;
    const lift = mode === MODE_FADE ? 0 : -2;

    if (prefBool(PREF_SIMPLIFY, true)) {
      // 覆盖内容切换的 0.42–0.58s；切换在同一帧发生，过渡不会启动。
      pulseRootAttr(ATTR_SWITCH, duration + 180);
    }
    // 列表上移后指针会落到下一行，短暂抑制关闭按钮浮现。
    pulseRootAttr(ATTR_JUST_CLOSED, duration + 160);

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
            translate: `0px ${lift}px`,
            // 让后续行上移 margin box 的高度：最终值正好抵消移除后的布局位移。
            marginBottom: `${marginBottom - height}px`,
          },
        ],
        { duration, easing: EASE, fill: "forwards" }
      );
    } catch (e) {
      // 动画不可用（极老版本 / 元素已销毁）时退回原生行为：立即删除。
      console.error("[zen-washi] tab close animation failed:", e);
      item.removeAttribute(ATTR_CLOSING);
      activeCloses = Math.max(0, activeCloses - 1);
      return Promise.resolve();
    }

    return new Promise(resolve => {
      win.setTimeout(() => {
        // 先 resolve：removeTab 会在微任务里同步执行 _endRemoveTab() 并删除节点。
        resolve();
        activeCloses = Math.max(0, activeCloses - 1);

        // 正常路径下节点下一帧就没了，cancel 是空操作；
        // 若关闭被中止（节点仍在），取消动画把行、margin 都还原。
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
              // 元素已销毁时 cancel 可能抛 AbortError，忽略。
            }
            item.removeAttribute(ATTR_CLOSING);
          }
        };
        win.requestAnimationFrame(settle);
      }, duration);
    });
  }

  // ---- 安装 ---------------------------------------------------------------
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
    // Sine 的脚本可能早于 Zen 的模块初始化，最多等 10 秒。
    let tries = 0;
    const timer = win.setInterval(() => {
      if (install() || ++tries > 100) {
        win.clearInterval(timer);
      }
    }, 100);
  }
})();
