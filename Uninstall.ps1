$ErrorActionPreference='Stop'
Set-StrictMode -Version 2
$Install=Join-Path $env:LOCALAPPDATA 'Programs\GeminiBridge'
$Base=Join-Path $env:LOCALAPPDATA 'GeminiBridge'
$State=Join-Path $Base 'state-v3'
$MutableExtension=Join-Path $Base 'web-extension'
$LauncherRoot=Join-Path $Base 'launcher'
$Startup=[Environment]::GetFolderPath('Startup')
$Desktop=[Environment]::GetFolderPath('Desktop')
$script:Mutex=$null;$script:MaintenanceEntered=$false
function Fail([string]$m){throw $m}
function Get-OptionalProperty($obj,[string]$name){
  if($null -eq $obj -or [string]::IsNullOrWhiteSpace($name)){return $null}
  try{$p=$obj.PSObject.Properties[$name];if($null -eq $p){return $null};return $p.Value}catch{return $null}
}
function Assert-AppOwnedPathSafe([string]$path,[string]$label){
  if([string]::IsNullOrWhiteSpace($path)){Fail ("{0} path is empty." -f $label)}
  if(-not (Test-Path -LiteralPath $path)){return}
  try{$item=Get-Item -LiteralPath $path -Force -ErrorAction Stop}catch{Fail ("{0} could not be inspected safely: {1}" -f $label,$_.Exception.Message)}
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($item.PSObject.Properties.Name -contains 'LinkType' -and $item.LinkType)){
    Fail ("{0} is a reparse/junction/symlink path. Gemini Bridge will not recursively delete redirected app-owned roots." -f $label)
  }
}
function Assert-AppOwnedFileSafe([string]$path,[string]$label,[bool]$AllowMissing=$true){
  if([string]::IsNullOrWhiteSpace($path)){Fail ("{0} path is empty." -f $label)}
  if(-not (Test-Path -LiteralPath $path)){if($AllowMissing){return};Fail ("{0} is missing." -f $label)}
  try{$item=Get-Item -LiteralPath $path -Force -ErrorAction Stop}catch{Fail ("{0} could not be inspected safely: {1}" -f $label,$_.Exception.Message)}
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($item.PSObject.Properties.Name -contains 'LinkType' -and $item.LinkType)){
    Fail ("{0} is not an owned regular file; reparse/junction/symlink metadata is refused." -f $label)
  }
}
function Assert-AppOwnedRootsSafe {
  Assert-AppOwnedPathSafe $Base 'Gemini Bridge data root'
  Assert-AppOwnedPathSafe $State 'Gemini Bridge state root'
  Assert-AppOwnedPathSafe $Install 'Gemini Bridge program root'
  Assert-AppOwnedPathSafe $MutableExtension 'Gemini Bridge mutable extension root'
  Assert-AppOwnedPathSafe $LauncherRoot 'Gemini Bridge launcher root'
}
function Acquire-SetupMutex {$m=New-Object System.Threading.Mutex($false,'Local\GeminiBridge.SetupUninstall');$owned=$false;try{$owned=$m.WaitOne(0)}catch [System.Threading.AbandonedMutexException]{$owned=$true};if(-not $owned){$m.Dispose();Fail 'Another Gemini Bridge Setup/Uninstall operation is already running.'};$script:Mutex=$m}
function Release-SetupMutex {if($script:Mutex){try{$script:Mutex.ReleaseMutex()}catch{};try{$script:Mutex.Dispose()}catch{};$script:Mutex=$null}}
function Read-Config {try{return Get-Content (Join-Path $State 'runtime.json') -Raw|ConvertFrom-Json}catch{return $null}}
function Read-HostLock {
  $file=Join-Path $State 'host.lock.json'
  if(-not (Test-Path -LiteralPath $file -PathType Leaf)){return $null}
  try{return Get-Content -LiteralPath $file -Raw|ConvertFrom-Json}catch{return $null}
}
function Test-HostLockPresentButUnreadable {
  $file=Join-Path $State 'host.lock.json'
  if(-not (Test-Path -LiteralPath $file -PathType Leaf)){return $false}
  return ($null -eq (Read-HostLock))
}
function Api([string]$method,[string]$path,$cfg,$body=$null){$headers=@{'X-Gemini-Bridge-Token'=[string]$cfg.token};$a=@{Method=$method;Uri=("http://127.0.0.1:{0}{1}" -f [int]$cfg.port,$path);Headers=$headers;TimeoutSec=2};if($body -ne $null){$a.ContentType='application/json';$a.Body=($body|ConvertTo-Json -Compress)};return Invoke-RestMethod @a}
function Read-Health($cfg){if(-not $cfg){return $null};try{return Api 'GET' '/v1/health' $cfg}catch{return $null}}
function Test-Health($cfg){return ((Read-Health $cfg) -ne $null)}
function Get-ProcessIdentity([int]$processId){if($processId -le 0){return $null};try{$proc=Get-Process -Id $processId -ErrorAction Stop;return ('win32:'+ $proc.StartTime.ToUniversalTime().Ticks.ToString())}catch{return $null}}
function Test-ExactProcessAlive([int]$processId,[string]$identity){if($processId -le 0 -or [string]::IsNullOrWhiteSpace($identity)){return $false};return ((Get-ProcessIdentity $processId) -eq $identity)}
function Wait-ExactProcessExit([int]$processId,[string]$identity,[int]$timeoutMs=10000){$end=[DateTime]::UtcNow.AddMilliseconds($timeoutMs);while([DateTime]::UtcNow -lt $end){if(-not (Test-ExactProcessAlive $processId $identity)){return $true};Start-Sleep -Milliseconds 100};return (-not (Test-ExactProcessAlive $processId $identity))}
function Lock-MatchesLiveHost {
  if(Test-HostLockPresentButUnreadable){return $true}
  $lock=Read-HostLock;$pidValue=Get-OptionalProperty $lock 'pid';if(-not $lock -or -not $pidValue){return $false};$processId=[int]$pidValue
  try{$null=Get-Process -Id $processId -ErrorAction Stop}catch{return $false}
  $identity=[string](Get-OptionalProperty $lock 'processIdentity');if([string]::IsNullOrWhiteSpace($identity)){return $true};if($identity -notmatch '^win32:\d+$'){return $true}
  return (Test-ExactProcessAlive $processId $identity)
}
function Get-VerifiedOwner($cfg,$h){
  $programVersion=[string](Get-OptionalProperty $cfg 'programVersion');$healthVersion=[string](Get-OptionalProperty $h 'version')
  if(-not $h -or [string]::IsNullOrWhiteSpace($programVersion) -or $healthVersion -ne $programVersion){Fail 'Authenticated Host release identity is missing or stale. Run Setup/Repair first; no files were removed.'}
  $hostInfo=Get-OptionalProperty $h 'host';$hostPid=Get-OptionalProperty $hostInfo 'pid';$identity=[string](Get-OptionalProperty $hostInfo 'processIdentity');$instanceId=[string](Get-OptionalProperty $hostInfo 'instanceId')
  if(-not $hostInfo -or -not $hostPid -or [string]::IsNullOrWhiteSpace($identity) -or $instanceId -notmatch '^[a-f0-9]{32}$'){Fail 'Authenticated Host process identity is incomplete. Run Setup/Repair first; no files were removed.'}
  $processId=[int]$hostPid
  if($identity -notmatch '^win32:\d+$' -or -not (Test-ExactProcessAlive $processId $identity)){Fail 'Authenticated Host PID/processIdentity cannot be proven exactly; no files were removed.'}
  $lock=Read-HostLock;$lockPid=Get-OptionalProperty $lock 'pid';$lockIdentity=[string](Get-OptionalProperty $lock 'processIdentity');$lockInstance=[string](Get-OptionalProperty $lock 'instanceId')
  if(-not $lock -or -not $lockPid -or [int]$lockPid -ne $processId -or $lockIdentity -ne $identity -or $lockInstance -ne $instanceId){Fail 'Authenticated Host health/lock ownership does not match; no files were removed.'}
  return [pscustomobject]@{pid=$processId;processIdentity=$identity;instanceId=$instanceId}
}
function Ensure-Host($cfg){
  $h=Read-Health $cfg;if($h){return Get-VerifiedOwner $cfg $h}
  if(Lock-MatchesLiveHost){Fail 'A live or ambiguously identified Host owns host.lock.json while authenticated API is unavailable. Run Setup/Repair first; no files were removed.'}
  $launcher=Join-Path $LauncherRoot 'Start-Host-Hidden.ps1';if(-not (Test-Path -LiteralPath $launcher -PathType Leaf)){Fail 'Host cannot be started to verify unfinished work. Run Setup/Repair first; no files were removed.'}
  $psExe=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe';& $psExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File $launcher
  if($LASTEXITCODE -ne 0){Fail 'Host launcher failed. Run Setup/Repair first; no files were removed.'}
  for($i=0;$i -lt 100;$i++){$h=Read-Health $cfg;if($h){return Get-VerifiedOwner $cfg $h};Start-Sleep -Milliseconds 100}
  Fail 'Could not contact authenticated Bridge Host. No files were removed.'
}
function Quiesce-ResidualHostWithoutProgram($cfg){
  if(-not (Test-Path $State)){return}
  if($cfg){
    $h=Read-Health $cfg
    if($h){$owner=Get-VerifiedOwner $cfg $h;Enter-UninstallMaintenance $cfg;Stop-And-Prove $cfg $owner;return}
  }
  if(Lock-MatchesLiveHost){Fail 'A live or ambiguously identified Host still owns local state while program files are missing. Repair/reboot before uninstalling data; nothing was removed.'}
}
function Enter-UninstallMaintenance($cfg){try{$m=Api 'POST' '/v1/maintenance' $cfg @{enabled=$true};$script:MaintenanceEntered=$true}catch{Fail 'Running Host does not support safe uninstall maintenance. Finish/close it normally or repair the installation first.'};$r=Api 'GET' '/v1/upgrade-readiness' $cfg;if(-not $r.ok){Fail ("{0} unfinished Agent/run item(s) exist. Apply/Discard/resolve them before uninstalling." -f @($r.unfinished).Count)}}
function Exit-MaintenanceBestEffort($cfg){if($script:MaintenanceEntered -and (Test-Health $cfg)){try{$null=Api 'POST' '/v1/maintenance' $cfg @{enabled=$false}}catch{}};$script:MaintenanceEntered=$false}
function Stop-And-Prove($cfg,$owner){
  if(-not $owner){Fail 'Authenticated Host exact process owner was lost before shutdown; nothing was deleted.'};$processId=[int]$owner.pid;$identity=[string]$owner.processIdentity
  if(-not (Test-ExactProcessAlive $processId $identity)){Fail 'Authenticated Host exact process owner was lost before shutdown; nothing was deleted.'}
  try{$null=Api 'POST' '/v1/shutdown' $cfg @{}}catch{Fail 'Authenticated Host shutdown request failed; nothing was deleted.'}
  for($i=0;$i -lt 100;$i++){if(-not (Test-Health $cfg)){break};Start-Sleep -Milliseconds 100}
  if(Test-Health $cfg){Fail 'Authenticated Host still responds after shutdown; nothing was deleted.'}
  if(-not (Wait-ExactProcessExit $processId $identity 10000)){Fail 'Authenticated Host process did not exit after shutdown; nothing was deleted.'}
  $lock=Read-HostLock
  if($lock){$lockPid=Get-OptionalProperty $lock 'pid';$lockIdentity=[string](Get-OptionalProperty $lock 'processIdentity');$same=($lockPid -and [int]$lockPid -eq $processId -and $lockIdentity -eq $identity);if($same -and -not (Test-ExactProcessAlive $processId $identity)){Remove-Item -LiteralPath (Join-Path $State 'host.lock.json') -Force -ErrorAction SilentlyContinue}elseif(Lock-MatchesLiveHost){Fail 'A live process still owns the Gemini Bridge Host lock; nothing was deleted.'}}
  $script:MaintenanceEntered=$false
}

$cfg=$null
try{
  Acquire-SetupMutex
  Assert-AppOwnedRootsSafe
  Assert-AppOwnedFileSafe (Join-Path $State 'runtime.json') 'runtime.json' $true
  Assert-AppOwnedFileSafe (Join-Path $State 'host.lock.json') 'host.lock.json' $true
  if(Test-Path $Install){
    if(-not (Test-Path $State)){Fail 'Bridge state is missing, so unfinished work and Host ownership cannot be verified. Run Setup/Repair first; no program files were removed.'}
    if(-not (Test-Path -LiteralPath (Join-Path $State 'bridge.sqlite') -PathType Leaf)){Fail 'bridge.sqlite is missing from an existing installation. Run Setup/Repair first; Uninstall will not create empty state.'}
    $cfg=Read-Config;if(-not $cfg){Fail 'runtime.json is missing/corrupt. Run Setup/Repair before uninstalling so pending work can be verified.'}
    $owner=Ensure-Host $cfg;Enter-UninstallMaintenance $cfg;Stop-And-Prove $cfg $owner
  }else{
    $cfg=Read-Config
    Quiesce-ResidualHostWithoutProgram $cfg
  }
  Remove-Item (Join-Path $Startup 'Gemini Bridge Host.lnk') -Force -ErrorAction SilentlyContinue;foreach($n in @('Gemini Bridge.url','Gemini Bridge Sign-in.lnk','Gemini Bridge.lnk','Gemini Bridge Web Server.lnk')){Remove-Item (Join-Path $Desktop $n) -Force -ErrorAction SilentlyContinue}
  if(Test-Path $MutableExtension){Remove-Item -LiteralPath $MutableExtension -Recurse -Force};if(Test-Path $MutableExtension){Fail 'Mutable browser-extension folder still exists after removal attempt; uninstall is incomplete.'}
  if(Test-Path $Install){Remove-Item -LiteralPath $Install -Recurse -Force};if(Test-Path $Install){Fail 'Program folder still exists after removal attempt; uninstall is incomplete.'};Remove-Item -LiteralPath $LauncherRoot -Recurse -Force -ErrorAction SilentlyContinue;Write-Host 'Program files and local extension pairing files removed. If the optional unpacked extension is still listed in Chrome/Edge, remove that entry manually.' -ForegroundColor Green
  if(Test-Path $Base){$ans=Read-Host 'Delete local Gemini history, Google Bridge profile, backups, and managed runtime too? Type DELETE to confirm';if($ans -eq 'DELETE'){Remove-Item -LiteralPath $Base -Recurse -Force;if(Test-Path $Base){Fail 'Local data folder could not be fully removed.'};Write-Host 'Local Gemini Bridge data deleted.' -ForegroundColor Green}else{Write-Host "Local data kept: $Base"}}
  exit 0
}catch{$msg=$_.Exception.Message;Exit-MaintenanceBestEffort $cfg;Write-Host "`nUNINSTALL ABORTED: $msg" -ForegroundColor Red;exit 2}finally{Release-SetupMutex}
