[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LauncherPath = Join-Path $PSScriptRoot 'start-fams.ps1'
$IconPath = Join-Path $PSScriptRoot 'assets\fams.ico'
$DesktopPath = [Environment]::GetFolderPath('Desktop')

if ([string]::IsNullOrWhiteSpace($DesktopPath)) {
    $DesktopPath = Join-Path $env:USERPROFILE 'Desktop'
}

if (-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) {
    throw "找不到 Windows 启动器：$LauncherPath"
}
if (-not (Test-Path -LiteralPath $IconPath -PathType Leaf)) {
    throw "找不到桌面图标：$IconPath"
}
if (-not (Test-Path -LiteralPath $DesktopPath -PathType Container)) {
    throw "找不到 Windows 桌面目录：$DesktopPath"
}

$powerShellPath = (Get-Command 'powershell.exe' -ErrorAction Stop).Source
$shortcutPath = Join-Path $DesktopPath 'FAMS 金融资产管理.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powerShellPath
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LauncherPath`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.IconLocation = "$IconPath,0"
$shortcut.Description = '启动 FAMS 金融资产管理系统并打开系统首页'
$shortcut.WindowStyle = 7
$shortcut.Save()

$installed = $shell.CreateShortcut($shortcutPath)
if ($installed.TargetPath -ne $powerShellPath -or $installed.IconLocation -notlike "$IconPath,*") {
    throw "快捷方式创建后校验失败：$shortcutPath"
}

[PSCustomObject]@{
    Status = 'installed'
    Shortcut = $shortcutPath
    Target = $installed.TargetPath
    Arguments = $installed.Arguments
    WorkingDirectory = $installed.WorkingDirectory
    IconLocation = $installed.IconLocation
} | ConvertTo-Json -Depth 2
