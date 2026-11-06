#!/usr/bin/env bash
# =============================================================================
# zen-washi-sumi — 同步并注册「和纸与松烟墨」主题到 Zen Browser 的 sine-mods 目录
#
#   ./install.sh                      # 自动扫描包含 sine-mods 的 Zen Profile
#   ./install.sh "/path/to/sine-mods" # 手动指定 sine-mods 绝对路径
# =============================================================================
set -euo pipefail

MOD_ID="zen-washi-sumi"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DST="${1:-}"
if [ -z "$DST" ]; then
  for candidate in "$HOME/Library/Application Support/zen/Profiles"/*/chrome/sine-mods; do
    if [ -f "$candidate/mods.json" ]; then
      DST="$candidate"
      break
    fi
  done
fi

if [ -z "$DST" ] || [ ! -f "$DST/mods.json" ]; then
  echo "未检测到已初始化的 sine-mods 目录（需包含 mods.json）。" >&2
  echo "请确保已在 Zen 中启用 Sine，或者将 sine-mods 路径作为参数传入：" >&2
  echo "  ./install.sh \"/path/to/Profiles/xxxx.default/chrome/sine-mods\"" >&2
  exit 1
fi

is_zen_running() {
  pgrep -x "zen" >/dev/null 2>&1 \
    || pgrep -x "zen-bin" >/dev/null 2>&1 \
    || pgrep -f "Zen.app/Contents/MacOS/zen" >/dev/null 2>&1
}

# 关键防覆盖保护：如果 Zen 正在运行，Sine 会在内存中持有旧版 mods.json（无 scripts 字段），
# 在切换开关、点击重载或退出浏览器时会把内存中的旧数据写回磁盘，覆盖掉 install.sh 写入的 scripts 配置！
# 因此必须先安全退出 Zen 浏览器并确认进程完全结束，否则宁可报错退出，也不写入半成品注册。
if is_zen_running; then
  echo "→ 检测到 Zen 浏览器正在运行，正在先安全关闭以避免 Sine 内存缓存覆盖 mods.json..."
  osascript -e 'tell application "Zen" to quit' >/dev/null 2>&1 \
    || osascript -e 'tell application "Zen Browser" to quit' >/dev/null 2>&1 \
    || killall "zen" >/dev/null 2>&1 \
    || true
  # 标签多时退出可能要几十秒，最多等 30 秒。
  for _ in $(seq 1 100); do
    is_zen_running || break
    sleep 0.3
  done
  if is_zen_running; then
    echo "✗ Zen 在 30 秒内仍未退出，已中止安装。" >&2
    echo "  请手动完全退出 Zen（确认菜单栏/程序坞中无 Zen 进程）后重新运行本脚本。" >&2
    exit 1
  fi
fi

echo "→ 正在同步到: $DST/$MOD_ID"
mkdir -p "$DST/$MOD_ID"

# 不能再用 cp -R：Git 对象是只读的 444 文件，覆盖已存在的 .git/objects 会触发
# "Permission denied"，配合 set -e 会让脚本在写 mods.json 之前直接中断（旧版就是因此
# 一直注册不上 scripts）。这里改为排除 .git/.DS_Store 的镜像同步，并清掉历史遗留的 .git。
rm -rf "$DST/$MOD_ID/.git"
# 目标目录里可能残留历史只读文件（Git 对象是 444），先恢复可写再镜像同步。
chmod -R u+w "$DST/$MOD_ID" 2>/dev/null || true
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude='.git' \
    --exclude='.DS_Store' \
    "$SRC/" "$DST/$MOD_ID/"
else
  tar --exclude='.git' --exclude='.DS_Store' -C "$SRC" -cf - . \
    | tar -C "$DST/$MOD_ID" -xf -
fi

# 清理旧版安装脚本遗留的 fx-autoconfig 兜底副本：Sine 注册正常时双通道会把
# 同一个脚本注入两遍，导致事件监听/观察器重复。现在只保留 Sine 一条通道。
LEGACY_JS="$(dirname "$DST")/JS/zen-washi-sumi-blended-bar.uc.js"
if [ -e "$LEGACY_JS" ]; then
  rm -f "$LEGACY_JS"
  echo "→ 已移除旧的 fx-autoconfig 兜底副本: $LEGACY_JS"
fi

python3 - "$DST" "$MOD_ID" <<'PY'
import json, pathlib, shutil, sys

sine_mods = pathlib.Path(sys.argv[1])
mod_id = sys.argv[2]

entry = json.load(open(sine_mods / mod_id / "theme.json", encoding="utf-8"))
entry["origin"] = "store"  # Sine 只给 store 来源（或开启 allow-unsafe-js）的 mod 注入 JS
entry["no-updates"] = True
entry["enabled"] = True

entry_scripts = entry.get("scripts") or {}
missing = [rel for rel in entry_scripts if not (sine_mods / mod_id / rel).is_file()]
if not entry_scripts or missing:
    print("✗ theme.json 缺少 scripts 或脚本文件不存在，未写入 mods.json：", file=sys.stderr)
    for rel in missing:
        print(f"  - 缺少文件: {rel}", file=sys.stderr)
    raise SystemExit(1)

mods_file = sine_mods / "mods.json"
mods = json.load(open(mods_file, encoding="utf-8"))
shutil.copy2(mods_file, str(mods_file) + ".bak")
mods[mod_id] = entry
mods_file.write_text(json.dumps(mods, indent=2, ensure_ascii=False), encoding="utf-8")
print("→ 已写入 mods.json 注册条目")

style = entry.get("style", {})
for kind, entrypoint in (("chrome", "chrome.css"), ("content", "content.css")):
    rel = style.get(kind)
    if not rel:
        continue
    import_line = f'@import "{(sine_mods / mod_id / rel).as_uri()}";\n'
    css_file = sine_mods / entrypoint
    text = css_file.read_text(encoding="utf-8") if css_file.exists() else ""
    if mod_id not in text:
        if text and not text.endswith("\n"):
            text += "\n"
        css_file.write_text(text + import_line, encoding="utf-8")
        print(f"→ 已写入 {entrypoint} @import")
    else:
        print(f"→ {entrypoint} 已包含 @import 声明")

# 写盘后回读校验：注册没落地就立刻报错，避免“脚本说成功、实际没生效”。
saved_entry = json.loads(mods_file.read_text(encoding="utf-8")).get(mod_id) or {}
saved_scripts = saved_entry.get("scripts") or {}
problems = []
if not saved_scripts:
    problems.append("mods.json 中没有 scripts 字段")
if saved_entry.get("origin") != "store":
    problems.append("origin 不是 'store'（Sine 会因此拒绝注入本地 mod 的 JS）")
for script_rel in saved_scripts:
    if not (sine_mods / mod_id / script_rel).is_file():
        problems.append(f"脚本文件不存在: {script_rel}")
if problems:
    print("✗ 注册校验失败：", file=sys.stderr)
    for problem in problems:
        print(f"  - {problem}", file=sys.stderr)
    raise SystemExit(1)
print(f"→ 校验通过：version={saved_entry.get('version')} "
      f"origin={saved_entry.get('origin')} scripts={list(saved_scripts)}")
PY

# ---------------------------------------------------------------------------
# 原生 userContent 通道（PDF 阅读器等多个 out-of-process 文档唯一可靠的入口）
#   Sine 的 content.css 是由 JSWindowActor 注入 chrome://sine/content/content.css，
#   实测到不了 PDF 阅读器这类 out-of-process 文档（子进程里 chrome:// 包解析不到）。
#   Gecko 自己会在每个内容进程启动时加载 <profile>/chrome/userContent.css，
#   所以这里额外维护一段 @import 作为兜底；主题的 userContent.css 再转进
#   styles/pdf-viewer.css。块内 @import 必须位于文件最前面，因此整块前插。
# ---------------------------------------------------------------------------
python3 - "$DST" <<'PY'
import pathlib, re, sys

sine_mods = pathlib.Path(sys.argv[1])
target = sine_mods.parent / "userContent.css"
rel = f"{sine_mods.name}/zen-washi-sumi/userContent.css"

BEGIN = "/* >>> zen-washi-sumi managed import (do not edit) >>> */"
END = "/* <<< zen-washi-sumi managed import <<< */"
block = f'{BEGIN}\n@import "{rel}";\n{END}\n'

text = target.read_text(encoding="utf-8") if target.exists() else ""
text = re.sub(
    re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?",
    "",
    text,
    flags=re.S,
)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(block + text, encoding="utf-8")
print(f"→ 已维护 {target.name} 的 userContent @import（{rel}）")
PY

# 自动清理 Zen 的 startupCache，确保启动后最新 .uc.js 脚本立即被编译加载
for cache_dir in "$HOME/Library/Caches/zen/Profiles"/*/startupCache; do
  if [ -d "$cache_dir" ]; then
    rm -rf "$cache_dir"
    echo "→ 已清理启动缓存: $cache_dir"
  fi
done

echo "✓ 安装成功！现在直接打开 Zen 浏览器即可（请勿在运行 install.sh 前后点击 Sine 的重载按钮，以免覆盖本地注册）。"
