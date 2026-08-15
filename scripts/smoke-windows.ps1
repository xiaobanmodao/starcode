param(
  [Parameter(Mandatory = $true)]
  [string]$PackagedAppDir,
  [Parameter(Mandatory = $true)]
  [string]$MakeDir
)

$ErrorActionPreference = 'Stop'
$verifyScript = Join-Path $PSScriptRoot 'verify-windows-package.mjs'
& node $verifyScript $PackagedAppDir $MakeDir
if ($LASTEXITCODE -ne 0) { throw "Windows 打包资源检查失败（$LASTEXITCODE）。" }

function Get-DescendantProcessIds {
  param([int]$RootProcessId)

  $descendants = [System.Collections.Generic.HashSet[int]]::new()
  $pending = [System.Collections.Generic.Queue[int]]::new()
  $pending.Enqueue($RootProcessId)
  while ($pending.Count -gt 0) {
    $parentProcessId = $pending.Dequeue()
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $parentProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
      $childProcessId = [int]$child.ProcessId
      if ($descendants.Add($childProcessId)) {
        $pending.Enqueue($childProcessId)
      }
    }
  }
  return @($descendants)
}

function Add-ProcessTreeToSet {
  param(
    [int]$RootProcessId,
    [System.Collections.Generic.HashSet[int]]$Target
  )

  [void]$Target.Add($RootProcessId)
  foreach ($processId in Get-DescendantProcessIds -RootProcessId $RootProcessId) {
    [void]$Target.Add($processId)
  }
}

$executable = Join-Path $PackagedAppDir 'StarCode.exe'
$application = $null
$trackedProcessIds = [System.Collections.Generic.HashSet[int]]::new()
try {
  $application = Start-Process -FilePath $executable -ArgumentList '--smoke-test' -PassThru
  for ($iteration = 0; $iteration -lt 20; $iteration += 1) {
    Add-ProcessTreeToSet -RootProcessId $application.Id -Target $trackedProcessIds
    Start-Sleep -Milliseconds 250
    if ($application.HasExited) {
      throw "StarCode 在冒烟测试等待期间提前退出，代码 $($application.ExitCode)。"
    }
  }
  Write-Host "Windows 启动冒烟测试通过，PID $($application.Id)。"
}
finally {
  if ($null -ne $application) {
    if (-not $application.HasExited) {
      Add-ProcessTreeToSet -RootProcessId $application.Id -Target $trackedProcessIds
      $taskkill = Start-Process -FilePath 'taskkill.exe' `
        -ArgumentList @('/PID', "$($application.Id)", '/T', '/F') `
        -PassThru -Wait -NoNewWindow
      if ($taskkill.ExitCode -ne 0 -and $null -ne (Get-Process -Id $application.Id -ErrorAction SilentlyContinue)) {
        throw "无法终止 StarCode 进程树，taskkill 退出代码 $($taskkill.ExitCode)。"
      }
    }

    foreach ($processId in $trackedProcessIds) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
      $remainingProcessIds = @(
        foreach ($processId in $trackedProcessIds) {
          if ($null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { $processId }
        }
      )
      if ($remainingProcessIds.Count -eq 0) { break }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)

    if ($remainingProcessIds.Count -gt 0) {
      throw "Windows 冒烟测试清理失败，仍有残留进程：$($remainingProcessIds -join ', ')。"
    }
  }
}
