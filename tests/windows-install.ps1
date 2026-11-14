$ErrorActionPreference = 'Stop'
$qaInstaller = (Resolve-Path 'dist/OpenCluely-General-Setup-1.1.1.exe').Path
$qaInstallDir = Join-Path $env:RUNNER_TEMP 'OpenCluely-General-Install'
$qaResult = Start-Process -FilePath $qaInstaller -ArgumentList @('/S', "/D=$qaInstallDir") -Wait -PassThru
if ($qaResult.ExitCode -ne 0) {
  Get-WinEvent -FilterHashtable @{LogName='Application';Id=1000,1001;StartTime=(Get-Date).AddMinutes(-3)} -ErrorAction SilentlyContinue | Select-Object -First 4 -ExpandProperty Message | Write-Output
  throw "Installer failed: $($qaResult.ExitCode)"
}
if (!(Test-Path (Join-Path $qaInstallDir 'OpenCluely.exe'))) { throw 'Installed application executable missing' }
$qaEntry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -eq 'OpenCluely General' }
if (!$qaEntry) { throw 'Application missing from Windows Installed apps registry' }
if (!$qaEntry.UninstallString) { throw 'Uninstall registration missing' }
$qaPrograms = [Environment]::GetFolderPath('Programs')
if (!(Test-Path (Join-Path $qaPrograms 'OpenCluely General.lnk'))) { throw 'Start menu shortcut missing' }
$qaDesktop = [Environment]::GetFolderPath('Desktop')
if (!(Test-Path (Join-Path $qaDesktop 'OpenCluely General.lnk'))) { throw 'Desktop shortcut missing' }
Write-Output 'Installer verified: application executable, Installed apps entry, uninstaller, Start menu and desktop shortcuts.'
$qaUninstaller = Join-Path $qaInstallDir 'Uninstall OpenCluely.exe'
if (!(Test-Path $qaUninstaller)) { throw 'Uninstaller executable missing' }
$qaRemoval = Start-Process -FilePath $qaUninstaller -ArgumentList '/S' -Wait -PassThru
if ($qaRemoval.ExitCode -ne 0) { throw "Uninstaller failed: $($qaRemoval.ExitCode)" }
for ($qaAttempt=0; $qaAttempt -lt 30; $qaAttempt++) {
  $qaRemaining = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -eq 'OpenCluely General' }
  if (!$qaRemaining) { break }
  Start-Sleep -Milliseconds 200
}
if ($qaRemaining) { throw 'Installed apps entry remains after uninstall' }
Write-Output 'Uninstall verified: Installed apps registration removed.'
