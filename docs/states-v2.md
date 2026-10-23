# 大肥鱼 v2 状态说明

v2 让大肥鱼不只"跟着每一步工具调用动"，还能看懂**整个 agent 循环**：第几轮、是不是在重试、是不是连续失败、是不是一口气干很多事、这一步是不是太久了。

## 1. 状态总表

| 状态 | 中文 | 触发 | 大肥鱼动画 | 没有该动画的角色包（如 Claude娘）回退到 |
|---|---|---|---|---|
| `thinking` / `thinking_b` | 思考 | 模型在输出 | 托腮 / 灯泡 | — |
| `reading` / `reading_b` | 读文件 | `read` `lsp` `cordis_inspect_*` | 看纸 / 捧书 | — |
| `search` / `search_b` | 搜索 | `glob` `grep` | 放大镜 / 望远 | — |
| `coding` / `coding_b` | 写代码 | `write`（已有文件） | 笔记本 / 敲键盘 | — |
| `create` | 新建文件 | `write` 且路径在本会话里第一次出现 | 举着新纸 | coding |
| `editing` / `editing_b` | 改代码 | `edit` `str_replace_editor` | 改纸 / 大铅笔 | — |
| `diff` | 对比 | `git diff` `diff` `cmp` | 两张纸对照 | editing → reading |
| `cmd` / `cmd_b` | 跑命令 | `bash` `pwsh` `terminal_*` `job_*`（其它命令） | 终端窗 | — |
| `git` | git | `git …` `gh …`、`create_worktree` | 印章 | cmd |
| `test` | 跑测试 | `npm/pnpm/yarn/bun test` `pytest` `jest` `vitest` `go test` `cargo test` `node --test` `make test` `mvn test` | 试管 | cmd |
| `install` | 装依赖 | `npm i/ci/add` `pip install` `uv` `apt` `brew` `cargo add` `go get` `gem` `Install-Module`、`load_workspace_dependencies` | 抱纸箱 | download → cmd |
| `download` | 下载 | `curl` `wget` `aria2c` `iwr` `scp` `rsync` | 下载盒 | web → cmd |
| `delete` | 删除 | `rm` `rmdir` `unlink` `del` `Remove-Item` `shred` | 垃圾桶 | cmd |
| `web` | 上网 | `web_search` `web_fetch` `stagehand_*` | 浏览器窗 | search |
| `mcp` | MCP 工具 | `mcp__*` `list_mcp_resources` `read_mcp_resource` | 插头 | tools → cmd |
| `memory` | 翻记录 | `session_*` | 记事本 | search → reading |
| `media` | 看图 | `read_image` | 相机 | reading |
| `planning` | 做计划 | `todo_write` `*_goal` `schedule_*` | 清单 | — |
| `subagents` | 派子代理 | `subagent` `spawn_teammate` … | 召唤 | — |
| `subtask` | 子任务完成 | 子代理 / 队友任务成功返回；`todo_write` 完成数增加 | 比耶 + ✓ | done |
| `busy` | 忙碌 | 模型不停顿地连发 ≥ 5 个工具调用（`busyN`） | 手忙脚乱 | cmd → thinking |
| `retry` | 重试 | 与上一次失败**相同**的调用再次发出；或 `llm/retry` | 握拳再来 | error → thinking |
| `error` | 出错 | 工具结果 `isError`，或 shell 退出码非 0（`diff/grep/test` 除外） | 红叉 | — |
| `worried` | 担心 | 连续失败 ≥ 2 次（`worriedN`） | 捂嘴着急 | error |
| `denied` | 被拒绝 | 你在审批里点了拒绝 | 双手 ✗ | error |
| `interrupted` | 已中断 | 你中断 / turn 被取消 | 惊讶 | waiting → idle |
| `waiting` | 等你 | 审批或提问挂起 | — | — |
| `sweat` | 有点久 | 一步运行 ≥ 20 s（或思考 ≥ 20 s，文字改成"深度思考中…"） | 冒汗 | thinking |
| `tired` | 累了 | 一步 ≥ 60 s（3×步长阈值），或整轮 ≥ 2 min 时仍在思考 | 打哈欠 | waiting → thinking |
| `cheer` | 终于搞定 | 整轮 ≥ 2 min 且成功结束 | 欢呼 | done |
| `done` | 完成 | turn 正常结束 | — | — |

`_b` 是 A/B 变体，见第 4 节。所有回退链都以角色包里实际存在的状态为准，单测会检查每个 DSH 工具在两个包里都能播。

## 2. 循环理解（轮次 / 重试 / 失败）

- **轮次**：DSH 事件里有 `step` 字段时直接用；没有时，"工具结果之后模型又开始输出"算新一轮。卡片上显示 `第 N 轮`（N>1 时），turn 结束文字为 `完成 · 共 N 步 · R 轮`。
- **重试**：调用签名（工具名 + 命令/路径/查询）与上一次失败相同 → `retry`，文字 `再试一次（第 k 次尝试）· 运行 …`。
- **连续失败**：第一次 `error`（`失败：…`），之后 `worried`（`又失败了（连续 N 次）：…`）。任一步成功即清零。
- **shell 退出码**：DSH 把非 0 退出当作普通结果（`isError:false`，结尾 `[exit code: N]`），v2 会识别为失败；`diff/cmp/grep/rg/test/[` 的非 0 退出是"答案"而不是错误，不算。
- **忙碌**：两次模型输出之间连续发出的工具调用计数，≥ `busyN`（5）进入 `busy`。
- **子任务**：子代理成功返回 → `子任务完成：…`；待办完成数增加 → `完成一项待办（x/y）`。
- **拒绝 / 中断**：审批被拒 → `denied`（`你拒绝了这一步，换个办法`）；中断或取消 → `interrupted`（`已中断`）。

## 3. 时长升级

| 条件 | 表现 |
|---|---|
| 当前步已运行 ≥ 步长阈值的一半（默认 10 s） | 卡片出现淡色斜体提示 `⏱ 已 Xs` |
| 当前步 ≥ 步长阈值（默认 20 s） | `sweat`，标签"有点久" |
| 当前步 ≥ 3 × 步长阈值（默认 60 s） | `tired` |
| 整轮 ≥ 循环阈值（默认 2 min） | 提示 `⏱ 本轮 X`；此时在思考则 `tired` |
| 整轮 ≥ 循环阈值且成功结束 | `cheer`：`终于搞定！ · 共 N 步 · R 轮 · 用时 X` |

计时用的是事件到达浏览器的时间，刷新页面回放历史时不会误报"有点久"。

## 4. A/B 变体

`coding / reading / cmd / search / thinking / editing` 各有一个 `_b` 版本（manifest 的 `variants` 字段）。设置项"动画变体"：

- **交替**（默认）：按步号奇偶交替，同一步不会来回跳；
- **随机**：按会话 + 步号哈希，确定性随机；
- **关闭**：只用 A 版。

## 5. 设置项（新增）

| 设置 | 默认 | 说明 |
|---|---|---|
| 动画变体 `variants` | 交替 | alternate / random / off |
| 步长阈值 `stepSlowSec` | 20 | 一步超过多少秒算"有点久"（3 倍算"累了"） |
| 循环阈值 `loopLongSec` | 120 | 一轮超过多少秒算"长任务" |

原有功能（审批避让、三种展示面、自定义映射、提示音、拖动宠物等）全部保留。

## 6. 角色包

- 大肥鱼 v2：37 个状态（11 个 v1 + 26 个 v2），manifest `"version": 2`，约 12 MB。
- v2 状态：VP9 透明 webm（384 px，约 220 KB）+ 两帧 WebP 兜底（约 27 KB，Safari 用）+ PNG 海报。
- Claude娘不变（5.8 MB），新状态全部通过回退链播放。
- 自制角色包只需提供想要的状态，缺的自动回退；也可以在 manifest 里声明自己的 `variants`。
