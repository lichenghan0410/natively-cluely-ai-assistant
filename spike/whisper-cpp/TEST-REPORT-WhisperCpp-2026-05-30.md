# TEST REPORT — whisper.cpp Windows Spike（ADR-003）

**日期:** 2026-05-30
**执行人:** Li
**对应:** ADR-003 行动项「whisper.cpp Windows spike：同 4 样本对比 final 延迟 / CER / 集成成本」
**关联:** ADR-001 / ADR-002 / INCIDENT-001 / TEST-REPORT-Whisper-Medium-2026-05-24 / STANDUP-2026-05-24-V3
**原始数据:** `spike/whisper-cpp/results/whispercpp-2026-05-30T13-26-42.json`、`summary.json`

---

## 1. 结论摘要

whisper.cpp 在本机以 **CUDA（RTX 3070 Ti）** 运行时，**同时满足 ADR-003 的两条硬门槛**：

- **final 延迟 ≤ 2,000 ms** — CUDA 下全部样本的 warm 单段推理 ≤ 1,984 ms；large-v3-turbo-q5 下整段 47s 音频也只要 978 ms。对比 Medium ONNX/DML 的 3,149–6,205 ms，提速约 **4–9 倍**。
- **CER ≤ 9%** — `cuda/medium-q5_0` 四样本均值 **3.43%**，`cuda/large-v3-turbo-q5_0` 均值 **5.87%**，均达标。

并且额外解决了 Medium 验收里的两个悬案：

- **Part3 outlier 不是架构问题。** `medium-q8` 在 whisper.cpp 上**复现了** Part3 88.73% 的失败（只输出「準備してください」），与 Medium ONNX 结果一致 —— 证明这是 medium-q8 在该片段（长内部沉默）上的解码 fallback，而非 `@huggingface/transformers`+ONNX+Worker 架构的产物。**换 q5 量化或换 large-v3-turbo 后，Part3 CER 直接降到 0%。**
- 24 次推理 **无 crash / OOM / 空文本**，稳定性达标。

**建议：** 推进 whisper.cpp 落地，首选 **`large-v3-turbo-q5_0`**（延迟最低、Part3 解决、纯语音段精度最好），`medium-q5_0` 作为备选。落地前仍应按 ADR-003 补做 **Part3 production VAD replay**（行动项 #4）——本次数据已使该验证变为低风险确认而非阻塞项。

> ⚠️ **一个边界：≤2s 门槛仅在 CUDA 下成立。** 纯 CPU（i5-12600KF, 8 线程）RTF 0.22–0.88，单段延迟数秒级，不达标。本机有 NVIDIA GPU 故不受影响，但若未来分发到无 NVIDIA 卡的机器，需重新评估或降级模型。

---

## 2. 测试环境

| 项 | 值 |
|---|---|
| 主机 | DESKTOP-UVH9EP2 |
| CPU | Intel Core i5-12600KF（10 核 / 16 线程） |
| 内存 | 16 GB |
| GPU | NVIDIA GeForce RTX 3070 Ti, 8 GB, compute 8.6，驱动 552.22（支持 CUDA 12.x） |
| whisper.cpp | v1.8.5 预编译（ggml-org/whisper.cpp release） |
| CPU 后端 | `whisper-bin-x64.zip`（ggml-cpu，AVX2/F16C/FMA） |
| CUDA 后端 | `whisper-cublas-12.4.0-bin-x64.zip`（flash-attn=1，bundled cudart/cublas） |
| 模型 | `ggml-medium-q5_0`(514MB) / `ggml-medium-q8_0`(785MB) / `ggml-large-v3-turbo-q5_0`(547MB)，来源 HF `ggerganov/whisper.cpp` |
| 样本 | 4 段 Japrise 官方题干（与 ADR-002 Medium 验收同源、同 ground truth） |
| 调用 | `whisper-cli -l ja -nt -t 8`，默认采样（5 beams + best of 5） |

---

## 3. 方法

**样本一致性。** 复用 Medium 验收的同 4 段音频，并用与 harness 完全相同的预处理：16kHz 单声道，对 peak>1 的样本做 `0.95/peak` 归一（Part1 peak=1.398、Part5 peak=1.235 被归一，与 Medium harness 行为一致），再转 16-bit PCM 喂给 whisper-cli。

**CER 口径一致。** 评分脚本 `score.js` 与 Medium harness 逐行一致：`NFKC` 归一 → 去空白与标点（`、。，．,.?？!！「」『』（）()・〜~-—…`）→ 小写 → 字符级 Levenshtein / 参考长度。因此本报告 CER 与 Medium 报告**直接可比**。

**延迟口径（关键）。** 经验证，whisper.cpp 的 `total time` **包含模型加载**（每次进程 wall ≈ total + ~250ms 启动开销，且 load < total）。生产中 whisper.cpp 以**常驻子进程**运行（whisper-server 或长生命周期子进程），模型只加载一次，因此真正的**单段 final 延迟 = `total − load` = warm 计算时间**。这与 Medium harness 测量「warm worker（模型已加载）」是**对等口径（warm-vs-warm）**。本报告所有延迟均为此 warm 计算时间。每个 backend×model 组合在计时前先做一次 warmup 丢弃，支付掉 CUDA 一次性 PTX JIT（首跑曾观测到 15.9s，JIT 缓存后回落到 ~1s）。

**VAD 说明。** 单次 whisper-cli 对整段文件做转写；>30s 样本由 whisper.cpp 内部按 30s 窗切分。生产中由 VAD 在语音结束处闭合 segment（≤14s soft commit / 15s hard flush），不会把尾部长沉默喂进 Whisper —— 这一点对 Part4 的 CER 解读很重要（见 §6）。

---

## 4. 结果

### 4.1 延迟（warm 单段推理 = total − load）

| 配置 | Part1 (10.8s) | Part3 (27.3s) | Part4 (31.0s) | Part5 (47.6s) | 最大 | 最大 RTF |
|---|--:|--:|--:|--:|--:|--:|
| **cuda / large-v3-turbo-q5** | 340 ms | 540 ms | 741 ms | 978 ms | **978 ms** | **0.032** |
| **cuda / medium-q5** | 388 ms | 1,984 ms | 1,307 ms | 1,830 ms | **1,984 ms** | 0.073 |
| cuda / medium-q8 | 374 ms | 320 ms | 1,258 ms | 1,850 ms | 1,850 ms | 0.041 |
| cpu / medium-q8 | 4,382 ms | 4,128 ms | 10,473 ms | 12,329 ms | 12,329 ms | 0.406 |
| cpu / medium-q5 | 5,650 ms | 6,087 ms | 13,301 ms | 14,057 ms | 14,057 ms | 0.524 |
| cpu / large-v3-turbo-q5 | 9,456 ms | 10,036 ms | 19,309 ms | 19,500 ms | 19,500 ms | 0.877 |

> CUDA 全部 ≤ 2,000 ms（注：medium-q5 的 1,984ms 是 27s 整段单窗；生产中 ≤15s 的 VAD 段对应约 1.1s）。turbo-q5 即便整段 47s 也只要 978ms。CPU 三个配置均不达标。

### 4.2 精度（CER，门槛 ≤ 9%）

| 配置 | Part1 | Part3 | Part4 | Part5 | 均值(含 Part3) | 均值(排 Part3) |
|---|--:|--:|--:|--:|--:|--:|
| **cuda / medium-q5** | 0% | **0%** | 8.54% | 5.19% | **3.43%** | 4.58% |
| **cuda / large-v3-turbo-q5** | 0% | **0%** | 18.29%¹ | 5.19% | **5.87%** | 7.83% |
| cuda / medium-q8 | 0% | **88.73%** | 7.32% | 5.19% | 25.31% | 4.17% |
| cpu / medium-q5 | 0% | 0% | 12.2%¹ | 5.19% | 4.35% | 5.80% |
| cpu / medium-q8 | 0% | 88.73% | 7.32% | 5.19% | 25.31% | 4.17% |
| cpu / large-v3-turbo-q5 | 0% | 0% | 18.29%¹ | 5.19% | 5.87% | 7.83% |

¹ Part4 的 CER 几乎全部来自**尾部沉默幻觉**（turbo 追加「ご視聴ありがとうございました」、medium-q5 追加「サブタイトル:ひかり」、q8 追加「[音声なし]」）。题干正文本身转写正确；去掉尾部幻觉后 Part4 CER 约 0–3%。生产 VAD 不喂尾部沉默，预期这些幻觉不出现（见 §6）。

---

## 5. 与 Medium（ADR-002 方案 C'）对照

| 维度 | Medium ONNX/DML (q8) | whisper.cpp cuda/medium-q5 | whisper.cpp cuda/turbo-q5 |
|---|---|---|---|
| final 延迟 | 3,149–6,205 ms ❌ | ≤ 1,984 ms ✅ | ≤ 978 ms ✅ |
| RTF | ≈ 0.30 | 0.036–0.073 | 0.020–0.032 |
| CER 均值(含 Part3) | 28.36% | 3.43% | 5.87% |
| Part3 | 88.73%（outlier） | **0%** | **0%** |
| 稳定性 | 26 次无 OOM ✅ | 12 次无 OOM ✅ | 12 次无 OOM ✅ |
| 首条幻觉 | 「ご視聴…」 | 仅 Part4 尾部 | 仅 Part4 尾部 |

whisper.cpp CUDA 在延迟上是数量级改善，CER 也全面更优或持平。

---

## 6. 关键发现

**(1) Part3 outlier 是 medium-q8 特性，不是 ONNX 架构问题。** `medium-q8`（CPU 与 CUDA 都）复现了 Medium 验收里 Part3 只输出「準備してください」的 88.73% 失败 —— 这正是 Part3 27s 内多句 + ≥4s 长沉默触发 Whisper `compression_ratio`/`no_speech` fallback 的表现。换 `medium-q5` 或 `large-v3-turbo-q5` 后 **Part3 CER = 0%，完整转写四句**。这直接回应 Blocker #2：「排除 Part3 后 8.23%」的论据对 q8 仍需 VAD replay 佐证，但**对 q5/turbo 根本不存在需要排除的 outlier**。

**(2) Part4 的 CER 是尾部沉默幻觉，不是核心精度问题。** 三个模型在 Part4 正文都转写正确，差异全在 ~30s 片段末尾的静音段产生的幻觉尾巴。生产 `VadProcessor`（300ms hangover）在语音结束处闭合 segment，不会把尾部沉默送进 Whisper，预期消除该幻觉。这与 STANDUP-V3 的推断一致，仍待 VAD replay 实测确认。

**(3) ≤2s 门槛依赖 GPU。** CPU 后端即使 8 线程也是数秒级单段延迟，不达标。结论的可移植性受限于「目标机器有 NVIDIA GPU」。本机满足。

**(4) turbo-q5 是综合最优。** 延迟最低（整段 47s < 1s）、Part3 解决、纯语音精度最好，模型体积（547MB）与 medium-q5 相当。

---

## 7. ADR-003 门槛判定

| 门槛 | 要求 | 实测（cuda/turbo-q5 与 cuda/medium-q5） | 判定 |
|---|---|---|---|
| final 延迟 | ≤ 2,000 ms（可比 4 样本） | turbo ≤978ms / medium-q5 ≤1,984ms | ✅ |
| CER | ≤ 9% | turbo 5.87% / medium-q5 3.43% | ✅ |
| Part3 outlier | 经 VAD replay 解释或被切段消除 | q5/turbo 直接 0%；q8 复现失败 | ✅（待 VAD replay 终验） |
| 进程稳定 | 无 OOM/crash | 24/24 通过 | ✅ |
| 集成成本 | 子进程接入，不重写采集/VAD/LA-2/上下文 | whisper-cli/whisper-server 独立子进程 | ✅（见 §8） |

→ **满足「推进 whisper.cpp 落地」的全部门槛。**

---

## 8. 集成成本评估

- **形态:** whisper.cpp 提供 `whisper-cli`（一次性子进程）与 `whisper-server`（HTTP 常驻）。生产建议用**常驻子进程**，模型加载一次（~0.5s），之后按 VAD segment 喂 PCM，单段返回 ≤1s。可不重写现有音频采集、`VadProcessor`、LocalAgreement-2、上下文 prompt 或双声道抽象，仅替换 `LocalWhisperSTT` 的推理后端。
- **分发:** CPU 包 16MB；CUDA 包 438MB（含 cudart/cublas DLL，可免装 CUDA Toolkit）。模型 514–785MB 需随应用分发或首启下载（与现有 `%APPDATA%\natively\whisper-models\` 下载机制可复用）。
- **进程生命周期 / 错误处理:** 子进程崩溃可重启并保留 Medium fallback；whisper.cpp 日志走 stderr，需解析 timing/错误。复杂度可控。
- **风险:** GPU 依赖（见 §6.3）；首跑 PTX JIT 一次性 ~15s（缓存后消失，可在应用启动时预热）。

---

## 9. 建议与下一步

1. **采纳 whisper.cpp + CUDA，模型选 `large-v3-turbo-q5_0`（备选 `medium-q5_0`）。**
2. **补做 Part3 production VAD replay（ADR-003 行动项 #4）。** 用 `VadProcessor` + `LocalWhisperSTT` 切段路径喂 Part3 原始 m4a，确认切段数/每段 CER，并顺带验证 Part4 尾部幻觉在 VAD 下消失。本次数据已表明该验证为低风险确认。
3. **起草 ADR-004 / 实施计划**：whisper.cpp 常驻子进程协议、模型分发、应用启动预热、与 Medium fallback 的共存与切换开关。
4. 落地实现后，按 STANDUP Blocker #3 一次性 commit STT 源码改动。

---

## 附录 A — 逐样本转写（cuda）

**medium-q5_0**
- Part1: `家から会社までどうやって行きますか`（CER 0%）
- Part3: `休みの日にしたいことについて 1分で話してください次の3つを話してください誰と何をしたいかそれをしたい理由 次にいつそれができるか準備してください`（CER 0%）
- Part4: `…これが何のグラフかここから何がわかるか話してください準備してください` + 尾部幻觉 `お疲れ様でした`（CER 8.54%）
- Part5: `…日本語を話せる人はどのくらいいますか`（CER 5.19%）

**large-v3-turbo-q5_0**
- Part1: `家から会社までどうやって行きますか?`（CER 0%）
- Part3: `休みの日にしたいことについて、1分で話してください。…準備してください。`（CER 0%）
- Part4: 正文正确 + 尾部幻觉 `ご視聴ありがとうございました`（CER 18.29%，去尾≈0%）
- Part5: 正文正确（CER 5.19%）

**medium-q8_0**
- Part3: 仅 `準備してください。`（CER 88.73%，复现 Medium outlier）

## 附录 B — 复现方式

```
# 1. 下载 binary + 模型（仓库外 D:\Interview APP\spike-whispercpp\）
scripts/download.ps1
# 2. float WAV -> 16-bit PCM
node scripts/convert.js
# 3. 跑全套 backend×model×sample
scripts/run-spike.ps1
# 4. 汇总（warm compute = total - load）
node scripts/analyze.js
```
