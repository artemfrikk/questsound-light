# Makes dist/QuestSound-Light.exe: the unpacked Electron app (dist/win-unpacked, from `electron-builder --win`)
# zipped into a small launcher (build/launcher/Launcher.cs) built with the C# compiler that ships with Windows.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root 'dist'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$work = Join-Path $dist 'launcher'
New-Item -ItemType Directory -Force $work | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $work 'app.zip'
if (Test-Path $zip) { Remove-Item $zip }
[System.IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $dist 'win-unpacked'), $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Set-Content -Path (Join-Path $work 'version.txt') -Value $version -NoNewline -Encoding ascii

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$out = Join-Path $dist 'QuestSound-Light.exe'
& $csc /nologo /target:winexe /optimize+ /platform:x64 "/out:$out" "/win32icon:$(Join-Path $root 'build\icon.ico')" `
  "/resource:$zip,app.zip" "/resource:$(Join-Path $work 'version.txt'),version.txt" `
  "/r:$fw\System.IO.Compression.dll" "/r:$fw\System.IO.Compression.FileSystem.dll" /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  (Join-Path $root 'build\launcher\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed" }
Get-Item $out | Select-Object Name, Length
