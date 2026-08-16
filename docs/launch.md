# 渠道发布清单（M5）

## 已执行（2026-08-16）

- ✅ GitHub 仓库公开（temotee2103/dsh-overdrive，57+ commit，CI 全绿）
- ✅ `dsh-plugin` topic + 10 个相关 topic
- ✅ npm 三包发布（sdk / gateway-core / gateway @ 0.1.1，英文描述）
- ✅ DSH 官方 Discussion 发帖：https://github.com/deepseek-ai/deepseek-harness/discussions/2546（"Show Your Plugins!"）
- ✅ awesome-dsh-plugin PR #1191（4838⭐）：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1191
- ✅ awesome-deepseek-harness PR #321（589⭐）：https://github.com/0xsline/awesome-deepseek-harness/pull/321
- ✅ 双语 README + 自带动画 SVG 演示（免录屏）
- ✅ 发布稿草稿：`docs/launch-hn.md`（Show HN）、`docs/launch-cn.md`（CSDN/掘金/知乎）

## 待执行

- [ ] 粘贴发布 `docs/launch-hn.md`（Show HN）
- [ ] 粘贴发布 `docs/launch-cn.md`（CSDN / 掘金 / 知乎）
- [ ] 录制真实演示视频（可选，动画 SVG 已可作素材）
- [ ] Discord 社区发帖（需登录 Discord）
- [ ] 全部密钥作废/轮换（GitHub PAT×2、npm token×2、DeepSeek key、Telegram token）

## 发布前检查

- [ ] `npm run build && npx vitest run && npm run e2e` 全绿（CI 同步）
- [ ] LICENSE / README / CI 就位
- [ ] `npm publish` 三个包完成（见 docs/publish.md）
- [ ] GitHub repo 公开 + `dsh-plugin` topic 打上
- [ ] `repository.url` 的 `temotee2103` 替换为真实 GitHub 用户名
- [ ] 演示视频录好（docs/demo.md）
- [ ] 真机验收至少一个平台闭环（docs/smoke-platforms.md）

## 渠道与文案要点

| 渠道 | 动作 | 要点 |
|---|---|---|
| GitHub | README + Releases + topic `dsh-plugin` | 英文 README 头部一句话定位；演示 GIF 放顶部 |
| DSH Discord | 发消息 + 演示链接 | 提"基于 Cordis 的 channel 插件"，附 `dsh-plugin` topic |
| Hacker News | Show HN 帖 | 标题点出"DeepSeek Harness 的多平台消息网关，聊天内可追踪" |
| CSDN/掘金/知乎 | 中文长文 | 标题带"超越 Hermes/OpenClaw"；对比表 + 架构图 + 演示 |
| Twitter/X | 短视频 + 截图线程 | 30s：扫码→对话→审批按钮 |
| 阿里云开发者社区 | 镜像 + 一键部署教程 | 复用 harness-lark 的 Docker 镜像推广路径 |

## 发布后动作

- 48h 内响应 issue/discussion 反馈
- 准备 v0.2 路线图：个人微信（实验性）、ASR 语音转写、飞书/钉钉原生卡片、多租户

## 叙事要点（一页话术）

> Hermes / OpenClaw 是"黑盒 + 21 平台"；dsh-overdrive 是"看得见每一步 + 平台更多（含中文生态）+ 一条命令部署"。轨迹可回放是它们抄不走的——因为 DSH 的 session log 天然 append-only。
