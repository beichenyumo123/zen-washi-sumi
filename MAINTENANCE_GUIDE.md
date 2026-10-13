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
