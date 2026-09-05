# dsh-overdrive 进程内化 — 交接手册（HANDOVER）

> 更新：2026-09-05（Round 12 后，用户确认「不需要测试、代码没问题就行」）。
> **最终状态：0.2.0 正式发布** —— npm `latest=0.2.0`（beta 标签保留 0.2.0-beta.0）；
> 270 单测绿；dsh-index 收录分支 `update-latest-versions` 已同步 0.2.0（`5c6c38a`，
> PR 待上游合并：https://github.com/Sunrisepeak/dsh-index/compare/main...temotee2103:update-latest-versions?expand=1）；
> losebird/dsh-plugin-market PR #25 已被合并（overdrive/ci-co-pilot v0.3.1 条目在线）。
> 剩余为可选项：P3 设置页客户端卡、P2 其余平台迁入、gateway 退役。
> 主计划：`docs/superpowers/plans/2026-09-05-in-process-native.md`；发布稿：`docs/releases/gateway-core-0.2.0.md`。

## 一句话现状

gateway-core **进程内原生形态已发布正式版 0.2.0**（npm `latest`），270 项单测绿；收录仓库已同步
（losebird PR #25 已合并；dsh-index 分支 0.2.0 待上游合并）。用户验收口径：**无需真机测试，代码与单测通过即可**。

## 仓库/包状态

- Repo: `github.com/temotee2103/dsh-overdrive`（main，SSH push OK；npm token 在 ~/.npmrc，GitHub API/浏览器 不可用）。
- npm:
  - `@dsh-overdrive/gateway-core` **latest=0.1.9**（legacy 稳定线） / **beta=0.2.0-beta.0**（进程内原生）。
  - `@dsh-overdrive/sdk@0.1.3`、`gateway@0.3.1`、`mock-dsh@0.1.3`（此前打包修复；legacy 相关）。
- 关键提交（main）：`3319b94` 打包修复(0.1.8) → `4b6d4d0` 优雅降级(0.1.9) → `9b59899` P0 → `5b9c59d` P1 Telegram → `4a5e349` P2-a schema → `54d6e48` P2-b 审批 → `c8b7417` P2-c 图片 → `87ed215` P2-d /remind → `8c2210f` 文档 → `14782b0` beta 发布 → `a7bc3a8` 交接/发布稿。

## 已实现（原生路径，全部单测覆盖）

P0 接缝 `native.ts`（NativeDriver/NativeBridge，会话前缀隔离）→ P1 Telegram driver（轮询、allowlist、HTML+4096 分片、typing 限频）→ P2-a schemastery Config → P2-b 原生审批（批准/拒绝/超时取消）→ P2-c 图片入站（photo→URL→MediaRef）→ P2-d `/remind` + `apiBase` seam。
原则：**任何缺失配置→禁用态告警，绝不 throw、绝不阻塞 DSH 启动**；`dsh plugin add/remove` 真实 CLI 已验证无 loader 崩溃（scratch profile odtest，已清理，未碰用户 web profile）。

## 续接清单（按序）

1. 用户提供 Telegram bot token（@BotFather）→ 例 `export DSH_TELEGRAM_TOKEN=…`。
2. （需用户同意）`dsh plugin --profile web add @dsh-overdrive/gateway-core@beta` → 重启 `dsh web`。
3. 验证：启动无崩溃（应见 `telegram 原生桥接已启动`）；给 bot 发文字/图片；审批触发时回「批准/拒绝」；`/remind 30s …`。
4. 通过后：gateway-core 版本 `0.2.0-beta.0 → 0.2.0`，`npm publish --tag latest`（或先 rc 灰度）。
5. P3 设置页客户端卡（`dsh.client` + client bundle + dsh-settings；参考 `welsione/dsh-mmx-bridge`）——需真机 Web 环境。
6. P2 其余平台迁入（feishu/wecom/discord/slack/whatsapp 从 `packages/gateway/src/adapters/*` 移植为 NativeDriver）。
7. P4 退役外部 gateway：`@dsh-overdrive/gateway` npm deprecate + README 迁移；收录刷新：
   - losebird/dsh-plugin-market **PR #25**（open，head 分支 `temotee2103/dsh-plugin-market:bump-versions`）spec 已是 repo tag `v0.3.1`；最终 0.2.0 若发新 repo tag 则再刷。
   - Sunrisepeak/dsh-index fork 分支 `update-latest-versions`（`10b4880`，含 gateway-core 0.1.9/ci-co-pilot 0.3.1 条目）→ 开 PR（无 API 权限时给用户 compare 链接：https://github.com/Sunrisepeak/dsh-index/compare/main...temotee2103:update-latest-versions?expand=1 ）。
8. 移除用户先前 1★ 前的其它事故隐患排查：web profile 的历史加载 `SessionLogOffset … undefined` 问题**未复现/未归因**（用户卸载插件后自愈，疑与早前插件崩溃导致 zstd 日志截断有关）；若复现，检查 `~/.dsh/sessions/**/session.jsonl.zstd` 尾部完整性。

## 安全/凭据备忘（勿外泄）

- npm publish token：`~/.npmrc` 的 `//registry.npmjs.org/:_authToken=npm_…`。
- GitHub：仅 SSH（`git@github.com:temotee2103/*.git`）；无 API token/gh/browser → 开新 PR 需用户给 PAT 或点 compare 链接。
- Telegram bot token 由用户提供后只作运行配置，不进仓库/日志明文。
