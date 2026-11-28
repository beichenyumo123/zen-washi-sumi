// ==UserScript==
// @name           Zen Washi Workspace Wheel
// @description    悬停底部工作区图标时平滑展开的苹果风轮盘：支持侧栏弧形与上方悬浮半圆扇形切换及一键卸载
// @version        0.4.0
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(() => {
  "use strict";

  const win = window;
  if (win.__zenwashiWorkspaceWheel) {
    return;
  }
  win.__zenwashiWorkspaceWheel = true;

  const PREF = "zenwashi.sidebar.workspace-wheel";
  const STYLE_PREF = "zenwashi.sidebar.workspace-wheel-style";
  const STYLE_ARC = "sidebar-arc";
  const STYLE_SEMICIRCLE = "top-semicircle";
  const HOST_ID = "zenwashi-workspace-wheel-host";
  const BRIDGE_ID = "zenwashi-workspace-wheel-bridge";
  const WHEEL_ID = "zenwashi-workspace-wheel";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const INSTALL_TRIES = 100;

  // 临界阻尼弹簧参数（Apple UI 默认：damping = 1.0 无过冲；可随时反向打断）
  const SPRING_OMEGA = (2 * Math.PI) / 0.25;
  const SECTOR_SPRING_OMEGA = (2 * Math.PI) / 0.16;
  const ANGLE_SPRING_OMEGA = (2 * Math.PI) / 0.14;
  const SCROLL_SPRING_OMEGA = (2 * Math.PI) / 0.24;
  const LEAVE_GRACE_MS = 120;
  const SETTLE_DIST = 0.002;
  const SETTLE_VEL = 0.015;
  const VIEWPORT_MARGIN = 10;
  const SIDEBAR_INSET = 6;
  const TRIGGER_GAP = 7;
  const SEMI_HOVER_EXPAND = 10;
  const SEMI_FOOTER_HEIGHT = 35;
  const ARC_FOOTER_HEIGHT = 36;

  const doc = win.document;
  const root = doc.documentElement;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const clamp01 = v => clamp(v, 0, 1);

  function rubberband(overshoot, dimension = 0.36, constant = 0.55) {
    if (overshoot === 0) {
      return 0;
    }
    const abs = Math.abs(overshoot);
    const val = (abs * dimension * constant) / (dimension + constant * abs);
    return overshoot > 0 ? val : -val;
  }

  function stepCriticallyDamped(current, velocity, target, dt, omega) {
    const y0 = current - target;
    const exp = Math.exp(-omega * dt);
    const b = velocity + omega * y0;
    return [
      target + (y0 + b * dt) * exp,
      (velocity - omega * b * dt) * exp,
    ];
  }

  function shortestAngleDelta(from, to) {
    return (((to - from) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  }

  function polar(cx, cy, r, angle) {
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  function isEnabled() {
    try {
      return Services.prefs.getBoolPref(PREF, true);
    } catch {
      return true;
    }
  }

  function getWheelStyle() {
    try {
      const val = Services.prefs.getStringPref(STYLE_PREF, STYLE_ARC);
      return val === STYLE_SEMICIRCLE ? STYLE_SEMICIRCLE : STYLE_ARC;
    } catch {
      return STYLE_ARC;
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

  function reducedTransparency() {
    try {
      return win.matchMedia("(prefers-reduced-transparency: reduce)").matches;
    } catch {
      return false;
    }
  }

  function isCompactMode() {
    return root.getAttribute("zen-compact-mode") === "true";
  }

  function isSidebarRightSide() {
    try {
      return Services.prefs.getBoolPref("zen.tabs.vertical.right-side", false);
    } catch {
      return false;
    }
  }

  function createSvgIcon(paths, size = 11) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const d of paths) {
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  const createUnloadSvg = (size = 11) =>
    createSvgIcon(["M12.7 9.9A5.4 5.4 0 0 1 6.1 3.3a5.5 5.5 0 1 0 6.6 6.6Z"], size);

  const createUnloadOthersSvg = (size = 11) =>
    createSvgIcon(
      [
        "M9.4 10.6A4.1 4.1 0 0 1 4.5 5.7a4.2 4.2 0 1 0 4.9 4.9Z",
        "M11.6 3.5v2.4",
        "M10.4 4.7h2.4",
      ],
      size
    );

  // ---- ZenWorkspaces 数据与操作 -----------------------------------------
  function getWorkspacesData() {
    const mgr = win.gZenWorkspaces;
    if (!mgr || typeof mgr.getWorkspaces !== "function") {
      return { workspaces: [], activeId: "" };
    }
    return {
      workspaces: mgr.getWorkspaces() || [],
      activeId: mgr.activeWorkspace || "",
    };
  }

  function resolveIcon(ws) {
    const mgr = win.gZenWorkspaces;
    const raw = ws?.icon || "";
    if (raw.endsWith(".svg")) {
      return { isSvg: true, value: raw };
    }
    if (mgr && typeof mgr.getWorkspaceIcon === "function") {
      const icon = mgr.getWorkspaceIcon(ws);
      if (icon && icon.endsWith(".svg")) {
        return { isSvg: true, value: icon };
      }
      return { isSvg: false, value: icon || Array.from(ws?.name || "?")[0] || "?" };
    }
    if (raw) {
      return { isSvg: false, value: raw };
    }
    return { isSvg: false, value: Array.from(ws?.name || "?")[0]?.toUpperCase() || "?" };
  }

  function getUnloadableTabs(workspaceId) {
    const mgr = win.gZenWorkspaces;
    const tabs = mgr?.allStoredTabs || [];
    const selectedTab = win.gBrowser?.selectedTab;
    return tabs.filter(
      tab =>
        tab.getAttribute("zen-workspace-id") === workspaceId &&
        !tab.hasAttribute("zen-empty-tab") &&
        !tab.hasAttribute("zen-essential") &&
        !tab.hasAttribute("pending") &&
        !tab.hasAttribute("discarded") &&
        tab !== selectedTab
    );
  }

  function getOtherUnloadableTabs(activeId) {
    const mgr = win.gZenWorkspaces;
    const tabs = mgr?.allStoredTabs || [];
    const selectedTab = win.gBrowser?.selectedTab;
    return tabs.filter(
      tab =>
        tab.getAttribute("zen-workspace-id") !== activeId &&
        !tab.hasAttribute("zen-empty-tab") &&
        !tab.hasAttribute("zen-essential") &&
        !tab.hasAttribute("pending") &&
        !tab.hasAttribute("discarded") &&
        tab !== selectedTab
    );
  }

  async function unloadSpecificWorkspace(workspaceId) {
    const tabs = getUnloadableTabs(workspaceId);
    if (tabs.length === 0) {
      return 0;
    }
    if (typeof win.gBrowser?.explicitUnloadTabs === "function") {
      await win.gBrowser.explicitUnloadTabs(tabs);
      return tabs.length;
    }
    if (
      workspaceId === win.gZenWorkspaces?.activeWorkspace &&
      typeof win.gZenWorkspaces?.unloadWorkspace === "function"
    ) {
      await win.gZenWorkspaces.unloadWorkspace();
      return tabs.length;
    }
    return 0;
  }

  async function unloadOtherWorkspaces(activeId) {
    const tabs = getOtherUnloadableTabs(activeId);
    if (tabs.length === 0) {
      return 0;
    }
    if (typeof win.gZenWorkspaces?.unloadAllOtherWorkspaces === "function") {
      await win.gZenWorkspaces.unloadAllOtherWorkspaces();
      return tabs.length;
    }
    if (typeof win.gBrowser?.explicitUnloadTabs === "function") {
      await win.gBrowser.explicitUnloadTabs(tabs);
      return tabs.length;
    }
    return 0;
  }

  // ---- 状态与 DOM ---------------------------------------------------------
  let installed = false;
  let triggerEl = null;
  let hostEl = null;
  let bridgeEl = null;
  let wheelEl = null;
  let dialEl = null;
  let svgEl = null;
  let sectorsGroupEl = null;
  let nodesLayerEl = null;
  let hubEl = null;
  let hubInnerEl = null;
  let hubIconEl = null;
  let hubMetaEl = null;
  let footerEl = null;
  let footerTargetEl = null;
  let footerTargetIconEl = null;
  let footerTargetNameEl = null;
  let footerUnloadActiveBtn = null;
  let footerUnloadActiveText = null;
  let footerUnloadOthersBtn = null;
  let footerUnloadOthersText = null;
  let activeArcEl = null;
  let dialArcEl = null;

  let sectorItems = [];
  let nodeItems = [];
  let sectorHovers = [];
  let sectorHoverVels = [];
  let currentWorkspaces = [];
  let currentActiveId = "";
  let wheelStyle = STYLE_ARC;
  let hoveredIdx = -1;
  let pinnedIdx = -1;

  // 几何状态（自适应侧边栏尺寸，收敛在侧栏宽度内）
  let cardWidth = 152;
  let dialHeight = 200;
  let cardHeight = 236;
  let pivotOnRight = false;
  let pivotX = 156;
  let pivotY = 100;
  let rIn = 40;
  let rOut = 200;
  let rNode = 94;
  let stepRad = 0.39;
  let halfWedgeRad = 0.185;
  let arcGapRad = 0.024;
  let arcSpanRad = Math.PI - 0.12;
  let scrollBound = 0;

  let wantOpen = false;
  let triggerHovered = false;
  let wheelHovered = false;
  let bridgeHovered = false;
  let leaveTimer = 0;
  let statusMessage = "";
  let statusTimer = 0;
  let ownedCompactAttr = false;

  // 弹簧物理状态
  let openProgress = 0;
  let openVelocity = 0;
  let dialOffset = 0;
  let dialTargetOffset = 0;
  let dialVelocity = 0;
  let dialVisible = false;
  let scrollOffset = 0;
  let scrollTarget = 0;
  let scrollVelocity = 0;
  let isDragging = false;
  let dragMoved = false;
  let dragStartCoord = 0;
  let dragLastCoord = 0;
  let dragLastTime = 0;
  let dragReleaseVel = 0;
  let dragStartScroll = 0;
  let rafId = 0;
  let lastFrameTime = 0;

  const isSemicircleMode = () => wheelStyle === STYLE_SEMICIRCLE;

  function setCompactKeepOpen(keep) {
    const toolbox = win.gNavToolbox || doc.getElementById("navigator-toolbox");
    if (!toolbox) {
      return;
    }
    if (keep && isCompactMode()) {
      if (!toolbox.hasAttribute("has-popup-menu")) {
        toolbox.setAttribute("has-popup-menu", "true");
        ownedCompactAttr = true;
      }
    } else if (ownedCompactAttr) {
      ownedCompactAttr = false;
      toolbox.removeAttribute("has-popup-menu");
    }
  }

  function describeAnnularWedge(cx, cy, innerR, outerR, startAngle, endAngle) {
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const p1 = polar(cx, cy, outerR, startAngle);
    const p2 = polar(cx, cy, outerR, endAngle);
    const p3 = polar(cx, cy, innerR, endAngle);
    const p4 = polar(cx, cy, innerR, startAngle);
    return (
      `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} ` +
      `A ${outerR.toFixed(2)} ${outerR.toFixed(2)} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} ` +
      `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)} ` +
      `A ${innerR.toFixed(2)} ${innerR.toFixed(2)} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)} Z`
    );
  }

  // 圆润花瓣扇形（四隅切角二次贝塞尔平滑过渡，视觉接近实体玻璃键帽）
  function describeRoundedAnnularWedge(cx, cy, r0, r1, a0, a1, cr0 = 4, cr1 = 7) {
    const span = a1 - a0;
    if (span <= 0.04 || r1 - r0 <= 4) {
      return describeAnnularWedge(cx, cy, r0, r1, a0, a1);
    }
    const maxRadial = Math.max(1, (r1 - r0) * 0.42);
    const effCr0 = Math.min(cr0, maxRadial, r0 * span * 0.36);
    const effCr1 = Math.min(cr1, maxRadial, r1 * span * 0.36);
    const da0 = effCr0 / Math.max(1, r0);
    const da1 = effCr1 / Math.max(1, r1);
    const largeArc = a1 - da1 - (a0 + da1) > Math.PI ? 1 : 0;
    const innerLargeArc = a1 - da0 - (a0 + da0) > Math.PI ? 1 : 0;

    const p1 = polar(cx, cy, r1 - effCr1, a0);
    const c1 = polar(cx, cy, r1, a0);
    const p2 = polar(cx, cy, r1, a0 + da1);
    const p3 = polar(cx, cy, r1, a1 - da1);
    const c2 = polar(cx, cy, r1, a1);
    const p4 = polar(cx, cy, r1 - effCr1, a1);
    const p5 = polar(cx, cy, r0 + effCr0, a1);
    const c3 = polar(cx, cy, r0, a1);
    const p6 = polar(cx, cy, r0, a1 - da0);
    const p7 = polar(cx, cy, r0, a0 + da0);
    const c4 = polar(cx, cy, r0, a0);
    const p8 = polar(cx, cy, r0 + effCr0, a0);

    return (
      `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} ` +
      `Q ${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} ` +
      `A ${r1.toFixed(2)} ${r1.toFixed(2)} 0 ${largeArc} 1 ${p3.x.toFixed(2)} ${p3.y.toFixed(2)} ` +
      `Q ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${p4.x.toFixed(2)} ${p4.y.toFixed(2)} ` +
      `L ${p5.x.toFixed(2)} ${p5.y.toFixed(2)} ` +
      `Q ${c3.x.toFixed(2)} ${c3.y.toFixed(2)} ${p6.x.toFixed(2)} ${p6.y.toFixed(2)} ` +
      `A ${r0.toFixed(2)} ${r0.toFixed(2)} 0 ${innerLargeArc} 0 ${p7.x.toFixed(2)} ${p7.y.toFixed(2)} ` +
      `Q ${c4.x.toFixed(2)} ${c4.y.toFixed(2)} ${p8.x.toFixed(2)} ${p8.y.toFixed(2)} Z`
    );
  }

  function describeArc(cx, cy, radius, startAngle, endAngle) {
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const p1 = polar(cx, cy, radius, startAngle);
    const p2 = polar(cx, cy, radius, endAngle);
    return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  function visualOffsetToAngle(offset) {
    if (isSemicircleMode()) {
      return -Math.PI / 2 + offset;
    }
    return pivotOnRight ? Math.PI - offset : offset;
  }

  function getToolboxRect() {
    const toolbox = win.gNavToolbox || doc.getElementById("navigator-toolbox");
    return toolbox?.getBoundingClientRect?.() || null;
  }

  function getArcMetrics(count, style = wheelStyle) {
    if (style === STYLE_SEMICIRCLE) {
      const gap = count >= 5 ? 0.052 : 0.068;
      if (count <= 5) {
        const span =
          count === 2 ? 2.08 : count === 3 ? 2.58 : count === 4 ? Math.PI - 0.1 : Math.PI - 0.08;
        const step = span / Math.max(1, count);
        return { span, step, gap, halfWedge: step / 2 - gap / 2, scrollMax: 0 };
      }
      const span = Math.PI - 0.08;
      const step = Math.PI / 5.2;
      const totalSpan = Math.max(0, (count - 1) * step);
      const maxVisibleSpan = 4.0 * step;
      return {
        span,
        step,
        gap,
        halfWedge: step / 2 - gap / 2,
        scrollMax: Math.max(0, (totalSpan - maxVisibleSpan) / 2),
      };
    }

    const step = count <= 3 ? 0.44 : count === 4 ? 0.37 : 0.33;
    const gap = 0.024;
    const totalSpan = Math.max(0, (count - 1) * step);
    const maxVisibleSpan = 3.55 * step;
    const bound = count > 5 ? Math.max(0, (totalSpan - maxVisibleSpan) / 2) : 0;
    return { span: totalSpan + step, step, gap, halfWedge: step / 2 - gap / 2, scrollMax: bound };
  }

  function computeLayout(count) {
    wheelStyle = getWheelStyle();
    const tbRect = getToolboxRect();
    const triggerRect = triggerEl?.getBoundingClientRect?.();
    const tbWidth = tbRect?.width || 0;
    const dockedInside = tbWidth >= 98;
    const semi = isSemicircleMode();

    pivotOnRight = isSidebarRightSide();

    if (dockedInside) {
      const inset = semi ? 5 : SIDEBAR_INSET;
      cardWidth = clamp(Math.round(tbWidth - inset * 2), 106, 240);
    } else {
      const availW = win.innerWidth - VIEWPORT_MARGIN * 2;
      cardWidth = clamp(Math.min(176, availW), 130, 188);
    }

    const footerH = semi ? SEMI_FOOTER_HEIGHT : ARC_FOOTER_HEIGHT;
    const maxDialAvail = Math.max(
      68,
      (triggerRect ? triggerRect.top - TRIGGER_GAP : win.innerHeight) -
        (tbRect && dockedInside ? tbRect.top + 8 : VIEWPORT_MARGIN) -
        footerH
    );

    const arc = getArcMetrics(count, wheelStyle);
    arcSpanRad = arc.span;
    stepRad = arc.step;
    arcGapRad = arc.gap;
    halfWedgeRad = arc.halfWedge;
    scrollBound = arc.scrollMax;

    let hubInset = 0;

    if (semi) {
      // 为悬浮扇区外扩保留 SEMI_HOVER_EXPAND 边距，展开后仍严格留在侧栏之内
      const maxSemiR = Math.min(Math.round(cardWidth / 2) - SEMI_HOVER_EXPAND, maxDialAvail - SEMI_HOVER_EXPAND - 2);
      const baseR = Math.max(46, maxSemiR);
      dialHeight = baseR + SEMI_HOVER_EXPAND + 3;
      cardHeight = dialHeight + footerH;
      pivotX = cardWidth / 2;
      pivotY = dialHeight - 2;
      rIn = clamp(Math.round(baseR * 0.3), 17, 26);
      rOut = baseR;
      rNode = Math.round(rIn + (rOut - rIn) * 0.56);
    } else {
      const visibleSlots = clamp(count, 2, 5);
      const slotPitch = cardWidth >= 140 ? 44 : 40;
      dialHeight = Math.min(clamp(visibleSlots * slotPitch + 22, 128, 242), maxDialAvail);
      cardHeight = dialHeight + footerH;
      rIn = clamp(Math.round(cardWidth * 0.27), 30, 48);
      hubInset = Math.round(rIn * 0.84);
      pivotX = pivotOnRight ? cardWidth + (rIn - hubInset) : -(rIn - hubInset);
      pivotY = dialHeight / 2;
      const oppositeReach = pivotOnRight ? pivotX : cardWidth - pivotX;
      rOut = Math.hypot(oppositeReach + 8, dialHeight / 2 + 8);
      rNode = rIn + Math.round((oppositeReach - rIn - 10) * 0.5);
    }

    return { dockedInside, tbRect, hubInset };
  }

  function ensureDom() {
    if (hostEl && hostEl.isConnected) {
      return;
    }

    hostEl = doc.createElement("div");
    hostEl.id = HOST_ID;
    hostEl.setAttribute("role", "dialog");
    hostEl.setAttribute("aria-label", "工作区轮盘");
    hostEl.style.cssText =
      "position:fixed;z-index:2147483000;pointer-events:none;opacity:0;visibility:hidden;";

    bridgeEl = doc.createElement("div");
    bridgeEl.id = BRIDGE_ID;
    hostEl.appendChild(bridgeEl);

    wheelEl = doc.createElement("div");
    wheelEl.id = WHEEL_ID;
    hostEl.appendChild(wheelEl);

    dialEl = doc.createElement("div");
    dialEl.className = "zenwashi-wheel-dial";

    svgEl = doc.createElementNS(SVG_NS, "svg");
    svgEl.classList.add("zenwashi-wheel-svg");
    sectorsGroupEl = doc.createElementNS(SVG_NS, "g");
    sectorsGroupEl.classList.add("zenwashi-wheel-sectors");
    svgEl.appendChild(sectorsGroupEl);
    dialEl.appendChild(svgEl);

    nodesLayerEl = doc.createElement("div");
    nodesLayerEl.className = "zenwashi-wheel-nodes";
    dialEl.appendChild(nodesLayerEl);

    hubEl = doc.createElement("div");
    hubEl.className = "zenwashi-wheel-hub";
    hubInnerEl = doc.createElement("div");
    hubInnerEl.className = "zenwashi-wheel-hub-inner";
    hubIconEl = doc.createElement("span");
    hubIconEl.className = "zenwashi-wheel-hub-icon";
    hubMetaEl = doc.createElement("span");
    hubMetaEl.className = "zenwashi-wheel-hub-meta";
    hubInnerEl.appendChild(hubIconEl);
    hubInnerEl.appendChild(hubMetaEl);
    hubEl.appendChild(hubInnerEl);
    dialEl.appendChild(hubEl);

    footerEl = doc.createElement("div");
    footerEl.className = "zenwashi-wheel-footer";

    footerTargetEl = doc.createElement("div");
    footerTargetEl.className = "zenwashi-wheel-footer-target";
    footerTargetIconEl = doc.createElement("span");
    footerTargetIconEl.className = "zenwashi-wheel-footer-icon";
    footerTargetNameEl = doc.createElement("span");
    footerTargetNameEl.className = "zenwashi-wheel-footer-name";
    footerTargetEl.appendChild(footerTargetIconEl);
    footerTargetEl.appendChild(footerTargetNameEl);

    footerUnloadActiveBtn = doc.createElement("button");
    footerUnloadActiveBtn.type = "button";
    footerUnloadActiveBtn.className = "zenwashi-wheel-footer-btn";
    footerUnloadActiveBtn.appendChild(createUnloadSvg(11));
    footerUnloadActiveText = doc.createElement("span");
    footerUnloadActiveText.textContent = "卸载";
    footerUnloadActiveBtn.appendChild(footerUnloadActiveText);

    footerUnloadOthersBtn = doc.createElement("button");
    footerUnloadOthersBtn.type = "button";
    footerUnloadOthersBtn.className = "zenwashi-wheel-footer-btn";
    footerUnloadOthersBtn.setAttribute("data-secondary", "true");
    footerUnloadOthersBtn.appendChild(createUnloadOthersSvg(11));
    footerUnloadOthersText = doc.createElement("span");
    footerUnloadOthersText.textContent = "其他";
    footerUnloadOthersBtn.appendChild(footerUnloadOthersText);

    footerEl.appendChild(footerTargetEl);
    footerEl.appendChild(footerUnloadActiveBtn);
    footerEl.appendChild(footerUnloadOthersBtn);

    wheelEl.appendChild(dialEl);
    wheelEl.appendChild(footerEl);

    wheelEl.addEventListener("pointerenter", onWheelEnter);
    wheelEl.addEventListener("pointerleave", onWheelElLeave);
    bridgeEl.addEventListener("pointerenter", onBridgeEnter);
    bridgeEl.addEventListener("pointerleave", onBridgeLeave);
    dialEl.addEventListener("pointermove", onDialPointerMove);
    dialEl.addEventListener("pointerleave", onDialPointerLeave);
    dialEl.addEventListener("pointerdown", onDialPointerDown);
    dialEl.addEventListener("pointerup", onDialPointerUp);
    dialEl.addEventListener("pointercancel", onDialPointerUp);
    dialEl.addEventListener("click", onDialClick);
    dialEl.addEventListener("wheel", onDialWheel, { passive: false });

    footerUnloadActiveBtn.addEventListener("click", async e => {
      e.stopPropagation();
      const targetWs = getDisplayTargetWorkspace();
      if (!targetWs) {
        return;
      }
      const unloaded = await unloadSpecificWorkspace(targetWs.uuid);
      if (unloaded > 0) {
        flashHubStatus(`释放 ${unloaded}`);
      }
      refreshDynamicState();
    });

    footerUnloadOthersBtn.addEventListener("click", async e => {
      e.stopPropagation();
      const unloaded = await unloadOtherWorkspaces(currentActiveId);
      if (unloaded > 0) {
        flashHubStatus(`休眠 ${unloaded}`);
      }
      refreshDynamicState();
    });

    root.appendChild(hostEl);
  }

  function getDisplayTargetWorkspace() {
    const activeWs =
      currentWorkspaces.find(w => w.uuid === currentActiveId) || currentWorkspaces[0];
    if (hoveredIdx >= 0 && currentWorkspaces[hoveredIdx]) {
      return currentWorkspaces[hoveredIdx];
    }
    if (isSemicircleMode() && pinnedIdx >= 0 && currentWorkspaces[pinnedIdx]) {
      return currentWorkspaces[pinnedIdx];
    }
    return activeWs || null;
  }

  function flashHubStatus(msg) {
    statusMessage = msg;
    if (statusTimer) {
      win.clearTimeout(statusTimer);
    }
    statusTimer = win.setTimeout(() => {
      statusTimer = 0;
      statusMessage = "";
      updateHubReadout();
    }, 1400);
  }

  function positionWheel(layoutInfo) {
    if (!triggerEl || !hostEl || !wheelEl || !bridgeEl) {
      return;
    }
    const rect = triggerEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const { dockedInside, tbRect } = layoutInfo || computeLayout(currentWorkspaces.length || 4);
    const triggerCx = rect.left + rect.width / 2;
    const triggerCy = rect.top + rect.height / 2;

    let left;
    let top;
    if (dockedInside && tbRect) {
      const idealLeft = tbRect.left + (tbRect.width - cardWidth) / 2;
      left = clamp(idealLeft, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, win.innerWidth - cardWidth - VIEWPORT_MARGIN));
      const minTop = Math.max(VIEWPORT_MARGIN, tbRect.top + 6);
      const maxTop = Math.max(minTop, win.innerHeight - cardHeight - VIEWPORT_MARGIN);
      top = clamp(rect.top - TRIGGER_GAP - cardHeight, minTop, maxTop);
    } else {
      const tbLeft = tbRect ? tbRect.left : rect.left;
      const tbRight = tbRect ? tbRect.right : rect.right;
      const preferredLeft = pivotOnRight
        ? tbLeft - TRIGGER_GAP - cardWidth
        : tbRight + TRIGGER_GAP;
      left = clamp(preferredLeft, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, win.innerWidth - cardWidth - VIEWPORT_MARGIN));
      top = clamp(
        triggerCy - cardHeight / 2,
        VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, win.innerHeight - cardHeight - VIEWPORT_MARGIN)
      );
    }

    const hostLeft = Math.min(left, rect.left);
    const hostTop = Math.min(top, rect.top);
    const hostRight = Math.max(left + cardWidth, rect.right);
    const hostBottom = Math.max(top + cardHeight, rect.bottom);

    hostEl.style.left = `${hostLeft.toFixed(1)}px`;
    hostEl.style.top = `${hostTop.toFixed(1)}px`;
    hostEl.style.width = `${(hostRight - hostLeft).toFixed(1)}px`;
    hostEl.style.height = `${(hostBottom - hostTop).toFixed(1)}px`;

    wheelEl.style.marginLeft = `${(left - hostLeft).toFixed(1)}px`;
    wheelEl.style.marginTop = `${(top - hostTop).toFixed(1)}px`;
    wheelEl.style.width = `${cardWidth}px`;
    wheelEl.style.height = `${cardHeight}px`;

    if (dockedInside) {
      const bridgeLeftAbs = Math.min(left, rect.left);
      const bridgeRightAbs = Math.max(left + cardWidth, rect.right);
      const gapTopAbs = top + cardHeight - 4;
      const gapBottomAbs = rect.top + 1;
      bridgeEl.style.left = `${(bridgeLeftAbs - hostLeft).toFixed(1)}px`;
      bridgeEl.style.width = `${Math.max(24, bridgeRightAbs - bridgeLeftAbs).toFixed(1)}px`;
      bridgeEl.style.top = `${(gapTopAbs - hostTop).toFixed(1)}px`;
      bridgeEl.style.height = `${Math.max(12, gapBottomAbs - gapTopAbs).toFixed(1)}px`;
    } else {
      const gapStartAbs = pivotOnRight ? left + cardWidth - 4 : rect.right - 2;
      const gapEndAbs = pivotOnRight ? rect.left + 1 : left + 4;
      bridgeEl.style.left = `${(gapStartAbs - hostLeft).toFixed(1)}px`;
      bridgeEl.style.width = `${Math.max(14, gapEndAbs - gapStartAbs).toFixed(1)}px`;
      bridgeEl.style.top = `${(rect.top - hostTop).toFixed(1)}px`;
      bridgeEl.style.height = `${Math.max(24, rect.height).toFixed(1)}px`;
    }

    const originX = clamp(triggerCx - left, 0, cardWidth);
    const originY = clamp(triggerCy - top, 0, cardHeight + 30);
    wheelEl.style.transformOrigin = `${originX.toFixed(1)}px ${originY.toFixed(1)}px`;
  }

  function renderIconInto(container, iconInfo) {
    container.textContent = "";
    if (iconInfo.isSvg) {
      const img = doc.createElement("img");
      img.className = "zenwashi-wheel-icon-img";
      img.src = iconInfo.value;
      img.alt = "";
      container.appendChild(img);
    } else {
      const span = doc.createElement("span");
      span.className = "zenwashi-wheel-emoji";
      span.textContent = iconInfo.value;
      container.appendChild(span);
    }
  }

  function computeSectorOffsets(count) {
    const semi = isSemicircleMode();
    const midIndex = (count - 1) / 2;

    if (semi && count <= 5) {
      // Dock 鱼眼角分配：总张角恒定，悬停花瓣自动挤开邻瓣保持匀称缝隙
      const weights = new Array(count);
      let sumW = 0;
      for (let i = 0; i < count; i++) {
        const w = 1 + 0.24 * clamp01(sectorHovers[i] || 0);
        weights[i] = w;
        sumW += w;
      }
      const totalSpan = arcSpanRad;
      let cursor = -totalSpan / 2;
      const result = new Array(count);
      for (let i = 0; i < count; i++) {
        const alloc = (weights[i] / sumW) * totalSpan;
        const centerOff = cursor + alloc / 2 - scrollOffset;
        const half = Math.max(0.08, alloc / 2 - arcGapRad / 2);
        result[i] = { centerOff, halfOff: half };
        cursor += alloc;
      }
      return result;
    }

    const activeIdx =
      hoveredIdx >= 0 ? hoveredIdx : semi ? pinnedIdx : -1;
    const activeH = activeIdx >= 0 ? clamp01(sectorHovers[activeIdx] || 0) : 0;
    const result = new Array(count);
    for (let i = 0; i < count; i++) {
      const h = clamp01(sectorHovers[i] || 0);
      let push = 0;
      if (activeIdx >= 0 && i !== activeIdx) {
        const dist = Math.abs(i - activeIdx);
        push = Math.sign(i - activeIdx) * (dist === 1 ? 0.036 : 0.016) * activeH;
      }
      const centerOff = (i - midIndex) * stepRad + push - scrollOffset;
      const half = halfWedgeRad + (semi ? 0.048 : 0.028) * h;
      result[i] = { centerOff, halfOff: half };
    }
    return result;
  }

  function updateSectorGeometry() {
    const count = sectorItems.length;
    if (!count) {
      return;
    }

    const semi = isSemicircleMode();
    const offsets = computeSectorOffsets(count);

    for (let i = 0; i < count; i++) {
      const h = clamp01(sectorHovers[i] || 0);
      const { centerOff, halfOff } = offsets[i];
      const theta = visualOffsetToAngle(centerOff);
      const a0 = theta - halfOff;
      const a1 = theta + halfOff;

      const innerR = semi ? rIn + 1.5 - 2.0 * h : rIn + 2.0 - 2.5 * h;
      const outerR = semi ? rOut + SEMI_HOVER_EXPAND * h : rOut;

      const sector = sectorItems[i];
      sector.baseOff = centerOff;
      sector.visOffStart = centerOff - halfOff;
      sector.visOffEnd = centerOff + halfOff;
      sector.theta = theta;

      const d = semi
        ? describeRoundedAnnularWedge(pivotX, pivotY, innerR, outerR, a0, a1, 3.8, 7.5 + 2 * h)
        : describeAnnularWedge(pivotX, pivotY, innerR, outerR, a0, a1);
      sector.el.setAttribute("d", d);

      if (i === activeArcEl?.__activeIdx && activeArcEl) {
        const arcHalf = Math.min(semi ? 0.24 : 0.19, halfOff * 0.68);
        activeArcEl.setAttribute(
          "d",
          describeArc(pivotX, pivotY, rIn + 2.5, theta - arcHalf, theta + arcHalf)
        );
      }

      const node = nodeItems[i];
      if (node) {
        const nodeR = rNode + (semi ? 5.5 : 3.5) * h;
        const nx = pivotX + nodeR * Math.cos(theta);
        const ny = pivotY + nodeR * Math.sin(theta);
        node.theta = theta;
        node.nx = nx;
        node.ny = ny;
        node.el.style.left = `${nx.toFixed(1)}px`;
        node.el.style.top = `${ny.toFixed(1)}px`;

        const p = clamp01(openProgress);
        const hoverScale = (semi ? 0.26 : 0.08) * h;
        if (reducedMotion()) {
          node.el.style.opacity = "1";
          node.el.style.transform = `translate(-50%, -50%) scale(${(1 + hoverScale).toFixed(4)})`;
        } else {
          const start = count > 1 ? (i / count) * 0.16 : 0;
          const localT = clamp01((p - start) / (1 - start));
          const ease = 1 - (1 - localT) * (1 - localT);
          const pull = (semi ? 9 : 8) * (1 - ease);
          const dirX = Math.cos(theta);
          const dirY = Math.sin(theta);
          const nodeScale = 0.88 + 0.12 * ease + hoverScale;
          node.el.style.opacity = ease.toFixed(3);
          node.el.style.transform =
            `translate(calc(-50% - ${(dirX * pull).toFixed(2)}px), ` +
            `calc(-50% - ${(dirY * pull).toFixed(2)}px)) ` +
            `scale(${nodeScale.toFixed(4)})`;
        }
      }
    }

    if (dialArcEl && count > 0) {
      const dialTheta = visualOffsetToAngle(dialOffset);
      const halfSpan = Math.min(semi ? 0.26 : 0.22, halfWedgeRad * 0.72);
      const arcR = semi ? Math.max(10, rIn - 1.5) : rIn + 2.5;
      dialArcEl.setAttribute(
        "d",
        describeArc(pivotX, pivotY, arcR, dialTheta - halfSpan, dialTheta + halfSpan)
      );
    }
  }

  function rebuildWheel() {
    ensureDom();
    const { workspaces, activeId } = getWorkspacesData();
    currentWorkspaces = workspaces;
    currentActiveId = activeId;

    if (!workspaces.length) {
      return;
    }

    const layoutInfo = computeLayout(workspaces.length);
    const { hubInset } = layoutInfo;
    const semi = isSemicircleMode();

    wheelEl.setAttribute("data-style", wheelStyle);
    wheelEl.setAttribute("data-pivot", pivotOnRight ? "right" : "left");
    wheelEl.setAttribute("data-scrollable", scrollBound > 0 ? "true" : "false");

    const maxNodeW = semi ? 38 : Math.max(54, cardWidth - hubInset - 22);
    wheelEl.style.setProperty("--zw-wheel-node-max-w", `${maxNodeW}px`);

    dialEl.style.width = `${cardWidth}px`;
    dialEl.style.height = `${dialHeight}px`;
    svgEl.setAttribute("viewBox", `0 0 ${cardWidth} ${dialHeight}`);

    // 中心轴心严格对称（半圆模式直接使用上凸半圆拱盒体，消除 clip-path 底边断线）
    const hubRadius = semi ? Math.max(13, rIn - 3) : rIn;
    const hubDiameter = hubRadius * 2;
    hubEl.style.width = `${hubDiameter}px`;
    if (semi) {
      hubEl.style.height = `${hubRadius}px`;
      hubEl.style.left = `${pivotX.toFixed(1)}px`;
      hubEl.style.top = `${(pivotY - hubRadius / 2).toFixed(1)}px`;
      hubInnerEl.style.paddingLeft = "0px";
      hubInnerEl.style.paddingRight = "0px";
      hubInnerEl.style.paddingTop = "2px";
      hubInnerEl.style.paddingBottom = "0px";
    } else {
      hubEl.style.height = `${hubDiameter}px`;
      hubEl.style.left = `${pivotX.toFixed(1)}px`;
      hubEl.style.top = `${pivotY.toFixed(1)}px`;
      const clippedSidePx = Math.max(0, rIn * 2 - hubInset);
      hubInnerEl.style.paddingTop = "0px";
      hubInnerEl.style.paddingBottom = "0px";
      hubInnerEl.style.paddingRight = pivotOnRight ? `${clippedSidePx + 2}px` : "2px";
      hubInnerEl.style.paddingLeft = pivotOnRight ? "2px" : `${clippedSidePx + 2}px`;
    }

    sectorsGroupEl.textContent = "";
    if (activeArcEl) {
      activeArcEl.remove();
      activeArcEl = null;
    }
    if (dialArcEl) {
      dialArcEl.remove();
      dialArcEl = null;
    }
    nodesLayerEl.textContent = "";
    sectorItems = [];
    nodeItems = [];

    const count = workspaces.length;
    sectorHovers = new Array(count).fill(0);
    sectorHoverVels = new Array(count).fill(0);
    const midIndex = (count - 1) / 2;

    for (let i = 0; i < count; i++) {
      const ws = workspaces[i];
      const isActive = ws.uuid === activeId;
      const baseOff = (i - midIndex) * stepRad - scrollOffset;

      const sector = doc.createElementNS(SVG_NS, "path");
      sector.classList.add("zenwashi-wheel-sector");
      if (isActive) {
        sector.setAttribute("data-active", "true");
      }
      sectorsGroupEl.appendChild(sector);
      sectorItems.push({
        el: sector,
        baseOff,
        visOffStart: baseOff - halfWedgeRad,
        visOffEnd: baseOff + halfWedgeRad,
        theta: visualOffsetToAngle(baseOff),
      });

      if (isActive && !semi) {
        activeArcEl = doc.createElementNS(SVG_NS, "path");
        activeArcEl.classList.add("zenwashi-wheel-active-arc");
        activeArcEl.__activeIdx = i;
        svgEl.appendChild(activeArcEl);
      }

      const nodeEl = doc.createElement("div");
      nodeEl.className = "zenwashi-wheel-node";
      nodeEl.setAttribute("zen-workspace-id", ws.uuid);
      if (isActive) {
        nodeEl.setAttribute("data-active", "true");
      }

      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "zenwashi-wheel-node-btn";
      btn.setAttribute("aria-label", ws.name || "工作区");

      const iconWrap = doc.createElement("span");
      iconWrap.className = "zenwashi-wheel-node-icon";
      renderIconInto(iconWrap, resolveIcon(ws));

      const label = doc.createElement("span");
      label.className = "zenwashi-wheel-node-name";
      label.textContent = ws.name || "";

      const loadedDot = doc.createElement("span");
      loadedDot.className = "zenwashi-wheel-loaded-dot";

      btn.appendChild(iconWrap);
      btn.appendChild(label);
      btn.appendChild(loadedDot);
      btn.addEventListener("click", e => {
        e.stopPropagation();
        if (dragMoved) {
          return;
        }
        activateWorkspace(ws.uuid);
      });

      const sliceUnload = doc.createElement("button");
      sliceUnload.type = "button";
      sliceUnload.className = "zenwashi-wheel-slice-unload";
      sliceUnload.appendChild(createUnloadSvg(10));
      sliceUnload.addEventListener("click", async e => {
        e.stopPropagation();
        const unloaded = await unloadSpecificWorkspace(ws.uuid);
        if (unloaded > 0) {
          flashHubStatus(`释放 ${unloaded}`);
        }
        refreshDynamicState();
      });

      nodeEl.appendChild(btn);
      nodeEl.appendChild(sliceUnload);
      nodesLayerEl.appendChild(nodeEl);
      nodeItems.push({ el: nodeEl, btn, unloadBtn: sliceUnload, ws, nx: 0, ny: 0, theta: 0 });
    }

    dialArcEl = doc.createElementNS(SVG_NS, "path");
    dialArcEl.classList.add("zenwashi-wheel-dial-arc");
    dialArcEl.setAttribute("data-visible", dialVisible ? "true" : "false");
    svgEl.appendChild(dialArcEl);

    refreshDynamicState();
    positionWheel(layoutInfo);
    updateSectorGeometry();
  }

  function refreshDynamicState() {
    const { activeId } = getWorkspacesData();
    currentActiveId = activeId;
    const highlightIdx = hoveredIdx >= 0 ? hoveredIdx : isSemicircleMode() ? pinnedIdx : -1;

    for (let i = 0; i < nodeItems.length; i++) {
      const item = nodeItems[i];
      const sector = sectorItems[i];
      const isActive = item.ws.uuid === activeId;
      const isHovered = i === highlightIdx;
      const count = getUnloadableTabs(item.ws.uuid).length;

      item.el.toggleAttribute("data-active", isActive);
      item.el.toggleAttribute("data-hovered", isHovered);
      item.el.setAttribute("data-loaded", count > 0 ? "true" : "false");
      item.el.setAttribute("data-unloadable", count > 0 ? "true" : "false");
      item.unloadBtn.setAttribute(
        "title",
        count > 0
          ? `卸载「${item.ws.name}」（释放 ${count} 个标签）`
          : `「${item.ws.name}」已休眠`
      );

      if (sector) {
        sector.el.toggleAttribute("data-active", isActive);
        sector.el.toggleAttribute("data-hovered", isHovered);
      }
    }

    if (activeArcEl) {
      activeArcEl.setAttribute("data-dimmed", highlightIdx >= 0 ? "true" : "false");
    }

    updateHubReadout();
  }

  function updateHubReadout() {
    if (!hubIconEl || !hubMetaEl || !footerUnloadActiveBtn) {
      return;
    }
    const activeWs =
      currentWorkspaces.find(w => w.uuid === currentActiveId) || currentWorkspaces[0];
    const targetWs = getDisplayTargetWorkspace();
    if (!targetWs) {
      return;
    }

    const semi = isSemicircleMode();
    const targetCount = getUnloadableTabs(targetWs.uuid).length;
    const activeCount = activeWs ? getUnloadableTabs(activeWs.uuid).length : 0;
    const otherCount = getOtherUnloadableTabs(currentActiveId).length;

    renderIconInto(hubIconEl, resolveIcon(targetWs));

    if (statusMessage) {
      hubMetaEl.textContent = statusMessage;
    } else if (targetCount > 0) {
      hubMetaEl.textContent = `${targetCount} 活跃`;
    } else {
      hubMetaEl.textContent = targetWs.uuid === currentActiveId ? "当前" : "轻载";
    }

    if (footerTargetIconEl && footerTargetNameEl) {
      renderIconInto(footerTargetIconEl, resolveIcon(targetWs));
      footerTargetNameEl.textContent = statusMessage || targetWs.name || "";
    }

    const compactBtns = cardWidth < 134;
    const actionWs = semi ? targetWs : activeWs;
    const actionCount = semi ? targetCount : activeCount;
    footerUnloadActiveBtn.setAttribute("data-has-count", actionCount > 0 ? "true" : "false");

    if (actionCount > 0) {
      footerUnloadActiveText.textContent = semi
        ? cardWidth < 146
          ? `卸载 ${actionCount}`
          : "卸载"
        : compactBtns
          ? `卸载(${actionCount})`
          : `卸载 (${actionCount})`;
    } else {
      footerUnloadActiveText.textContent = semi ? "" : compactBtns ? "已轻" : "已轻载";
    }
    footerUnloadActiveBtn.disabled = actionCount === 0;
    footerUnloadActiveBtn.title =
      actionCount > 0 && actionWs
        ? `卸载「${actionWs.name}」（释放 ${actionCount} 个标签）`
        : actionWs
          ? `「${actionWs.name}」已休眠，无需卸载`
          : "当前无后台标签";

    footerUnloadOthersBtn.setAttribute("data-empty", otherCount === 0 ? "true" : "false");
    footerUnloadOthersText.textContent =
      otherCount > 0 ? `其他 (${otherCount})` : compactBtns ? "已休" : "其他";
    footerUnloadOthersBtn.disabled = otherCount === 0;
    footerUnloadOthersBtn.title =
      otherCount > 0
        ? `卸载其他全部工作区（释放 ${otherCount} 个后台标签）`
        : "其余工作区均已休眠";
  }

  function updateHoveredSector(nextIdx, options = {}) {
    const keepPin = options.keepPin === true;
    const semi = isSemicircleMode();

    if (nextIdx >= 0) {
      pinnedIdx = nextIdx;
    } else if (!semi || !keepPin) {
      pinnedIdx = -1;
    }

    const effectiveIdx = nextIdx >= 0 ? nextIdx : semi && keepPin ? pinnedIdx : -1;
    if (nextIdx === hoveredIdx && (!semi || effectiveIdx === pinnedIdx)) {
      return;
    }
    hoveredIdx = nextIdx;

    if (effectiveIdx >= 0 && sectorItems[effectiveIdx]) {
      dialTargetOffset = sectorItems[effectiveIdx].baseOff;
      dialVisible = true;
    } else {
      dialVisible = false;
    }
    if (dialArcEl) {
      dialArcEl.setAttribute("data-visible", dialVisible ? "true" : "false");
    }
    ensureAnimationLoop();
    refreshDynamicState();
  }

  // ---- 逐帧物理渲染 -------------------------------------------------------
  function applyAnimationFrame() {
    if (!hostEl || !wheelEl) {
      return;
    }

    const p = clamp01(openProgress);
    const reduce = reducedMotion();
    const reduceTrans = reducedTransparency();

    if (p <= 0.001 && !wantOpen) {
      hostEl.style.opacity = "0";
      hostEl.style.visibility = "hidden";
      hostEl.removeAttribute("data-active");
      wheelEl.style.transform = "translate3d(0, 6px, 0) scale(0.86)";
      wheelEl.style.removeProperty("--zenwashi-wheel-backdrop-blur");
      setCompactKeepOpen(false);
      return;
    }

    hostEl.style.visibility = "visible";
    hostEl.setAttribute("data-active", "true");
    hostEl.style.opacity = p.toFixed(3);

    if (reduce) {
      wheelEl.style.transform = "translate3d(0, 0, 0) scale(1)";
      wheelEl.style.removeProperty("--zenwashi-wheel-backdrop-blur");
    } else {
      const scale = 0.86 + 0.14 * p;
      const liftY = 8 * (1 - p);
      wheelEl.style.transform = `translate3d(0, ${liftY.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
      if (!reduceTrans) {
        const blurPx = 6 + 16 * p;
        wheelEl.style.setProperty("--zenwashi-wheel-backdrop-blur", `${blurPx.toFixed(1)}px`);
      } else {
        wheelEl.style.removeProperty("--zenwashi-wheel-backdrop-blur");
      }
    }

    updateSectorGeometry();
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
    let active = false;

    const target = wantOpen ? 1 : 0;
    if (reduce) {
      openProgress = target;
      openVelocity = 0;
    } else {
      const [nextP, nextV] = stepCriticallyDamped(
        openProgress,
        openVelocity,
        target,
        dt,
        SPRING_OMEGA
      );
      openProgress = clamp(nextP, 0, 1.04);
      openVelocity = nextV;
      if (
        Math.abs(target - openProgress) > SETTLE_DIST ||
        Math.abs(openVelocity) > SETTLE_VEL
      ) {
        active = true;
      } else {
        openProgress = target;
        openVelocity = 0;
      }
    }

    // 每扇区独立放大/收缩弹簧（Mac Dock 径向放大）
    const activeHoverIdx =
      hoveredIdx >= 0 ? hoveredIdx : isSemicircleMode() ? pinnedIdx : -1;
    for (let i = 0; i < sectorHovers.length; i++) {
      const targetH = i === activeHoverIdx ? 1 : 0;
      if (reduce) {
        sectorHovers[i] = targetH;
        sectorHoverVels[i] = 0;
      } else if (
        Math.abs(targetH - sectorHovers[i]) > 0.003 ||
        Math.abs(sectorHoverVels[i]) > 0.015
      ) {
        const [nextH, nextHv] = stepCriticallyDamped(
          sectorHovers[i],
          sectorHoverVels[i],
          targetH,
          dt,
          SECTOR_SPRING_OMEGA
        );
        sectorHovers[i] = clamp01(nextH);
        sectorHoverVels[i] = nextHv;
        active = true;
      } else {
        sectorHovers[i] = targetH;
        sectorHoverVels[i] = 0;
      }
    }

    if (reduce) {
      dialOffset = dialTargetOffset;
      dialVelocity = 0;
    } else if (
      Math.abs(dialTargetOffset - dialOffset) > 0.003 ||
      Math.abs(dialVelocity) > 0.015
    ) {
      const [nextD, velD] = stepCriticallyDamped(
        dialOffset,
        dialVelocity,
        dialTargetOffset,
        dt,
        ANGLE_SPRING_OMEGA
      );
      dialOffset = nextD;
      dialVelocity = velD;
      active = true;
    } else {
      dialOffset = dialTargetOffset;
      dialVelocity = 0;
    }

    if (!isDragging) {
      if (reduce) {
        scrollOffset = scrollTarget;
        scrollVelocity = 0;
      } else if (
        Math.abs(scrollTarget - scrollOffset) > 0.002 ||
        Math.abs(scrollVelocity) > 0.012
      ) {
        const [nextS, velS] = stepCriticallyDamped(
          scrollOffset,
          scrollVelocity,
          scrollTarget,
          dt,
          SCROLL_SPRING_OMEGA
        );
        scrollOffset = nextS;
        scrollVelocity = velS;
        active = true;
      } else {
        scrollOffset = scrollTarget;
        scrollVelocity = 0;
      }
    }

    applyAnimationFrame();

    if (active) {
      rafId = win.requestAnimationFrame(onAnimationFrame);
    }
  }

  // ---- 交互与悬停调度 -----------------------------------------------------
  function openWheel() {
    if (!isEnabled() || !triggerEl || triggerEl.hasAttribute("dont-show")) {
      return;
    }
    if (triggerEl.hasAttribute("reorder-mode")) {
      return;
    }
    const { workspaces, activeId } = getWorkspacesData();
    if (workspaces.length <= 1) {
      return;
    }

    if (leaveTimer) {
      win.clearTimeout(leaveTimer);
      leaveTimer = 0;
    }

    if (!wantOpen && openProgress <= 0.02) {
      dragMoved = false;
      hoveredIdx = -1;
      pinnedIdx = -1;
      const activeIdx = Math.max(0, workspaces.findIndex(w => w.uuid === activeId));
      const arc = getArcMetrics(workspaces.length, getWheelStyle());
      scrollOffset = clamp(
        (activeIdx - (workspaces.length - 1) / 2) * arc.step,
        -arc.scrollMax,
        arc.scrollMax
      );
      scrollTarget = scrollOffset;
      scrollVelocity = 0;

      rebuildWheel();
      if (sectorItems[activeIdx]) {
        dialOffset = sectorItems[activeIdx].baseOff;
        dialTargetOffset = dialOffset;
      }
    } else {
      const layoutInfo = computeLayout(workspaces.length);
      positionWheel(layoutInfo);
      refreshDynamicState();
    }

    wantOpen = true;
    setCompactKeepOpen(true);
    ensureAnimationLoop();
  }

  function scheduleClose() {
    if (leaveTimer) {
      win.clearTimeout(leaveTimer);
    }
    leaveTimer = win.setTimeout(() => {
      leaveTimer = 0;
      if (!triggerHovered && !wheelHovered && !bridgeHovered && !isDragging) {
        wantOpen = false;
        updateHoveredSector(-1, { keepPin: false });
        ensureAnimationLoop();
      }
    }, LEAVE_GRACE_MS);
  }

  function collapseNow() {
    triggerHovered = false;
    wheelHovered = false;
    bridgeHovered = false;
    isDragging = false;
    dragMoved = false;
    if (leaveTimer) {
      win.clearTimeout(leaveTimer);
      leaveTimer = 0;
    }
    wantOpen = false;
    updateHoveredSector(-1, { keepPin: false });
    ensureAnimationLoop();
  }

  function onTriggerEnter() {
    triggerHovered = true;
    openWheel();
  }

  function onTriggerLeave() {
    triggerHovered = false;
    scheduleClose();
  }

  function onTriggerPointerDown(e) {
    if (e.button !== 0) {
      collapseNow();
    }
  }

  function keepAliveOnEnter() {
    if (leaveTimer) {
      win.clearTimeout(leaveTimer);
      leaveTimer = 0;
    }
    if (!wantOpen && openProgress > 0.02) {
      wantOpen = true;
      setCompactKeepOpen(true);
      ensureAnimationLoop();
    }
  }

  function onWheelEnter() {
    wheelHovered = true;
    keepAliveOnEnter();
  }

  function onWheelElLeave() {
    wheelHovered = false;
    isDragging = false;
    wheelEl?.removeAttribute("data-pressing");
    updateHoveredSector(-1, { keepPin: false });
    scheduleClose();
  }

  function onBridgeEnter() {
    bridgeHovered = true;
    keepAliveOnEnter();
  }

  function onBridgeLeave() {
    bridgeHovered = false;
    scheduleClose();
  }

  function hitTestSector(clientX, clientY) {
    if (!currentWorkspaces.length || !dialEl) {
      return { idx: -1, inHub: false };
    }
    const rect = dialEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { idx: -1, inHub: false };
    }
    const scale = rect.width / Math.max(1, cardWidth);
    const localX = (clientX - rect.left) / scale;
    const localY = (clientY - rect.top) / scale;
    if (localX < 0 || localX > cardWidth || localY < 0 || localY > dialHeight) {
      return { idx: -1, inHub: false };
    }

    const dx = localX - pivotX;
    const dy = localY - pivotY;
    const dist = Math.hypot(dx, dy);
    if (dist <= rIn) {
      return { idx: -1, inHub: true };
    }
    if (isSemicircleMode() && (dy > 4 || dist > rOut + SEMI_HOVER_EXPAND + 6)) {
      return { idx: -1, inHub: false };
    }

    const theta = Math.atan2(dy, dx);
    const visualOffset = isSemicircleMode()
      ? shortestAngleDelta(-Math.PI / 2, theta)
      : pivotOnRight
        ? -shortestAngleDelta(Math.PI, theta)
        : shortestAngleDelta(0, theta);

    // 按当前实际渲染扇区范围命中（含鱼眼放大后的自适应边界）
    const tol = arcGapRad * 0.52 + 0.025;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < sectorItems.length; i++) {
      const s = sectorItems[i];
      if (visualOffset >= s.visOffStart - tol && visualOffset <= s.visOffEnd + tol) {
        const d = Math.abs(visualOffset - s.baseOff);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
    }
    return { idx: bestIdx, inHub: false };
  }

  function onDialPointerMove(e) {
    if (isDragging) {
      const coord = isSemicircleMode() ? e.clientX : e.clientY;
      if (Math.abs(coord - dragStartCoord) > 7) {
        dragMoved = true;
      }
      if (dragMoved) {
        const now = win.performance.now();
        const dtMs = Math.max(4, now - dragLastTime);
        const radPerPx = 1 / Math.max(46, rNode);
        const rawTarget = (coord - dragStartCoord) * radPerPx * -1 + dragStartScroll;
        let bounded = rawTarget;
        if (rawTarget < -scrollBound) {
          bounded = -scrollBound + rubberband(rawTarget + scrollBound, 0.28);
        } else if (rawTarget > scrollBound) {
          bounded = scrollBound + rubberband(rawTarget - scrollBound, 0.28);
        }
        const instantVel = ((coord - dragLastCoord) * radPerPx * -1) / (dtMs / 1000);
        dragReleaseVel = dragReleaseVel * 0.4 + instantVel * 0.6;
        dragLastCoord = coord;
        dragLastTime = now;
        scrollOffset = bounded;
        scrollTarget = clamp(bounded, -scrollBound, scrollBound);
        updateSectorGeometry();
        return;
      }
    }

    const hit = hitTestSector(e.clientX, e.clientY);
    updateHoveredSector(hit.idx, { keepPin: hit.inHub });
  }

  function onDialPointerLeave(e) {
    if (isDragging) {
      return;
    }
    const stayingInWheel = Boolean(e.relatedTarget && wheelEl?.contains(e.relatedTarget));
    updateHoveredSector(-1, { keepPin: stayingInWheel });
  }

  function onDialPointerDown(e) {
    if (e.button !== 0 || e.target?.closest(".zenwashi-wheel-hub, .zenwashi-wheel-slice-unload")) {
      return;
    }
    const coord = isSemicircleMode() ? e.clientX : e.clientY;
    dragMoved = false;
    dragStartCoord = coord;
    dragLastCoord = coord;
    dragLastTime = win.performance.now();
    dragReleaseVel = 0;
    dragStartScroll = scrollOffset;
    isDragging = true;

    const hit = hitTestSector(e.clientX, e.clientY);
    if (hit.idx >= 0) {
      updateHoveredSector(hit.idx, { keepPin: true });
      wheelEl?.setAttribute("data-pressing", "true");
    }
  }

  function onDialPointerUp() {
    if (isDragging) {
      const hadMoved = dragMoved;
      isDragging = false;
      if (hadMoved) {
        const decel = 0.996;
        const proj = ((dragReleaseVel / 1000) * decel) / (1 - decel);
        scrollTarget = clamp(scrollOffset + proj, -scrollBound, scrollBound);
        scrollVelocity = dragReleaseVel * 0.45;
        ensureAnimationLoop();
        win.setTimeout(() => {
          dragMoved = false;
        }, 0);
      } else if (scrollOffset < -scrollBound || scrollOffset > scrollBound) {
        scrollTarget = clamp(scrollOffset, -scrollBound, scrollBound);
        ensureAnimationLoop();
      }
    }
    wheelEl?.removeAttribute("data-pressing");
  }

  function onDialWheel(e) {
    if (!wantOpen) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const rawDelta =
      isSemicircleMode() && Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const deltaRad = (rawDelta || 0) * 0.0024;
    if (scrollBound <= 0) {
      scrollOffset = rubberband(-deltaRad * 2.2, 0.08);
      scrollTarget = 0;
      ensureAnimationLoop();
      return;
    }
    const next = scrollTarget + deltaRad;
    scrollTarget = clamp(next, -scrollBound, scrollBound);
    if (next < -scrollBound || next > scrollBound) {
      scrollOffset = clamp(scrollOffset + deltaRad * 0.35, -scrollBound - 0.14, scrollBound + 0.14);
    }
    ensureAnimationLoop();
  }

  function activateWorkspace(uuid) {
    if (uuid && uuid !== currentActiveId) {
      win.gZenWorkspaces?.changeWorkspaceWithID?.(uuid);
    }
    collapseNow();
  }

  function onDialClick(e) {
    if (dragMoved) {
      return;
    }
    if (e.target?.closest(".zenwashi-wheel-hub, .zenwashi-wheel-slice-unload, .zenwashi-wheel-node-btn")) {
      return;
    }
    const hit = hitTestSector(e.clientX, e.clientY);
    const idx = hoveredIdx >= 0 ? hoveredIdx : hit.idx;
    if (idx >= 0 && currentWorkspaces[idx]) {
      activateWorkspace(currentWorkspaces[idx].uuid);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && wantOpen) {
      collapseNow();
    }
  }

  function onContextPopupShowing(e) {
    const target = e.target;
    if (!target) {
      return;
    }
    if (
      target.localName === "tooltip" &&
      (wantOpen || triggerHovered || wheelHovered || bridgeHovered) &&
      doc.tooltipNode?.closest?.("#zen-workspaces-button, #zenwashi-workspace-wheel .zenwashi-wheel-node-btn")
    ) {
      e.preventDefault();
      return;
    }

    const tag = target.localName;
    if (
      target.id === "zenWorkspaceMoreActions" ||
      tag === "menupopup" ||
      tag === "panel"
    ) {
      collapseNow();
    }
  }

  const triggerObserver = new win.MutationObserver(() => {
    if (triggerEl?.hasAttribute("reorder-mode")) {
      collapseNow();
    }
  });

  function onWorkspaceUpdate() {
    if (wantOpen || openProgress > 0.01) {
      rebuildWheel();
    }
  }

  function onTabOrLayoutChange() {
    if (wantOpen || openProgress > 0.01) {
      positionWheel(computeLayout(currentWorkspaces.length || 4));
      refreshDynamicState();
    }
  }

  const prefObserver = {
    observe(_subject, _topic, data) {
      if (data === PREF && !isEnabled()) {
        collapseNow();
        return;
      }
      if (data === STYLE_PREF) {
        hoveredIdx = -1;
        pinnedIdx = -1;
        scrollOffset = 0;
        scrollTarget = 0;
        scrollVelocity = 0;
        if (wantOpen || openProgress > 0.01) {
          rebuildWheel();
        }
      }
    },
  };

  function install() {
    if (installed) {
      return true;
    }
    triggerEl = doc.getElementById("zen-workspaces-button");
    if (!triggerEl) {
      return false;
    }

    installed = true;
    triggerEl.addEventListener("pointerenter", onTriggerEnter);
    triggerEl.addEventListener("pointerleave", onTriggerLeave);
    triggerEl.addEventListener("pointerdown", onTriggerPointerDown);
    triggerObserver.observe(triggerEl, {
      attributes: true,
      attributeFilter: ["reorder-mode", "dont-show"],
    });
    win.addEventListener("ZenWorkspacesUIUpdate", onWorkspaceUpdate, true);
    win.addEventListener("ZenWorkspacesSwitched", onWorkspaceUpdate);
    win.addEventListener("resize", onTabOrLayoutChange);
    win.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("popupshowing", onContextPopupShowing, true);

    try {
      Services.prefs.addObserver(PREF, prefObserver);
      Services.prefs.addObserver(STYLE_PREF, prefObserver);
    } catch {}

    if (triggerEl.matches(":hover")) {
      onTriggerEnter();
    }

    return true;
  }

  function destroy() {
    if (rafId) {
      win.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (leaveTimer) {
      win.clearTimeout(leaveTimer);
      leaveTimer = 0;
    }
    if (statusTimer) {
      win.clearTimeout(statusTimer);
      statusTimer = 0;
    }
    setCompactKeepOpen(false);
    triggerObserver.disconnect();
    if (triggerEl) {
      triggerEl.removeEventListener("pointerenter", onTriggerEnter);
      triggerEl.removeEventListener("pointerleave", onTriggerLeave);
      triggerEl.removeEventListener("pointerdown", onTriggerPointerDown);
    }
    win.removeEventListener("ZenWorkspacesUIUpdate", onWorkspaceUpdate, true);
    win.removeEventListener("ZenWorkspacesSwitched", onWorkspaceUpdate);
    win.removeEventListener("resize", onTabOrLayoutChange);
    win.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("popupshowing", onContextPopupShowing, true);
    try {
      Services.prefs.removeObserver(PREF, prefObserver);
      Services.prefs.removeObserver(STYLE_PREF, prefObserver);
    } catch {}
    hostEl?.remove();
    delete win.__zenwashiWorkspaceWheel;
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
