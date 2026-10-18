param([switch]$Disable)
$ErrorActionPreference = 'Stop'
$taskName = 'Searcher'
$root = Split-Path $PSScriptRoot -Parent
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($Disable) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
} else {
    $supervisor = Join-Path $PSScriptRoot 'Watch-Searcher.ps1'
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $supervisor) -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
    $principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts Searcher at sign-in and restarts it after unexpected exits. Quit Searcher stops it until the next sign-in or manual launch.' -Force | Out-Null
}
# Migrate only our old generic Electron startup entry; leave other apps alone.
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$legacy = (Get-Item $run).GetValue('electron.app.Electron')
if ($legacy -and $legacy.Contains($root)) {
    Remove-ItemProperty -Path $run -Name 'electron.app.Electron'
}
