# npm 发布（dsh-overdrive）

## 状态：✅ 已发布 v0.1.0（2026-08-16）

- `@dsh-overdrive/sdk@0.1.0`
- `@dsh-overdrive/gateway-core@0.1.0`
- `@dsh-overdrive/gateway@0.1.0`

## 更新版本（发新版时）

```bash
npm version patch -w @dsh-overdrive/sdk -w @dsh-overdrive/gateway-core -w @dsh-overdrive/gateway
npm publish -w @dsh-overdrive/sdk      # 依赖顺序：sdk → gateway-core → gateway
npm publish -w @dsh-overdrive/gateway-core
npm publish -w @dsh-overdrive/gateway
```

> 认证：仓库根 `.npmrc` 写 `//registry.npmjs.org/:_authToken=npm_xxx`（用完即删，勿提交）。
> `packages/mock-dsh` 仅开发用，不发布。

## 安装到 DSH

```bash
dsh plugin --profile web add @dsh-overdrive/gateway-core
# 或本地 patch overlay：
# dsh --profile web --patch ./packages/gateway-core/cordis.patch.yml
# 必需环境变量：DSH_OVERDRIVE_TOKEN、DEEPSEEK_API_KEY
```

## 验证

- `dsh plugin --profile web ls` 出现 `overdrive-gateway-core`
- `GET http://127.0.0.1:3192/v1/health`（`Authorization: Bearer $DSH_OVERDRIVE_TOKEN`）返回 `{"status":"ok"}`
- 启动 gateway 指向 3192 后发一条消息，确认事件回流

## 注意事项

- DSH 运行时包是 `^0.1.0-rc.6` pre-release：发布前确认 npm registry 可解析，且 gateway-core 的 peer/deps 版本与实际安装一致
- 正式发布前把 `package.json` 里 `repository.url` 的 `temotee2103` 替换为真实 GitHub 用户名
