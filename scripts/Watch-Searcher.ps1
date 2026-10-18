$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$data = Join-Path $root '.data'
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
$quitFile = Join-Path $data 'quit-requested'
$logFile = Join-Path $data 'supervisor.log'
New-Item -ItemType Directory -Path $data -Force | Out-Null
function Write-Log($eventName, $details) {
    try {
        if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 1MB) {
            Move-Item -LiteralPath $logFile -Destination "$logFile.previous" -Force
        }
        @{ time = [DateTime]::UtcNow.ToString('o'); event = $eventName; details = $details; supervisorPid = $PID } | ConvertTo-Json -Compress | Add-Content -LiteralPath $logFile
    } catch {}
}
function Is-Enabled {
    try { return (Get-Content -LiteralPath (Join-Path $data 'settings.json') -Raw | ConvertFrom-Json).launchAtLogin -eq $true } catch { return $false }
}
# The scheduled task runs once per interactive sign-in. The next sign-in resumes
# protection even if the user deliberately quit during the previous session.
Remove-Item -LiteralPath $quitFile -Force -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:SEARCHER_SMOKE -ErrorAction SilentlyContinue
Write-Log 'supervisor-start' $null
$failures = 0
while (Is-Enabled) {
    $started = Get-Date
    try {
        # Adopt a manually launched main process, rather than launching a duplicate.
        $existing = Get-CimInstance Win32_Process | Where-Object {
            $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '--type=|worker\.cjs'
        } | Select-Object -First 1
        if ($existing) {
            $child = Get-Process -Id $existing.ProcessId -ErrorAction Stop
            Write-Log 'adopted-app' $existing.ProcessId
        } else {
            $child = Start-Process -FilePath $exe -ArgumentList ('"{0}" --background' -f $root) -WorkingDirectory $root -WindowStyle Hidden -PassThru
            Write-Log 'launched-app' $child.Id
        }
        $child.WaitForExit()
        $child.Refresh()
        Write-Log 'app-exit' @{ pid = $child.Id; code = $child.ExitCode }
    } catch { Write-Log 'launch-or-wait-error' $_.Exception.Message }
    if (Test-Path -LiteralPath $quitFile) { Write-Log 'user-quit' $null; break }
    if (-not (Is-Enabled)) { break }
    if (((Get-Date) - $started).TotalSeconds -gt 60) { $failures = 0 }
    $failures++
    $delay = [Math]::Min(60, [Math]::Pow(2, [Math]::Min(6, $failures)))
    Write-Log 'restart-scheduled' @{ delaySeconds = $delay }
    Start-Sleep -Seconds $delay
}
Write-Log 'supervisor-exit' $null
