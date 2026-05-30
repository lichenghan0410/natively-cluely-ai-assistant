# whisper.cpp spike — binary & model manifest

本目录脚本与结果已纳入版本管理；**binary 与 ggml 模型体积过大，不入库**，运行时放在仓库外的 `D:\Interview APP\spike-whispercpp\` （非版本管理）。

## whisper.cpp binary

- 版本: v1.8.5 (ggml-org/whisper.cpp, 预编译)
- CPU 包: whisper-bin-x64.zip (3.9MB)
- CUDA 包: whisper-cublas-12.4.0-bin-x64.zip (438.5MB, 含 cudart/cublas DLL)
- 来源: https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.5

## ggml 模型 (来源: https://huggingface.co/ggerganov/whisper.cpp)

| 文件 | 大小 |
|---|---|
| ggml-large-v3-turbo-q5_0.bin | 547.4 MB |
| ggml-medium-q5_0.bin | 514.2 MB |
| ggml-medium-q8_0.bin | 785.2 MB |

