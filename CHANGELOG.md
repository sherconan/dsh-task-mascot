# Changelog

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
