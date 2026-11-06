# Zen Washi & Sumi (和纸与松烟墨) — 维护与避坑指南

本文档总结了在开发与调优“和纸与松烟墨”极简禅道主题过程中遇到的关键架构痛点、Firefox/Zen XUL 引擎特性陷阱，以及长效维护规范。

---

## 1. 核心架构与设计基准

- **设计哲学**：
  - 以手工和纸（鸟の子色 `#F7F6F2`）为昼调，以松烟古墨（`#141517`）为夜基。
  - 去除原生多余的分割硬线与生硬指示条，采用温润的微卡片浮雕与传统矿物强调色（竹青、焦茶、朱砂、琉璃、山吹）。
- **核心文件分布**：
  - `userChrome.css`：浏览器界面核心样式。
  - `preferences.json`：Sine Mods 动态配置项（强调色、视口圆角、边距、阴影档位等）。
  - `install.sh`：自动将主题注册并同步至 Zen Profile 的部署脚本。

---

## 2. 关键痛点复盘与避坑指南

### 踩坑点 1：Essentials 区域“贴边与裁剪”陷阱 (Grid / Flex Box Model)
- **现象**：
  - 给 Essentials 容器或内部 `tab` 增加 `margin` 或手动设置 `width`、`padding` 时，第三列卡片要么紧贴侧边栏右边缘，要么直接被物理裁剪或撑破窗口。
- **根本原因**：
  - Zen Browser 的 Essentials (`#zen-essentials` -> `.zen-essentials-container`) 在 XUL 内部是由原生弹性引擎精确计算列宽百分比的。
  - 任何在外部容器或 `tab` 节点上声明的额外 `margin` 或 `width: calc(...)`，都会破坏网格的宽度推导逻辑，触发父级盒模型的 `overflow: clip`。
- **最佳实践与防坑规则**：
  - **零干预原生盒模型**：绝不对 `#zen-essentials`、`.zen-essentials-container` 或 `.tabbrowser-tab` 设置额外的 `margin`、`width` 或 `padding`。
  - **仅在 `.tab-background` 内部着色**：将常态微卡片底色、发丝边框、悬停浮雕及选中态边框全部约束在内部背景层渲染，保证几何外框始终由 Zen 原生引擎计算，彻底杜绝贴边与裁切。

---

### 踩坑点 2：文件夹（Folder）重叠穿模与全局变量劫持
- **现象**：
  - 试图通过覆盖 SVG 变量（`--zen-folder-*`）或全面覆盖图层颜色时，容易破坏原本的线框透明度，甚至造成文件夹整行背景变蓝或发虚。
- **根本原因**：
  - Zen 的文件夹图标是由多个矢量层（`.back` 背板、`.front` 正面封皮、`.dots` 圆点）及整行容器联动渲染的。
  - 过度干预背后的 CSS 变量或使用宽泛的选择器（如无差别的 `rect, path` 规则）会连锁污染其它状态。
- **已固化的成熟实现**：
  ```css
  /* 仅针对图标内部的具体 path/rect 施加极简线框与底色 */
  zen-folder .tab-group-folder-icon rect,
  zen-folder .tab-group-folder-icon path,
  .tab-group-folder-icon rect,
  .tab-group-folder-icon path {
    fill: var(--zenwashi-bg-base) !important;
    stroke: var(--zenwashi-accent) !important;
    stroke-width: 1.5px !important;
    transition: stroke var(--zenwashi-duration) var(--zenwashi-ease) !important;
  }

  /* 保持整行背景透明，悬停时仅高亮文字与强调色 */
  zen-folder,
  zen-folder .tab-group-label-container {
    background: transparent !important;
    color: var(--zenwashi-fg-primary) !important;
  }

  zen-folder:hover .tab-group-label-container {
    color: var(--zenwashi-accent) !important;
  }
  ```
- **防坑规则**：
  - **严禁再随意修改文件夹相关规则**，避免破坏已验证稳定的极简效果。

---

### 踩坑点 3：工作区激活标签页（Active Tab）的指示逻辑
- **现象**：
  - 原生左侧垂直指示线条与和纸风格格格不入；若清除不彻底，容易出现贴墙杂线或重叠发虚。
- **成熟解决方案**：
  - 彻底隐藏原生指示器与伪元素：
    ```css
    .tab-line,
    .tab-indicator,
    .tab-context-line,
    .tab-group-line,
    .tabbrowser-tab::before,
    .tabbrowser-tab::after,
    .tab-background::before,
    .tab-background::after {
      display: none !important;
      opacity: 0 !important;
    }
    ```
  - 使用独立的浅色纯和纸温润微凸起卡片指示当前激活状态：
    ```css
    .tabbrowser-tab:not([zen-essential="true"])[selected="true"] .tab-background,
    .tabbrowser-tab:not([zen-essential="true"])[visuallyselected] .tab-background {
      background-color: var(--zenwashi-tab-selected-bg) !important;
      border-color: var(--zenwashi-tab-selected-border) !important;
      box-shadow: var(--zenwashi-tab-selected-shadow) !important;
    }
    ```

---

### 踩坑点 4：悬浮画卷视口（Floating Island）阴影截断与档位生效
- **现象**：
  - 如果将 `box-shadow` 和 `overflow: clip`（圆角裁剪）写在同一个容器上，Gecko 引擎会把外侧的漫射投影一同裁剪掉，导致阴影“基本没有”或档位切换无变化。
- **解耦架构**：
  - **外层卡片 (`.browserSidebarContainer`)**：负责承载外部漫射阴影与外边距（`margin`），必须保持 `overflow: visible`。
  - **内层视口 (`.browserContainer`)**：负责通过 `overflow: clip` 和 `border-radius` 精准裁剪网页内容。

---

### 踩坑点 4.1：大半径下"圆角不够顺"——圆弧 vs 连续圆角（`corner-shape`）

- **现象**：`Content viewport radius` 开到 20px 以上时，会觉得拐角"不够平滑 / 有点硬"，但放大截屏逐像素看又是干净的：单像素抗锯齿、没有台阶、没有双层线、没有白缝。**这不是渲染 bug。**
- **原因**：`border-radius` 画的是**四分之一圆**，它在与直边的两个切点处曲率从 0 突跳到 1/R。半径越大，这段"曲率接头"越长、越容易被眼睛抓到。macOS 的窗口圆角是**连续圆角**（超椭圆 / squircle，曲率平滑过渡），所以把内容区摆在系统窗口旁边时对比最明显。
- **能不能修**：CSS 规范里的 `corner-shape: squircle` 正是干这个的，Gecko 已经实现但**锁在静态 pref 后面**：
  ```text
  about:config → layout.css.corner-shape.enabled = true   # 静态 pref，必须重启
  Sine 设置 → Corner style 圆角形状 = Squircle
  ```
  - pref 没开时 `corner-shape` 属性整条被 CSS 解析器丢弃，`--zenwashi-corner-shape: squircle` 不产生任何影响，**自动退回普通圆弧**，所以对没开 pref 的用户是零风险。
  - 只作用在网页视口四层（`#zen-appcontent-wrapper` / `.browserContainer` / `.browserStack` / `browser`），不动标签、地址栏、面板。
  - **不要**试图用 `clip-path: path()` 或 SVG mask 手搓超椭圆：`path()` 只吃绝对 px（窗口一改尺寸就错），而且 `clip-path` 会把 `box-shadow` 一起裁掉——那正是第 4 条里辛苦解耦出来的纸面阴影。

- **如果就是不想开 pref**，视觉上等价的两条退路：
  1. 半径收到 **22px 以内**，曲率接头明显变短；
  2. `Content border width` 选 **Hairline 0.5px**：一条发丝墨线把弧线"描"出来，硬边感会消失一大半（纯色硬切时最显生硬）。

---


### 踩坑点 5：与 Zen 内置层抢属性（!important / 动画 / 测量 / 内联变量）

这一组坑的共同点：**主题写的是 CSS，但真正决定效果的是 Zen 的 JS + 内联样式 + 层叠顺序**。
碰到"改了没反应 / 只有一半生效 / 深色才出问题"时，先按下面五条对照。

#### 5.1 `!important` 会压掉 Zen 的动画
- **层叠顺序**：动画属性 > 普通声明；而**带 `!important` 的作者声明又高于动画**。
- 案例：折叠文件夹的 `[aria-hidden]` 标签上曾用 `height / max-height / opacity: 0 !important` 强制收拢，结果 `ZenFolders.animateCollapse()` 的 `opacity 1→0` + `height auto→0` 动画整段被压掉，文件夹"啪"一下就没了。
- **只去掉 `!important` 也不够**：静态规则仍然参与布局，会干扰下一条的测量，症状变成"只有展开有动画、收起没有"。

#### 5.2 不要在 Zen 测量之前动它要量的盒子
- `tabgroup.mjs` 的 `set collapsed()` 是**先**给所有子标签打 `aria-hidden`，**再** dispatch 事件触发 `animateCollapse()`；
- 而 `animateCollapse()` 第一步就是 `#measureCollapsedShift()` → `getBoundsWithoutFlushing(容器).height`；
- 任何在这之前把子标签高度压成 0 的规则，都会让"收起距离"算成 ≈0，收起动画退化成 4px 抖动。
- **正确做法**：整块删掉这类强制收拢规则；Zen 自己在动画结束后会给容器加 `hidden` 并清理内联样式。

#### 5.3 `!important` 挡住动画时，改让它引用的自定义属性
- 案例：融合模式下内容层上两角被 `border-radius: 0 0 r r !important` 钉死；
  - 动画 `border-radius` → 被 `!important` 压掉；
  - `clip-path` → 也补不回来（`overflow: clip` 已按 `0 0 r r` 裁掉内容，再裁只会取交集）。
- **解法**：用 `@property` 注册变量，让那条 `!important` 声明**引用**变量，再动画这个变量：

```css
@property --zw-panel-tl { syntax: "<length>"; inherits: true; initial-value: 0px; }
border-radius: var(--zw-panel-tl, 0px) var(--zw-panel-tr, 0px) <r> <r> !important;
```

#### 5.4 Zen 从内联值复制的变量，只能覆盖目标元素
- 窗口背景是 `#zen-browser-background`（`.zen-browser-generic-background`）的两个伪元素按 `--zen-background-opacity` 混合：
  `::after` 用 `--zen-main-browser-background`，`::before` 用 `--zen-main-browser-background-old`。
- `-old` 由 `ZenGradientGenerator.mjs` 从 `element.style.getPropertyValue()` 复制（**内联值，不是计算值**），
  所以在 `:root` 上覆盖 `--zen-main-browser-background` 对它无效 → 深色下内容区会混进 Zen 自己的暗色（表现为比侧栏暗一截，如 `#11121C` vs `#1E2030`）。
- **解法**：直接给 `#zen-browser-background / #zen-toolbar-background` 的 `::before / ::after` 上色，让两层同色，混合比例就无所谓了。

#### 5.5 别依赖 `:active` 做按压反馈
- `:active` 的生命周期严格等于 mousedown→mouseup；快速点击可能只跨一两帧、甚至一帧都没渲染。
- **解法**：用状态变化（`[selected]` / `[busy]` / `#urlbar[open]`）触发**一次性关键帧动画**，动画一旦开始就必定跑完。
- 按下（一次性动画）与按住（`:active`）不可兼得，需要选一个。

#### 5.6 深色下"看起来正常"可能只是巧合
- 浅色 `#FFF` 恰好等于主题浅色 surface，多次掩盖了 Zen 兜底色（`light-dark(#FFF, #202020)`）的存在；
- 换到深色才暴露。**验证深浅两态时，浅色通过不能作为结论。**

#### 5.7 地址栏面板是另一套 Token（`#urlbar-background` 已不存在）
- **现象**：`zenwashi.palette` 切换后侧栏、标签页都变了，但 Cmd+T / Cmd+L 唤出的地址栏浮层仍是中性白 / 中性黑，候选项悬停也是中性灰。
- **原因**：
  1. Gecko 158 起地址栏底板由 `#urlbar-background` 改为 `<div class="urlbar-background">`（见 `UrlbarInputBase.#markup`），旧 id 选择器会**静默失效**；
  2. Zen 在 `#urlbar[breakout-extend] .urlbar-background` 上硬编码 `--zen-urlbar-background-base: light-dark(#fff, #181818)` 并 `!important` 上色；
  3. `.urlbarView-url` 被 Zen 写死为 `light-dark(#4f4f4f, #aaa)`，行悬停 Token 指向 `--toolbarbutton-background-color-hover`（中性色），都不读调色板。
- **固化做法**（见 `userChrome.css` 第 12.1 节）：
  - 地址栏底板统一用 `.urlbar-background` class 选择器；
  - 面板底色用 `--zenwashi-bg-urlbar`，描边用 1px `--zenwashi-border-distinct` 发丝墨线，靠纸影托起浮层（不要用满强度 accent 粗边或 3px accent 外环，浅色下会显脏）；亚克力开启时用 `color-mix` 保留磨砂；
  - 改写 `--urlbarview-*` / `--toolbar-field-*` Token，覆盖行悬停、选中、URL 行与操作文字；
  - `.searchmode-switcher-panel` / `.urlbarView-result-menu` 走 `--panel-*` / `--panel-list-*`，需单独重绘。
- **面板圆角**：由 Sine 设置项 `zenwashi.urlbar.panel.radius` 直接映射到 `--zenwashi-urlbar-panel-radius`（默认 `15px`），改完立即在 Cmd+T 浮层生效；不要写死在选择器里。
- **验证**：至少要在深色 + 两套 palette（如 washi / catppuccin）下打开 Cmd+T 检查（呼应 5.6）。

#### 5.8 关闭标签的动画被三条 `!important` 静默压掉（现已由 JS 接管）
- **关闭链路**（Zen 1.23.4b）：
  `gBrowser.removeTab()` → `#beginRemoveTab()` 只做 `tab.closing = true`（普通 JS 属性，不是 attribute，`Tabbrowser.sys.mjs:6913`）→ `gZenVerticalTabsManager.animateItemClose()`（`ZenVerticalTabsManager.mjs:181`，WAAPI：`opacity 1→0`、`scale 1→0.95`、非最后一项时 `margin-bottom 0→-height`，`0.1s / easeOut`）→ promise 结束后 `_endRemoveTab()` 立即删除节点（`Tabbrowser.sys.mjs:6673`）。
- 因此 CSS 里的 `[closing]` 选择器**永远匹配不到**，10.3 的折卷 keyframes 是死代码（已删除，只保留说明）。
- 更隐蔽的是：主题里有三条"作者 `!important`"会把这段 WAAPI 逐项压掉（同 5.1 的层叠规则）：
  1. 第 6 节 `.tabbrowser-tab { transform: none !important }` → `scale` 失效；
  2. 第 6 节 `margin-block: 1px !important` → 负 `margin` 让位失效；
  3. 第 8 节休眠标签的 `opacity: 1 !important`（默认开启）→ 最后的 `opacity` 淡出也失效。
  三者叠加后关闭动画**完全不可见**：节点到期直接删除，列表瞬移。
- **修复**：这三条改成普通声明（去掉 `!important`）。静止时选择器特异性足够；动画期间由 WAAPI 接管；Motion One 结束时 `commitStyles()` 会把终值写回内联样式，再由 DOM 移除接走，所以不会回弹。休眠标签的 `opacity: 0.6` 也去掉了 `!important`（否则关闭一个休眠标签时，WAAPI 的淡出会被它压住）；Zen 原生没有给 discarded 标签写 opacity，因此静止态不受影响。
- **副作用**：解掉 `transform` 锁之后，Zen 原生**开标签**的 `scale(0.95→1, 0.12s)` 会回来；关闭方向已经由 `js/tab-close.uc.js` 接管，不再缩放。如果连开标签的缩放也不想要，把第 6 节的 `transform: none` 加回 `!important` 即可（`margin-block` 保持解锁，让位仍正常）。
- **现行动效**：`js/tab-close.uc.js` override 了 `animateItemClose()`：
  - 视觉离场 `170ms`（`opacity` 从当前值淡出 + 2px 上浮，不缩放），让位用关闭项自己的 `margin-bottom` 收拢（与 Zen 原生同源）：同一帧多个关闭只合并成一次布局，文件夹导轨、滚动条都自然跟随；
  - 同一时刻最多 6 条关闭动画，超出的直接交由 DOM 删除（防止批量关闭拖慢）；同时关闭多个时 margin 变化会合并成一次布局，不会 N 次 reflow；
  - 关闭同一帧给根元素打 `zenwashi-tab-closing`，把内容区 0.42–0.58s 的切换动效降级为瞬时；`zenwashi-tab-just-closed` 抑制下一行的关闭按钮浮现；关闭行自身带 `zenwashi-closing`（`pointer-events: none`）。
  - 偏好：`zenwashi.tab.close-animation`（0 关 / 1 默认 170ms / 2 短淡出 130ms）、`zenwashi.tab.close-simplify-switch`（默认开）。
  - ⚠ **版本敏感点**：`animateItemClose` 在 1.23.2b→1.23.4b 之间从 `ZenUIManager` 搬到了 `ZenVerticalTabsManager`。脚本用轮询 + 特性检测安装，找不到方法时安静放弃；Zen 升级后若关闭动效消失，先查这里（`gZenVerticalTabsManager?.animateItemClose` 是否还存在）。

#### 5.9 融合顶栏变色为什么默认没有过渡（以及怎么打开）
- **机制**：`styles/blended-addressbar.css` 用一个变量统一控制颜色过渡：`--blended-addressbar-color-transition`。
  - 基础值 `0ms linear`（原 mod 的选择：静止时顶栏与网页取色**完全一致**，不滞后）；
  - `:root[data-blended-addressbar-color-loading]` 期间为 `120ms ease-out`（加载中取色频繁，缩短过渡去跟）；
  - 新增的 `zenwashi.urlbar.color-transition`（默认开）在静止态把它设为 `160ms var(--zenwashi-ease)`，切换标签 / 加载完成 / 系统深浅切换都会柔和渐变；
  - `@media (prefers-reduced-motion: reduce)` 用 `!important` 压回 `0ms`。
- **消费方**：`#zen-appcontent-navbar-wrapper`、`#zen-appcontent-navbar-container`、`#zen-appcontent-wrapper`（userChrome 里的画卷边框）、`.blended-addressbar-pane-bar` 都声明了 `transition: background-color/color var(--blended-addressbar-color-transition)`；`#PersonalToolbar`（书签栏）是独立元素，**必须单独声明**，否则顶栏渐变时它会瞬变（已补）。
- **不能过渡的地方**：窗口色调 `--blended-addressbar-window-tint-background` 被塞进 `#zen-browser-background::before/::after` 的 `linear-gradient(...)` 里，渐变图像不可插值——改这个变量不会渐变。若以后要做色调过渡，必须换成"纯色层 + opacity"结构，不能靠 `transition: background`。
- **为什么默认值不是 0 也不是 240ms**：0ms 是"取色精确"的原教旨；240ms 在切标签时会明显滞后于已经渲染好的网页。160ms 是折中：能看清是渐变，又不会觉得顶栏还在"追"上一页的颜色。想回到原样就把 Sine 里的 "Smooth color transition" 关掉。

#### 5.10 磨砂玻璃输入框为什么不是真的 `backdrop-filter`（以及 Safari 观感怎么来）
- **硬约束**：Firefox/Zen 的 chrome 文档里，`backdrop-filter` 只能看到**同一棵 chrome 层树**里在它背后的内容。网页跑在独立的异步合成层（out-of-process），chrome 的 backdrop 根本拿不到那些像素——所以「给输入框加 `backdrop-filter: blur()` 把背后的网页糊掉」在闭合态**永远不会生效**，写了也只是白白多一层合成。
  - 真正能糊网页的只有把 `filter: blur()` 直接打在 `<browser>` 上（本主题 §12.3/12.4 的「宣纸微敛 / 画卷退景」就是这么做的，配合 `#urlbar[open]`），代价是**整页**糊，做不出一块局部玻璃。
  - Zen 自己的 `zen.theme.acrylic-urlbar` 在 macOS 上也不是 backdrop：那是平台级 vibrancy（Windows 走 acrylic / Mica），同样不给你"局部磨砂网页"。
- **那 Safari 观感从哪来**：`frame.js` 已经把网页顶部 `8px` 像素用 `drawWindow` 抓下来，`getDominantSampleColor()` 取主色写入 `--zen-tab-header-background`——**这本身就是"被糊平的网页顶部"**。顶栏已经是玻璃背后的那层模糊色，缺的只是中间那枚半透明胶囊。所以实现放在 `userChrome.css` 融合顶栏一节（`zenwashi.urlbar.glass`，默认开）：
  - 填充 `--zenwashi-urlbar-glass-fill` = 顶栏前景色 8%（悬停 12%）。用 fg 而不是写死白/黑，是因为 `readableForeground()` 已经按底色调过明暗：浅色页得到"墨色微沉"，深色页得到"纸白微浮"，一条公式覆盖任意取色；
  - 描边/高光全走 `inset box-shadow`，不用 `border`：不参与盒模型（地址栏高度与内边距零位移），也不会和 `styles/loadbar.css` glow 模式写死的 `background-image` 抢层；
  - 圆角由 `zenwashi.urlbar.field.radius` → `--zenwashi-urlbar-field-radius`（默认 `9px`）。
- **验证**：浅色页（Bilibili / 白底文档）+ 深色页（暗色主题站点）各看一次未聚焦、悬停、聚焦三种状态；再开一次 `prefers-reduced-transparency: reduce`（系统设置 → 辅助功能 → 显示 → 降低透明度），应退回实心和纸胶囊而不是半透明叠半透明。
- **还没做、也别急着做**：①把取色从"单一主色"升级成 2×3 分块 → 顶栏能画出一条网页色渐变（更像真模糊，改动在 `frame.js` + `blended-bar.uc.js` 的内联副本）；②让顶栏**浮在**网页之上（Safari 的真实结构），需要改 `#zen-appcontent-navbar-wrapper` 的定位并给内容区让位，和单栏模式、分屏、全屏都会打架，收益不值这个风险。

#### 5.11 内容区阴影为什么一直不生效：`light-dark()` 不能包住整条阴影列表

- **现象**：`zenwashi.content.shadow` 切到 soft / medium / strong / deep 都没有肉眼变化；
  临时探针读到 `#zen-appcontent-wrapper` 与 `.browserSidebarContainer` 的 computed `box-shadow` 都是 `none`。
- **根因**：主题把整条阴影列表塞进了 `light-dark()`：
  ```css
  box-shadow: light-dark(
    0 10px 28px rgba(...), 0 3px 10px rgba(...),
    0 14px 40px rgba(...), 0 4px 14px rgba(...)
  ) !important;
  ```
  `light-dark()` 是**颜色函数**，只接受两个颜色；`0 10px 28px` 不是颜色，整条声明在解析阶段就无效。
  同一元素前面还有一条 `box-shadow: none !important` 兜底，最终计算值就是 `none` —— 阴影“从未存在过”。
- **正确写法**（二选一）：
  1. 每条阴影单独取色：
     ```css
     box-shadow:
       0 2px 6px light-dark(rgba(60,52,42,.08), rgba(0,0,0,.35));
     ```
  2. 明暗两态的 offset/blur 不同时，把**整条阴影**存进变量，用 `prefers-color-scheme` 切换：
     ```css
     :root { --zenwashi-paper-shadow: 0 10px 28px ..., 0 3px 10px ...; }
     @media (prefers-color-scheme: dark) {
       :root { --zenwashi-paper-shadow: 0 14px 40px ..., 0 4px 14px ...; }
     }
     ```
- **本次修复**：
  - `userChrome.css §1.1` 新增 `--zenwashi-paper-shadow`（默认 medium；soft / strong / deep × 明暗各一档）；
  - `.browserSidebarContainer` 与 `#zen-appcontent-wrapper` 只引用该变量，不再各自重复 4 条 media query；
  - `colors.css` 的 `--zenwashi-tab-selected-shadow`、`--zenwashi-essentials-card-shadow` 同步改为 per-shadow 形式
    （前者已生效，选中卡片现在有 `0 2px 6px` 的纸影；后者当前未被消费）。
- **验证**：临时探针（已删除）读 computed 值。修复前 wrapper = `none`；修复后（deep / 浅色）=
  `rgba(38,36,33,.36) 0 18px 48px, rgba(38,36,33,.22) 0 6px 18px, rgba(38,36,33,.12) 0 0 12px`。
- **防坑规则**：以后任何 `box-shadow` 都不要再写 `light-dark(<整条阴影>, <整条阴影>)`；
  只要看到 `light-dark(` 里出现 `px`，基本就是错的。

---

#### 5.12 玻璃质感为什么不能靠 `backdrop-filter`，只能靠 alpha + 系统 vibrancy

- **想做的**：侧栏 / 案台像磨砂玻璃，透出背后的东西。
- **做不到的那一半**：`backdrop-filter` 采样的是**同一个 chrome 文档的背板**，采样不到网页。
  网页跑在独立 content 进程、独立合成器层树里（和 §5.10 地址栏玻璃是同一个限制）；
  而且 Zen 的侧栏是一列独立容器，本来也不压在网页上面。
  → 所以"侧栏糊掉背后的网页"这条路在 Gecko 里没有解，别浪费时间试 `backdrop-filter`。
- **能做到的那一半**：macOS 的窗口本身就是一块 `NSVisualEffectView`（Zen 原生
  `zen.widget.macos.window-vibrancy`，默认开），桌面壁纸**已经被系统糊过**。
  只要把 chrome 的纸层调成半透明，糊过的桌面就会从纸底下渗上来 —— 这才是真玻璃。
  `backdrop-filter` 在这里反而没有意义：侧栏的背板是那层纯色纸，糊纯色 = 什么都没发生，
  却白付一个合成层的代价。
- **实现要点**（`userChrome.css §16`）：
  - 纸色只留**一层**：`#zen-toolbar-background` 的 `::before/::after` 让成透明，
    只让 `#zen-browser-background` 承担 alpha，否则 60% 叠 60% 会变成 84%，颜色发死；
  - 侧栏各层（`#TabsToolbar` / `#tabbrowser-tabs` / …）原本都钉着实心纸色，
    玻璃模式下必须先全部让开，再由 `#navigator-toolbox` 单独铺一张；
  - 整块包在 `@media not (prefers-reduced-transparency: reduce)` 里，
    系统开"降低透明度"时自动退回实心纸；
  - 用 `:not([zen-compact-mode="true"])` 排除紧凑模式：那里的悬浮面板有自己的
    `.zen-toolbar-background`、圆角和阴影（§15），混进来会把原生观感打穿。
- **档位语义**：alpha 都是"纸色占多少"，100% = 和改之前逐像素一致，
  所以 `off` 档即使整块规则命中也不会有任何变化（这是刻意的安全兜底）。
- **非 macOS**：没有 vibrancy 时半透明透出的是窗口自身底色，观感退化成"更薄的纸"，
  不会出错，但也谈不上磨砂。
- **第一次翻车（值得记）**：只把 `#zen-browser-background` 的 `::before/::after` 调成 60%，
  用户反馈"开不开一模一样"。原因不在新写的规则，而在**第 4 节**：
  ```css
  :root, #main-window, #browser, .zen-browser-generic-background, ... {
    background-color: var(--zenwashi-bg-base) !important;
  }
  ```
  这三个「窗口画布」本身被涂成了实心纸，而且还在最底层——纸盖纸，上面调多少 alpha 都看不出来。
  修法是玻璃模式下先把这一层让空（`background-color: transparent`），
  再让 `#zen-browser-background` 的伪元素独自承担 alpha。
  **教训**：做透明度之前，先把"这块颜色到底是谁在画"从最底层往上数一遍，
  别只盯着自己新写的那条规则。
- **第二次翻车（同一个教训的加强版）**：把窗口画布让空后玻璃出来了，但侧栏**顶部一条
  不透明灰带**，玻璃从标题栏高度往下才开始。原因是 Firefox 的 `browser-shared.css` 在
  macOS 上给 `#navigator-toolbox::after` 挂了 `-moz-default-appearance: -moz-window-titlebar`，
  画的是原生标题栏底色，`z-index: -1` 压在侧栏后面——实心纸时看不见，一透明就露出来。
  修法：玻璃模式下 `appearance: none` 关掉它。
  同一个坑的两种形态：**底色不一定在你选的那个元素上，也不一定在 `background-color` 上**，
  `appearance` / 伪元素 / 原生控件都可能偷偷画一层。

---

## 3. 日常维护与调试检查清单 (Checklist)

修改 CSS 或追加新功能后，请按以下步骤逐项核验：

1. **Essentials 区域检查**：
   - [ ] 9 个图标常态下是否呈现清晰微卡片底色与微弱边框？
   - [ ] 切换各个 Essential 时，当前选中项是否高亮显示实体白底、强调色外边框和微投影？
   - [ ] 最右列（第 3 列）卡片与右侧边缘是否有自然间距，且未发生任何边缘被切？
2. **文件夹区域检查**：
   - [ ] 文件夹图标是否保持极简线框风格与和纸实心遮挡？
   - [ ] 展开/收起时是否有线条穿模或整行底色变异？
3. **普通标签页与侧边栏检查**：
   - [ ] 激活标签页是否无生硬垂直条，仅呈现浅色和纸凸起卡片？
   - [ ] 侧边栏与顶栏各容器接缝是否纯净无杂线？
4. **内容视口检查**：
   - [ ] 内容区悬浮留白对称度与阴影是否自然呈现？
   - [ ] 全屏模式下是否能自动贴合边缘无黑边？
   - [ ] **深色**下内容区四周的底色是否与侧栏同色（不该比侧栏暗一截）？
5. **两态与动效检查（务必深浅都验）**：
   - [ ] 系统深/浅切换后，chrome 是否自动跟随（见 5.6：浅色通过不代表深色没问题）？
   - [ ] 页面加载「宣纸微敛」：四角是否统一、与地址栏边缘是否协调？
   - [ ] Cmd+T 新建标签：缩放效果的上两角是否与下方一致？
   - [ ] 快速连点 Essentials / 普通标签：按压效果是否每次都能播完（见 5.5）？
   - [ ] 文件夹收起是否仍有淡出 + 收拢动画（见 5.1 / 5.2）？
   - [ ] 关闭标签：下方标签应平滑上移（不是瞬移）；连续关闭多个时不应出现叠加抖动（见 5.8）。
   - [ ] 切换深/浅色网页：顶栏与画卷边框应渐变（160ms）而不是瞬变；书签栏开启时也要一起渐变（见 5.9）。
   - [ ] 系统开启「减弱动态效果」后：切页应直接落位，关闭不应再播 170ms 时间轴（见 13 节 / 5.8）。
6. **地址栏面板检查（Cmd+T / Cmd+L）**：
   - [ ] 面板底色是否等于当前 palette 的 surface（深色下不该是中性 `#181818`）？
   - [ ] 候选项悬停 / 选中是否呈现和纸微阶与强调色联动？
   - [ ] URL 行、操作文字是否使用次级墨色，而不是 Zen 写死的 `#aaa`？
   - [ ] 搜索模式切换面板、候选结果右键菜单是否也是和纸浮层色？

---

## 4. 同步与发布命令

每次更新代码后，直接在主题根目录执行：
```bash
./install.sh
```
并在 Zen 浏览器中按 `Cmd + Q` 重启，即可热载入最新样式。

---

## 5. 色彩方案扩展规范 (Extending Color Schemes)

为了让日后拓展新配色如同“换墨水”一样轻松，已将色彩层解耦为独立模块 [`colors.css`](./colors.css)。

### 架构设计
整个主题由两个核心色彩 Token 驱动：
1. `--zenwashi-accent`：矿物强调色主色，支持通过 `light-dark(浅色值, 深色值)` 分别定义明暗模式。
2. `--zenwashi-accent-tint`：强调色半透明光晕（用于聚焦外环与微边框发光）。

当选择新的配色方案时，输入框焦点、选中的 Essentials 微卡片边框、选中的常规标签页、文件夹线框等所有界面元素将**全自动联动同步**。

### 如何快速新增一套配色？（只需两步）

#### 第一步：在 `colors.css` 中声明新方案
在 [`colors.css`](./colors.css) 末尾追加一个 `@media` 查询（例如新增“樱落”浅粉与深绯色）：
```css
/* 樱落 (Sakura Blossom) · 柔春落樱 */
@media (-moz-pref("zenwashi.accent", "sakura")) {
  :root {
    --zenwashi-accent: light-dark(#C25975, #E2829B) !important;
    --zenwashi-accent-tint: light-dark(rgba(194, 89, 117, 0.15), rgba(226, 130, 155, 0.22)) !important;
  }
}
```

#### 第二步：在 `preferences.json` 中添加下拉项
打开 [`preferences.json`](./preferences.json)，在 `zenwashi.accent` 的 `options` 数组中追加对应的键值对：
```json
{
  "value": "sakura",
  "label": "樱落 (Sakura Blossom) · 柔春落樱"
}
```

保存后执行 `./install.sh` 并重启浏览器，即可在 Zen 浏览器的 Sine 设置面板中直接选用新配色！

---

## 6. 混合地址栏明暗钩子 (`data-blended-mode`)

混合地址栏会按页面顶部采样颜色动态决定前景明暗。为了能按“实际渲染出来的明暗”切换素材，`blended-bar.uc.js` 会维护一个 `:root` 属性：

| 属性值 | 含义 |
| :-- | :-- |
| `data-blended-mode="light"` | 采样背景较亮，地址栏按浅色渲染（深色前景） |
| `data-blended-mode="dark"` | 采样背景较暗，地址栏按深色渲染（浅色前景） |
| 属性不存在 | 没有可用采样色（透明/无法解析），地址栏使用主题默认 |

判定依据是采样背景的相对亮度（阈值 `0.6`，与 `color-utils.js` 的 `chooseForeground()` 一致）；若背景色语法 `parseCssRgb()` 读不了（如 `color(display-p3 …)`），则退回用前景色判断（浅色文字 = 深色渲染）。它跟随**页面采样**，不是 `prefers-color-scheme`，因此“浅色系统 + 深色网页”时依然正确。关闭混合地址栏、页面切换为不适用主题或脚本卸载时，属性会被清除。

用法示例：

```css
/* 单色图标：直接用 currentColor，不必判断明暗 */
#my-button > .toolbarbutton-icon {
  list-style-image: none !important;
  background-color: currentColor !important;
  mask: url("chrome://sine/content/zen-washi-sumi/my-icon.svg") center / 16px no-repeat !important;
}

/* 需要两套素材时 */
:root[data-blended-mode="light"] #my-banner { background-image: url("banner-light.png"); }
:root[data-blended-mode="dark"]  #my-banner { background-image: url("banner-dark.png"); }
```

调试：打开浏览器工具箱（Browser Toolbox），选中 `<html>`，切换标签页或滚动页面即可看到该属性变化。

---

## 7. PDF 阅读器模块 (`styles/pdf-viewer.css`)

### 7.1 阅读器在**独立内容进程**里 —— 这是本模块所有设计的起点

实测（Zen 1.24 + macOS）：

```
gBrowser.selectedBrowser.contentDocument                    → null
…currentWindowGlobal.documentPrincipal.spec                 → resource://pdf.js/web/viewer.html
…currentWindowGlobal.documentURI.spec                       → file:///…/xxx.pdf
```

三条推论，缺一条都会写出"完全没效果"的代码：

1. **父进程碰不到它**：拿不到 DOM，也拿不到 `PDFViewerApplication`；`nsIStyleSheetService` 的 USER_SHEET 只在注册进程内生效，所以 Sine 的 `chrome.css` 链进不去。
2. **文档 URL 不是 `resource://pdf.js/`**：`PdfStreamConverter` 执行 `channel.originalURI = aRequest.URI`（"Keep the URL the same so the browser sees it as the same."），保留的是那份 PDF 自己的地址。所以 `@-moz-document url-prefix("resource://pdf.js/")` **永远不命中**。
3. **`<html>` 上没有 `mozdisallowselectionprint`**：viewer.html 源码里写着，但实测 `hasAttribute(...) === false`，用它做守卫同样静默失效。

### 7.2 交付链路：走 Gecko 原生 `userContent.css`

试过两条路，只有一条通：

| 通道 | 结果 |
| :-- | :-- |
| Sine 的 `chrome.css`（父进程 USER_SHEET） | 进不去——文档不在父进程 |
| Sine 的 content 注入（`SineUserContent` actor → `chrome://sine/content/content.css`） | 实测到不了阅读器 |
| 自建 `JSWindowActor` + `windowUtils.loadSheet(chrome://…)` | actor 注册成功、无报错，但在阅读器文档上从未触发 |
| **`<profile>/chrome/userContent.css`** | ✅ Gecko 每个内容进程启动时自己从磁盘读，不经 chrome 包注册 |

所以 `install.sh` 现在会维护 `<profile>/chrome/userContent.css` 顶部的一段托管块：

```css
/* >>> zen-washi-sumi managed import (do not edit) >>> */
@import "sine-mods/zen-washi-sumi/userContent.css";
/* <<< zen-washi-sumi managed import <<< */
```

注意 `@import` 必须位于文件最前面，所以是**整块前插**而不是追加；重装时会先删旧块再插，幂等。

原来自建的 `JSWindowActor`（`js/pdf-outline.uc.js` + `js/pdf-child.sys.mjs`）已验证无法触发，已删除；原因见 §7.9。

`@media -moz-pref(...)` 在内容进程里有效（Gecko 原生媒体特性，`viewer.css` 自己就在用），不必改成属性镜像。

### 7.3 守卫只能用「head 里那张 pdf.js 自有样式表」

`userContent.css` 对所有内容文档生效，网页也会被波及，所以必须守卫。可用判据只有一条：

```html
<link rel="stylesheet" href="resource://pdf.js/web/viewer.css">
```

于是根选择器：

```css
:root:has(link[href^="resource://pdf.js"]) { … }
```

网页不可能出现这种链接。**不要**再用下面这些（都试过，全部失效）：

- `@-moz-document url-prefix("resource://pdf.js/")` —— 文档 URL 是那份 PDF 自己的地址；
- `:root[mozdisallowselectionprint]` —— 属性在源码里有、在实测 DOM 里时有时无；
- 以 `#outerContainer` 为作用域根 —— 依赖在跨进程文档里取 DOM，而 Browser Toolbox 的 `document` 代理行为不一致（`getElementById` 能命中、`querySelector` 返回 null、`adoptedStyleSheets` 静默无效），据此下的结论不可信。

### 7.4 变量该写在哪个元素上

pdf.js 会把部分变量声明在更近的元素上，`:root` 的赋值会被就地声明盖掉：

| 变量 | 实际声明位置 | 覆盖写法 |
| :-- | :-- | :-- |
| `--page-bg-color` | `.pdfViewer`（重置为 `unset`） | `:root:has(link[href^="resource://pdf.js"]) .pdfViewer` |
| `--sidebar-bg-color` / `--sidebar-border-color` / `--sidebar-box-shadow` / `--sidebar-border-radius` | `.sidebar`（即 `#viewsManager`） | 同上前缀 `.sidebar` |
| `--treeitem-*` | `.treeView` | 同上前缀 `.treeView` |
| 工具栏、`--page-margin`、`--page-border`、输入框、弹层、进度条 | `:root` | 守卫根本身即可（比 `:root` 更近） |

user sheet 的普通声明优先级低于 author sheet（`viewer.css` 就是 author），覆盖已有属性一律 `!important`。

### 7.5 纸页的三个可配置项

| pref | 类型 | 默认 | 说明 |
| :-- | :-- | :-- | :-- |
| `zenwashi.pdf.page-radius` | dropdown | `6px` | `0px / 4px / 6px / 10px / 14px` |
| `zenwashi.pdf.page-shadow` | dropdown | `medium` | `off / soft / medium / strong / deep` |
| `zenwashi.pdf.page-border` | checkbox | `true` | 纸页 1px 发丝描边 |

CSS 读不到任意数值的 pref，所以圆角用**离散档位 + 等值媒体查询**（`@media (-moz-pref("…", "10px"))`）实现。投影档位用 `light-dark()` 定义两个颜色变量再复用，避免"4 档 × 明暗两种"写成 8 个媒体查询；`off` 用 `0 0 0 0 transparent` 占位而不是 `none`，否则 `box-shadow: <ring>, var(--shadow)` 会因为 `none` 让整个列表失效。

边框默认开：浅色纸面上没有那圈 1px 描边，圆角几乎看不出来。它和投影是同一条 `box-shadow` 列表的两个部分，靠源码顺序（边框规则在后）覆盖，因此**不要**把边框规则挪到投影规则前面。

### 7.6 贴顶工具栏（借鉴 Arc 2.0 的 `betterpdf.css`）

三个 pref：`zenwashi.pdf.floating-toolbar`（开关，默认开）、`zenwashi.pdf.toolbar-width`（`100% / 1080 / 860 / 720 / 560px`）、以及沿用 `zenwashi.pdf.page-shadow` 做胶囊投影。

实现就三步：

```css
#viewerContainer { inset: 0; }            /* ① 纸页顶到窗口边 */
#toolbarContainer {                       /* ② 工具栏贴顶并居中 */
  position: fixed; top: 0; left: 50%; transform: translateX(-50%);
  width: calc(100% - 16px); max-width: min(860px, calc(100% - 16px));
  border-radius: 0 0 12px 12px; border: 1px solid var(--zenwashi-pdf-line); border-top: none;
}
.pdfViewer .page:first-of-type {          /* ③ 首屏让位 */
  margin-top: calc(var(--toolbar-height) + 10px);
}
```

几个必须记住的点：

- **必须用 `position: fixed`，不能用 `absolute`**。`absolute` 的包含块是 `#mainContainer`，而侧栏开合会改动 `#viewerContainer` 与工具栏内部布局，实测会让工具栏在"贴边 / 下落 8px"之间跳；`fixed` 以视口为参照系，纵向彻底锁死。
- 贴顶之后**只圆下缘**（`0 0 12px 12px`）并去掉 `border-top`：上面再圆会在窗口顶边露出纸页。
- **让位只能用 `margin-top`**，不能用 `padding-top`：`#viewerContainer` 的 `inset: 0` 已经把滚动原点移到窗口顶部，用 padding 会在滚动区域里多出一段空白，而且不跟随缩放重算。
- `#loadingBar` 原本顶在 `calc(var(--toolbar-height))`，改造后要改成 `top: 100%` 贴住工具栏下沿（`#toolbarContainer` 没有 `overflow: hidden`，所以能露出来）。
- **不要**照搬 Arc 的 `#mainContainer::before { z-index: -10000 }` 底衬：那是给它半透明玻璃背景垫底的，我们的工具栏不透明，不需要。
- Arc 的工具栏是 `backdrop-filter: blur()` 玻璃，这里刻意不用。

### 7.7 入场与侧栏动画

- 工具栏：`@keyframes zenwashi-pdf-toolbar-in`，`translate(-50%, -6px)` → `translate(-50%, 0)` + 淡入，0.28s `cubic-bezier(0.22, 1, 0.36, 1)`。
- 侧栏面板：**靠 `hidden` 属性（`[hidden] { display: none !important }`）显隐**，所以普通 transition 跑不起来，进入动画必须写 `@starting-style`；关闭仍是瞬时的（要动画退出得 `transition-behavior: allow-discrete`，收益不大）。
- 侧栏打开时 **不要**让 `#viewerContainer` 改变 `inset-inline-start`：pdf.js 原本会按面板宽度推开内容，整页横向"划"一下，和工具栏的纵向落定完全不搭。本模块把它钉死在 0，面板改成浮在纸页上的门帘。
- 面板的 `max-height` 也不能沿用 pdf.js 的 `--viewer-container-height` 算法（我们清掉了 viewerContainer 的 inset），否则底部会顶到窗口下沿、圆角被切；改成按 `100vh` 预留 16px。
- 两者都在 `prefers-reduced-motion: reduce` 下关闭。

### 7.8 页间分隔线用 `.page::before`

pdf.js 只在 `.page.loadingIcon::after` 上画加载圈，`::before` 空闲。分隔线挂在 `bottom: calc(gap * -0.5 - 0.5px)`，正好落在 `--page-margin` 造成的间隙正中。`--page-border` 默认是 `9px solid transparent`（无阴影，纯留白），模块里统一压成 `0`，间距完全交给 `--page-margin`，否则两种留白叠加、`none` 档永远无法真正无缝。

### 7.9 为什么没有工具栏按钮 / 快捷键

**结论：在当前注入机制下做不到，本模块只做样式。**

要加一个「直接打开文档大纲」的按钮，需要往阅读器文档里插 `<button>` 并绑点击，纯 CSS 不可能。而内容进程里没有任何可用的 JS 入口：

- profile 的 `chrome/utils/chrome.manifest`（把 `chrome://userscripts/`、`chrome://sine/` 映到 profile 目录）是 `config.js` 在**父进程** `autoRegister` 的：

  ```js
  Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(cmanifest);
  ChromeUtils.importESModule("chrome://userscripts/content/sine.sys.mjs");
  ```

  子进程不跑 `config.js`，所以这些包在子进程解析不到。**Sine 自己的 `SineUserContent` actor 也因此失效**——这正是它的 `content.css` 从未到达阅读器的原因。
- 换 URI 也不行：`file://` 的 ES module 被 Gecko 直接禁用，`resource://` 是只读 omni，`chrome://browser/` 写不进去。

因此 `JSWindowActor` + `windowUtils.loadSheet` 那条路整条作废，`js/pdf-child.sys.mjs` 与 `js/pdf-outline.uc.js` 已删除。

如果只是想要「打开就是大纲」，用 pdf.js 自己的 pref：

```
pdfjs.sidebarViewOnLoad = 2      # 0=无 1=缩略图 2=大纲 3=附件 4=图层
```

代价是每次打开 PDF 面板会自动展开一次；关掉之后，同一份文档里再点面板按钮会记住大纲视图。

### 7.10 工具栏图标（内联 data: URI）

pdf.js 的图标全部是 `mask-image: var(--toolbarButton-*-icon)` + `background-color` 上色，素材在 `resource://pdf.js/web/images/*.svg`。主题另画了一套 16px / 1.5px 描边的替换，只覆盖主工具栏（翻页、缩放 ±、打印、下载、视图面板、二级工具栏、演示模式、菜单箭头）和查找栏前后翻；二级工具栏里那些（旋转、单双页、文档属性、手型工具…）保持原生。

两个必须知道的点：

1. **只能用 data: URI**。阅读器的 CSP 是 `img-src resource: blob: data:`，而我们的 `icons/*.svg` 在 profile 的 `file://` 路径下，会被拦掉。内联时描边写死 `#000`——mask 只看 alpha，不需要 `context-fill`（而 `context-fill` 在没有 context paint 的 data: URI 里会画不出来）。
2. **变量覆盖必须 `!important`**。pdf.js 把这些变量声明在 `:root`（author sheet），我们是 user sheet，普通声明会输。

替换的变量清单（12 个）：

```
--toolbarButton-pageUp-icon        --toolbarButton-pageDown-icon
--toolbarButton-zoomOut-icon       --toolbarButton-zoomIn-icon
--toolbarButton-print-icon         --toolbarButton-download-icon
--toolbarButton-viewsManagerToggle-icon
--toolbarButton-secondaryToolbarToggle-icon
--toolbarButton-presentationMode-icon
--toolbarButton-menuArrow-icon     --findbarButton-previous-icon
--findbarButton-next-icon
```

---

## 8. 设置页换肤 (`styles/settings.css`) 与标签条渐隐

### 8.1 覆盖设计令牌，而不是逐元素重绘

`about:preferences` 内部是 `moz-page-nav` / `groupbox` / `.subcategory` / `moz-card` 一堆自定义元素，其中 `moz-page-nav-button` 的选中态还在 **shadow DOM** 里（`button[selected]`）。逐元素改样式既穿不透 shadow，又会被版本升级打散。

所以这里只做一件事：覆盖 Firefox 自己用来上色的**设计令牌**。

```css
#preferences-root {
  --background-color-canvas: var(--zwset-bg);
  --background-color-box: var(--zwset-card);
  --text-color: var(--zwset-fg);
  --border-color: var(--zwset-line);
  --page-nav-button-background-color-selected: var(--zwset-accent-tint);
  --border-color-selected: var(--zwset-accent);
}
```

`#preferences-root` 就是 `<html id="preferences-root">`，令牌在这里声明会向下继承到整页，包括 shadow DOM 里那些 `var()` 引用。

### 8.1.1 两个必须按元素覆盖的地方

1. **`moz-page-nav-button` 的令牌**。它在 shadow 里用 `:host` 声明了
   `--page-nav-button-*`——**元素自身的声明永远压过继承值**，所以在
   `#preferences-root` 上覆盖这些令牌是无效的（选中态仍然是 Firefox 的淡蓝）。
   必须直接写在按钮元素上：

   ```css
   #categories moz-page-nav-button {
     --page-nav-button-background-color-selected: var(--zwset-accent-tint) !important;
     --page-nav-button-text-color-selected: var(--zwset-fg) !important;
   }
   ```

   另外这些令牌定义在 `@layer tokens-foundation` 里，层内声明优先级低于无层声明，
   但**来源**仍先于层——我们是 user sheet，普通声明依然会输，所以 `!important` 不能省。

2. **左侧导航的硬分隔线**由 `moz-page-nav` 的
   `border-inline-end: 1px solid var(--page-nav-border-color)` 画，覆盖
   `--page-nav-border-color: transparent` 即可；顺带把 `#categories` 背景设成
   transparent，让导航列和页面底色连成一片。

3. 复选框、链接、焦点环、进度条统一吃 `--color-accent-primary`，在
   `#preferences-root` 上覆盖它比逐个元素改省事得多。

### 8.2 投放：复用 userContent 通道

设置页是**内容进程的普通文档**（URL 就是 `about:preferences`），和 PDF 阅读器不同 —— 它既吃 `@-moz-document url-prefix("about:preferences")`，也吃 `<profile>/chrome/userContent.css` 这条原生通道。不需要任何额外机制。

调色板数值由 `colors.css` 生成后写死在本文件里（跨文档变量不继承，只能复制）。**改配色时以 `colors.css` 为准，重新生成这一节。**

### 8.3 标签条渐隐：下端用遮罩，上端用 sticky 覆盖层

```css
/* 下端：遮罩 */
#zen-tabs-wrapper {
  mask-image: linear-gradient(to bottom, #000 0, #000 calc(100% - 18px), transparent 100%);
}

/* 上端：sticky 覆盖层 */
#zen-tabs-wrapper::before {
  content: "";
  position: sticky;
  top: 0;
  z-index: 4;
  display: block;
  height: 16px;
  margin-block-end: -16px;      /* 抵消占位，不影响标签布局 */
  pointer-events: none;         /* 点击穿透到下面 */
  background: linear-gradient(to bottom, var(--zenwashi-bg-base), transparent);
}
```

**为什么上下要用两套机制**：`#zen-tabs-wrapper` 自己是 `overflow-y: auto` 的滚动容器，而 `mask-image` 画在元素的**滚动坐标系**里（等价于 `background-attachment: scroll`）。下端那段在内容滚到底时正好进入可视区末尾，所以能看见；上端那段会随内容一起滚走，永远落不到可视区上边界。

`position: sticky` 则是相对**滚动容器的可视区**定位的，所以能钉在顶部。三个配套细节缺一不可：`margin-block-end: -16px` 抵消占位、`pointer-events: none` 让点击穿透、`z-index` 压住标签卡片。

**踩过的错路**（别再走）：

1. 挂到 `#tabbrowser-arrowscrollbox` —— 它同样在滚动链里，一样滚走；
2. 用 `[scrolledtostart]` / `[scrolledtoend]` 做条件 —— 竖向标签下这两个属性不随滚动更新，条件一挂就永远命中"两端都在"，整条渐隐消失；
3. 只把上端 ramp 调长 —— 只是把"切掉半行"变成"糊掉一行"。

### 8.4 工作区指示器开关

侧栏顶部那行「工作区名 + 折叠箭头」由 JS 生成，类名是 `.zen-current-workspace-indicator`（不在 browser.xhtml 静态标记里，所以搜 id 搜不到）。关掉时整行连高度一起消失：

```css
@media (-moz-pref("zenwashi.sidebar.workspace-indicator", false)) {
  .zen-current-workspace-indicator { display: none !important; }
}
```

底部那排工作区图标按钮是 `#zen-workspaces-button`（另一组元素，在 `#zen-sidebar-foot-buttons` 里），不受这个开关影响；要一起隐藏得另加规则。

指示器隐藏后，Essentials 与标签列表会直接贴在一起，所以同一分支里补了一段呼吸间距：

```css
#zen-tabs-wrapper { margin-block-start: var(--zenwashi-tabs-gap, 12px); }
```

加在 `#zen-tabs-wrapper` 而不是 `#zen-essentials` 上——后者由 Zen 用 grid 精确计算，外部 margin 会把它顶偏（见 §2 踩坑点 1）。用 `margin` 而不是 `padding`，避免把 `mask` 的渐隐区域一起撑大。

---

## 9. Cmd+T 悬浮地址栏的居中参照

Zen 原生把 `#urlbar[open][zen-floating-urlbar="true"]` 定位成「相对窗口居中」：

```css
top: var(--zen-urlbar-top) !important;
left: 50% !important;
translate: -50% 0%;
```

窗口中线比侧栏右侧的内容区中心偏左半个侧栏宽，所以看起来"不居中"。主题改成以内容区为中心、并垂直居中，但**纯 CSS 做不成**：

- `#urlbar` 是 popover（`position: fixed`），`left` / `top` 百分比以**视口**为基准；
- 换算需要侧栏宽度。Zen 确实有 `--zen-sidebar-width`，但它写在 `#navigator-toolbox` 的**内联样式**上（`ZenCustomizableUI.sys.mjs`），popover 进顶层后继承链断开 → 取到空值 → `calc(50% + 0px/2)` 仍然等于 `50%`，表现就是"改了跟没改一样"。

所以交给 `js/floating-urlbar-center.uc.js`：

1. 监听 `#urlbar` 的 `open` / `zen-floating-urlbar` 属性（MutationObserver）；
2. 打开时量 `gBrowser.selectedBrowser.getBoundingClientRect()`，把中心点写成
   `--zenwashi-float-x` / `--zenwashi-float-y`，并打上 `zenwashi-float-positioned`；
3. CSS 只负责消费：

```css
:root[zenwashi-float-positioned="true"] #urlbar[open][zen-floating-urlbar="true"] {
  left: var(--zenwashi-float-x) !important;
  top: var(--zenwashi-float-y) !important;
  translate: -50% -50% !important;
}
```

因为量的是 `selectedBrowser` 的矩形，侧栏展开/折叠、split view、紧凑模式都会自动跟随，不需要各写一套。

**另一个坑**：`styles/blended-addressbar.css` 里给分屏地址栏用的那条 `position: fixed + left/top/width` 覆盖，早期没排除悬浮态，会把 Cmd+T 面板钉到内联字段的坐标上。现在选择器带 `:not([zen-floating-urlbar="true"])`。

---

## 10. 地址栏的「上/下圆角」分离

`zenwashi.urlbar.bottom-radius` 控制地址栏**下方两个角**，未展开的玻璃胶囊与展开后的候选面板都生效：

| 值 | 含义 |
| :-- | :-- |
| `follow`（默认） | 跟随各自的上圆角，行为与改造前完全一致 |
| `0px` | 下方直角，贴住内容区上沿 |
| `6 / 9 / 12 / 15px` | 固定档位 |

实现要点：

```css
border-radius:
  var(--zenwashi-urlbar-panel-radius, 15px) var(--zenwashi-urlbar-panel-radius, 15px)
  var(--zenwashi-urlbar-bottom-radius, var(--zenwashi-urlbar-panel-radius, 15px))
  var(--zenwashi-urlbar-bottom-radius, var(--zenwashi-urlbar-panel-radius, 15px)) !important;
```

- 下圆角的回落值是**各自的上圆角**（胶囊 9px / 面板 15px），所以 `follow` 档等于四角同圆，不需要额外写规则；
- `#urlbar` **本体**和它的 `.urlbar-background` 都要写同一条四值圆角——只改后者时，本体那块方形背景会从上层的圆角外露出来；
- 展开态的 `#urlbar` 还带描边与投影，圆角改了它们会跟着走，不用单独处理。

未展开的输入框另走一套**长手属性**，只改下方两角：

```css
#urlbar:not([zen-floating-urlbar="true"]):not([open]):not([breakout-extend]),
#urlbar:not([zen-floating-urlbar="true"]):not([open]):not([breakout-extend])
  > .urlbar-background {
  border-end-start-radius: 12px !important;
  border-end-end-radius: 12px !important;
}
```

**为什么不用四值简写**：简写会连上圆角一起写死，而各布局模式下原生上圆角并不相同。更要紧的是——主题里那条玻璃胶囊规则带 `:root:not([zen-single-toolbar="true"])`，**单工具栏布局下整条不生效**，所以早期版本"选了档位却毫无变化"就是这么来的。长手属性 + 不带布局前提的选择器才与模式无关。

**视觉风险**（用户问的"会不会出现空白"）：`border-radius` 只影响绘制、不改变盒模型，所以不会有布局位移或真正的空白。真实风险有两个：

1. **面板**下圆角大于内容内边距时，最后一行的圆角底色会被边缘"啃掉"一块，看起来像贴边翻车；面板内边距约 6–8px，建议不超过 12px；
2. **未展开胶囊**只圆下方会变成"上半圆、下方直"的形状；它紧贴上方的工具栏时反而更整齐，但离内容区太远时会显得下盘被削平。

### 10.1 融合顶栏自己的下圆角（`zenwashi.toolbar.bottom-radius`）

「融合一体顶栏」里真正上色的那一层是 **`#zen-appcontent-navbar-wrapper`**（`styles/blended-addressbar.css` 给它铺 `--zen-tab-header-background`）。它和页面同属 `#zen-appcontent-wrapper` 这张卡，所以圆掉它的下方两角，露出来的是卡片底色，顶栏就成了一条浮在页面上的圆角条。

```css
#zen-appcontent-navbar-wrapper {
  border-end-start-radius: 12px !important;
  border-end-end-radius: 12px !important;
}
```

**踩过的三个错目标**（都不出效果，别再试）：

| 元素 | 为什么不对 |
| :-- | :-- |
| `#navigator-toolbox` / `#titlebar` | 被 `#zen-toolbar-background` 那层盖住，圆了也看不见 |
| `#zen-toolbar-background` | `.zen-browser-generic-background` 是 `position: absolute; inset: 0` 的**整窗背景层**，不是"条" |
| `#nav-bar` | 主题里就是 `background-color: transparent`，不负责上色 |

排错心法：**先找"谁在铺色"，再找"谁在上面盖着"**。光看截图里那条浅色是判断不出来的——那层可能整窗铺开，只是下半截被页面挡住了。

