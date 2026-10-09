# The Node helper preserves exact bytes and owns only its recorded block/link.
# Requires Node >=20; PowerShell 5.1 and 7 are both supported.
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot 'tools\install-state.mjs'
$arguments = @($helper, '--home', $DshHome, '--profile', $Profile)
if ($Uninstall) { $arguments += '--uninstall' }
& node @arguments
exit $LASTEXITCODE
