# Zen Washi & Sumi (和纸与松烟墨)

为 Zen 浏览器打造的东方极简纸墨美学主题（基于 **Sine** Mod 体系）。

白昼如**手工和纸（鳥の子色）**般温润护眼、无刺眼反光；入夜如**松烟老墨（濡羽色）**般深邃沉静、无高光死黑。结合东方矿物传统色（竹青、焦茶、朱砂、琉璃、山吹）作为点睛印章色，专为追求内敛克制、长时阅读与心流专注的用户设计。

---
## 预览
<img width="3328" height="1876" alt="图片" src="https://github.com/user-attachments/assets/1f021a29-b571-4216-8f5d-b24b497ce3b1" />

---

<img width="3328" height="1876" alt="图片" src="https://github.com/user-attachments/assets/49d1bfb4-0938-4659-9b20-f789ff6353cf" />


## 🎨 色彩与设计哲学

| 维度 | 日间模式 · 和纸（Washi） | 夜间模式 · 松烟墨（Sumi） |
| :--- | :--- | :--- |
| **画布底色** | `#F5F3EC`（鸟の子色 / 暖白和纸） | `#131416`（松烟墨 / 带幽微冷青的深墨） |
| **侧边栏基底** | `#ECE9DF`（生成り色 / 生白纸阶） | `#181A1D`（油烟微明 / 侧边层级过渡） |
| **主标题字色** | `#24221F`（古法浓墨） | `#E8E5DC`（胡粉白 / 柔和纸色字） |
| **次级说明字** | `#6E685F`（薄墨浅灰） | `#908B82`（淡云灰） |
| **标签选中态** | `rgba(60, 52, 42, 0.09)` 哑光墨茶微阶 | `rgba(245, 242, 235, 0.11)` 柔光纸色微阶 |
| **悬浮视口边框**| `1px` 细发丝纸边（柔和漫射阴影） | `1px` 深墨发丝边（夜间多层柔和深影） |

---

## ✨ 核心特性

1. **去油纯净的标签页（Zero Indicator Glare）**：
   - 移除生硬霓虹指示条、外发光与厚重卡片描边。
   - 标签页完全平贴于侧边栏，通过微色阶与半透明质感区分激活状态。
   - 可在 Sine 设置中选择是否开启**朱砂印（Cinnabar Seal Dot）**作为极简活动指示微标。
   - 顶栏与画卷边框跟随网页取色时带 `160ms` 柔和过渡（可在 Sine 设置 → 融合顶栏里关闭）。

2. **传统矿物印彩（Mineral Accent Presets）**：
   在 Sine 图形化设置面板中提供 5 种东方经典矿物印色：
   - 🌿 **竹青 (Bamboo Green)**：清雅幽静（默认）。
   - 🍂 **焦茶 (Warm Umber)**：枯木暖褐、古朴沉着。
   - 🔴 **朱砂 (Cinnabar Red)**：典雅印泥、提神醒目。
   - 🌊 **琉璃 (Deep Indigo)**：静谧深靛、理性内敛。
   - 🌾 **山吹 (Yamabuki Gold)**：暮色秋金、温和微润。

3. **悬浮画卷视口（Floating Webview Island）**：
   - 原生圆角同步（默认 `16px`），消除双圆角毛边。
   - 网页视口宛如铺设在和纸/深墨案台上的独立画卷，支持自定义外边距与漫射纸影。
   - 圆角形状可选 **Round 圆弧 / Squircle 连续圆角**：`border-radius` 画的是四分之一圆，切点处曲率突变，半径开到 20px 以上时会"看着不够顺"；Squircle 走 Gecko 的 `corner-shape`（macOS 式超椭圆，曲率连续）。需先在 `about:config` 打开 `layout.css.corner-shape.enabled` 并重启 Zen，未开启时该设置自动退回圆弧。

4. **护眼墨迹微褪（Ink Fade on Sleeping Tabs）**：
   - 休眠或闲置未加载的标签页墨色自动微褪（`opacity: 0.6`），降低信息噪音，让注意力聚焦于当前任务。

5. **纸墨质感滚动条**：
   - 内置极细墨色页面滚动条（支持关闭或完全隐藏）。

6. **内置 New Icons 图标集（Integrated Icon Set）**：
   - 已整合 [`qumeqa/zen-icons`](https://github.com/qumeqa/zen-icons) 的图标（工具栏、地址栏、面板、右键菜单），无需再单独安装 New Icons mod。
   - 图标为 `chrome://` 外部 SVG + `context-fill`，颜色跟随主题前景色与融合顶栏的明暗自动变化。
   - 可在 Sine 设置 → **Icons 图标集** 中一键关闭，回到 Zen 原生图标。

7. **和纸抽离式关闭动效（Washi Close）**：
   - 关闭标签不再"瞬间消失 / 整排瞬移"：整行 170ms 淡出上浮，关闭项自己的 `margin` 收拢带动后续标签平滑上移（与 Zen 原生同源，文件夹导轨与滚动条会自然跟随）。
   - 关闭当前标签时跳过 0.42–0.58s 的内容切换缩放，让"关闭"由标签行自己主导。
   - 批量关闭有并发保护；可在 Sine 设置中选择 `Off / Washi Slide / Fade`，并单独开关"关闭时跳过切换动效"。实现见 `js/tab-close.uc.js`，维护要点见 `MAINTENANCE_GUIDE.md` §5.8。

8. **磨砂玻璃地址栏（Frosted URL Field）**：
   - 未聚焦时地址栏不再"隐形"，而是一枚半透明玻璃胶囊：底色取顶栏对比色 8%，悬停 12%，配发丝描边与顶部高光，聚焦后仍回到和纸浮层。
   - 融合顶栏的底色本来就是网页顶部像素磨皮后的平均色，"半透明胶囊 + 取色顶栏"读起来就是 Safari 那种隔着玻璃看网页的观感；不靠 `backdrop-filter`（chrome 层采不到网页像素，见指南 §5.10）。
   - 圆角可在 Sine 设置 → **URL field corner radius** 调整；整项可用 **Frosted URL field** 关闭，回到纯文字无底板的旧样式。

9. **和纸 PDF 阅读器（Washi PDF Viewer）**：
   - 取景框换成和纸案台色，工具栏与侧栏面板统一到当前基底方案的纸色（纯色，不用毛玻璃）。
   - 纸页圆角（0 / 4 / 6 / 10 / 14px）、投影档位（Off / Soft / Medium / Strong / Deep）、发丝描边开关都在 Sine 设置里可调。
   - 贴顶工具栏：纸页顶到窗口边、工具栏钉在窗口顶边（只圆下缘）并带落定动画，宽度可调（通栏 / 1080 / 860 / 720 / 560px），侧栏带滑出淡入；可整体关回原生工具栏。
   - 页与页之间可选 **间距 / 细虚线 / 细点线 / 无缝连排**（Sine 设置 → **Page separation**）。
   - 侧栏（缩略图 / 文档大纲 / 附件 / 图层）与查找栏一并换肤，大纲条目用矿物强调色标注选中态。
   - 阅读器跑在**独立内容进程**里，Sine 的样式注入到不了，所以由 `install.sh` 在 `<profile>/chrome/userContent.css` 顶部维护一条 `@import`（Gecko 原生按进程加载），主题用 `:root:has(link[href^="resource://pdf.js"])` 作守卫；配色不能复用 `colors.css` 的 token，维护要点见 `MAINTENANCE_GUIDE.md` §7。

10. **设置页与标签条边缘（Settings & Edge Fade）**：
   - `about:preferences` 也换肤：页面、卡片、导航选中态与链接统一到当前基底方案，卡片收成 12px 圆角。实现走的是覆盖 Firefox 设计令牌（`--background-color-*` / `--text-color` / `--page-nav-button-*`），不逐元素重绘，所以版本升级不容易失效。
   - 标签条在溢出时上下边缘柔和渐隐（`mask-image`），不再被硬边切断。
   - 两者都可在 Sine 设置里单独关闭。

---

## 📂 文件结构

```text
zen-washi-sumi/
├── theme.json         # Sine Mod 元数据声明
├── preferences.json   # Sine 图形化配置面板（色彩预设、视口与标签微调）
├── userChrome.css     # 和纸与松烟墨界面样式、Token 与组件定义
├── userContent.css    # 网页端配套极细墨色滚动条
├── styles/            # 融合顶栏、图标集、PDF 阅读器等分模块样式
│   ├── blended-addressbar.css
│   ├── icons.css      # New Icons 图标集（内置）
│   ├── header-chrome.css
│   ├── loadbar.css
│   ├── pdf-viewer.css # PDF 阅读器（resource://pdf.js）独立文档样式
│   └── settings.css   # about:preferences 设计令牌覆盖
├── icons/             # 32 个外部 SVG 图标（chrome:// 引用，支持 context-fill）
├── blended-bar.uc.js  # 融合顶栏采样脚本
├── frame.js           # 页面颜色采样注入脚本
├── js/
│   ├── tab-close.uc.js    # 标签关闭动效（WAAPI 时间轴 + 让位收拢）
│   ├── tab-indicator.uc.js # 垂直标签切换的瞬态墨痕（opt-in）
│   └── floating-urlbar-center.uc.js # Cmd+T / Cmd+L 浮层在内容区居中
├── scripts/           # 采样 / 配色 / 面板布局等模块化辅助脚本
├── preview/           # 开发期调试页（loading-veil.html）
├── install.sh         # 一键同步到 Zen Profile 并注册脚本
├── MAINTENANCE_GUIDE.md # 架构与踩坑复盘（改样式前先读）
└── README.md          # 详细设计说明与指南
```

---

## 🚀 安装与使用

**前置条件**：[Zen Browser](https://zen-browser.app/) + 已启用 [Sine](https://github.com/zen-browser/sine) Mod 体系（主题走 Sine 的 `theme.json` / `preferences.json` 注册，不是纯 `userChrome.css` 拖放）。

```bash
git clone https://github.com/beichenyumo123/zen-washi-sumi.git
cd zen-washi-sumi
./install.sh
```

脚本会自动扫描你本地已配置 Sine 的 Zen Profile，完成 Mod 文件同步，并在 `mods.json` 与 `chrome.css` 中注入注册配置（同时维护 PDF 阅读器需要的 `<profile>/chrome/userContent.css` 托管块）。

- **多 Profile / 自动扫描失败**时，手动指定 `sine-mods` 目录：
  ```bash
  ./install.sh "/path/to/Profiles/xxxx.default/chrome/sine-mods"
  ```
- 若 Zen 正在运行，脚本会先安全退出 Zen 再写入（Sine 会把内存里的旧 `mods.json` 回写磁盘，运行中安装会被覆盖）。
- 安装完成后重启 Zen，前往 **Zen 设置 → Sine → Mods**，即可在 **Zen Washi & Sumi (和纸与松烟墨)** 下调整传统色强调、对比度、视口圆角与各类动效。

**更新**：`git pull` 后重新执行 `./install.sh` 并重启 Zen。

**卸载**：在 Sine 设置里关闭 / 移除本 Mod，然后删除 `<profile>/chrome/sine-mods/zen-washi-sumi` 目录即可。

---

## 🙏 致谢

- [Zen Browser](https://zen-browser.app/) 与 [Sine](https://github.com/zen-browser/sine)：主题的宿主与 Mod 框架。
- [`qumeqa/zen-icons`](https://github.com/qumeqa/zen-icons)：内置 New Icons 图标集（`icons/`）。
- 融合顶栏的取色思路参考了社区里一批「地址栏随网页变色」的实现，采样与配色收敛逻辑为本主题重写。

## 📄 License

[MIT](LICENSE) © 2026 db (beichenyumo123)

主题内的第三方图标集（`icons/`）遵循其上游仓库的授权；`icons/` 以外未标注的代码、样式与文档均为本仓库原创。
