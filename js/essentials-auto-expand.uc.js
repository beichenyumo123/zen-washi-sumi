// ==UserScript==
// @name           Zen Washi Essentials Auto Expand
// @description    以临界阻尼弹簧驱动 Essentials 的折叠与展开（零延迟响应、途中可打断反向、贴合真实行高），并在选中隐藏项时自动展开
// @version        0.2.0
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(() => {
  "use strict";

  const win = window;
  if (win.__zenwashiEssentialsAutoExpand) {
    return;
  }
  win.__zenwashiEssentialsAutoExpand = true;

  const PREF = "zenwashi.essentials.hover-expand";
  const ATTR_SELECTED_HIDDEN = "zenwashi-essentials-selected-hidden";
  const ATTR_SPRING = "zenwashi-essentials-spring";

  // 临界阻尼弹簧参数（Apple UI 默认：damping = 1.0 无过冲，response = 0.26s 轻快跟手）
  const SPRING_RESPONSE_SEC = 0.26;
  const SPRING_OMEGA = (2 * Math.PI) / SPRING_RESPONSE_SEC;
  const LEAVE_GRACE_MS = 130; // 仅作用于移出边缘防误触；移入与切页均为 0ms 响应
  const SETTLE_DIST_PX = 0.25;
  const SETTLE_VEL_PX = 2.0;
  const REVEAL_SLIDE_PX = 6;
  const REVEAL_MIN_SCALE = 0.96;
  const INSTALL_TRIES = 100;

  const root = win.document.documentElement;
  const states = new Map();
  const openPopups = new Set();

  let rafId = 0;
  let lastFrameTime = 0;
  let syncRafId = 0;
  let installed = false;

  // ---- 小工具 -------------------------------------------------------------
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const clamp01 = v => clamp(v, 0, 1);

  function setStyle(style, prop, value, priority = "important") {
    const next = String(value);
    if (
      style.getPropertyValue(prop) === next &&
      style.getPropertyPriority(prop) === priority
    ) {
      return;
    }
    style.setProperty(prop, next, priority);
  }

  function clearStyle(style, prop) {
    if (style.getPropertyValue(prop)) {
      style.removeProperty(prop);
    }
  }

  function getHoverMode() {
    try {
      return Services.prefs.getStringPref(PREF, "1row");
    } catch {
      return "1row";
    }
  }

  function reducedMotion() {
    try {
      return (
        win.gReduceMotion === true ||
        win.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch {
      return false;
    }
  }

  function isSidebarExpanded() {
    return root.getAttribute("zen-sidebar-expanded") === "true";
  }

  function getCssCollapsedLimit(mode) {
    const raw = win
      .getComputedStyle(root)
      .getPropertyValue("--zenwashi-essentials-collapsed-height");
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return mode === "2rows" ? 103 : 53;
  }

  function getContainers() {
    const list = Array.from(
      win.document.querySelectorAll(
        ".zen-essentials-container, #zen-essentials-container"
      )
    );
    if (list.length > 0) {
      return list;
    }
    const fallback = win.document.getElementById("zen-essentials");
    return fallback ? [fallback] : [];
  }

  // ---- 几何测量（只在静止或结构变化时调用，绝不放进逐帧 rAF） ------------
  function measureContainer(container, mode) {
    const cs = win.getComputedStyle(container);
    if (cs.display === "none" || cs.visibility === "hidden") {
      return { collapsible: false };
    }

    const containerRect = container.getBoundingClientRect();
    if (containerRect.width <= 0) {
      return { collapsible: false };
    }

    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const borderTop = parseFloat(cs.borderTopWidth) || 0;
    const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
    const vertChrome =
      cs.boxSizing === "border-box"
        ? 0
        : padTop + padBottom + borderTop + borderBottom;

    const tabs = Array.from(
      container.querySelectorAll(
        ".tabbrowser-tab:not([hidden]):not([aria-hidden='true'])"
      )
    );
    const rows = [];
    for (const tab of tabs) {
      const r = tab.getBoundingClientRect();
      if (r.height <= 0 || r.width <= 0) {
        continue;
      }
      let row = rows.find(rw => Math.abs(rw.top - r.top) < 6);
      if (!row) {
        row = { top: r.top, bottom: r.bottom, entries: [] };
        rows.push(row);
      } else {
        row.top = Math.min(row.top, r.top);
        row.bottom = Math.max(row.bottom, r.bottom);
      }
      row.entries.push({
        tab,
        visual: tab.querySelector(".tab-stack") || tab,
      });
    }
    rows.sort((a, b) => a.top - b.top);

    const maxRows = mode === "2rows" ? 2 : 1;
    if (rows.length <= maxRows) {
      return {
        collapsible: false,
        width: containerRect.width,
        vertChrome,
        allEntries: rows.flatMap(r => r.entries),
      };
    }

    const lastVisibleRow = rows[maxRows - 1];
    const firstHiddenRow = rows[maxRows];
    const lastRow = rows[rows.length - 1];

    const visibleBottomRel = lastVisibleRow.bottom - containerRect.top;
    const hiddenTopRel = firstHiddenRow.top - containerRect.top;
    const cssLimitBorderBox = getCssCollapsedLimit(mode) + vertChrome;
    const minSafe = visibleBottomRel + 2;
    const maxSafe = Math.max(minSafe, hiddenTopRel - 1);
    const collapsedBorderBox = clamp(cssLimitBorderBox, minSafe, maxSafe);
    const expandedBorderBox = Math.ceil(
      lastRow.bottom - containerRect.top + Math.max(padBottom, 3) + borderBottom
    );

    const collapsedHeight = Math.max(0, collapsedBorderBox - vertChrome);
    const expandedHeight = Math.max(
      collapsedHeight,
      expandedBorderBox - vertChrome
    );
    if (expandedHeight - collapsedHeight < 4) {
      return {
        collapsible: false,
        width: containerRect.width,
        vertChrome,
        allEntries: rows.flatMap(r => r.entries),
      };
    }

    const hiddenRows = rows.slice(maxRows);
    const hiddenTabSet = new Set();
    for (const row of hiddenRows) {
      for (const entry of row.entries) {
        hiddenTabSet.add(entry.tab);
      }
    }

    return {
      collapsible: true,
      width: containerRect.width,
      vertChrome,
      collapsedHeight,
      expandedHeight,
      visibleEntries: rows.slice(0, maxRows).flatMap(r => r.entries),
      hiddenRows,
      hiddenTabSet,
    };
  }

  // ---- 样式写入 -----------------------------------------------------------
  function clearTabReveal(entry) {
    clearStyle(entry.visual.style, "opacity");
    clearStyle(entry.visual.style, "transform");
    clearStyle(entry.visual.style, "will-change");
    clearStyle(entry.tab.style, "pointer-events");
  }

  function releaseContainer(state) {
    if (state.leaveTimer) {
      win.clearTimeout(state.leaveTimer);
      state.leaveTimer = 0;
    }
    const { el } = state;
    clearStyle(el.style, "height");
    clearStyle(el.style, "max-height");
    clearStyle(el.style, "overflow");
    clearStyle(el.style, "will-change");
    for (const tab of el.querySelectorAll(".tabbrowser-tab")) {
      const visual = tab.querySelector(".tab-stack") || tab;
      clearStyle(visual.style, "opacity");
      clearStyle(visual.style, "transform");
      clearStyle(visual.style, "will-change");
      clearStyle(tab.style, "pointer-events");
    }
    state.animating = false;
    state.settledExpanded = false;
    state.currentHeight = null;
    state.targetHeight = null;
    state.velocity = 0;
  }

  function applyFrame(state, height, reduce) {
    const { el, metrics } = state;
    const { collapsedHeight, expandedHeight, visibleEntries, hiddenRows } = metrics;
    const hPx = `${height.toFixed(2)}px`;

    setStyle(el.style, "height", hPx);
    setStyle(el.style, "max-height", hPx);
    setStyle(el.style, "overflow", "hidden");

    for (const entry of visibleEntries) {
      clearTabReveal(entry);
    }

    const span = Math.max(1, expandedHeight - collapsedHeight);
    const progress = clamp01((height - collapsedHeight) / span);
    const rowCount = hiddenRows.length;

    for (let i = 0; i < rowCount; i++) {
      const start = rowCount > 1 ? Math.min(0.32, i * 0.14) : 0;
      const t = clamp01((progress - start) / (1 - start));
      const opacity = 1 - (1 - t) * (1 - t);
      const ty = -REVEAL_SLIDE_PX * (1 - t);
      const scale = REVEAL_MIN_SCALE + (1 - REVEAL_MIN_SCALE) * t;
      const hiddenPointer = t <= 0.3;

      for (const entry of hiddenRows[i].entries) {
        if (reduce) {
          setStyle(entry.visual.style, "opacity", t > 0.5 ? "1" : "0");
          clearStyle(entry.visual.style, "transform");
        } else {
          setStyle(entry.visual.style, "opacity", opacity.toFixed(3));
          setStyle(
            entry.visual.style,
            "transform",
            `translate3d(0, ${ty.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`
          );
        }
        if (hiddenPointer) {
          setStyle(entry.tab.style, "pointer-events", "none");
        } else {
          clearStyle(entry.tab.style, "pointer-events");
        }
      }
    }
  }

  function settleState(state, wantExpanded) {
    const { el, metrics } = state;
    state.animating = false;
    state.velocity = 0;
    clearStyle(el.style, "will-change");

    if (wantExpanded) {
      clearStyle(el.style, "height");
      clearStyle(el.style, "max-height");
      clearStyle(el.style, "overflow");
      for (const entry of metrics.visibleEntries) {
        clearTabReveal(entry);
      }
      for (const row of metrics.hiddenRows) {
        for (const entry of row.entries) {
          clearTabReveal(entry);
        }
      }
      state.currentHeight = metrics.expandedHeight;
      state.settledExpanded = true;
      return;
    }

    applyFrame(state, metrics.collapsedHeight, reducedMotion());
    for (const row of metrics.hiddenRows) {
      for (const entry of row.entries) {
        clearStyle(entry.visual.style, "will-change");
      }
    }
    state.currentHeight = metrics.collapsedHeight;
    state.settledExpanded = false;
  }

  // ---- 临界阻尼弹簧解析步进 ---------------------------------------------
  function stepCriticallyDamped(current, velocity, target, dt) {
    const y0 = current - target;
    const exp = Math.exp(-SPRING_OMEGA * dt);
    const b = velocity + SPRING_OMEGA * y0;
    return [
      target + (y0 + b * dt) * exp,
      (velocity - SPRING_OMEGA * b * dt) * exp,
    ];
  }

  function ensureAnimationLoop() {
    if (rafId) {
      return;
    }
    lastFrameTime = win.performance.now();
    rafId = win.requestAnimationFrame(onAnimationFrame);
  }

  function onAnimationFrame(now) {
    rafId = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
    lastFrameTime = now;

    const reduce = reducedMotion();
    let anyActive = false;

    for (const state of states.values()) {
      if (!state.animating || !state.metrics?.collapsible) {
        continue;
      }

      const target = state.targetHeight;
      const wantExpanded = state.wantExpanded;

      if (reduce) {
        settleState(state, wantExpanded);
        continue;
      }

      const [nextHeight, nextVel] = stepCriticallyDamped(
        state.currentHeight,
        state.velocity,
        target,
        dt
      );
      const clampedHeight = clamp(
        nextHeight,
        state.metrics.collapsedHeight,
        state.metrics.expandedHeight
      );
      state.currentHeight = clampedHeight;
      state.velocity = clampedHeight !== nextHeight ? 0 : nextVel;

      const dist = Math.abs(target - state.currentHeight);
      const speed = Math.abs(state.velocity);
      if (dist < SETTLE_DIST_PX && speed < SETTLE_VEL_PX) {
        settleState(state, wantExpanded);
        continue;
      }

      applyFrame(state, state.currentHeight, false);
      anyActive = true;
    }

    if (anyActive) {
      rafId = win.requestAnimationFrame(onAnimationFrame);
    }
  }

  // ---- 目标驱动与中断 -----------------------------------------------------
  function driveState(state, wantExpanded) {
    const { el, metrics } = state;
    if (!metrics?.collapsible) {
      releaseContainer(state);
      return;
    }

    const nextTarget = wantExpanded
      ? metrics.expandedHeight
      : metrics.collapsedHeight;
    state.wantExpanded = wantExpanded;
    state.targetHeight = nextTarget;

    if (reducedMotion()) {
      settleState(state, wantExpanded);
      return;
    }

    // 若从展开自适应态（height: auto）开始收起，先读一次当前实高锁定起点，零跳变切入弹簧
    if (!state.animating && state.settledExpanded && !wantExpanded) {
      const liveBorderBox = el.getBoundingClientRect().height;
      const liveHeight = Math.max(
        metrics.collapsedHeight,
        liveBorderBox - metrics.vertChrome
      );
      state.currentHeight = liveHeight;
      state.velocity = 0;
      state.settledExpanded = false;
    } else if (state.currentHeight === null) {
      // 首次初始化：直接落到目标静止态，不在启动时闪动动画
      settleState(state, wantExpanded);
      return;
    }

    const alreadySettled =
      !state.animating &&
      ((wantExpanded && state.settledExpanded) ||
        (!wantExpanded &&
          !state.settledExpanded &&
          Math.abs(state.currentHeight - nextTarget) < SETTLE_DIST_PX));
    if (alreadySettled) {
      return;
    }

    state.settledExpanded = false;
    state.animating = true;
    setStyle(el.style, "will-change", "height");
    for (const row of metrics.hiddenRows) {
      for (const entry of row.entries) {
        setStyle(entry.visual.style, "will-change", "transform, opacity");
      }
    }
    applyFrame(state, state.currentHeight, false);
    ensureAnimationLoop();
  }

  function hasKeyboardFocus(el) {
    try {
      return el.matches(":has(:focus-visible)");
    } catch {
      return el.matches(":focus-within");
    }
  }

  function isTriggerInside(popup, container) {
    const trigger = popup?.triggerNode || win.TabContextMenu?.contextTab;
    return Boolean(trigger && container.contains(trigger));
  }

  function shouldExpandState(state, selectedTab) {
    const { el, metrics } = state;
    if (!metrics?.collapsible) {
      return false;
    }
    if (
      state.hovered ||
      state.focusWithin ||
      state.dragging ||
      (openPopups.size > 0 && state.popupOwned) ||
      el.matches(":hover") ||
      hasKeyboardFocus(el)
    ) {
      return true;
    }
    return Boolean(selectedTab && metrics.hiddenTabSet.has(selectedTab));
  }

  // ---- 容器注册与监听 -----------------------------------------------------
  function attachContainer(container) {
    if (states.has(container)) {
      return states.get(container);
    }

    const state = {
      el: container,
      hovered: container.matches(":hover"),
      focusWithin: hasKeyboardFocus(container),
      dragging: false,
      popupOwned: false,
      leaveTimer: 0,
      metrics: null,
      currentHeight: null,
      targetHeight: null,
      velocity: 0,
      wantExpanded: false,
      settledExpanded: false,
      animating: false,
      lastWidth: 0,
    };

    const onPointerEnter = () => {
      if (state.leaveTimer) {
        win.clearTimeout(state.leaveTimer);
        state.leaveTimer = 0;
      }
      state.hovered = true;
      updateSingle(state);
    };

    const onPointerLeave = () => {
      state.hovered = false;
      if (state.leaveTimer) {
        win.clearTimeout(state.leaveTimer);
      }
      state.leaveTimer = win.setTimeout(() => {
        state.leaveTimer = 0;
        updateSingle(state);
      }, LEAVE_GRACE_MS);
    };

    const onFocusIn = () => {
      state.focusWithin = hasKeyboardFocus(container);
      if (state.focusWithin) {
        updateSingle(state);
      }
    };

    const onFocusOut = () => {
      win.queueMicrotask(() => {
        if (!container.isConnected) {
          return;
        }
        state.focusWithin = hasKeyboardFocus(container);
        updateSingle(state);
      });
    };

    const onDragStart = () => {
      state.dragging = true;
      updateSingle(state);
    };

    const onDragEnd = () => {
      state.dragging = false;
      scheduleSync();
    };

    const resizeObserver = new win.ResizeObserver(entries => {
      const entry = entries[0];
      const w = entry?.contentRect?.width ?? container.getBoundingClientRect().width;
      // 忽略我们自己弹簧改变高度引起的 ResizeObserver 回调，彻底杜绝动画期间的布局抖动
      if (state.animating && Math.abs(w - state.lastWidth) <= 0.5) {
        return;
      }
      if (Math.abs(w - state.lastWidth) > 0.5 || !state.animating) {
        state.lastWidth = w;
        scheduleSync();
      }
    });

    const mutationObserver = new win.MutationObserver(() => {
      scheduleSync();
    });

    container.addEventListener("pointerenter", onPointerEnter);
    container.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    container.addEventListener("dragstart", onDragStart);
    container.addEventListener("dragend", onDragEnd);
    container.addEventListener("drop", onDragEnd);
    resizeObserver.observe(container);
    mutationObserver.observe(container, {
      childList: true,
      subtree: false,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden"],
    });

    state.dispose = () => {
      releaseContainer(state);
      container.removeEventListener("pointerenter", onPointerEnter);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      container.removeEventListener("dragstart", onDragStart);
      container.removeEventListener("dragend", onDragEnd);
      container.removeEventListener("drop", onDragEnd);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };

    states.set(container, state);
    return state;
  }

  function updateSingle(state) {
    const mode = getHoverMode();
    if (mode === "off" || !isSidebarExpanded()) {
      releaseContainer(state);
      syncSelectedHiddenAttr();
      return;
    }

    if (!state.metrics) {
      state.metrics = measureContainer(state.el, mode);
      state.lastWidth = state.metrics.width || 0;
    }

    const selectedTab = win.gBrowser?.selectedTab;
    const wantExpanded = shouldExpandState(state, selectedTab);
    syncSelectedHiddenAttr();
    driveState(state, wantExpanded);
  }

  function syncSelectedHiddenAttr() {
    const mode = getHoverMode();
    const selectedTab = win.gBrowser?.selectedTab;
    let isHiddenSelected = false;

    if (mode !== "off" && isSidebarExpanded() && selectedTab) {
      for (const state of states.values()) {
        if (state.metrics?.collapsible && state.metrics.hiddenTabSet.has(selectedTab)) {
          isHiddenSelected = true;
          break;
        }
      }
    }

    const hasAttr = root.hasAttribute(ATTR_SELECTED_HIDDEN);
    if (isHiddenSelected && !hasAttr) {
      root.setAttribute(ATTR_SELECTED_HIDDEN, "true");
    } else if (!isHiddenSelected && hasAttr) {
      root.removeAttribute(ATTR_SELECTED_HIDDEN);
    }
  }

  function syncAll() {
    syncRafId = 0;
    const mode = getHoverMode();
    const expandedSidebar = isSidebarExpanded();
    const containers = getContainers();
    const activeSet = new Set(containers);

    for (const [el, state] of states.entries()) {
      if (!activeSet.has(el) || !el.isConnected) {
        state.dispose();
        states.delete(el);
      }
    }

    if (mode === "off" || !expandedSidebar) {
      for (const state of states.values()) {
        releaseContainer(state);
      }
      syncSelectedHiddenAttr();
      return;
    }

    for (const container of containers) {
      const state = attachContainer(container);
      state.metrics = measureContainer(container, mode);
      state.lastWidth = state.metrics.width || 0;
    }

    const selectedTab = win.gBrowser?.selectedTab;
    syncSelectedHiddenAttr();

    for (const state of states.values()) {
      const wantExpanded = shouldExpandState(state, selectedTab);
      driveState(state, wantExpanded);
    }
  }

  function scheduleSync() {
    if (syncRafId) {
      return;
    }
    syncRafId = win.requestAnimationFrame(syncAll);
  }

  // ---- 全局事件与生命周期 -----------------------------------------------
  const rootObserver = new win.MutationObserver(() => {
    scheduleSync();
  });

  const prefObserver = {
    observe() {
      scheduleSync();
    },
  };

  function onPopupShown(event) {
    const popup = event.target;
    for (const state of states.values()) {
      if (isTriggerInside(popup, state.el)) {
        openPopups.add(popup);
        state.popupOwned = true;
        updateSingle(state);
        return;
      }
    }
  }

  function onPopupHidden(event) {
    if (!openPopups.delete(event.target)) {
      return;
    }
    if (openPopups.size === 0) {
      for (const state of states.values()) {
        if (state.popupOwned) {
          state.popupOwned = false;
          updateSingle(state);
        }
      }
    }
  }

  function onTabSelect() {
    // 切换标签页时立即响应（0ms 延迟），若切走且未悬停则马上收起
    for (const state of states.values()) {
      if (state.leaveTimer) {
        win.clearTimeout(state.leaveTimer);
        state.leaveTimer = 0;
      }
    }
    scheduleSync();
  }

  function install() {
    if (installed) {
      return true;
    }
    const containers = getContainers();
    if (containers.length === 0) {
      return false;
    }

    installed = true;
    root.setAttribute(ATTR_SPRING, "true");
    syncAll();

    rootObserver.observe(root, {
      attributes: true,
      attributeFilter: ["zen-sidebar-expanded"],
    });
    win.addEventListener("TabSelect", onTabSelect);
    win.addEventListener("ZenWorkspacesSwitched", scheduleSync);
    win.document.addEventListener("popupshown", onPopupShown, true);
    win.document.addEventListener("popuphidden", onPopupHidden, true);

    try {
      Services.prefs.addObserver(PREF, prefObserver);
    } catch {}

    return true;
  }

  function destroy() {
    if (rafId) {
      win.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (syncRafId) {
      win.cancelAnimationFrame(syncRafId);
      syncRafId = 0;
    }
    for (const state of states.values()) {
      state.dispose();
    }
    states.clear();
    rootObserver.disconnect();
    win.removeEventListener("TabSelect", onTabSelect);
    win.removeEventListener("ZenWorkspacesSwitched", scheduleSync);
    win.document.removeEventListener("popupshown", onPopupShown, true);
    win.document.removeEventListener("popuphidden", onPopupHidden, true);
    try {
      Services.prefs.removeObserver(PREF, prefObserver);
    } catch {}
    root.removeAttribute(ATTR_SPRING);
    root.removeAttribute(ATTR_SELECTED_HIDDEN);
    delete win.__zenwashiEssentialsAutoExpand;
  }

  if (!install()) {
    win.addEventListener("load", install, { once: true });
    let tries = 0;
    const timer = win.setInterval(() => {
      if (install() || ++tries > INSTALL_TRIES) {
        win.clearInterval(timer);
      }
    }, 100);
  }

  win.addEventListener("unload", destroy, { once: true });
})();
