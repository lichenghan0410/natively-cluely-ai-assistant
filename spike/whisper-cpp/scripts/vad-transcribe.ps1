# Transcribe each Part3 VAD segment with whisper.cpp (CUDA) and score concatenated CER.
param([string]$Work='D:\Interview APP\spike-whispercpp')
$ErrorActionPreference='Continue'
$exe = (Get-ChildItem "$Work\bin\cuda" -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1).FullName
$segDir = "$Work\vad-replay"
$gtFile = 'D:\Interview APP\TEST FILE\Part3-Speech-q1-text.txt'
$score  = "$Work\scripts\score.js"
$segs = (Get-Content "$segDir\segments.json" -Raw | ConvertFrom-Json).segments
$models = @(
  @{ id='large-v3-turbo-q5_0'; path="$Work\models\ggml-large-v3-turbo-q5_0.bin" },
  @{ id='medium-q5_0';         path="$Work\models\ggml-medium-q5_0.bin" },
  @{ id='medium-q8_0';         path="$Work\models\ggml-medium-q8_0.bin" }
)
$report = @()
foreach ($m in $models) {
  # warmup (discard) to pay any JIT
  & $exe -m $m.path -l ja -f $segs[0].wav -nt -t 8 2>$null | Out-Null
  $parts = @()
  foreach ($s in $segs) {
    $of = "$segDir\$($m.id)_$($s.name)"
    & $exe -m $m.path -l ja -f $s.wav -nt -t 8 -otxt -of $of 2>$null | Out-Null
    $t = if (Test-Path "$of.txt") { (Get-Content "$of.txt" -Raw -Encoding UTF8).Trim() } else { '' }
    $parts += $t
    Write-Host ("[{0}] {1} ({2}s): {3}" -f $m.id,$s.name,$s.durationSec,$t)
  }
  $concat = ($parts -join '')
  $hf = "$segDir\concat_$($m.id).txt"
  Set-Content -Path $hf -Value $concat -Encoding UTF8
  $cer = & node $score --file $gtFile $hf 2>&1 | Out-String
  $cerObj = $null; try { $cerObj = ($cer.Trim()) | ConvertFrom-Json } catch {}
  Write-Host ("  => {0} concatenated CER = {1}%`n" -f $m.id,$cerObj.cerPct)
  $report += [ordered]@{ model=$m.id; segCount=$segs.Count; concatCerPct=$cerObj.cerPct; editDistance=$cerObj.editDistance; refLen=$cerObj.refLen; segments=($segs | ForEach-Object { $_.name }); transcripts=$parts; concat=$concat }
}
$out = [ordered]@{ test='Part3 production VAD replay'; segCount=$segs.Count; segDurations=($segs | ForEach-Object { $_.durationSec }); results=$report }
$out | ConvertTo-Json -Depth 6 | Set-Content -Path "$segDir\vad-replay-results.json" -Encoding UTF8
Write-Host ("saved " + "$segDir\vad-replay-results.json")
