#!/usr/bin/env python3
"""
Zen Washi & Sumi — 调色板单一数据源校验 / 同步工具
=============================================================================
以根目录 colors.css 为唯一真相源（SSOT），校验或同步以下两处派生色表：
  1. styles/settings.css    — 4 套基底方案 + 全部矿物强调色（整块托管）
  2. styles/pdf-viewer.css  — 4 套基底共享前景色/强调色校验 + 全部矿物强调色（托管）

用法：
  python3 tools/sync-palettes.py --check   # 仅校验是否漂移（默认，适合提交前检查）
  python3 tools/sync-palettes.py --write   # 从 colors.css 自动回写派生色块
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
COLORS_CSS = ROOT / "colors.css"
SETTINGS_CSS = ROOT / "styles" / "settings.css"
PDF_CSS = ROOT / "styles" / "pdf-viewer.css"

SETTINGS_START = "/* >>> sync-palettes:settings:start >>> */"
SETTINGS_END = "/* <<< sync-palettes:settings:end <<< */"
PDF_ACCENTS_START = "/* >>> sync-palettes:pdf-accents:start >>> */"
PDF_ACCENTS_END = "/* <<< sync-palettes:pdf-accents:end <<< */"

VAR_RE = re.compile(r"(--[a-zA-Z0-9-]+)\s*:\s*([^;]+?)(?:\s*!important)?\s*;")
MEDIA_PREF_RE = re.compile(
    r'@media\s*\(\s*-moz-pref\(\s*"(zenwashi\.(?:palette|accent))"\s*,\s*"([^"]+)"\s*\)\s*\)\s*\{(.*?)\n\}',
    re.S,
)


def parse_vars(block: str) -> dict[str, str]:
    return {m.group(1): " ".join(m.group(2).split()) for m in VAR_RE.finditer(block)}


def parse_colors_css(text: str) -> tuple[dict[str, str], dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    # 1. Default :root accent block (before any @media)
    first_media = text.find("@media")
    head = text[:first_media] if first_media != -1 else text
    default_root = parse_vars(head)

    palettes: dict[str, dict[str, str]] = {}
    accents: dict[str, dict[str, str]] = {}
    for m in MEDIA_PREF_RE.finditer(text):
        pref, name, body = m.group(1), m.group(2), m.group(3)
        parsed = parse_vars(body)
        if pref == "zenwashi.palette":
            palettes[name] = parsed
        else:
            accents[name] = parsed
    return default_root, palettes, accents


def retint_rgba(value: str, light_alpha: str, dark_alpha: str) -> str:
    """将 light-dark(rgba(..., a1), rgba(..., a2)) 替换为指定透明度。"""
    m = re.match(
        r"light-dark\(\s*rgba\(\s*(\d+\s*,\s*\d+\s*,\s*\d+)\s*,\s*[\d.]+\s*\)\s*,\s*"
        r"rgba\(\s*(\d+\s*,\s*\d+\s*,\s*\d+)\s*,\s*[\d.]+\s*\)\s*\)",
        value.strip(),
    )
    if not m:
        return value
    return f"light-dark(rgba({m.group(1)}, {light_alpha}), rgba({m.group(2)}, {dark_alpha}))"


def render_settings_block(
    default_root: dict[str, str],
    palettes: dict[str, dict[str, str]],
    accents: dict[str, dict[str, str]],
) -> str:
    lines: list[str] = [SETTINGS_START]
    washi = palettes["washi"]
    washi_accent = washi.get("--zenwashi-accent", default_root["--zenwashi-accent"])
    washi_tint = washi.get("--zenwashi-accent-tint", default_root["--zenwashi-accent-tint"])

    lines.extend([
        "    :root {",
        f"      --zwset-bg: {washi['--zenwashi-bg-base']};",
        f"      --zwset-card: {washi['--zenwashi-bg-surface']};",
        f"      --zwset-fg: {washi['--zenwashi-fg-primary']};",
        f"      --zwset-fg-dim: {washi['--zenwashi-fg-secondary']};",
        f"      --zwset-line: {washi['--zenwashi-border-subtle']};",
        f"      --zwset-accent: {washi_accent};",
        f"      --zwset-accent-tint: {washi_tint};",
        "    }",
    ])

    for name, vals in palettes.items():
        if name == "washi":
            continue
        lines.extend([
            f'    @media (-moz-pref("zenwashi.palette", "{name}")) {{',
            "      :root {",
            f"        --zwset-bg: {vals['--zenwashi-bg-base']};",
            f"        --zwset-card: {vals['--zenwashi-bg-surface']};",
            f"        --zwset-fg: {vals['--zenwashi-fg-primary']};",
            f"        --zwset-fg-dim: {vals['--zenwashi-fg-secondary']};",
            f"        --zwset-line: {vals['--zenwashi-border-subtle']};",
            f"        --zwset-accent: {vals['--zenwashi-accent']};",
            f"        --zwset-accent-tint: {vals['--zenwashi-accent-tint']};",
            "      }",
            "    }",
        ])

    for name, vals in accents.items():
        lines.extend([
            f'    @media (-moz-pref("zenwashi.accent", "{name}")) {{',
            "      :root {",
            f"        --zwset-accent: {vals['--zenwashi-accent']};",
            f"        --zwset-accent-tint: {vals['--zenwashi-accent-tint']};",
            "      }",
            "    }",
        ])

    lines.append(f"    {SETTINGS_END}")
    return "\n".join(lines)


def render_pdf_accents_block(accents: dict[str, dict[str, str]]) -> str:
    lines: list[str] = [PDF_ACCENTS_START]
    for name, vals in accents.items():
        pdf_tint = retint_rgba(vals["--zenwashi-accent-tint"], "0.18", "0.26")
        lines.extend([
            f'  @media (-moz-pref("zenwashi.accent", "{name}")) {{',
            '    :root:has(link[href^="resource://pdf.js"]) {',
            f"      --zenwashi-pdf-accent: {vals['--zenwashi-accent']};",
            f"      --zenwashi-pdf-accent-tint: {pdf_tint};",
            "    }",
            "  }",
        ])
    lines.append(f"  {PDF_ACCENTS_END}")
    return "\n".join(lines)


def check_pdf_shared_palettes(
    pdf_text: str,
    default_root: dict[str, str],
    palettes: dict[str, dict[str, str]],
) -> list[str]:
    """校验 pdf-viewer.css 中 4 套基底的共享前景色与强调色是否与 colors.css 一致。"""
    errors: list[str] = []

    # Check default washi block in pdf-viewer.css
    washi_match = re.search(
        r'/\*\s*\[方案 A\].*?\*/\s*:root:has\(link\[href\^="resource://pdf\.js"\]\)\s*\{(.*?)\n  \}',
        pdf_text,
        re.S,
    )
    if not washi_match:
        errors.append("styles/pdf-viewer.css: 未找到 [方案 A] 默认色块")
    else:
        pdf_washi = parse_vars(washi_match.group(1))
        washi = palettes["washi"]
        expected = {
            "--zenwashi-pdf-fg": washi["--zenwashi-fg-primary"],
            "--zenwashi-pdf-fg-dim": washi["--zenwashi-fg-secondary"],
            "--zenwashi-pdf-accent": washi.get("--zenwashi-accent", default_root["--zenwashi-accent"]),
        }
        for k, exp in expected.items():
            if pdf_washi.get(k) != exp:
                errors.append(f"styles/pdf-viewer.css [washi] {k}: 实际={pdf_washi.get(k)!r}, 期望={exp!r}")

    # Check non-default palettes
    for name, vals in palettes.items():
        if name == "washi":
            continue
        pat = re.compile(
            rf'@media\s*\(\s*-moz-pref\(\s*"zenwashi\.palette"\s*,\s*"{re.escape(name)}"\s*\)\s*\)\s*\{{(.*?)\n  \}}',
            re.S,
        )
        m = pat.search(pdf_text)
        if not m:
            errors.append(f"styles/pdf-viewer.css: 缺少基底方案 {name!r}")
            continue
        pdf_vals = parse_vars(m.group(1))
        expected = {
            "--zenwashi-pdf-fg": vals["--zenwashi-fg-primary"],
            "--zenwashi-pdf-fg-dim": vals["--zenwashi-fg-secondary"],
            "--zenwashi-pdf-accent": vals["--zenwashi-accent"],
        }
        for k, exp in expected.items():
            if pdf_vals.get(k) != exp:
                errors.append(f"styles/pdf-viewer.css [{name}] {k}: 实际={pdf_vals.get(k)!r}, 期望={exp!r}")

    return errors


def replace_managed_block(text: str, start_marker: str, end_marker: str, replacement: str) -> tuple[str, bool]:
    pattern = re.compile(
        re.escape(start_marker) + r".*?" + re.escape(end_marker),
        re.S,
    )
    if not pattern.search(text):
        raise ValueError(f"未找到托管标记: {start_marker} ... {end_marker}")
    updated = pattern.sub(replacement, text, count=1)
    return updated, updated != text


def main() -> int:
    parser = argparse.ArgumentParser(description="校验或同步 Zen Washi & Sumi 三处调色板。")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="仅校验是否与 colors.css 一致（默认）")
    mode.add_argument("--write", action="store_true", help="将 colors.css 同步写入派生样式表")
    args = parser.parse_args()

    default_root, palettes, accents = parse_colors_css(COLORS_CSS.read_text(encoding="utf-8"))
    if "washi" not in palettes:
        print("✗ colors.css 中缺少 washi 默认基底方案", file=sys.stderr)
        return 1

    settings_text = SETTINGS_CSS.read_text(encoding="utf-8")
    pdf_text = PDF_CSS.read_text(encoding="utf-8")

    new_settings_block = render_settings_block(default_root, palettes, accents)
    new_pdf_accents_block = render_pdf_accents_block(accents)

    new_settings_text, settings_changed = replace_managed_block(
        settings_text, SETTINGS_START, SETTINGS_END, new_settings_block
    )
    new_pdf_text, pdf_changed = replace_managed_block(
        pdf_text, PDF_ACCENTS_START, PDF_ACCENTS_END, new_pdf_accents_block
    )

    shared_errors = check_pdf_shared_palettes(new_pdf_text, default_root, palettes)

    if args.write:
        if settings_changed:
            SETTINGS_CSS.write_text(new_settings_text, encoding="utf-8")
            print("→ 已同步 styles/settings.css")
        if pdf_changed:
            PDF_CSS.write_text(new_pdf_text, encoding="utf-8")
            print("→ 已同步 styles/pdf-viewer.css（矿物强调色块）")
        if not settings_changed and not pdf_changed:
            print("✓ 托管色块已与 colors.css 一致，无需写入")
        if shared_errors:
            print("✗ styles/pdf-viewer.css 的基底共享色存在偏差（需手动核对）：", file=sys.stderr)
            for err in shared_errors:
                print(f"  - {err}", file=sys.stderr)
            return 1
        print(f"✓ 校验通过：{len(palettes)} 套基底方案 + {len(accents)} 套矿物强调色完全对齐")
        return 0

    # Default: --check mode
    problems: list[str] = []
    if settings_changed:
        problems.append("styles/settings.css 调色板与 colors.css 不一致（运行 --write 自动同步）")
    if pdf_changed:
        problems.append("styles/pdf-viewer.css 矿物强调色与 colors.css 不一致（运行 --write 自动同步）")
    problems.extend(shared_errors)

    if problems:
        print("✗ 调色板同步校验未通过：", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1

    print(f"✓ 调色板同步校验通过：{len(palettes)} 套基底方案 + {len(accents)} 套矿物强调色与 colors.css 完全一致")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
