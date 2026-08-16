# npm 发布步骤（dsh-overdrive）

## 前置

- npm 账号已登录：`npm login`
- `@dsh-overdrive/*` scope 发布权限（org 或 public scope）
- 版本统一：`npm version patch -w @dsh-overdrive/sdk -w @dsh-overdrive/gateway-core -w @dsh-overdrive/gateway`（或手动统一各包 version）

## 发布顺序（依赖方向：sdk → gateway-core → gateway）

```bash
npm publish -w @dsh-overdrive/sdk
npm publish -w @dsh-overdrive/gateway-core
npm publish -w @dsh-overdrive/gateway
```

> `packages/mock-dsh` 仅开发用，不发布（如发布需同样补元数据）。

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
- 正式发布前把 `package.json` 里 `repository.url` 的 `<owner>` 替换为真实 GitHub 用户名
