#!/usr/bin/env bash
# =============================================================================
# zen-washi-sumi — 同步并注册「和纸与松烟墨」主题到 Zen Browser 的 sine-mods 目录
#
#   ./install.sh                      # 自动扫描包含 sine-mods 的 Zen Profile
#   ./install.sh "/path/to/sine-mods" # 手动指定 sine-mods 绝对路径
#
# 安装完成后重启 Zen Browser，即可在设置 -> Sine -> Mods 中管理与调节。
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

echo "→ 正在同步到: $DST/$MOD_ID"
mkdir -p "$DST/$MOD_ID"
cp -R "$SRC/." "$DST/$MOD_ID/"

python3 - "$DST" "$MOD_ID" <<'PY'
import json, pathlib, shutil, sys

sine_mods = pathlib.Path(sys.argv[1])
mod_id = sys.argv[2]

entry = json.load(open(sine_mods / mod_id / "theme.json", encoding="utf-8"))
entry["no-updates"] = True
entry.setdefault("enabled", True)

mods_file = sine_mods / "mods.json"
mods = json.load(open(mods_file, encoding="utf-8"))
if mods.get(mod_id) != entry:
    shutil.copy2(mods_file, str(mods_file) + ".bak")
    mods[mod_id] = entry
    mods_file.write_text(json.dumps(mods, indent=2, ensure_ascii=False), encoding="utf-8")
    print("→ 已成功注册到 mods.json")
else:
    print("→ mods.json 已是最新配置")

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
PY

echo "✓ 安装成功！重启 Zen 浏览器或在 Sine 设置中重载 mod 即可生效。"
