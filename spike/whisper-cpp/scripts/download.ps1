$ErrorActionPreference="Continue"
$work="D:\Interview APP\spike-whispercpp"
$log="$work\logs\download.log"
function L($m){ Add-Content -Path $log -Value ("$([DateTime]::Now.ToString('HH:mm:ss')) $m") }
Set-Content -Path $log -Value "start" -Encoding ascii
$items = @(
  @{u="https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.5/whisper-cublas-12.4.0-bin-x64.zip"; o="$work\bin\whisper-cuda.zip"},
  @{u="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin"; o="$work\models\ggml-medium-q5_0.bin"},
  @{u="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q8_0.bin"; o="$work\models\ggml-medium-q8_0.bin"},
  @{u="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"; o="$work\models\ggml-large-v3-turbo-q5_0.bin"}
)
foreach($it in $items){
  L "START $($it.o)"
  & curl.exe -L --fail --retry 5 -C - -o $it.o $it.u 2>$null
  if($LASTEXITCODE -eq 0){ $sz=[math]::Round((Get-Item $it.o).Length/1MB,1); L "DONE $($it.o) ${sz}MB" } else { L "FAIL exit=$LASTEXITCODE $($it.o)" }
}
Set-Content -Path "$work\logs\ALL_DONE.marker" -Value "ALL_DONE" -Encoding ascii
L "ALL_DONE"
