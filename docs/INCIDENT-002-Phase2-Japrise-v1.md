# INCIDENT-002 / Phase 2 — Japrise 模式 v1 验收与修复记录

**日期:** 2026-06-07  **严重度:** SEV2(核心功能在 Windows 上不可用)  **状态:** Resolved
**作者:** Li  **范围:** ADR-005 Japrise 实时辅助 — 应用内手动验收(开发模式)

## Summary

在 Japrise 模式第一版的应用内手动验收中,从"构建启动"到"看图说话"逐项排查并修复了 7 类阻断问题。
根因集中在三处:开发启动脚本误用、平台假设(英文/Unix 路径)未覆盖日语与 Windows、以及 premium 子模块缺失导致的 UI/门控失效。修复后 Japrise 模式可端到端工作:五部分检测、即时本地参考面板、按部分长度的完整日语答案(含假名注音)、以及 Part 4 截图视觉作答。

## Impact

- 受影响用户:在 Windows + 开发模式下做 Japrise 验收的人员(本机单人)。
- 受影响功能:应用启动、模式管理、答案生成(OpenAI)、日语自动触发、Part 4 视觉作答。
- 持续时间:单次验收会话(约数小时),全部当场修复。
- 业务影响:验收一度完全阻塞;修复后 v1 可交付。

## Timeline

| 阶段 | 事件 |
|---|---|
| T0 | `npm run electron:dev` 启动后窗口全黑 |
| T1 | 定位:dev 脚本未起 Vite(5180),应使用 `app:dev`/`start` |
| T2 | OpenAI Test connection 报 429 配额不足(账户计费,非代码) |
| T3 | 切 gpt-4o 后 stop 报 400 `max_tokens 65536`,定位并修 LLMHelper |
| T4 | Modes 入口打开空面板;查出 premium 子模块未拉取,UI 缺失 |
| T5 | 用本地实现替换 ModesSettings 空壳;Create 仍失败 → pro 门控 |
| T6 | dev 模式放开 `isProOrTrialActive`;模式创建/激活成功,§3 面板工作 |
| T7 | 日语题目不自动生成 → 修 `hasQuestionSignal`/词数门控(CJK) |
| T8 | 答案为教练脚手架且过短 → 改 Japrise 提示词为完整答案 + 按部分长度 |
| T9 | 加假名注音规则 |
| T10 | Part 4 截图后 What to answer 卡死 → 定位 Windows 绝对路径被校验拒绝 |
| T11 | 修 `validateImagePath`;视觉作答打通。验收通过 |

## Root Cause

逐项根因:

1. 启动脚本:`electron:dev` 只构建主进程并启动 Electron,不启动 Vite dev server;开发模式渲染器从 `http://localhost:5180` 加载,服务器未起 → `ERR_CONNECTION_REFUSED` → 全黑。正确入口是 `app:dev`(`start`),用 concurrently 同时拉起 Vite 并 `wait-on`。
2. OpenAI 429:账户无可用额度/计费,非代码问题(401=key 错,429+quota=计费)。
3. gpt-4o 400:`LLMHelper` 对所有非 Claude 模型一律下发 `max_completion_tokens=MAX_OUTPUT_TOKENS(65536)`,而 gpt-4o 上限 16384。只为 Claude 做了按型号封顶,OpenAI 未做。
4. Modes 空面板:`premium` 是未拉取的 git 子模块,`ModesSettings` 经 premium loader 回退为 `NullComponent`,整套模式管理 UI 缺失。
5. 创建失败:`modes:create` 等 IPC 被 `isProOrTrialActive()` 的 license 门控挡住,无 license/trial 即拒绝。
6. 日语不触发:`maybeSpeculate` 的 `hasQuestionSignal` 只识别英文疑问词/结尾 `?`,且按空格数词;日语无空格、无 `?` → 永不触发。
7. 答案短/占位符:`MODE_JAPRISE_PROMPT` 是防作弊练习教练,显式禁止给完整脚本,且 output_style 限制 1-2 行。
8. Part 4 卡死:`validateImagePath` 无条件拒绝所有 Windows 盘符路径(`C:\...`),而截图就存在 userData 下的 Windows 绝对路径 → 路径被拒、返回空答案、UI 不抛错而干等。

## 5 Whys(以 Part 4 卡死为主线)

1. 为什么 Part 4 点 What to answer 后一直无响应? → 后端 `generate-what-to-say` 拒绝了图片路径,返回空答案。
2. 为什么路径被拒? → `validateImagePath` 命中"Windows absolute paths are not allowed"。
3. 为什么会命中? → 该校验在白名单检查之前,无条件拒绝任何 `C:\` 盘符路径。
4. 为什么这样写? → 校验逻辑按 Unix/sandbox 路径假设设计,未考虑 Windows 截图存于 userData 的绝对路径。
5. 根因:跨平台路径假设缺失 + 失败被静默吞掉(UI 不展示 error),使一个平台 bug 表现为"卡死"。

## 修复清单(代码)

| # | 文件 | 改动 |
|---|---|---|
| 1 | 启动 | 用 `npm run start`(app:dev)代替 `electron:dev`(文档/操作修正) |
| 2 | electron/LLMHelper.ts | 新增 `getOpenAiMaxOutput()`,gpt-4o→16384 等按型号封顶;3 处调用点改用它 |
| 3 | src/components/settings/ModesSettings.tsx | 用本地实现替换 premium 空壳(列表/创建/激活/删除/查看参考文件) |
| 4 | electron/ipcHandlers.ts | `isProOrTrialActive()` 在 `NODE_ENV=development` 下返回 true(仅 dev 放开 pro 门) |
| 5 | electron/IntelligenceEngine.ts | `maybeSpeculate` 门控加 CJK 分支:中日文 ≥10 字即可自动触发 |
| 6 | electron/llm/prompts.ts | Japrise 提示词:教练→完整可照读答案;按 Part1-5 设定长度;新增假名注音规则 |
| 7 | electron/utils/curlUtils.ts | `validateImagePath`:Windows 绝对路径仅在不在 userData 内时才拒绝 |

## What Went Well

- 每个症状都能从日志精确定位到代码行,无需盲改。
- 修复均通过 `typecheck:electron`,且都留有 `.bak` 备份。
- 多为通用平台 bug(Windows 截图、日语触发),修复对全体 Windows/日语用户有益。

## What Went Poorly

- 失败被静默吞掉(空答案不报错),把 bug 表现成"卡死",拖长定位时间。
- DevTools 无法打开,被迫直接改前端空壳,绕路较多。
- 多处对 Windows / 日语 / 无 license 的平台假设缺失,集中暴露。

## Action Items

| Action | Owner | Priority | Due |
|---|---|---|---|
| `handleWhatToSay` 在拿到 error 时显示到对话框,不再静默卡死 | Li | P1 | TBD |
| 给带图/流式生成路径补硬超时 + 错误上抛 | Li | P1 | TBD |
| `hasQuestionSignal`/触发门控补充更完整的日语判定与单测 | Li | P2 | TBD |
| 决定模型二进制管理策略(LFS/外部下载,勿入 git) | Li | P2 | TBD |
| premium 子模块缺失时给出明确 UI 提示而非空白 | Li | P3 | TBD |

## Lessons Learned

- 跨平台路径/语言假设必须显式覆盖 Windows 与日语,并配单测。
- 失败要可见:宁可在 UI 报错,也不要静默返回空导致"卡死"。
- 开发启动入口、license 门控、子模块缺失等"环境前提"问题,应在 README/验收手册 §0 显式说明。

---
*本记录为 Japrise 模式 v1 的最终成果物之一,对应 PR: feat/japrise-v1。*