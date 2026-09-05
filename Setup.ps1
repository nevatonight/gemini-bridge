$ErrorActionPreference='Stop'
Set-StrictMode -Version 2
$Version='0.4.8.8'
$MinimumAntigravityVersion='1.1.20'
$script:AgentVersion=$null
$script:ReleaseRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallRoot=Join-Path $env:LOCALAPPDATA 'Programs\GeminiBridge'
$BaseRoot=Join-Path $env:LOCALAPPDATA 'GeminiBridge'
$StateRoot=Join-Path $BaseRoot 'state-v3'
$RuntimeBase=Join-Path $BaseRoot 'runtime'
$MutableExtension=Join-Path $BaseRoot 'web-extension'
$BackupRoot=Join-Path $BaseRoot 'backups'
$LauncherRoot=Join-Path $BaseRoot 'launcher'
$Startup=[Environment]::GetFolderPath('Startup')
$Desktop=[Environment]::GetFolderPath('Desktop')
$script:Mutex=$null;$script:ProgramBackupDir=$null;$script:ProgramStageDir=$null;$script:StateBackupDir=$null;$script:ExtensionBackupDir=$null;$script:ExtensionStageDir=$null;$script:NewRuntimeDir=$null;$script:MaintenanceEntered=$false;$script:Committed=$false;$script:HadProgramBefore=$false;$script:HadExtensionBefore=$false;$script:HadLauncherBefore=$false;$script:LauncherBackupFile=$null;$script:RestartOldHostOnRollback=$false;$script:CandidateLaunchNonce=$null;$script:CandidateInstanceId=$null;$script:CandidateProcessId=$null;$script:CandidateProcessIdentity=$null

function Info([string]$m){Write-Host $m -ForegroundColor Cyan}
function Ok([string]$m){Write-Host $m -ForegroundColor Green}
function Warn([string]$m){Write-Host $m -ForegroundColor Yellow}
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
    Fail ("{0} is a reparse/junction/symlink path. Gemini Bridge will not mutate redirected app-owned roots." -f $label)
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
  Assert-AppOwnedPathSafe $BaseRoot 'Gemini Bridge data root'
  Assert-AppOwnedPathSafe $StateRoot 'Gemini Bridge state root'
  Assert-AppOwnedPathSafe $InstallRoot 'Gemini Bridge program root'
  Assert-AppOwnedPathSafe $MutableExtension 'Gemini Bridge mutable extension root'
  Assert-AppOwnedPathSafe $RuntimeBase 'Gemini Bridge managed runtime root'
  Assert-AppOwnedPathSafe $BackupRoot 'Gemini Bridge backup root'
  Assert-AppOwnedPathSafe $LauncherRoot 'Gemini Bridge launcher root'
}
function Stage([int]$n,[string]$m){Info ("[{0}/6] {1}" -f $n,$m)}
function Get-ProcessIdentity([int]$processId){
  if($processId -le 0){return $null};try{$proc=Get-Process -Id $processId -ErrorAction Stop;return ('win32:'+ $proc.StartTime.ToUniversalTime().Ticks.ToString())}catch{return $null}
}
function Test-ExactProcessAlive([int]$processId,[string]$identity){if($processId -le 0 -or [string]::IsNullOrWhiteSpace($identity)){return $false};return ((Get-ProcessIdentity $processId) -eq $identity)}
function Wait-ExactProcessExit([int]$processId,[string]$identity,[int]$timeoutMs=10000){
  $end=[DateTime]::UtcNow.AddMilliseconds($timeoutMs);while([DateTime]::UtcNow -lt $end){if(-not (Test-ExactProcessAlive $processId $identity)){return $true};Start-Sleep -Milliseconds 100};return (-not (Test-ExactProcessAlive $processId $identity))
}
function Read-HostLockSafe {
  $file=Join-Path $StateRoot 'host.lock.json'
  if(-not (Test-Path -LiteralPath $file -PathType Leaf)){return $null}
  try{return Get-Content -LiteralPath $file -Raw|ConvertFrom-Json}catch{return $null}
}
function Test-HostLockPresentButUnreadable {
  $file=Join-Path $StateRoot 'host.lock.json'
  if(-not (Test-Path -LiteralPath $file -PathType Leaf)){return $false}
  return ($null -eq (Read-HostLockSafe))
}
function Invoke-NativeLogged([string]$exe,[string[]]$arguments){
  $lines=@(& $exe @arguments 2>&1);$code=$LASTEXITCODE
  foreach($line in $lines){Write-Host ([string]$line)}
  return [pscustomobject]@{ExitCode=[int]$code;LineCount=$lines.Count}
}
function Require-SinglePath($value,[string]$label,[string]$mustBeUnder=$null){
  $items=@($value);if($items.Count -ne 1){Fail ("{0} resolution produced {1} values; refusing ambiguous/native-output-contaminated path." -f $label,$items.Count)}
  $s=[string]$items[0];if([string]::IsNullOrWhiteSpace($s) -or $s -match '[\r\n\x00]'){Fail ("{0} is empty or contains control characters." -f $label)}
  try{$full=[IO.Path]::GetFullPath($s)}catch{Fail ("{0} is not a valid absolute filesystem path: {1}" -f $label,$_.Exception.Message)}
  if(-not (Test-Path -LiteralPath $full -PathType Leaf)){Fail ("{0} does not resolve to an existing file: {1}" -f $label,$full)}
  try{$resolved=(Resolve-Path -LiteralPath $full -ErrorAction Stop).ProviderPath}catch{Fail ("{0} real path could not be resolved: {1}" -f $label,$_.Exception.Message)}
  if($mustBeUnder){try{$baseResolved=(Resolve-Path -LiteralPath $mustBeUnder -ErrorAction Stop).ProviderPath}catch{Fail ("Managed runtime root could not be resolved for {0}." -f $label)};$base=[IO.Path]::GetFullPath($baseResolved).TrimEnd('\')+'\';$real=[IO.Path]::GetFullPath($resolved);if(-not $real.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){Fail ("{0} escaped the managed runtime root through a reparse/symlink path." -f $label)}}
  return [IO.Path]::GetFullPath($resolved)
}
function Acquire-SetupMutex {
  $m=New-Object System.Threading.Mutex($false,'Local\GeminiBridge.SetupUninstall');$owned=$false
  try{$owned=$m.WaitOne(0)}catch [System.Threading.AbandonedMutexException]{$owned=$true}
  if(-not $owned){$m.Dispose();Fail 'Another Gemini Bridge Setup/Uninstall operation is already running.'};$script:Mutex=$m
}
function Release-SetupMutex {if($script:Mutex){try{$script:Mutex.ReleaseMutex()}catch{};try{$script:Mutex.Dispose()}catch{};$script:Mutex=$null}}
function Node-Ok([string]$exe){try{$v=& $exe -p 'process.versions.node';$p=$v.Trim().Split('.');$major=[int]$p[0];$minor=[int]$p[1];return (($major -eq 22 -and $minor -ge 13) -or ($major -eq 24))}catch{return $false}}
function Find-Node {$c=@();try{$c+=(Get-Command node -ErrorAction Stop).Source}catch{};$c+=@(Join-Path $env:ProgramFiles 'nodejs\node.exe');if(${env:ProgramFiles(x86)}){$c+=@(Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')};foreach($x in ($c|Select-Object -Unique)){if($x -and (Test-Path $x) -and (Node-Ok $x)){return $x}};return $null}
function Find-Npm([string]$node){$same=Join-Path (Split-Path -Parent $node) 'npm.cmd';if(Test-Path -LiteralPath $same -PathType Leaf){return $same};return $null}
function Ensure-Node {$node=Find-Node;if($node){return $node};Info 'Node.js 22.13+ is required. Trying Windows Package Manager...';try{$winget=(Get-Command winget.exe -ErrorAction Stop).Source}catch{Fail 'Node.js 22.13+ is required and winget is unavailable. Install current Node.js LTS, then run Setup again.'};$r=Invoke-NativeLogged $winget @('install','--id','OpenJS.NodeJS.LTS','--exact','--source','winget','--silent','--accept-package-agreements','--accept-source-agreements');if($r.ExitCode -ne 0){Fail ("Automatic Node.js installation failed (winget exit {0})." -f $r.ExitCode)};$node=Find-Node;if(-not $node){Fail 'Node.js was installed but could not be located. Restart Windows and run Setup again.'};return $node}
function Relative-Path([string]$root,[string]$file){$r=[IO.Path]::GetFullPath($root).TrimEnd('\')+'\';$f=[IO.Path]::GetFullPath($file);if(-not $f.StartsWith($r,[StringComparison]::OrdinalIgnoreCase)){Fail 'Manifest path escaped release root.'};return $f.Substring($r.Length).Replace('\','/')}
function Verify-ReleaseManifest([string]$root){
  $manifest=Join-Path $root 'MANIFEST.sha256';if(-not (Test-Path $manifest)){Fail 'MANIFEST.sha256 is missing.'};$expected=@{}
  foreach($line in Get-Content $manifest){if([string]::IsNullOrWhiteSpace($line)){continue};if($line -notmatch '^([a-fA-F0-9]{64})  (.+)$'){Fail "Malformed MANIFEST.sha256 line: $line"};$hash=$Matches[1].ToLowerInvariant();$rel=$Matches[2].Replace('\','/');while($rel.StartsWith('./')){$rel=$rel.Substring(2)};if([string]::IsNullOrWhiteSpace($rel) -or [IO.Path]::IsPathRooted($rel) -or $rel.Split('/') -contains '..'){Fail "Unsafe manifest path: $rel"};if($expected.ContainsKey($rel)){Fail "Duplicate manifest path: $rel"};$file=Join-Path $root ($rel.Replace('/','\'));if(-not (Test-Path -LiteralPath $file -PathType Leaf)){Fail "Manifest file missing: $rel"};$actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant();if($actual -ne $hash){Fail "Manifest hash mismatch: $rel"};$expected[$rel]=$true}
  $actualFiles=@(Get-ChildItem -LiteralPath $root -Recurse -Force -File|ForEach-Object {Relative-Path $root $_.FullName}|Where-Object {$_ -ne 'MANIFEST.sha256'});foreach($rel in $actualFiles){if(-not $expected.ContainsKey($rel)){Fail "Unlisted release file: $rel"}};if($actualFiles.Count -ne $expected.Count){Fail 'Release manifest is not exhaustive.'};return $true
}
function Read-RuntimeSafe {try{return Get-Content (Join-Path $StateRoot 'runtime.json') -Raw|ConvertFrom-Json}catch{return $null}}
function Parse-AppVersion([string]$value,[string]$label){
  # Gemini Bridge historically used both three-part (0.4.7) and four-part
  # (0.4.8.1+) numeric versions. System.Version safely compares both forms.
  if([string]::IsNullOrWhiteSpace($value) -or $value -notmatch '^\d+(?:\.\d+){2,3}$'){
    Fail ("{0} Gemini Bridge programVersion is invalid: {1}" -f $label,$value)
  }
  try{return [version]$value}catch{Fail ("{0} Gemini Bridge programVersion is invalid: {1}" -f $label,$value)}
}
function Assert-NoDowngrade($cfg){
  if(-not $script:HadProgramBefore){return}
  $installed=[string](Get-OptionalProperty $cfg 'programVersion')
  if(-not $cfg -or [string]::IsNullOrWhiteSpace($installed)){Fail 'Existing Gemini Bridge programVersion is missing; refusing destructive upgrade. Run a matching/newer Repair package first.'}
  $installedVersion=Parse-AppVersion $installed 'Installed'
  $targetVersion=Parse-AppVersion $Version 'Target'
  if($installedVersion -gt $targetVersion){Fail ("Refusing downgrade from Gemini Bridge {0} to {1}. Use the same or a newer release." -f $installed,$Version)}
}
function Api([string]$method,[string]$path,$cfg,$body=$null,[int]$timeout=3){$headers=@{'X-Gemini-Bridge-Token'=[string]$cfg.token};$a=@{Method=$method;Uri=("http://127.0.0.1:{0}{1}" -f [int]$cfg.port,$path);Headers=$headers;TimeoutSec=$timeout};if($body -ne $null){$a.ContentType='application/json';$a.Body=($body|ConvertTo-Json -Compress)};return Invoke-RestMethod @a}
function Test-BridgeHealth($cfg){if(-not $cfg){return $false};try{$h=Api 'GET' '/v1/health' $cfg $null 1;return ($h -ne $null)}catch{return $false}}
function Lock-MatchesOrAmbiguousLiveHost {
  $lockFile=Join-Path $StateRoot 'host.lock.json';if(-not (Test-Path -LiteralPath $lockFile -PathType Leaf)){return $false}
  if(Test-HostLockPresentButUnreadable){return $true}
  try{$lock=Read-HostLockSafe;$pidValue=Get-OptionalProperty $lock 'pid';if(-not $pidValue){return $false};$processId=[int]$pidValue;if($processId -le 0){return $false};$proc=Get-Process -Id $processId -ErrorAction Stop}catch{return $false}
  $identity=[string](Get-OptionalProperty $lock 'processIdentity');if($identity -match '^win32:(\d+)$'){return ($proc.StartTime.ToUniversalTime().Ticks.ToString() -eq $Matches[1])}
  # A live PID with legacy/unknown identity is ambiguous. Fail closed rather than risk modifying files under a live Host.
  return $true
}
function Get-AuthenticatedHostOwner($cfg){
  try{$h=Api 'GET' '/v1/health' $cfg $null 2}catch{return $null}
  $hostInfo=Get-OptionalProperty $h 'host';$hostPid=Get-OptionalProperty $hostInfo 'pid';$hostIdentity=[string](Get-OptionalProperty $hostInfo 'processIdentity')
  if($hostInfo -and $hostPid -and -not [string]::IsNullOrWhiteSpace($hostIdentity)){$processId=[int]$hostPid;if(Test-ExactProcessAlive $processId $hostIdentity){return [pscustomobject]@{pid=$processId;processIdentity=$hostIdentity;instanceId=[string](Get-OptionalProperty $hostInfo 'instanceId');launchNonce=[string](Get-OptionalProperty $hostInfo 'launchNonce');health=$h}}}
  $lock=Read-HostLockSafe;$lockPid=Get-OptionalProperty $lock 'pid';$lockIdentity=[string](Get-OptionalProperty $lock 'processIdentity')
  if($lock -and $lockPid -and -not [string]::IsNullOrWhiteSpace($lockIdentity)){$processId=[int]$lockPid;if(Test-ExactProcessAlive $processId $lockIdentity){return [pscustomobject]@{pid=$processId;processIdentity=$lockIdentity;instanceId=[string](Get-OptionalProperty $lock 'instanceId');launchNonce=[string](Get-OptionalProperty $lock 'launchNonce');health=$h}}}
  return $null
}
function Enter-MaintenanceIfRunning($cfg){
  if(-not $cfg -or -not (Test-BridgeHealth $cfg)){return $false}
  try{$m=Api 'POST' '/v1/maintenance' $cfg @{enabled=$true};$script:MaintenanceEntered=$true}catch{Fail 'A live legacy/unsupported Gemini Bridge Host is running. Finish/close it normally, then run Setup again; Setup will not kill it blindly.'}
  $ready=Api 'GET' '/v1/upgrade-readiness' $cfg;if(-not $ready.ok){Fail ("Upgrade blocked: {0} unfinished run(s) or active operation(s) remain." -f @($ready.unfinished).Count)};return $true
}
function Exit-MaintenanceBestEffort($cfg){if($script:MaintenanceEntered -and $cfg -and (Test-BridgeHealth $cfg)){try{$null=Api 'POST' '/v1/maintenance' $cfg @{enabled=$false}}catch{}};$script:MaintenanceEntered=$false}
function Stop-AuthenticatedHost($cfg,[bool]$wasRunning){if(-not $wasRunning){return};$owner=Get-AuthenticatedHostOwner $cfg;if(-not $owner){Fail 'Authenticated Gemini Bridge Host ownership could not be proven exactly; upgrade aborted.'};try{$null=Api 'POST' '/v1/shutdown' $cfg @{}}catch{};for($i=0;$i -lt 100;$i++){if(-not (Test-BridgeHealth $cfg)){break};Start-Sleep -Milliseconds 100};if(Test-BridgeHealth $cfg){Fail 'Authenticated Gemini Bridge Host still responds after shutdown; upgrade aborted.'};if(-not (Wait-ExactProcessExit ([int]$owner.pid) ([string]$owner.processIdentity) 10000)){Fail 'Authenticated Gemini Bridge Host process did not exit after shutdown; upgrade aborted.'};$script:MaintenanceEntered=$false;$script:RestartOldHostOnRollback=$true}
function Invoke-OfflineStateCheck([string]$node){$env:GEMINI_BRIDGE_STATE=$StateRoot;$raw=& $node (Join-Path $script:ReleaseRoot 'src\cli.mjs') offline-check;if($LASTEXITCODE -ne 0){Fail ("Read-only offline state check failed: $raw")};$x=$raw|ConvertFrom-Json;if(-not $x.ok){Fail ("Offline state check refused upgrade: {0}" -f $x.error)};return $x}
function Backup-State {
  New-Item -ItemType Directory -Force -Path $BackupRoot|Out-Null;$b=Join-Path $BackupRoot ('state-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Force -Path $b|Out-Null
  $present=@();foreach($n in @('bridge.sqlite','bridge.sqlite-wal','bridge.sqlite-shm','runtime.json')){$src=Join-Path $StateRoot $n;if(Test-Path $src){Copy-Item -LiteralPath $src -Destination (Join-Path $b $n) -Force;$present+=$n}};@{present=$present}|ConvertTo-Json|Set-Content (Join-Path $b 'backup.json') -Encoding UTF8;$script:StateBackupDir=$b
}
function Restore-State {if(-not $script:StateBackupDir -or -not (Test-Path $script:StateBackupDir)){return};$meta=Get-Content (Join-Path $script:StateBackupDir 'backup.json') -Raw|ConvertFrom-Json;foreach($n in @('bridge.sqlite','bridge.sqlite-wal','bridge.sqlite-shm','runtime.json')){$dst=Join-Path $StateRoot $n;Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue;if(@($meta.present) -contains $n){Copy-Item -LiteralPath (Join-Path $script:StateBackupDir $n) -Destination $dst -Force}}}
function Stage-Release {
  $parent=Split-Path -Parent $InstallRoot;New-Item -ItemType Directory -Force -Path $parent|Out-Null;$nonce=[guid]::NewGuid().ToString('N');$stage=$InstallRoot+'.staging-'+$nonce;$old=$InstallRoot+'.old-'+$nonce;$script:ProgramStageDir=$stage;New-Item -ItemType Directory -Force -Path $stage|Out-Null
  try{
    Get-ChildItem -LiteralPath $script:ReleaseRoot -Force|ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force};Verify-ReleaseManifest $stage|Out-Null
    if(Test-Path $InstallRoot){Move-Item -LiteralPath $InstallRoot -Destination $old;$script:ProgramBackupDir=$old}
    Move-Item -LiteralPath $stage -Destination $InstallRoot;$script:ProgramStageDir=$null
  }catch{
    if($script:ProgramStageDir -and (Test-Path $script:ProgramStageDir)){Remove-Item -LiteralPath $script:ProgramStageDir -Recurse -Force -ErrorAction SilentlyContinue};$script:ProgramStageDir=$null
    if($script:ProgramBackupDir -and (Test-Path $script:ProgramBackupDir) -and -not (Test-Path $InstallRoot)){Move-Item -LiteralPath $script:ProgramBackupDir -Destination $InstallRoot;$script:ProgramBackupDir=$null}
    throw
  }
}
function Invoke-AntigravityEntryProbe([string]$node,[string]$entry,[string]$expected=$null){
  if(-not $entry -or -not (Test-Path -LiteralPath $entry -PathType Leaf)){return $null}
  try{$a=@('--entry',$entry,'--minimum',$MinimumAntigravityVersion);if($expected){$a+=@('--expected',$expected)};$raw=& $node (Join-Path $script:ReleaseRoot 'src\managed-antigravity-probe.mjs') @a;if($LASTEXITCODE -ne 0){return $null};return ($raw|ConvertFrom-Json)}catch{return $null}
}
function Get-AntigravityCandidates {
  $c=@();$official=Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe';$c+=@($official)
  try{$cmd=Get-Command agy.exe -CommandType Application -ErrorAction Stop;if($cmd.Source){$c+=@($cmd.Source)}}catch{}
  try{$cmd=Get-Command agy -CommandType Application -ErrorAction Stop;if($cmd.Source){$c+=@($cmd.Source)}}catch{}
  $out=@();foreach($x in ($c|Select-Object -Unique)){if([string]::IsNullOrWhiteSpace([string]$x)){continue};try{$full=[IO.Path]::GetFullPath([string]$x);if(Test-Path -LiteralPath $full -PathType Leaf){$item=Get-Item -LiteralPath $full -Force -ErrorAction Stop;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and (-not ($item.PSObject.Properties.Name -contains 'LinkType' -and $item.LinkType))){$out+=@($full)}}}catch{}}
  return @($out)
}
function Copy-FileWithRetry([string]$sourceFile,[string]$destination,[int]$attempts=8){
  $last=$null;for($i=0;$i -lt $attempts;$i++){try{Copy-Item -LiteralPath $sourceFile -Destination $destination -Force -ErrorAction Stop;return}catch{$last=$_;Start-Sleep -Milliseconds ([Math]::Min(1500,100*[Math]::Pow(2,$i)))} };throw $last
}
function Assert-DownloadedInstaller([string]$file,[string]$label){
  Assert-AppOwnedFileSafe $file $label $false
  $len=(Get-Item -LiteralPath $file -Force).Length
  if($len -lt 200 -or $len -gt 2097152){Fail ("{0} size is implausible ({1} bytes)." -f $label,$len)}
  $sample=[IO.File]::ReadAllText($file)
  if($sample -match '(?is)^\s*<(?:!doctype|html|head|body)\b' -or $sample -notmatch '(?i)(?:antigravity|agy)'){Fail ("{0} does not look like an Antigravity installer script." -f $label)}
}
function Invoke-CmdScriptLogged([string]$file,[string[]]$arguments){
  $lines=@(& $file @arguments 2>&1);$code=$LASTEXITCODE
  foreach($line in $lines){Write-Host ([string]$line)}
  return [pscustomobject]@{ExitCode=[int]$code;LineCount=$lines.Count}
}
function Invoke-OfficialAntigravityInstaller {
  Info 'Installing/upgrading Google Antigravity CLI for the current Windows user...'
  $nonce=[guid]::NewGuid().ToString('N');$cmdFile=Join-Path $env:TEMP ('gemini-bridge-antigravity-install-'+$nonce+'.cmd');$psFile=Join-Path $env:TEMP ('gemini-bridge-antigravity-install-'+$nonce+'.ps1');$errors=@()
  try{
    $curl=$null;try{$curl=(Get-Command curl.exe -CommandType Application -ErrorAction Stop).Source}catch{}
    if($curl){
      $r=Invoke-NativeLogged $curl @('--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--tlsv1.2','--connect-timeout','20','--max-time','120','https://antigravity.google/cli/install.cmd','--output',$cmdFile)
      if($r.ExitCode -eq 0){
        try{Assert-DownloadedInstaller $cmdFile 'Downloaded Antigravity CMD installer';$ir=Invoke-CmdScriptLogged $cmdFile @('--skip-path','--skip-aliases');if($ir.ExitCode -eq 0){return};$errors+=@('CMD installer exit '+$ir.ExitCode)}catch{$errors+=@('curl/cmd: '+$_.Exception.Message)}
      }else{$errors+=@('curl download exit '+$r.ExitCode)}
    }else{$errors+=@('curl.exe unavailable')}
    try{
      $oldProtocol=[Net.ServicePointManager]::SecurityProtocol
      try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;Invoke-WebRequest -UseBasicParsing -Uri 'https://antigravity.google/cli/install.ps1' -OutFile $psFile -TimeoutSec 120 -MaximumRedirection 0;Assert-DownloadedInstaller $psFile 'Downloaded Antigravity PowerShell installer'}finally{[Net.ServicePointManager]::SecurityProtocol=$oldProtocol}
      $psExe=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe';$pr=Invoke-NativeLogged $psExe @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$psFile,'--skip-path','--skip-aliases');if($pr.ExitCode -eq 0){return};$errors+=@('PowerShell installer exit '+$pr.ExitCode)
    }catch{$errors+=@('PowerShell/TLS: '+$_.Exception.Message)}
    Fail ('Could not install Antigravity through either official Windows transport. '+($errors -join ' | ')+' You may install it manually with the official Google installer and rerun Setup; the existing Gemini Bridge installation was not replaced.')
  }finally{Remove-Item -LiteralPath $cmdFile,$psFile -Force -ErrorAction SilentlyContinue}
}
function Find-UsableAntigravity([string]$node,[int]$attempts=3){
  foreach($candidate in @(Get-AntigravityCandidates)){
    for($i=0;$i -lt $attempts;$i++){
      $probe=Invoke-AntigravityEntryProbe $node $candidate
      if($probe -and $probe.ok -eq $true){return [pscustomobject]@{entry=$candidate;probe=$probe}}
      if($i+1 -lt $attempts){Start-Sleep -Milliseconds (250*($i+1))}
    }
  }
  return $null
}
function Ensure-Antigravity([string]$node,$oldCfg){
  $oldProvider=[string](Get-OptionalProperty $oldCfg 'provider');$oldEntry=[string](Get-OptionalProperty $oldCfg 'geminiEntry');$oldVersion=[string](Get-OptionalProperty $oldCfg 'geminiVersion')
  if($oldCfg -and $oldProvider -eq 'antigravity' -and -not [string]::IsNullOrWhiteSpace($oldEntry) -and -not [string]::IsNullOrWhiteSpace($oldVersion)){$e=$oldEntry;$base=[IO.Path]::GetFullPath($RuntimeBase).TrimEnd('\')+'\';try{$full=[IO.Path]::GetFullPath($e);if($full.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){$probe=Invoke-AntigravityEntryProbe $node $e $oldVersion;if($probe -and $probe.ok -eq $true){$script:AgentVersion=[string]$probe.version;return $e}}}catch{}}
  $usable=Find-UsableAntigravity $node
  if(-not $usable){Invoke-OfficialAntigravityInstaller;$usable=Find-UsableAntigravity $node 5}
  if(-not $usable){Fail ("Antigravity CLI is still unavailable or older than required minimum {0} after the official installer. The existing Gemini Bridge installation was not replaced." -f $MinimumAntigravityVersion)}
  New-Item -ItemType Directory -Force -Path $RuntimeBase|Out-Null
  for($copyAttempt=0;$copyAttempt -lt 3;$copyAttempt++){
    if($copyAttempt -gt 0){$usable=Find-UsableAntigravity $node 3;if(-not $usable){break}}
    $externalEntry=[string]$usable.entry;$sourceProbe=$usable.probe;$sourceVersion=[string]$sourceProbe.version
    $dir=Join-Path $RuntimeBase ('antigravity-'+$sourceVersion+'-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Force -Path $dir|Out-Null;$script:NewRuntimeDir=$dir;$entry=Join-Path $dir 'agy.exe'
    try{
      Copy-FileWithRetry $externalEntry $entry
      $managed=Invoke-AntigravityEntryProbe $node $entry $sourceVersion
      if($managed -and $managed.ok -eq $true){$script:AgentVersion=[string]$managed.version;return [string]$entry}
    }catch{}
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue;$script:NewRuntimeDir=$null
    Start-Sleep -Milliseconds (300*($copyAttempt+1))
  }
  Fail 'Managed Antigravity copy failed exact version verification after bounded retries. The external user installation was left untouched.'
}
function Write-RuntimeConfig($cfg,[string]$node,[string]$entry){if(-not $script:AgentVersion){Fail 'Antigravity runtime version was not established.'};Add-Member -InputObject $cfg -NotePropertyName nodePath -NotePropertyValue $node -Force;Add-Member -InputObject $cfg -NotePropertyName geminiEntry -NotePropertyValue $entry -Force;Add-Member -InputObject $cfg -NotePropertyName geminiVersion -NotePropertyValue $script:AgentVersion -Force;Add-Member -InputObject $cfg -NotePropertyName provider -NotePropertyValue 'antigravity' -Force;Add-Member -InputObject $cfg -NotePropertyName programVersion -NotePropertyValue $Version -Force;$file=Join-Path $StateRoot 'runtime.json';$tmp=$file+'.new-'+[guid]::NewGuid().ToString('N');[IO.File]::WriteAllText($tmp,($cfg|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)));Move-Item -LiteralPath $tmp -Destination $file -Force}
function Assert-RuntimeConfigPaths($cfg){
  if(-not $cfg){Fail 'runtime.json could not be read back after write.'}
  $nodeValue=[string](Get-OptionalProperty $cfg 'nodePath');$entryValue=[string](Get-OptionalProperty $cfg 'geminiEntry');$provider=[string](Get-OptionalProperty $cfg 'provider');$runtimeVersion=[string](Get-OptionalProperty $cfg 'geminiVersion')
  if([string]::IsNullOrWhiteSpace($nodeValue)){Fail 'runtime.json nodePath is missing after write.'};if([string]::IsNullOrWhiteSpace($entryValue)){Fail 'runtime.json Antigravity entry is missing after write.'}
  $n=Require-SinglePath $nodeValue 'runtime.json nodePath';$e=Require-SinglePath $entryValue 'runtime.json Antigravity entry' $RuntimeBase
  if($provider -ne 'antigravity'){Fail 'runtime.json provider changed during write/readback.'};if($runtimeVersion -ne [string]$script:AgentVersion){Fail 'runtime.json Antigravity version changed during write/readback.'}
  return [pscustomobject]@{nodePath=$n;geminiEntry=$e}
}
function Install-MutableExtension($cfg){
  $stage=$MutableExtension+'.staging-'+[guid]::NewGuid().ToString('N');$old=$MutableExtension+'.old-'+[guid]::NewGuid().ToString('N');$script:ExtensionStageDir=$stage;New-Item -ItemType Directory -Force -Path $stage|Out-Null
  try{
    Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'web-extension') -Force|ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force};@('// Generated locally. Keep private.',"const GB_TOKEN = '$([string]$cfg.token)';","const GB_PORT = $([int]$cfg.port);")|Set-Content (Join-Path $stage 'config.js') -Encoding ASCII
    if(Test-Path $MutableExtension){Move-Item -LiteralPath $MutableExtension -Destination $old;$script:ExtensionBackupDir=$old};Move-Item -LiteralPath $stage -Destination $MutableExtension;$script:ExtensionStageDir=$null
  }catch{
    if($script:ExtensionStageDir -and (Test-Path $script:ExtensionStageDir)){Remove-Item -LiteralPath $script:ExtensionStageDir -Recurse -Force -ErrorAction SilentlyContinue};$script:ExtensionStageDir=$null
    if($script:ExtensionBackupDir -and (Test-Path $script:ExtensionBackupDir) -and -not (Test-Path $MutableExtension)){Move-Item -LiteralPath $script:ExtensionBackupDir -Destination $MutableExtension;$script:ExtensionBackupDir=$null};throw
  }
}
function Shortcut([string]$file,[string]$target,[string]$shortcutArgs,[string]$work,[string]$desc){$ws=New-Object -ComObject WScript.Shell;$s=$ws.CreateShortcut($file);$s.TargetPath=$target;$s.Arguments=$shortcutArgs;$s.WorkingDirectory=$work;$s.Description=$desc;$s.Save()}
function Backup-Launcher {
  $launcher=Join-Path $LauncherRoot 'Start-Host-Hidden.ps1'
  if(-not $script:HadLauncherBefore){return}
  if(-not (Test-Path -LiteralPath $launcher -PathType Leaf)){Fail 'Existing Host launcher disappeared before candidate startup; refusing non-exact rollback.'}
  $backup=Join-Path $LauncherRoot ('Start-Host-Hidden.ps1.rollback-'+[guid]::NewGuid().ToString('N'))
  Copy-Item -LiteralPath $launcher -Destination $backup -Force
  $script:LauncherBackupFile=$backup
}
function Restore-Launcher {
  $launcher=Join-Path $LauncherRoot 'Start-Host-Hidden.ps1'
  if($script:LauncherBackupFile -and (Test-Path -LiteralPath $script:LauncherBackupFile -PathType Leaf)){
    Copy-Item -LiteralPath $script:LauncherBackupFile -Destination $launcher -Force
    Remove-Item -LiteralPath $script:LauncherBackupFile -Force -ErrorAction SilentlyContinue
    $script:LauncherBackupFile=$null
  }elseif(-not $script:HadLauncherBefore){Remove-Item -LiteralPath $launcher -Force -ErrorAction SilentlyContinue}
}
function Start-RestoredHost([string]$node){
  $launcher=Join-Path $LauncherRoot 'Start-Host-Hidden.ps1'
  if($script:HadLauncherBefore -and (Test-Path -LiteralPath $launcher -PathType Leaf)){& $launcher;return}
  Start-BridgeHost $node
}
function Start-BridgeHost([string]$node){Remove-Item -LiteralPath (Join-Path $StateRoot 'host-startup-error.json') -Force -ErrorAction SilentlyContinue;$launcherDir=$LauncherRoot;New-Item -ItemType Directory -Force -Path $launcherDir|Out-Null;$launcher=Join-Path $launcherDir 'Start-Host-Hidden.ps1';$hostFile=Join-Path $InstallRoot 'src\host.mjs';$nodeSafe=$node.Replace("'","''");$hostSafe=$hostFile.Replace("'","''");$stateSafe=$StateRoot.Replace("'","''");$launcherText=@"
param([string]`$LaunchNonce='')
`$ErrorActionPreference='Stop'
`$nodePath='$nodeSafe'
`$hostPath='$hostSafe'
`$statePath='$stateSafe'
if(`$nodePath -match '[`"`r`n]' -or `$hostPath -match '[`"`r`n]'){throw 'Unsafe Host launcher path.'}
`$psi=New-Object System.Diagnostics.ProcessStartInfo
`$psi.FileName=`$nodePath
`$psi.Arguments='`"'+`$hostPath+'`"'
`$psi.UseShellExecute = `$false
`$psi.CreateNoWindow = `$true
`$psi.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
`$psi.EnvironmentVariables['GEMINI_BRIDGE_STATE']=`$statePath
if(`$LaunchNonce){`$psi.EnvironmentVariables['GEMINI_BRIDGE_LAUNCH_NONCE']=`$LaunchNonce}
`$proc=[Diagnostics.Process]::Start(`$psi)
if(-not `$proc){throw 'Could not start Gemini Bridge Host.'}
"@;[IO.File]::WriteAllText($launcher,$launcherText,(New-Object Text.UTF8Encoding($true)));if($script:CandidateLaunchNonce){& $launcher -LaunchNonce $script:CandidateLaunchNonce}else{& $launcher}}
function Verify-NewHost($cfg){$lastHealth=$null;$identityMismatch=$null;for($i=0;$i -lt 300;$i++){try{$h=Api 'GET' '/v1/health' $cfg $null 1;$lastHealth=$h;if($h.ok -eq $true -and $h.version -eq $Version -and [string]$h.gemini.version -match ('^v?'+[regex]::Escape([string]$script:AgentVersion)+'$') -and $h.host -and [string]$h.host.instanceId -match '^[a-f0-9]{32}$' -and [string]$h.host.launchNonce -eq [string]$script:CandidateLaunchNonce -and [int]$h.host.pid -gt 0 -and [string]$h.host.processIdentity -match '^win32:\d+$'){if(-not (Test-ExactProcessAlive ([int]$h.host.pid) ([string]$h.host.processIdentity))){$identityMismatch='candidate PID/process identity is not live'}else{$lock=Read-HostLockSafe;if(-not $lock -or [string]$lock.instanceId -ne [string]$h.host.instanceId -or [int]$lock.pid -ne [int]$h.host.pid -or [string]$lock.processIdentity -ne [string]$h.host.processIdentity -or [string]$lock.launchNonce -ne [string]$script:CandidateLaunchNonce){$identityMismatch='candidate health/lock identity mismatch'}else{$script:CandidateInstanceId=[string]$h.host.instanceId;$script:CandidateProcessId=[int]$h.host.pid;$script:CandidateProcessIdentity=[string]$h.host.processIdentity;return $h}}}elseif($h){$identityMismatch='candidate release/instance/launch nonce did not match this Setup transaction'}}catch{};Start-Sleep -Milliseconds 100};$startupFile=Join-Path $StateRoot 'host-startup-error.json';$detail='';if(Test-Path $startupFile){try{$x=Get-Content $startupFile -Raw|ConvertFrom-Json;if($x.error){$detail=[string]$x.error}}catch{}};if(-not $detail -and $identityMismatch){$detail=$identityMismatch};if(-not $detail -and $lastHealth -and $lastHealth.gemini -and $lastHealth.gemini.error){$detail=[string]$lastHealth.gemini.error};if($detail){Fail ("New Host failed runtime health verification: {0}" -f $detail)};Fail 'New Host did not reach health.ok=true within 30 seconds. No startup diagnostic was produced.'}
function Install-Shortcuts {
  Remove-Item (Join-Path $Desktop 'Gemini Bridge.url') -Force -ErrorAction SilentlyContinue;Remove-Item (Join-Path $Desktop 'Gemini Bridge Web Server.lnk') -Force -ErrorAction SilentlyContinue
  $launcher=Join-Path $LauncherRoot 'Start-Host-Hidden.ps1';$psExe=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe';$launcherArgs='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$launcher+'"';Shortcut (Join-Path $Startup 'Gemini Bridge Host.lnk') $psExe $launcherArgs $InstallRoot 'Starts Gemini Bridge Host in the background'
  Remove-Item (Join-Path $Desktop 'Gemini Bridge Sign-in.lnk') -Force -ErrorAction SilentlyContinue;Shortcut (Join-Path $Desktop 'Gemini Bridge.lnk') (Join-Path $InstallRoot 'Launch-Dashboard.cmd') '' $InstallRoot 'Open Gemini Bridge dashboard'
}
function Remove-BridgeShortcutsBestEffort {Remove-Item (Join-Path $Startup 'Gemini Bridge Host.lnk') -Force -ErrorAction SilentlyContinue;foreach($n in @('Gemini Bridge.url','Gemini Bridge Sign-in.lnk','Gemini Bridge.lnk','Gemini Bridge Web Server.lnk')){Remove-Item (Join-Path $Desktop $n) -Force -ErrorAction SilentlyContinue}}
function Restore-Program {
  if($script:ProgramBackupDir -and (Test-Path $script:ProgramBackupDir)){Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue;Move-Item -LiteralPath $script:ProgramBackupDir -Destination $InstallRoot;$script:ProgramBackupDir=$null}
  elseif(-not $script:HadProgramBefore -and (Test-Path $InstallRoot)){Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue;Remove-BridgeShortcutsBestEffort}
  if($script:ProgramStageDir -and (Test-Path $script:ProgramStageDir)){Remove-Item -LiteralPath $script:ProgramStageDir -Recurse -Force -ErrorAction SilentlyContinue};$script:ProgramStageDir=$null
}
function Restore-Extension {
  if($script:ExtensionBackupDir -and (Test-Path $script:ExtensionBackupDir)){Remove-Item -LiteralPath $MutableExtension -Recurse -Force -ErrorAction SilentlyContinue;Move-Item -LiteralPath $script:ExtensionBackupDir -Destination $MutableExtension;$script:ExtensionBackupDir=$null}
  elseif(-not $script:HadExtensionBefore -and (Test-Path $MutableExtension)){Remove-Item -LiteralPath $MutableExtension -Recurse -Force -ErrorAction SilentlyContinue}
  if($script:ExtensionStageDir -and (Test-Path $script:ExtensionStageDir)){Remove-Item -LiteralPath $script:ExtensionStageDir -Recurse -Force -ErrorAction SilentlyContinue};$script:ExtensionStageDir=$null
}
function Stop-CandidateBeforeRollback($cfg){
  if(-not $script:CandidateLaunchNonce){return};$h=$null;try{$h=Api 'GET' '/v1/health' $cfg $null 1}catch{}
  if($h){$hostInfo=Get-OptionalProperty $h 'host';$hostNonce=[string](Get-OptionalProperty $hostInfo 'launchNonce');$hostPid=Get-OptionalProperty $hostInfo 'pid';$hostIdentity=[string](Get-OptionalProperty $hostInfo 'processIdentity');if(-not $hostInfo -or $hostNonce -ne [string]$script:CandidateLaunchNonce -or -not $hostPid -or [string]::IsNullOrWhiteSpace($hostIdentity)){Fail 'ROLLBACK_CANDIDATE_OWNERSHIP_AMBIGUOUS: responding candidate identity does not match this Setup transaction.'};$processId=[int]$hostPid;$identity=$hostIdentity;if(Test-ExactProcessAlive $processId $identity){try{$null=Api 'POST' '/v1/shutdown' $cfg @{}}catch{Fail 'ROLLBACK_CANDIDATE_OWNERSHIP_AMBIGUOUS: exact candidate is live but authenticated shutdown failed.'};if(-not (Wait-ExactProcessExit $processId $identity 10000)){Fail 'ROLLBACK_CANDIDATE_OWNERSHIP_AMBIGUOUS: exact candidate did not exit.'}};return}
  $lock=Read-HostLockSafe;if(-not $lock){return};$pidValue=Get-OptionalProperty $lock 'pid';$identity=[string](Get-OptionalProperty $lock 'processIdentity');$nonce=[string](Get-OptionalProperty $lock 'launchNonce');if(-not $pidValue -or [string]::IsNullOrWhiteSpace($identity)){if($nonce -eq [string]$script:CandidateLaunchNonce){Remove-Item -LiteralPath (Join-Path $StateRoot 'host.lock.json') -Force -ErrorAction SilentlyContinue;return};Fail 'ROLLBACK_CANDIDATE_OWNERSHIP_AMBIGUOUS: rollback lock identity is incomplete.'};$processId=[int]$pidValue;if($nonce -eq [string]$script:CandidateLaunchNonce){if(Test-ExactProcessAlive $processId $identity){Fail 'ROLLBACK_CANDIDATE_OWNERSHIP_AMBIGUOUS: candidate is still live while authenticated API is unavailable.'};Remove-Item -LiteralPath (Join-Path $StateRoot 'host.lock.json') -Force -ErrorAction SilentlyContinue;return};if(Test-ExactProcessAlive $processId $identity){Fail 'ROLLBACK_CANDIDATE_OWNERSHIP_AMBIGUOUS: a different live Host owns the state during rollback.'}
}
function Rollback-Release($cfg){Stop-CandidateBeforeRollback $cfg;Restore-Program;Restore-State;Restore-Extension;Restore-Launcher;if($script:NewRuntimeDir){Remove-Item -LiteralPath $script:NewRuntimeDir -Recurse -Force -ErrorAction SilentlyContinue};if($script:RestartOldHostOnRollback){$restored=Read-RuntimeSafe;$restoredNode=[string](Get-OptionalProperty $restored 'nodePath');if($restored -and -not [string]::IsNullOrWhiteSpace($restoredNode) -and (Test-Path $InstallRoot)){try{$script:CandidateLaunchNonce=$null;Start-RestoredHost $restoredNode}catch{}};$script:RestartOldHostOnRollback=$false}}
function Commit-Release {$script:Committed=$true}
function Finalize-Release {if($script:ProgramBackupDir){Remove-Item -LiteralPath $script:ProgramBackupDir -Recurse -Force -ErrorAction SilentlyContinue};if($script:ExtensionBackupDir){Remove-Item -LiteralPath $script:ExtensionBackupDir -Recurse -Force -ErrorAction SilentlyContinue};if($script:LauncherBackupFile){Remove-Item -LiteralPath $script:LauncherBackupFile -Force -ErrorAction SilentlyContinue;$script:LauncherBackupFile=$null}}
function Test-GeminiCredentials([string]$node){$env:GEMINI_BRIDGE_STATE=$StateRoot;try{$raw=& $node (Join-Path $InstallRoot 'src\cli.mjs') auth-status;if($LASTEXITCODE -ne 0){return $false};$x=$raw|ConvertFrom-Json;return ($x.present -eq $true)}catch{return $false}}
function Invoke-Retention([string]$currentRuntime){
  try{
    $dirs=@(Get-ChildItem -LiteralPath $RuntimeBase -Directory -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending);$keep=@();$currentDir=$null
    foreach($d in $dirs){$prefix=$d.FullName.TrimEnd('\')+'\';if($currentRuntime.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){$currentDir=$d.FullName;break}}
    if($currentDir){$keep+=@($currentDir)};foreach($d in $dirs){if($keep.Count -ge 2){break};if($d.FullName -ne $currentDir){$keep+=@($d.FullName)}};foreach($d in $dirs){if($keep -notcontains $d.FullName){Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue}}
  }catch{}
  try{$backs=@(Get-ChildItem -LiteralPath $BackupRoot -Directory -Filter 'state-*' -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending);foreach($b in ($backs|Select-Object -Skip 5)){Remove-Item -LiteralPath $b.FullName -Recurse -Force -ErrorAction SilentlyContinue}}catch{}
}

$oldCfg=$null;$wasRunning=$false;$newCfg=$null
try{
  Stage 1 'Verify release and prerequisites';Info "Gemini Bridge $Version setup";Verify-ReleaseManifest $script:ReleaseRoot|Out-Null;Acquire-SetupMutex;Assert-AppOwnedRootsSafe;$node=Require-SinglePath (Ensure-Node) 'Node executable';New-Item -ItemType Directory -Force -Path $StateRoot|Out-Null
  $script:HadProgramBefore=Test-Path $InstallRoot;$script:HadExtensionBefore=Test-Path $MutableExtension;$script:HadLauncherBefore=Test-Path (Join-Path $LauncherRoot 'Start-Host-Hidden.ps1')
  Stage 2 'Quiesce existing Host and protect local state';Assert-AppOwnedRootsSafe;Assert-AppOwnedFileSafe (Join-Path $StateRoot 'runtime.json') 'runtime.json' $true;Assert-AppOwnedFileSafe (Join-Path $StateRoot 'host.lock.json') 'host.lock.json' $true;if($script:HadProgramBefore -and -not (Test-Path -LiteralPath (Join-Path $StateRoot 'bridge.sqlite') -PathType Leaf)){Fail 'Existing Gemini Bridge program is missing bridge.sqlite state. Run Restore/Repair instead of creating empty state during upgrade.'};$oldCfg=Read-RuntimeSafe;Assert-NoDowngrade $oldCfg;$wasRunning=Enter-MaintenanceIfRunning $oldCfg;if(-not $wasRunning -and (Lock-MatchesOrAmbiguousLiveHost)){Fail 'A live or ambiguously identified Gemini Bridge Host process still owns host.lock.json but authenticated API is unavailable. Close/reboot it normally, then retry; Setup will not modify program/state under an unverified live Host.'};Stop-AuthenticatedHost $oldCfg $wasRunning;Invoke-OfflineStateCheck $node|Out-Null;Backup-State
  Stage 3 'Acquire managed Antigravity runtime and stage program files';$entry=Require-SinglePath (Ensure-Antigravity $node $oldCfg) 'Antigravity CLI entry' $RuntimeBase;Stage-Release
  Stage 4 'Configure runtime and browser pairing';$env:GEMINI_BRIDGE_STATE=$StateRoot;$runtimeRaw=& $node (Join-Path $InstallRoot 'src\cli.mjs') setup-runtime;if($LASTEXITCODE -ne 0){Fail 'Bridge runtime initialization/repair failed.'};$newCfg=$runtimeRaw|ConvertFrom-Json;Write-RuntimeConfig $newCfg $node $entry;$newCfg=Read-RuntimeSafe;$paths=Assert-RuntimeConfigPaths $newCfg;$node=[string]$paths.nodePath;$entry=[string]$paths.geminiEntry;Install-MutableExtension $newCfg
  Stage 5 'Start and verify the exact new Host';$script:CandidateLaunchNonce=[guid]::NewGuid().ToString('N');Backup-Launcher;Start-BridgeHost $node;$null=Verify-NewHost $newCfg;Commit-Release;try{Install-Shortcuts}catch{Warn ("Core release committed, but shortcut refresh failed: {0}" -f $_.Exception.Message)};Ok ("Host verified on 127.0.0.1:{0}" -f [int]$newCfg.port);Finalize-Release;Invoke-Retention $entry;Ok "Installed to $InstallRoot"
  Stage 6 'Dashboard and Google sign-in readiness';$credentials=Test-GeminiCredentials $node;Start-Process (Join-Path $InstallRoot 'Launch-Dashboard.cmd');if(-not $credentials){Warn "`nGoogle sign-in is not active yet. Opened Dashboard: use its 'Sign in with Google' button to start Antigravity authentication directly."};Warn "`nOptional chatgpt.com panel: Chrome/Edge -> Extensions -> Developer mode -> Load unpacked -> select:";Write-Host $MutableExtension -ForegroundColor Cyan;Warn 'After a repair/token rotation, press Reload on that unpacked extension.';exit 0
}catch{
  $msg=$_.Exception.Message;if(-not $script:Committed){try{Rollback-Release $newCfg;Warn 'Pre-upgrade program/state/runtime configuration was restored where present.'}catch{Warn ("Automatic rollback failed closed: {0}. Preserved backups were not deleted." -f $_.Exception.Message)}}else{Warn 'Upgrade was already committed; cleanup/retention failure did not roll back the healthy installation.'};Exit-MaintenanceBestEffort $oldCfg;Write-Host "`nSetup failed: $msg" -ForegroundColor Red;exit 1
}finally{Release-SetupMutex}
