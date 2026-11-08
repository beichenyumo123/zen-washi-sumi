#requires -Version 5.1
<#
.SYNOPSIS
    zen-washi-sumi — 将「和纸与松烟墨」同步并注册到 Zen Browser 的 sine-mods 目录（Windows 版）。

.DESCRIPTION
    与 install.sh 行为对齐：安全退出 Zen → 镜像同步 Mod 文件 → 写入 mods.json 注册条目
    → 维护 chrome.css / userContent.css 的 @import → 清理 startupCache → 回读校验。

    只依赖 Windows 自带的 Windows PowerShell 5.1（无需 Python / Git Bash / WSL）。

.PARAMETER SineMods
    sine-mods 目录的绝对路径（包含 mods.json）。
    省略时自动扫描 %APPDATA%\zen\Profiles\*\chrome\sine-mods。

.PARAMETER Force
    Zen 在 30 秒内没有正常退出时，强制结束进程（可能丢失未保存的会话/表单）。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install.ps1 "C:\Users\me\AppData\Roaming\zen\Profiles\abc.default\chrome\sine-mods"
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$SineMods,

    [string]$SourcePath = $PSScriptRoot,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 默认按 ANSI 读脚本，中文会乱码；本文件已存为 UTF-8 with BOM。
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$ModId = 'zen-washi-sumi'
$BeginMarker = '/* >>> zen-washi-sumi managed import (do not edit) >>> */'
$EndMarker = '/* <<< zen-washi-sumi managed import <<< */'

# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------
function Write-Step([string]$Message) {
    Write-Host "→ $Message"
}

function Write-Fail([string]$Message) {
    [Console]::Error.WriteLine("✗ $Message")
}

function Read-TextFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($null -eq $raw) { return '' }
    return $raw
}

function Write-Utf8File([string]$Path, [string]$Text) {
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    # 不要 BOM：mods.json / CSS 都按严格 UTF-8 读，BOM 会让 JSON.parse 报错。
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Clear-ReadOnly([string]$Path) {
    # Git 对象是只读的 444 文件，直接删除/覆盖会 "Access denied"。
    Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Attributes -band [System.IO.FileAttributes]::ReadOnly) {
            $_.Attributes = $_.Attributes -bxor [System.IO.FileAttributes]::ReadOnly
        }
    }
}

# ---------------------------------------------------------------------------
# 最小 JSON 序列化器
#   不用 ConvertTo-Json：5.1 会把中文转成 \uXXXX（虽然合法但 mods.json 不可读），
#   且不同版本缩进/数字格式不一致。这里按 Python json.dumps(indent=2) 的风格输出。
# ---------------------------------------------------------------------------
function Format-JsonString([string]$Value) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $Value.ToCharArray()) {
        switch ($ch) {
            '"' { [void]$sb.Append('\"'); break }
            '\' { [void]$sb.Append('\\'); break }
            "`n" { [void]$sb.Append('\n'); break }
            "`r" { [void]$sb.Append('\r'); break }
            "`t" { [void]$sb.Append('\t'); break }
            "`b" { [void]$sb.Append('\b'); break }
            "`f" { [void]$sb.Append('\f'); break }
            default {
                if ([int]$ch -lt 32) {
                    [void]$sb.Append(('\u{0:x4}' -f [int]$ch))
                }
                else {
                    [void]$sb.Append($ch)
                }
            }
        }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function ConvertTo-JsonText {
    param($Value, [int]$Depth = 0)

    $indent = '  ' * $Depth
    $inner = '  ' * ($Depth + 1)

    if ($null -eq $Value) { return 'null' }
    if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
    if ($Value -is [string]) { return (Format-JsonString $Value) }
    if ($Value -is [datetime]) {
        $iso = $Value.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        return (Format-JsonString $iso)
    }
    if ($Value -is [ValueType]) {
        $culture = [System.Globalization.CultureInfo]::InvariantCulture
        if ($Value -is [double] -or $Value -is [single]) {
            return ([string]::Format($culture, '{0:R}', $Value))
        }
        return [System.Convert]::ToString($Value, $culture)
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $entries = @($Value.GetEnumerator())
        if ($entries.Count -eq 0) { return '{}' }
        $lines = foreach ($e in $entries) {
            $key = Format-JsonString ([string]$e.Key)
            $val = ConvertTo-JsonText -Value $e.Value -Depth ($Depth + 1)
            "${inner}${key}: $val"
        }
        return "{`n" + ($lines -join ",`n") + "`n$indent}"
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $items = @(foreach ($item in $Value) {
                ConvertTo-JsonText -Value $item -Depth ($Depth + 1)
            })
        if ($items.Count -eq 0) { return '[]' }
        return "[`n" + (($items | ForEach-Object { "${inner}${_}" }) -join ",`n") + "`n$indent]"
    }

    $props = @($Value.PSObject.Properties | Where-Object {
            $_.MemberType -eq 'NoteProperty' -or $_.MemberType -eq 'Property'
        })
    if ($props.Count -eq 0) { return '{}' }
    $lines = foreach ($prop in $props) {
        $key = Format-JsonString $prop.Name
        $val = ConvertTo-JsonText -Value $prop.Value -Depth ($Depth + 1)
        "${inner}${key}: $val"
    }
    return "{`n" + ($lines -join ",`n") + "`n$indent}"
}

# ---------------------------------------------------------------------------
# Zen 进程
# ---------------------------------------------------------------------------
function Get-ZenProcess {
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $_.ProcessName -match '^zen(browser)?(-beta|-dev|-twilight)?$'
        })
}

function Stop-ZenSafely {
    param([switch]$Kill)

    if (@(Get-ZenProcess).Count -eq 0) { return }

    Write-Step '检测到 Zen 正在运行，正在先安全关闭以避免 Sine 内存缓存覆盖 mods.json...'
    foreach ($proc in Get-ZenProcess) {
        try { [void]$proc.CloseMainWindow() } catch { }
    }

    # 标签多时退出可能要几十秒，最多等 30 秒。
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (@(Get-ZenProcess).Count -eq 0) { return }
        Start-Sleep -Milliseconds 300
    }

    if ($Kill) {
        Write-Step 'Zen 未在 30 秒内退出，按 -Force 强制结束进程...'
        Get-ZenProcess | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        return
    }

    throw 'Zen 在 30 秒内仍未退出，已中止安装。请手动完全退出 Zen（确认任务管理器里没有 zen.exe / 后台进程）后重新运行本脚本，或加 -Force 强制结束。'
}

# ---------------------------------------------------------------------------
# Profile 探测
# ---------------------------------------------------------------------------
function Get-SineModsCandidates {
    $roots = @()
    if ($env:APPDATA) {
        $roots += (Join-Path $env:APPDATA 'zen\Profiles')
        $roots += (Join-Path $env:APPDATA 'Zen\Profiles')
    }

    $found = @()
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($profile in Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue) {
            $candidate = Join-Path (Join-Path $profile.FullName 'chrome') 'sine-mods'
            if (-not (Test-Path -LiteralPath (Join-Path $candidate 'mods.json'))) { continue }
            if ($found -notcontains $candidate) { $found += $candidate }
        }
    }
    return $found
}

# ---------------------------------------------------------------------------
# 镜像同步（robocopy 优先，缺失时退回原生实现）
# ---------------------------------------------------------------------------
function Sync-ModTree {
    param([string]$Source, [string]$Destination)

    $Source = $Source.TrimEnd([char[]]@('\', '/'))
    $Destination = $Destination.TrimEnd([char[]]@('\', '/'))
    $excludedDirs = @('.git')
    $excludedFiles = @('.DS_Store')

    if (-not (Test-Path -LiteralPath $Destination)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }

    # 清掉历史遗留的 .git（只读对象会让覆盖失败）。
    $destGit = Join-Path $Destination '.git'
    if (Test-Path -LiteralPath $destGit) {
        Clear-ReadOnly $destGit
        Remove-Item -LiteralPath $destGit -Recurse -Force
        Write-Step "已移除目标目录中的历史 .git: $destGit"
    }

    Clear-ReadOnly $Destination

    $robocopy = Get-Command robocopy -ErrorAction SilentlyContinue
    if ($robocopy) {
        # 退出码 0-7 都是成功（1=有文件复制，2=有额外文件被删，3=两者都有）。
        & $robocopy.Source $Source $Destination /MIR /XD .git (Join-Path $Source '.git') /XF .DS_Store /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
        $code = $LASTEXITCODE
        if ($code -ge 8) {
            throw "robocopy 同步失败（退出码 $code）。请确认 Zen 已完全退出后重试。"
        }
        return
    }

    # ---- 原生镜像：用于没有 robocopy 的环境（含在 macOS/Linux 上自测）----
    $seen = @()

    foreach ($file in @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction SilentlyContinue)) {
        if ($excludedFiles -contains $file.Name) { continue }
        $rel = $file.FullName.Substring($Source.Length).TrimStart([char[]]@('\', '/'))
        $parts = $rel -split '[\\/]'
        $dirParts = @()
        if ($parts.Length -gt 1) { $dirParts = $parts[0..($parts.Length - 2)] }
        if (@($dirParts | Where-Object { $excludedDirs -contains $_ }).Count -gt 0) { continue }

        $target = Join-Path $Destination $rel
        $targetDir = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
        $seen += $rel
    }

    foreach ($file in @(Get-ChildItem -LiteralPath $Destination -Recurse -File -Force -ErrorAction SilentlyContinue)) {
        if ($excludedFiles -contains $file.Name) { continue }
        $rel = $file.FullName.Substring($Destination.Length).TrimStart([char[]]@('\', '/'))
        $parts = $rel -split '[\\/]'
        $dirParts = @()
        if ($parts.Length -gt 1) { $dirParts = $parts[0..($parts.Length - 2)] }
        if (@($dirParts | Where-Object { $excludedDirs -contains $_ }).Count -gt 0) { continue }
        if ($seen -contains $rel) { continue }
        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
    }

    # 清掉同步后残留的空目录（最多 4 层，足够覆盖实际结构）。
    for ($i = 0; $i -lt 4; $i++) {
        $emptyDirs = @(Get-ChildItem -LiteralPath $Destination -Recurse -Directory -Force -ErrorAction SilentlyContinue |
                Where-Object { @(Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue).Count -eq 0 })
        if ($emptyDirs.Count -eq 0) { break }
        $emptyDirs | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    }
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
try {
    if (-not (Test-Path -LiteralPath (Join-Path $SourcePath 'theme.json'))) {
        throw "找不到主题源目录（需要包含 theme.json）：$SourcePath"
    }
    $SourcePath = (Resolve-Path -LiteralPath $SourcePath).Path

    if (-not $SineMods) {
        $candidates = @(Get-SineModsCandidates)
        if ($candidates.Count -eq 0) {
            throw @"
未检测到已初始化的 sine-mods 目录（需包含 mods.json）。
请确认已在 Zen 中启用 Sine，或把 sine-mods 路径作为参数传入：
  powershell -ExecutionPolicy Bypass -File .\install.ps1 "C:\Users\<你>\AppData\Roaming\zen\Profiles\<profile>\chrome\sine-mods"
"@
        }
        if ($candidates.Count -gt 1) {
            $list = ($candidates | ForEach-Object { "  - $_" }) -join "`n"
            throw @"
检测到多个 Profile 都启用了 Sine，请用 -SineMods 指定要安装到哪一个：
$list
"@
        }
        $SineMods = $candidates[0]
    }

    if (-not (Test-Path -LiteralPath $SineMods)) {
        throw "sine-mods 目录不存在：$SineMods"
    }
    $SineMods = (Resolve-Path -LiteralPath $SineMods).Path
    if (-not (Test-Path -LiteralPath (Join-Path $SineMods 'mods.json') -PathType Leaf)) {
        throw "目录中缺少 mods.json，Sine 可能还没初始化：$SineMods"
    }

    $ModDir = Join-Path $SineMods $ModId

    # 写入前自检：确认 JSON 序列化器在本机按预期工作（单元素数组不能被展平、中文不能被转义丢失），
    # 这样即使某台机器的 PowerShell 行为有差异，也会在改动任何文件之前就失败。
    $probeJson = ConvertTo-JsonText -Value ([pscustomobject]@{ 'a' = @('x'); 'b' = '和'; 'c' = 1; 'd' = $true })
    $probeParsed = $probeJson | ConvertFrom-Json
    if (-not ($probeParsed.a -is [System.Array]) -or $probeParsed.b -ne '和' -or $probeParsed.c -ne 1 -or $probeParsed.d -ne $true) {
        throw "内部 JSON 序列化自检失败，已中止（未改动任何文件）：$probeJson"
    }

    Stop-ZenSafely -Kill:$Force

    Write-Step "正在同步到: $ModDir"
    Sync-ModTree -Source $SourcePath -Destination $ModDir

    # 清理旧版安装脚本遗留的 fx-autoconfig 兜底副本（Sine 与它双通道会重复注入脚本）。
    $legacyJs = Join-Path (Split-Path -Parent $SineMods) 'JS\zen-washi-sumi-blended-bar.uc.js'
    if (Test-Path -LiteralPath $legacyJs) {
        Remove-Item -LiteralPath $legacyJs -Force
        Write-Step "已移除旧的 fx-autoconfig 兜底副本: $legacyJs"
    }

    # ---- mods.json 注册 ----
    $themePath = Join-Path $ModDir 'theme.json'
    $entry = Read-TextFile $themePath | ConvertFrom-Json
    Add-Member -InputObject $entry -MemberType NoteProperty -Name 'origin' -Value 'store' -Force   # Sine 只给 store 来源注入 JS
    Add-Member -InputObject $entry -MemberType NoteProperty -Name 'no-updates' -Value $true -Force
    Add-Member -InputObject $entry -MemberType NoteProperty -Name 'enabled' -Value $true -Force

    $scriptProps = @()
    if ($null -ne $entry.scripts) {
        $scriptProps = @($entry.scripts.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' })
    }
    $missing = @()
    foreach ($prop in $scriptProps) {
        if (-not (Test-Path -LiteralPath (Join-Path $ModDir $prop.Name) -PathType Leaf)) {
            $missing += $prop.Name
        }
    }
    if ($scriptProps.Count -eq 0 -or $missing.Count -gt 0) {
        $detail = ($missing | ForEach-Object { "  - 缺少文件: $_" }) -join "`n"
        throw "theme.json 缺少 scripts 或脚本文件不存在，未写入 mods.json：`n$detail"
    }

    $modsPath = Join-Path $SineMods 'mods.json'
    $modsText = Read-TextFile $modsPath
    if ([string]::IsNullOrWhiteSpace($modsText)) {
        $mods = [pscustomobject]@{}
    }
    else {
        $mods = $modsText | ConvertFrom-Json
    }
    Copy-Item -LiteralPath $modsPath -Destination ($modsPath + '.bak') -Force
    Add-Member -InputObject $mods -MemberType NoteProperty -Name $ModId -Value $entry -Force
    Write-Utf8File $modsPath (ConvertTo-JsonText -Value $mods)
    try {
        $null = Read-TextFile $modsPath | ConvertFrom-Json
    }
    catch {
        Copy-Item -LiteralPath ($modsPath + '.bak') -Destination $modsPath -Force
        throw "mods.json 写入后无法重新解析，已从 .bak 回滚：$($_.Exception.Message)"
    }
    Write-Step '已写入 mods.json 注册条目'

    # ---- chrome.css / content.css @import ----
    foreach ($kind in @('chrome', 'content')) {
        $rel = $entry.style.$kind
        if (-not $rel) { continue }
        $entrypoint = if ($kind -eq 'chrome') { 'chrome.css' } else { 'content.css' }
        $cssPath = Join-Path $SineMods $entrypoint
        $text = Read-TextFile $cssPath
        if ($text -notmatch [regex]::Escape($ModId)) {
            $uri = (New-Object System.Uri ([System.IO.Path]::GetFullPath((Join-Path $ModDir $rel)))).AbsoluteUri
            $importLine = "@import `"$uri`";`n"
            if ($text -and -not $text.EndsWith("`n")) { $text += "`n" }
            $text = $text + $importLine
            Write-Utf8File $cssPath $text
            Write-Step "已写入 $entrypoint @import"
        }
        else {
            Write-Step "$entrypoint 已包含 @import 声明"
        }
    }

    # ---- 原生 userContent 通道（PDF 阅读器等 out-of-process 文档唯一可靠的入口）----
    $chromeDir = Split-Path -Parent $SineMods
    $userContentPath = Join-Path $chromeDir 'userContent.css'
    $sineDirName = Split-Path -Leaf $SineMods
    $rel = "$sineDirName/$ModId/userContent.css"
    $block = "$BeginMarker`n@import `"$rel`";`n$EndMarker`n"

    $text = Read-TextFile $userContentPath
    $pattern = [regex]::Escape($BeginMarker) + '.*?' + [regex]::Escape($EndMarker) + "\r?\n?"
    $text = [regex]::Replace($text, $pattern, '', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    Write-Utf8File $userContentPath ($block + $text)
    Write-Step "已维护 userContent.css 的 @import（$rel）"

    # ---- 回读校验：注册没落地就立刻报错 ----
    $savedMods = Read-TextFile $modsPath | ConvertFrom-Json
    $saved = $savedMods.$ModId
    $problems = @()
    if ($null -eq $saved) {
        $problems += 'mods.json 中没有本主题条目'
    }
    else {
        $savedScripts = @()
        if ($null -ne $saved.scripts) {
            $savedScripts = @($saved.scripts.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' })
        }
        if ($savedScripts.Count -eq 0) { $problems += 'mods.json 中没有 scripts 字段' }
        if ($saved.origin -ne 'store') { $problems += "origin 不是 'store'（Sine 会因此拒绝注入本地 Mod 的 JS）" }
        foreach ($prop in $savedScripts) {
            if (-not (Test-Path -LiteralPath (Join-Path $ModDir $prop.Name) -PathType Leaf)) {
                $problems += "脚本文件不存在: $($prop.Name)"
            }
        }
    }
    if ($problems.Count -gt 0) {
        $detail = ($problems | ForEach-Object { "  - $_" }) -join "`n"
        throw "注册校验失败：`n$detail"
    }
    $scriptNames = @($saved.scripts.PSObject.Properties | ForEach-Object { $_.Name })
    Write-Step ("校验通过：version={0} origin={1} scripts={2}" -f $saved.version, $saved.origin, ($scriptNames -join ', '))

    # ---- 清理 startupCache，确保重启后最新 .uc.js 立即被编译加载 ----
    if ($env:LOCALAPPDATA) {
        foreach ($root in @((Join-Path $env:LOCALAPPDATA 'zen\Profiles'), (Join-Path $env:LOCALAPPDATA 'Zen\Profiles'))) {
            if (-not (Test-Path -LiteralPath $root)) { continue }
            foreach ($profile in Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue) {
                $cache = Join-Path $profile.FullName 'startupCache'
                if (-not (Test-Path -LiteralPath $cache)) { continue }
                Remove-Item -LiteralPath $cache -Recurse -Force -ErrorAction SilentlyContinue
                Write-Step "已清理启动缓存: $cache"
            }
        }
    }

    Write-Host ''
    Write-Host '✓ 安装成功！现在直接打开 Zen 浏览器即可（请勿在安装前后点击 Sine 的重载按钮，以免覆盖本地注册）。'
    exit 0
}
catch {
    Write-Fail $_.Exception.Message
    exit 1
}
