# Reads the Windows media controls (SMTC) and prints one JSON line whenever something changes.
# Runs in the built-in Windows PowerShell 5.1 – no modules, no compiling.
# Lines: {"type":"ready"} | {"type":"state",...} | {"type":"error","message":"..."}
# $ParentPid and $CoverDir are prepended by smtc-watcher.js.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 3)); [Console]::Out.Flush() }

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait(3000)) { throw 'timeout' }
    $task.Result
  }
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $script:readerCtor = [Windows.Storage.Streams.DataReader].GetConstructor([Type[]]@([Windows.Storage.Streams.IInputStream]))
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $manager = Await ($mgrType::RequestAsync()) $mgrType
} catch {
  Emit @{ type = 'error'; message = "SMTC not available: $($_.Exception.Message)" }
  exit 2
}
Emit @{ type = 'ready' }

if (-not (Test-Path $CoverDir)) { New-Item -ItemType Directory -Path $CoverDir | Out-Null }

# Saves the cover thumbnail of the current track as a file and returns its path ('' if none)
function Save-Cover($props, [string]$key) {
  try {
    if (-not $props.Thumbnail) { return '' }
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hash = [BitConverter]::ToString($md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($key))).Replace('-', '').Substring(0, 16)
    $existing = Get-ChildItem $CoverDir -Filter "$hash.*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing) { return $existing.FullName }
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    # PowerShell 5.1 cannot cast the WinRT stream directly – reflection does the interface lookup for us
    $reader = $script:readerCtor.Invoke(@($stream))
    $count = Await ($reader.LoadAsync(16777216)) ([uint32])
    if ($count -lt 16) { return '' }
    $bytes = New-Object byte[] $count
    $reader.ReadBytes($bytes)
    $ext = if ($bytes[0] -eq 0x89) { 'png' } elseif ($bytes[0] -eq 0xFF) { 'jpg' } else { 'img' }
    $file = Join-Path $CoverDir "$hash.$ext"
    [System.IO.File]::WriteAllBytes($file, $bytes)
    # keep the cover folder small: only the 30 newest files
    Get-ChildItem $CoverDir -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -ErrorAction SilentlyContinue
    return $file
  } catch { return '' }
}

# Prefer a session that is actually playing; otherwise Windows' "current" session
function Pick-Session {
  $sessions = @($manager.GetSessions())
  foreach ($s in $sessions) {
    try { if ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { return $s } } catch {}
  }
  return $manager.GetCurrentSession()
}

$lastKey = ''; $lastStatus = ''; $lastPos = 0; $lastEmit = [DateTime]::MinValue; $cover = ''; $lastActive = $null

while ($true) {
  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
  try {
    $s = Pick-Session
    if ($null -eq $s) {
      if ($lastActive -ne $false) { Emit @{ type = 'state'; active = $false }; $lastActive = $false; $lastKey = '' }
    } else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
      $tl = $s.GetTimelineProperties()
      $status = $s.GetPlaybackInfo().PlaybackStatus.ToString()
      $pos = $tl.Position.TotalMilliseconds
      # The position is only updated now and then: extrapolate it to "now" while playing
      if ($status -eq 'Playing' -and $tl.LastUpdatedTime.Year -gt 2000) {
        $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalMilliseconds
      }
      $dur = $tl.EndTime.TotalMilliseconds
      if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
      $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
      if ($key -ne $lastKey) { $cover = Save-Cover $p $key }

      $now = [DateTime]::UtcNow
      $expected = $lastPos + $(if ($status -eq 'Playing') { ($now - $lastEmit).TotalMilliseconds } else { 0 })
      $jumped = [Math]::Abs($pos - $expected) -gt 1500
      if ($key -ne $lastKey -or $status -ne $lastStatus -or $jumped -or ($now - $lastEmit).TotalSeconds -ge 5) {
        Emit @{
          type = 'state'; active = [bool]$p.Title; title = [string]$p.Title; artist = [string]$p.Artist
          album = [string]$p.AlbumTitle; status = $status; positionMs = [Math]::Round($pos)
          durationMs = [Math]::Round($dur); app = [string]$s.SourceAppUserModelId; cover = $cover
          sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        }
        $lastKey = $key; $lastStatus = $status; $lastPos = $pos; $lastEmit = $now; $lastActive = $true
      }
    }
  } catch {
    # a player closing mid-query throws – just try again next round
  }
  Start-Sleep -Milliseconds 400
}
