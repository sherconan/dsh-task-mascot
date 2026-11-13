# Changelog

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
