# Changelog

## 2.2.0

- 新增 Agent 待办清单：读 DSH 官方 `todo_write` 产生的 `todo/write` 事件，步骤卡里显示小清单（☐ / ▶ / ☑），开工时说「接到 N 件事：…」，每勾掉一项冒一句「勾掉一项 ✓ …（x/y）」，悬浮角色同步显示。
- 新增收尾汇总：一轮结束时列出还没做的项和没跑通的步骤（失败从本轮失败的工具调用推断，之后重试成功的不算）；被中断、输出被截断时也列出没做完的项。回合摘要显示待办完成情况，展开可看清单。
- 新增本轮花费估算：把每次模型调用 `assistant/message` 的 token 用量按 DeepSeek 官方单价（2026-11-22）和北京时间峰谷估算，文字一律写「约」；非 DeepSeek 或未知模型只显示 token 数。默认超过 ¥0.05 才在卡片里说，回合摘要总显示。全部在浏览器里计算，不联网、不读 API key。
- 设置页新增：显示待办清单、勾项气泡、收尾汇总、本轮花费（超过阈值 / 每轮 / 关闭）、花费提醒阈值。
- 大肥鱼图鉴新增第 33 格「清单全勾」（本轮待办 ≥ 2 项全部勾完并正常结束；沿用欢呼的画）。
- `max-tokens` 结束的回合改为显示「输出到上限被截断」。
- 已在 DSH 0.2.2-rc.5（dsh web，免 key 模拟模型）实测：读文件 → 写代码 → 跑测试 → 清单全勾、模型拒答、留一项没做 + 测试失败的收尾。单元测试 28 项，含用 rc.5 实录事件回放的用例。

## 2.1.3

- 识别 DSH 0.2.2-rc.3 起的模型拒答：`turn/end` 的 `reason.error.code` 为 `CONTENT_REFUSED` 时，显示「模型拒绝回答这个请求」，用担心的表情，不播放出错提示音。旧的 `MALFORMED_RESPONSE` 仍按普通出错处理。
- 大肥鱼图鉴新增第 32 格「模型拒答」（沿用担心的画，不含新动画文件）。
- 已在 DSH 0.2.2-rc.5（dsh web，mock LLM）实测拒答文案与普通工具回合。测试 21 项。

## 2.1.2

- 补上 DSH 0.2.2-rc.2 里一批原先只显示「用工具」的工具映射：`apply_patch` 按扩展名走改代码/写文档，`subagent_fork` / `subagent_oar` / `wait_agent` 走派子代理，`propose_action` 走等你确认，`user_terminal_list` / `user_terminal_read` 走读文件，`list_mcp_resource_templates` 走 MCP，`office_convert` / `office_render` 走写文档，`office_recalculate` 走跑数据。
- shell 结果里出现 `[sandbox: file access denied …]` 时按失败处理。
- 保留已下线的 `spawn_teammate` 映射，以免旧会话回放掉到「用工具」。
- 已在 DSH 0.2.2-rc.2（dsh web，mock LLM）实测 `apply_patch` / `subagent_fork` / 审批等待：卡片文案正确，悬浮角色不挡审批按钮，内联卡片在视野内时不再重复显示状态条，暗色模式下卡片可读。测试 20 项。

## 2.1.1

- 修复重复显示：对话内卡片和输入框上方状态条会同时显示同一步。现在默认（「状态条何时显示：自动」）卡片在视野里时隐藏状态条，卡片滚出视野、被关闭或不存在时状态条才出现；想要旧行为可选「总是」。
- 图鉴解锁提示改为右上角小卡片，不再有全屏遮罩、不挡对话；短时间内连续解锁合并成一张（「新解锁 ×N」），点击打开图鉴。图鉴里点卡片回放仍是大动画。
- 已在 DSH 0.2.2-rc.1（dsh web）实测；测试 18 项。

## 2.1.0

- 新增大肥鱼图鉴：31 格（对应 docs/states-v2.md，不含 `_b` 变体），首次进入某状态时点亮并弹出解锁动画；`window.MascotDex.unlock(id)` 首次返回 true，进度存 localStorage（`dsh-mascot-dex:public`）。
- 设置页新增：图鉴收集开关、新解锁弹窗开关、「打开图鉴」按钮；悬浮角色右键打开图鉴。

## 2.0.1

- 清理构建脚本里的本地路径默认值。

## 2.0.0

- 大肥鱼 v2 角色包：新增 26 个状态（create/diff/git/test/install/download/delete/web/mcp/memory/media/subtask/busy/retry/worried/denied/interrupted/sweat/tired/cheer 及 6 个 `_b` 变体），共 37 个，约 12 MB。
- bash/pwsh 按命令细分：git / test / install / download / delete / diff；`write` 新文件识别为 create。
- 循环理解：轮次显示、重试、连续失败（worried）、连发（busy）、子任务完成、拒绝、中断；shell 非 0 退出码识别为失败。
- 时长升级：sweat / tired / cheer + 淡色耗时提示，阈值可在设置里调。
- A/B 变体（交替 / 随机 / 关闭）。
- 测试 15 项；mock LLM 增加 `SCENARIO=v2` 场景；e2e 自动关闭"Get started"弹窗。
- 详见 docs/states-v2.md。

## 1.0.1

- 首个公开版本。
