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
if(-not $cfg.nodePath){throw 'Gemini Bridge runtime is incomplete. Run Setup/Repair first.'}
$node=[string]$cfg.nodePath
$env:GEMINI_BRIDGE_STATE=$State
Write-Host 'Gemini Bridge Google sign-in' -ForegroundColor Cyan
Write-Host 'Sign in with the Google account that has Google AI Pro. When authentication is complete, you may close Gemini with Ctrl+C.'
& $node (Join-Path $Root 'src\auth.mjs')
$authCode=$LASTEXITCODE
$credentials=$false
try{
  $raw=& $node (Join-Path $Root 'src\cli.mjs') auth-status
  if($LASTEXITCODE -eq 0){$status=$raw|ConvertFrom-Json;$credentials=($status.present -eq $true)}
}catch{$credentials=$false}
if($credentials){
  Write-Host 'Gemini Bridge credentials are present in the isolated OAuth profile.' -ForegroundColor Green
  exit 0
}
if($authCode -ne 0){Write-Host ("Gemini sign-in ended with code {0} and no local OAuth credentials were found. Run this sign-in shortcut again when ready." -f $authCode) -ForegroundColor Yellow;exit $authCode}
Write-Host 'Gemini sign-in is incomplete or was cancelled: no local OAuth credentials were found. Run this sign-in shortcut again when ready.' -ForegroundColor Yellow
exit 2
