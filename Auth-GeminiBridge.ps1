$ErrorActionPreference='Stop'
Set-StrictMode -Version 2
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$State=Join-Path $env:LOCALAPPDATA 'GeminiBridge\state-v3'
function Assert-AppOwnedFileSafe([string]$path,[string]$label,[bool]$AllowMissing=$false){
  if(-not (Test-Path -LiteralPath $path)){if($AllowMissing){return};throw ("{0} is missing. Run Setup/Repair first." -f $label)}
  $item=Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($item.PSObject.Properties.Name -contains 'LinkType' -and $item.LinkType)){throw ("{0} is a reparse/junction/symlink or non-file. Run Setup/Repair first." -f $label)}
}
$RuntimeFile=Join-Path $State 'runtime.json'
Assert-AppOwnedFileSafe $RuntimeFile 'runtime.json'
$cfg=Get-Content $RuntimeFile -Raw|ConvertFrom-Json
if(-not $cfg.nodePath -or -not $cfg.geminiEntry){throw 'Gemini Bridge runtime is incomplete. Run Setup/Repair first.'}
$node=[string]$cfg.nodePath
$env:GEMINI_BRIDGE_STATE=$State
Write-Host 'Gemini Bridge Google sign-in (Antigravity)' -ForegroundColor Cyan
Write-Host 'A separate Antigravity window/browser will open. Complete Google sign-in there.'
& $node (Join-Path $Root 'src\auth.mjs')
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
for($i=0;$i -lt 60;$i++){
  try{$raw=& $node (Join-Path $Root 'src\cli.mjs') auth-status;if($LASTEXITCODE -eq 0){$status=$raw|ConvertFrom-Json;if($status.authenticated -eq $true -or $status.present -eq $true){Write-Host 'Google is connected through Antigravity.' -ForegroundColor Green;exit 0}}}catch{}
  Start-Sleep -Seconds 2
}
Write-Host 'Google sign-in was not detected yet. You can finish it and use the Dashboard button to check again.' -ForegroundColor Yellow
exit 2
