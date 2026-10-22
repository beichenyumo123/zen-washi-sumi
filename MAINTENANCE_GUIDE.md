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
