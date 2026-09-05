$ErrorActionPreference='Stop'
Set-StrictMode -Version 2
$Base=Join-Path $env:LOCALAPPDATA 'GeminiBridge'
$State=Join-Path $Base 'state-v3'
$RuntimeFile=Join-Path $State 'runtime.json'
$Launcher=Join-Path $Base 'launcher\Start-Host-Hidden.ps1'
function Fail([string]$m){throw $m}
function Assert-AppOwnedFileSafe([string]$path,[string]$label,[bool]$AllowMissing=$false){
  if(-not (Test-Path -LiteralPath $path)){if($AllowMissing){return};Fail ("{0} is missing. Run Setup/Repair." -f $label)}
  try{$item=Get-Item -LiteralPath $path -Force -ErrorAction Stop}catch{Fail ("{0} could not be inspected safely. Run Setup/Repair." -f $label)}
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($item.PSObject.Properties.Name -contains 'LinkType' -and $item.LinkType)){Fail ("{0} is a reparse/junction/symlink or non-file. Run Setup/Repair." -f $label)}
}
function Api([string]$method,[string]$path,$cfg){
  $headers=@{'X-Gemini-Bridge-Token'=[string]$cfg.token}
  return Invoke-RestMethod -Method $method -Uri ("http://127.0.0.1:{0}{1}" -f [int]$cfg.port,$path) -Headers $headers -TimeoutSec 2
}
function Get-ProcessIdentity([int]$processId){
  if($processId -le 0){return $null};try{$proc=Get-Process -Id $processId -ErrorAction Stop;return ('win32:'+ $proc.StartTime.ToUniversalTime().Ticks.ToString())}catch{return $null}
}
function Read-Health($cfg){try{return Api 'GET' '/v1/health' $cfg}catch{return $null}}
function Read-HostLock {$lockFile=Join-Path $State 'host.lock.json';Assert-AppOwnedFileSafe $lockFile 'host.lock.json' $true;try{return Get-Content $lockFile -Raw|ConvertFrom-Json}catch{return $null}}
function Verify-Health($cfg,$h){
  if(-not $h){return $null}
  if([string]$h.version -ne [string]$cfg.programVersion){Fail 'A Gemini Bridge Host responded with the wrong release version. Run Setup/Repair before opening Dashboard.'}
  if(-not $h.host -or -not $h.host.pid -or -not $h.host.processIdentity -or [string]$h.host.instanceId -notmatch '^[a-f0-9]{32}$'){Fail 'Gemini Bridge Host identity is incomplete. Run Setup/Repair before opening Dashboard.'}
  $processId=[int]$h.host.pid;$identity=[string]$h.host.processIdentity
  if($identity -notmatch '^win32:\d+$' -or (Get-ProcessIdentity $processId) -ne $identity){Fail 'Gemini Bridge Host PID/processIdentity could not be verified exactly. Run Setup/Repair before opening Dashboard.'}
  $lock=Read-HostLock
  if(-not $lock -or [int]$lock.pid -ne $processId -or [string]$lock.processIdentity -ne $identity -or [string]$lock.instanceId -ne [string]$h.host.instanceId){Fail 'Gemini Bridge Host health/lock ownership does not match. Run Setup/Repair before opening Dashboard.'}
  return $h
}
Assert-AppOwnedFileSafe $RuntimeFile 'runtime.json'
$cfg=Get-Content $RuntimeFile -Raw|ConvertFrom-Json
$token=[string]$cfg.token;$port=[int]$cfg.port;$programVersion=[string]$cfg.programVersion
if($token -notmatch '^[a-f0-9]{64}$' -or $port -lt 1024 -or $port -gt 65535 -or [string]::IsNullOrWhiteSpace($programVersion)){Fail 'Gemini Bridge runtime configuration is invalid. Run Setup/Repair.'}
$health=Read-Health $cfg
if($health){$health=Verify-Health $cfg $health}else{
  Assert-AppOwnedFileSafe $Launcher 'Host launcher'
  if(-not (Test-Path -LiteralPath $Launcher -PathType Leaf)){Fail 'Gemini Bridge Host launcher is missing. Run Setup/Repair.'}
  $psExe=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  & $psExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File $Launcher
  if($LASTEXITCODE -ne 0){Fail 'Gemini Bridge Host launcher failed. Run Setup/Repair.'}
  for($i=0;$i -lt 100;$i++){$health=Read-Health $cfg;if($health){break};Start-Sleep -Milliseconds 100}
  if(-not $health){Fail 'Gemini Bridge Host did not become reachable. Run Setup/Repair.'}
  $health=Verify-Health $cfg $health
}
if(-not $health.ok){Fail 'Gemini Bridge Host is not runtime-ready. Run Setup/Repair and review the Host diagnostic.'}
Start-Process ("http://127.0.0.1:{0}/ui/#token={1}" -f $port,[uri]::EscapeDataString($token))
