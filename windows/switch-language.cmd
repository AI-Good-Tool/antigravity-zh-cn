@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
set "AGY_LANG_APP=%~1"
set "AGY_LANG_MODE=%~2"
set "AGY_LANG_INSTALL=%~3"
set "AGY_LANG_SCRIPT=%~dp0switch-language.cjs"
set "AGY_LANG_BUILDS=%~dp0official-builds.json"
if "%AGY_LANG_APP%"=="app" (
    set "AGY_LANG_FOLDER=Antigravity"
    set "AGY_LANG_EXE=Antigravity.exe"
) else if "%AGY_LANG_APP%"=="ide" (
    set "AGY_LANG_FOLDER=Antigravity IDE"
    set "AGY_LANG_EXE=Antigravity IDE.exe"
) else (
    exit /b 1
)
if not "%AGY_LANG_MODE%"=="chinese" if not "%AGY_LANG_MODE%"=="english" exit /b 1

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command ^
    "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);" ^
    "$folder = $env:AGY_LANG_FOLDER; $name = $env:AGY_LANG_EXE;" ^
    "$dirs = if ($env:AGY_LANG_INSTALL) { $env:AGY_LANG_INSTALL } else {" ^
    "    Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') $folder;" ^
    "    Join-Path $env:ProgramFiles $folder;" ^
    "};" ^
    "$exe = $dirs | ForEach-Object { Join-Path $_ $name } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1;" ^
    "if (!$exe) { throw ('Official installation not found: ' + $folder + '. See README for custom folders.'); }" ^
    "$exe = (Get-Item -LiteralPath $exe).FullName;" ^
    "$mutex = [Threading.Mutex]::new($false, ('Local\AntigravityLocalLanguage-' + $env:AGY_LANG_APP));" ^
    "try {" ^
    "    try { $locked = $mutex.WaitOne(0); } catch [Threading.AbandonedMutexException] { $locked = $true; }" ^
    "    if (!$locked) { throw 'Another language switch is running.'; }" ^
    "    try {" ^
    "        $session = (Get-Process -Id $PID).SessionId;" ^
    "        function Running { Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($name)) -ErrorAction SilentlyContinue | Where-Object SessionId -eq $session }" ^
    "        if (Running) {" ^
    "            Write-Host ('Save your work and exit ' + $folder + ' completely, including its tray icon. The switch will continue automatically.');" ^
    "            $deadline = (Get-Date).AddMinutes(2);" ^
    "            while (Running) { if ((Get-Date) -ge $deadline) { throw 'The application is still open. Exit it, then rerun the switch.'; }; Start-Sleep -Milliseconds 750; }" ^
    "        }" ^
    "        $product = $env:AGY_LANG_APP;" ^
    "        if ($env:AGY_LANG_MODE -eq 'english') {" ^
    "            Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue;" ^
    "            $locale = if ($product -eq 'app') { '--lang=en-US' } else { '--locale=en' };" ^
    "            Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -ArgumentList $locale;" ^
    "            Write-Host ('Opened ' + $folder + ' in English.');" ^
    "            exit 0;" ^
    "        }" ^
    "        $build = (Get-Content -LiteralPath $env:AGY_LANG_BUILDS -Raw | ConvertFrom-Json).$product;" ^
    "        if (!$build -or (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $build.executable) { throw ('Unsupported installation. Expected the official Windows x64 release ' + $build.version + '. The English launcher is still available.'); }" ^
    "        $env:ELECTRON_RUN_AS_NODE = '1';" ^
    "        & $exe $env:AGY_LANG_SCRIPT $product | ForEach-Object { $_ };" ^
    "        exit $LASTEXITCODE;" ^
    "    } finally { $mutex.ReleaseMutex(); }" ^
    "} finally { $mutex.Dispose(); }"

if errorlevel 1 (
    pause
    exit /b 1
)
exit /b 0
