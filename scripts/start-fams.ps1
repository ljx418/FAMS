[CmdletBinding()]
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
$DistroName = 'Ubuntu-24.04'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogDirectory = Join-Path $ProjectRoot 'logs'
$WindowsLog = Join-Path $LogDirectory 'fams-windows-launcher.log'
$SystemUrl = 'http://localhost:3000/'

function Write-LauncherLog {
    param([string]$Message)

    if (-not (Test-Path -LiteralPath $LogDirectory)) {
        New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    }
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'), $Message
    Add-Content -LiteralPath $WindowsLog -Value $line -Encoding UTF8
}

function Show-LauncherError {
    param([string]$Message)

    try {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show(
            $Message,
            'FAMS 启动失败',
            [System.Windows.MessageBoxButton]::OK,
            [System.Windows.MessageBoxImage]::Error
        ) | Out-Null
    }
    catch {
        $shell = New-Object -ComObject WScript.Shell
        $shell.Popup($Message, 0, 'FAMS 启动失败', 16) | Out-Null
    }
}

try {
    $wsl = Get-Command 'wsl.exe' -ErrorAction Stop
    $resolvedScriptsPath = [System.IO.Path]::GetFullPath($PSScriptRoot)
    if ($resolvedScriptsPath -notmatch '^([A-Za-z]):\\(.*)$') {
        throw "无法把项目路径转换为 WSL 路径：$resolvedScriptsPath"
    }

    $drive = $Matches[1].ToLowerInvariant()
    $pathWithinDrive = $Matches[2] -replace '\\', '/'
    $wslLauncher = "/mnt/$drive/$pathWithinDrive/start-fams.sh"

    Write-LauncherLog "Calling $DistroName launcher at $wslLauncher"
    $launcherOutput = & $wsl.Source -d $DistroName -- bash $wslLauncher 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    $trimmedOutput = $launcherOutput.Trim()
    if ($trimmedOutput) {
        Write-LauncherLog $trimmedOutput
    }

    if ($exitCode -ne 0) {
        throw "WSL 启动器返回错误代码 $exitCode。`n`n$trimmedOutput"
    }

    if (-not $NoBrowser) {
        Start-Process $SystemUrl
    }

    Write-LauncherLog "FAMS ready at $SystemUrl"
    if ($NoBrowser) {
        Write-Output "FAMS_READY $SystemUrl"
    }
    exit 0
}
catch {
    $details = $_.Exception.Message
    Write-LauncherLog "ERROR: $details"
    $message = "FAMS 未能启动。`n`n$details`n`n日志目录：$LogDirectory"
    if ($NoBrowser) {
        Write-Error $message
    }
    else {
        Show-LauncherError $message
    }
    exit 1
}
