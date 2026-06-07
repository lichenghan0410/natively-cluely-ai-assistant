# whisper.cpp Windows spike runner — ADR-003
# Runs each (backend x model x sample), captures wall-clock + whisper.cpp timings + CER.
param(
  [string]$Work = 'D:\Interview APP\spike-whispercpp'
)
$ErrorActionPreference = 'Continue'
$audioDir = "$Work\audio"
$gtDir    = 'D:\Interview APP\TEST FILE'
$outDir   = "$Work\results"
$tmpDir   = "$Work\tmp"
New-Item -ItemType Directory -Force -Path $outDir,$tmpDir | Out-Null
$score = "$Work\scripts\score.js"

$samples = @(
  @{ name='Part1-Interview-q1';        dur=10.784 },
  @{ name='Part3-Speech-q1';           dur=27.264 },
  @{ name='Part4-Graph Presentation-q1'; dur=30.965 },
  @{ name='Part5-Role Play-q1';        dur=47.569 }
)

# locate exes
$cpuExe  = Get-ChildItem "$Work\bin\cpu"  -Recurse -Filter 'whisper-cli.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
$cudaExe = Get-ChildItem "$Work\bin\cuda" -Recurse -Filter 'whisper-cli.exe' -ErrorAction SilentlyContinue | Select-Object -First 1

$backends = @()
if ($cpuExe)  { $backends += @{ label='cpu';  exe=$cpuExe.FullName;  extra=@('-t','8') } }
if ($cudaExe) { $backends += @{ label='cuda'; exe=$cudaExe.FullName; extra=@('-t','8') } }

$models = @(
  @{ id='medium-q5_0';          path="$Work\models\ggml-medium-q5_0.bin" },
  @{ id='medium-q8_0';          path="$Work\models\ggml-medium-q8_0.bin" },
  @{ id='large-v3-turbo-q5_0';  path="$Work\models\ggml-large-v3-turbo-q5_0.bin" }
)

$results = @()
foreach ($b in $backends) {
  foreach ($m in $models) {
    if (-not (Test-Path $m.path)) { Write-Host "skip model missing: $($m.path)"; continue }
    # warmup (discarded) — pays one-time CUDA PTX JIT + disk cache so timed runs are warm-vs-warm with Medium
    $warmArgs = @('-m',$m.path,'-l','ja','-f',"$audioDir\Part1-Interview-q1.wav",'-nt') + $b.extra
    & $($b.exe) @warmArgs 2>$null | Out-Null
    foreach ($s in $samples) {
      $wav = "$audioDir\$($s.name).wav"
      $ofBase = "$tmpDir\$($b.label)_$($m.id)_$($s.name)"
      $errLog = "$ofBase.stderr.txt"
      $cliArgs = @('-m',$m.path,'-l','ja','-f',$wav,'-nt','-otxt','-of',$ofBase) + $b.extra
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $stderr = & $($b.exe) @cliArgs 2>&1 | Out-String
      $sw.Stop()
      Set-Content -Path $errLog -Value $stderr -Encoding UTF8
      $wallMs = [math]::Round($sw.Elapsed.TotalMilliseconds)
      $loadMs = if ($stderr -match 'load time\s*=\s*([\d.]+)\s*ms') { [double]$Matches[1] } else { $null }
      $totalMs = if ($stderr -match 'total time\s*=\s*([\d.]+)\s*ms') { [double]$Matches[1] } else { $null }
      $encMs  = if ($stderr -match 'encode time\s*=\s*([\d.]+)\s*ms') { [double]$Matches[1] } else { $null }
      # whisper.cpp 'total time' EXCLUDES model load (load is a separate counter).
      # In production whisper.cpp runs as a persistent subprocess (model loaded once),
      # so per-segment final latency == total time. This is the warm-vs-warm comparable
      # to the Medium harness (which measured a warm worker, model already loaded).
      $inferMs = if ($totalMs -ne $null) { [math]::Round($totalMs) } else { $wallMs }
      $hyp = ''
      if (Test-Path "$ofBase.txt") { $hyp = (Get-Content "$ofBase.txt" -Raw -Encoding UTF8) }
      $gtFile = "$gtDir\$($s.name)-text.txt"
      $cerJson = & node $score --file $gtFile "$ofBase.txt" 2>&1 | Out-String
      $cer = $null; try { $cer = $cerJson.Trim() | ConvertFrom-Json } catch {}
      $rtf = if ($inferMs) { [math]::Round($inferMs / ($s.dur*1000), 3) } else { $null }
      $crash = ($LASTEXITCODE -ne 0) -or ($hyp.Trim().Length -eq 0)
      $row = [ordered]@{
        backend=$b.label; model=$m.id; sample=$s.name; audioSec=$s.dur;
        wallMs=$wallMs; loadMs=$loadMs; inferMs=$inferMs; encodeMs=$encMs; rtf=$rtf;
        cerPct=($cer.cerPct); editDistance=($cer.editDistance); refLen=($cer.refLen); hypLen=($cer.hypLen);
        emptyOrCrash=$crash; transcript=$hyp.Trim()
      }
      $results += (New-Object PSObject -Property $row)
      Write-Host ("[{0}/{1}] {2}  infer={3}ms rtf={4} cer={5}%" -f $b.label,$m.id,$s.name,$inferMs,$rtf,$cer.cerPct)
    }
  }
}

$meta = [ordered]@{
  timestamp = (Get-Date).ToString('o')
  host = $env:COMPUTERNAME
  backends = ($backends | ForEach-Object { $_.label })
  models = ($models | ForEach-Object { $_.id })
  whisperCppVersion = 'v1.8.5'
}
$out = [ordered]@{ meta=$meta; runs=$results }
$ts = (Get-Date).ToString('yyyy-MM-ddTHH-mm-ss')
$outPath = "$outDir\whispercpp-$ts.json"
$out | ConvertTo-Json -Depth 6 | Set-Content -Path $outPath -Encoding UTF8
Copy-Item $outPath "$outDir\whispercpp-latest.json" -Force
"SPIKE_DONE $outPath" | Out-File "$Work\logs\SPIKE_DONE.marker" -Encoding ascii
Write-Host "SPIKE_DONE $outPath"
