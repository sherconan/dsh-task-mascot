# 做一个自己的角色包 / Make a character pack

角色包就是 `assets/packs/<id>/` 下的一个文件夹：一个 `manifest.json`，加上每个状态的动画文件。放进去、重启 dsh web，就能在设置里选到它。

## 1. 准备素材

- 每个状态一段带透明背景的短动画（母版建议 PNG 序列或带 alpha 的视频），以及一张首帧 PNG。
- 至少要有 `thinking`，其它状态都可选，缺了会自动回退。
- 可用状态：`idle thinking reading search coding editing writingdoc cmd data planning subagents tools summary waiting done error`

建议优先做这几个，覆盖面最大：`thinking`（思考）、`reading`（读文件）、`cmd`（跑命令）、`waiting`（等你批准）、`done`（完成）、`error`（出错）。

## 2. 编码

把母版放到 `masters/<pack>/`，然后：

```bash
npm run encode   # scripts/encode-packs.sh
```

会生成三种格式：

| 文件 | 用途 |
|---|---|
| `<state>.webm` | VP9 + alpha，384px 30fps，Chrome / Edge / Firefox / 桌面端 |
| `<state>.webp` | 动画 WebP，256px 15fps，给 Safari（Safari 解 VP9 会丢透明） |
| `<state>.png`  | 首帧 poster |

## 3. 写 manifest.json

```json
{
  "schema": 1,
  "id": "mypack",
  "title": "My Character",
  "author": "you",
  "license": "CC BY 4.0",
  "preview": "thinking.png",
  "states": {
    "thinking": { "webm": "thinking.webm", "webp": "thinking.webp", "poster": "thinking.png", "loop": true },
    "done":     { "webm": "done.webm", "webp": "done.webp", "poster": "done.png", "loop": false, "durationMs": 3000 }
  },
  "fallback": { "writingdoc": ["editing"], "idle": ["waiting", "thinking"], "*": ["thinking"] }
}
```

- `id` 必须和文件夹名一致。
- `loop: false` 的状态（如 `done`）播完 `durationMs` 后回到常态。
- 缺失的状态按 `fallback` → 内置回退链 → `*` 依次查找。

## 4. 试用

重启 dsh web，在插件设置里切换到你的角色，随便让 Agent 读个文件、跑个命令，看看每个状态是否正常。

## 5. 授权（重要）

- 只提交**你原创**或**已获得授权**的形象。
- 在 `license` 里写清授权协议；二创角色请写明来源链，并遵守上游协议（例如上游是 NC，你的包也必须是 NC）。
- 不要使用未经授权的商业 IP 或他人画作。

## 6. 投稿

欢迎通过 Issue（选择「角色包投稿」模板）或 PR 分享你的角色包。
