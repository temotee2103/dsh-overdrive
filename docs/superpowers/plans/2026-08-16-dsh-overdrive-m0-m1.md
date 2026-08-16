# dsh-overdrive M0+M1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 M0（读透 DSH 的 sessions/轨迹/审批插件接口）与 M1（monorepo 骨架 + Remote Session Driver 协议 SDK + Mock DSH + Gateway 骨架 + CLI 适配器 + 端到端 + gateway-core 插件雏形），产出可运行、可测试的纵向切片。

**Architecture:** 方案 A 双进程。DSH 侧 `gateway-core` 插件暴露 Remote Session Driver API（HTTP + WS，token 认证）；独立 Gateway 进程承载平台适配器（本计划先用 CLI 适配器验证链路，真实平台适配器在 M2/M3 计划实现）。M1 用 `mock-dsh`（协议服务端实现 + 模拟轨迹/审批流）替代真实 DSH，保证不依赖 DSH 源码也能全链路测试。

**Tech Stack:** TypeScript (strict, NodeNext)、npm workspaces（monorepo）、vitest（单测/集成）、Node 内置 fetch + `ws`（WebSocket）、node:http（协议服务端）。

**Scope 说明：** M2（国际平台适配器）、M3（中文平台）、M4（爆款特性）、M5（发布）是后续独立计划，每个计划产出可独立测试的软件。本计划在 M5 前不写 README 完整文案、不做任何真实平台 SDK 集成。

---

## File Structure

```
<workspace>/                                   # 仓库根（C:\Users\Temo Tee\AppData\Roaming\TRAE SOLO\ModularData\ai-agent\work-mode-projects\6a81934bad0b9d1268fe198a）
├── package.json                               # npm workspaces 根
├── tsconfig.base.json                         # 共享 TS 配置
├── vitest.config.ts                           # 单测别名 + include
├── .gitignore
├── README.md                                  # 占位（M5 再写完整文案）
├── reference/                                 # gitignored：DSH + harness-lark 源码调研区
├── docs/
│   ├── superpowers/specs/2026-08-16-dsh-overdrive-design.md   # 已存在（设计文档）
│   └── interface-report.md                    # M0 交付物：DSH 插件接口调研报告
├── test/e2e.mjs                               # 端到端脚本（mock-dsh + gateway + CLI 全链路）
└── packages/
    ├── sdk/           # @dsh-overdrive/sdk —— 协议类型 + 服务端 + 客户端
    ├── mock-dsh/      # @dsh-overdrive/mock-dsh —— 协议服务端实现（模拟 agent）
    ├── gateway/       # @dsh-overdrive/gateway —— 适配器接口 + CLI 适配器 + 主程序
    └── gateway-core/  # @dsh-overdrive/gateway-core —— DSH 插件雏形（apply(ctx, config)）
```

每个包内：`src/`（源码）、`test/`（vitest）、`tsconfig.json`、`package.json`。测试一律 `import from '../src/index.js'`（NodeNext 需要 `.js` 后缀）；跨包引用走 vitest 别名（`@dsh-overdrive/sdk` → `packages/sdk/src/index.ts`），运行时走构建产物 `dist/`。

---

## Task 1: 环境引导（Node 20+ / git 安装与仓库初始化）

**前提：** 若目标机器已装 Node 20+ 与 git，跳过安装步骤，直接执行 Step 6。
**Files:**
- Create: `docs/superpowers/specs/2026-08-16-dsh-overdrive-design.md`（已存在，仅提交）

- [ ] **Step 1: 检查工具链**

```powershell
node -v ; npm -v ; git --version
```

- [ ] **Step 2: 安装 Node.js（winget 优先）**

```powershell
winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
```

若 winget 不可用，用便携版（下载 zip 解压并写入用户 PATH）：

```powershell
$ver='v22.14.0'
Invoke-WebRequest "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile "$env:TEMP\node-$ver.zip"
Expand-Archive "$env:TEMP\node-$ver.zip" -DestinationPath "$env:LOCALAPPDATA\Programs" -Force
$dir="$env:LOCALAPPDATA\Programs\node-$ver-win-x64"
[Environment]::SetEnvironmentVariable('Path', "$dir;$([Environment]::GetEnvironmentVariable('Path','User'))", 'User')
$env:PATH="$dir;$env:PATH"
```

- [ ] **Step 3: 安装 git（便携 MinGit）**

```powershell
$gv='2.47.1'
Invoke-WebRequest "https://github.com/git-for-windows/git/releases/download/v$gv/MinGit-$gv-64-bit.zip" -OutFile "$env:TEMP\mingit.zip"
Expand-Archive "$env:TEMP\mingit.zip" -DestinationPath "$env:LOCALAPPDATA\Programs\mingit" -Force
$dir="$env:LOCALAPPDATA\Programs\mingit\cmd"
[Environment]::SetEnvironmentVariable('Path', "$dir;$([Environment]::GetEnvironmentVariable('Path','User'))", 'User')
$env:PATH="$dir;$env:PATH"
```

- [ ] **Step 4: 验证**

```powershell
node -v ; npm -v ; git --version
```
Expected: 三个版本号正常输出（Node ≥ 20、npm ≥ 10、git ≥ 2.4x）。

- [ ] **Step 5: 初始化仓库并提交设计文档**

```bash
cd <workspace>
git init
git add docs/superpowers/specs/2026-08-16-dsh-overdrive-design.md
git commit -m "docs: dsh-overdrive 设计文档（方案A：gateway-core 插件 + 独立 Gateway）"
```
Expected: commit 成功（若此前已提交过，跳过）。

---

## Task 2: M0 — DSH 插件接口调研

**目标：** 产出 `docs/interface-report.md`，确认 gateway-core 后续要用到的全部接口，消除设计文档 §14 中"DSH 插件 API 不稳定"这一最大风险。
**Files:**
- Create: `reference/deepseek-harness/`（gitignored，DSH 源码）
- Create: `reference/harness-lark/`（gitignored，飞书插件参考实现）
- Create: `docs/interface-report.md`

- [ ] **Step 1: 克隆两个仓库（浅克隆）**

```bash
cd <workspace>
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git reference/deepseek-harness
git clone --depth 1 https://github.com/huoxue1/harness-lark.git reference/harness-lark
```

- [ ] **Step 2: 定位核心文件**

```bash
cd reference/deepseek-harness
ls packages
grep -rn "sessions" packages/*/src --include="*.ts" -l | head -30
grep -rn "approval" packages/*/src --include="*.ts" -l | head -30
grep -rn "trajectory\|sessionLog\|append-only" packages/*/src docs --include="*.ts" --include="*.md" -l | head -30
grep -rn "cordis" vendor/package.json packages/*/package.json 2>/dev/null | head -20
```
把命中文件清单记下来（要写进报告）。

- [ ] **Step 3: 通读架构文档与 harness-lark 实现**

```bash
sed -n '1,200p' reference/deepseek-harness/docs/architecture.md
ls -R reference/harness-lark | head -60
```
harness-lark 重点看：插件入口（`apply(ctx)`）、配置读取（FEISHU_APP_ID 等）、`requireMentionInGroups` 实现、它挂接了 DSH 的哪些服务/事件。

- [ ] **Step 4: 逐项核对接口并摘录签名**

对以下每一项，在源码中找到**方法签名/服务名/事件名**并连同文件路径+行号复制进报告：
1. sessions 服务：注入一条外部消息、创建/继续一个会话的入口
2. 会话输出：订阅 agent 回复（流式 delta / 完整消息）的接口
3. 轨迹/会话日志：读取 append-only log 或订阅轨迹 step 事件的接口
4. 审批流：approval 请求的产生方式、应答（同意/拒绝）的方法
5. subagent / cron 的触发表面
6. cordis 插件注册：cordis.yml patch overlay 语法、插件包声明方式
7. `@deepseek-ai/cordis`（或实际发布名）在 npm 上的确切包名与版本（查 `vendor/` 或任意 package.json）

- [ ] **Step 5: 写 `docs/interface-report.md`**

报告模板（每节必须含：结论一句话 + 源码证据摘录）：

```markdown
# DSH 插件接口调研报告（M0 交付物）

- 日期 / DSH commit hash / harness-lark commit hash
- Cordis npm 包名与版本：`<结论>`

## 1. sessions 服务（注入外部消息）
- 结论：<可行 / 需要变通，怎么变通>
- 证据：<服务名 + 方法签名 + 文件路径:行号 + 代码摘录>

## 2. 会话输出订阅
- 结论与证据：<同上>

## 3. 轨迹/会话日志
- 结论与证据：<同上>

## 4. 审批流
- 结论与证据：<同上>

## 5. subagent / cron 触发表面
- 结论与证据：<同上>

## 6. 插件注册与加载（cordis.yml / patch overlay）
- 结论与证据：<同上>

## 7. gateway-core 桥接实现清单
- 用到的具体方法/事件清单（供后续计划直接引用）
- 每条注明：来源文件路径、调用方式、注意事项
```

- [ ] **Step 6: 提交**

```bash
git add docs/interface-report.md
git commit -m "docs(M0): DSH 插件接口调研报告"
```
Expected: commit 成功。若 Step 2/3 发现某个接口不存在或与设计冲突，在报告 §7 中明确写出替代方案，并不要改设计文档（放到下一轮计划评审时处理）。

---

## Task 3: 仓库骨架（npm workspaces + 共享配置）

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: 写根 `package.json`**

```json
{
  "name": "dsh-overdrive",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "e2e": "node test/e2e.mjs"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 3: 写 `vitest.config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@dsh-overdrive/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 写 `.gitignore` 与 `README.md`**

```gitignore
node_modules/
dist/
reference/
*.log
```

```markdown
# dsh-overdrive

> 让 DeepSeek Harness 变成"超越 Hermes / OpenClaw"的多平台聊天智能体。

当前状态：M1 骨架（协议 SDK + Mock DSH + Gateway 雏形）。详见 `docs/superpowers/specs/2026-08-16-dsh-overdrive-design.md`。
```

- [ ] **Step 5: 安装依赖并验证**

```bash
cd <workspace>
npm install
npx vitest --version
```
Expected: `npm install` 成功生成 `package-lock.json`；vitest 版本号输出。

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.config.ts .gitignore README.md
git commit -m "chore: monorepo 骨架（npm workspaces + vitest + tsc）"
```

---

## Task 4: SDK 协议类型（`packages/sdk`）

**Files:**
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/src/protocol.ts`
- Create: `packages/sdk/src/index.ts`
- Create: `packages/sdk/test/protocol.test.ts`

- [ ] **Step 1: 写包配置**

`packages/sdk/package.json`：

```json
{
  "name": "@dsh-overdrive/sdk",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "scripts": { "build": "tsc" },
  "dependencies": { "ws": "^8.18.0" },
  "devDependencies": { "@types/ws": "^8.5.12" }
}
```

`packages/sdk/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 2: 写 `src/protocol.ts`（协议类型 + 会话键 + 事件编解码）**

```ts
// Remote Session Driver 协议：类型定义与工具函数。

export interface TrajectoryStep {
  kind: 'thought' | 'tool' | 'subagent';
  label: string;
  detail?: string;
}

export type ServerEvent =
  | { type: 'message.delta'; sessionId: string; ts: number; text: string }
  | { type: 'message.complete'; sessionId: string; ts: number; text: string }
  | { type: 'trajectory.step'; sessionId: string; ts: number; step: TrajectoryStep }
  | { type: 'approval.request'; sessionId: string; ts: number; reqId: string; summary: string; timeoutMs: number }
  | { type: 'agent.status'; sessionId: string; ts: number; status: 'busy' | 'idle' | 'subagent-spawned' }
  | { type: 'task.done'; sessionId: string; ts: number; taskId: string; ok: boolean }
  | { type: 'error'; sessionId: string; ts: number; message: string };

export interface UpsertSessionRequest { platform: string; channel: string; user: string; }
export interface UpsertSessionResponse { sessionId: string; }

export interface SendMessageRequest {
  text: string;
  media?: { kind: 'voice' | 'image' | 'video' | 'file'; url?: string; mime?: string; caption?: string };
}
export interface SendMessageResponse { runId: string; }

export interface ResolveApprovalRequest { decision: 'approve' | 'reject'; }
export interface ResolveApprovalResponse { ok: boolean; }

export interface TaskRequest { sessionId: string; kind: 'subagent' | 'cron'; prompt: string; schedule?: string; }
export interface TaskResponse { taskId: string; }

export interface HealthResponse { status: 'ok'; version: string; }

// 会话键：platform:channel:user（与 Hermes 网关同构）。
export function sessionKey(platform: string, channel: string, user: string): string {
  return `${platform}:${channel}:${user}`;
}

export function parseSessionKey(key: string): { platform: string; channel: string; user: string } {
  const [platform, channel, user] = key.split(':');
  if (!platform || !channel || !user) throw new Error(`invalid session key: ${key}`);
  return { platform, channel, user };
}

export function encodeEvent(ev: ServerEvent): string {
  return JSON.stringify(ev);
}

export function decodeEvent(line: string): ServerEvent {
  const parsed = JSON.parse(line) as ServerEvent;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    throw new Error('invalid event payload');
  }
  return parsed;
}
```

- [ ] **Step 3: 写 `src/index.ts`**

```ts
export * from './protocol.js';
export * from './server.js';
export * from './client.js';
```

- [ ] **Step 4: 写失败测试 `test/protocol.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { sessionKey, parseSessionKey, encodeEvent, decodeEvent, type ServerEvent } from '../src/protocol.js';

describe('sessionKey', () => {
  it('拼装与解析往返一致', () => {
    const key = sessionKey('whatsapp', '60123456789', '60123456789');
    expect(key).toBe('whatsapp:60123456789:60123456789');
    expect(parseSessionKey(key)).toEqual({ platform: 'whatsapp', channel: '60123456789', user: '60123456789' });
  });

  it('缺字段的会话键抛错', () => {
    expect(() => parseSessionKey('only-one')).toThrow(/invalid session key/);
  });
});

describe('event codec', () => {
  it('encode/decode 往返一致', () => {
    const ev: ServerEvent = { type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 1, step: { kind: 'tool', label: 'echo' } };
    expect(decodeEvent(encodeEvent(ev))).toEqual(ev);
  });

  it('非法 payload 抛错', () => {
    expect(() => decodeEvent('{"foo":1}')).toThrow(/invalid event/);
  });
});
```

- [ ] **Step 5: 先跑测试确认失败**

```bash
cd <workspace>
npx vitest run packages/sdk/test/protocol.test.ts
```
Expected: FAIL（`../src/protocol.js` 不存在——因为 src 里还没有 server/client，index.ts 引用了不存在的文件）。**注意：** 若 TS 编译错误阻止测试，这是预期的；本任务先只跑类型无关的断言，`index.ts` 的 server/client 导出在 Task 5/6 补齐后再全绿。

- [ ] **Step 6: 提交**

```bash
git add packages/sdk
git commit -m "feat(sdk): Remote Session Driver 协议类型与会话键"
```

---

## Task 5: SDK 协议服务端（`ProtocolServer`）

**Files:**
- Create: `packages/sdk/src/server.ts`
- Create: `packages/sdk/test/server.test.ts`

- [ ] **Step 1: 写失败测试 `test/server.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { ProtocolServer, type ProtocolHandlers } from '../src/server.js';
import type { ServerEvent } from '../src/protocol.js';

const TOKEN = 'test-token';

function makeHandlers(emit: (ev: ServerEvent) => void): ProtocolHandlers {
  return {
    async upsertSession(req) {
      emit({ type: 'agent.status', sessionId: `${req.platform}:${req.channel}:${req.user}`, ts: Date.now(), status: 'busy' });
      return { sessionId: `${req.platform}:${req.channel}:${req.user}` };
    },
    async sendMessage(sessionId) {
      emit({ type: 'message.complete', sessionId, ts: Date.now(), text: 'pong' });
      return { runId: 'run-1' };
    },
    async resolveApproval(reqId, decision) { return { ok: decision === 'approve' }; },
    async createTask() { return { taskId: 'task-1' }; },
  };
}

describe('ProtocolServer', () => {
  const servers: ProtocolServer[] = [];

  async function startServer(): Promise<{ server: ProtocolServer; port: number; url: string }> {
    const server = new ProtocolServer({ token: TOKEN, handlers: makeHandlers((ev) => server.emit(ev)) });
    servers.push(server);
    const port = await server.listen(0);
    return { server, port, url: `http://127.0.0.1:${port}` };
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it('health 返回 ok', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/v1/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('无 token 返回 401', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/v1/health`);
    expect(res.status).toBe(401);
  });

  it('upsertSession 走 handlers', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/v1/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'cli', channel: 'cli', user: 'local' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId: 'cli:cli:local' });
  });

  it('sendMessage 与 WS 事件推送', async () => {
    const { server, url } = await startServer();
    const events: ServerEvent[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${(server.http.address() as AddressInfo).port}/v1/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    ws.onmessage = (m) => events.push(JSON.parse(String(m.data)) as ServerEvent);
    await new Promise<void>((resolve) => (ws.onopen = () => resolve()));

    const res = await fetch(`${url}/v1/sessions/cli%3Acli%3Alocal/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: 'run-1' });

    await new Promise((r) => setTimeout(r, 100));
    expect(events.some((e) => e.type === 'message.complete')).toBe(true);
    ws.close();
  });

  it('未知路由返回 404', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/v1/nope`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/sdk/test/server.test.ts
```
Expected: FAIL（`../src/server.js` 不存在）。

- [ ] **Step 3: 写 `src/server.ts`**

```ts
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  HealthResponse, ResolveApprovalResponse, SendMessageResponse, ServerEvent,
  TaskResponse, UpsertSessionResponse,
} from './protocol.js';

export interface ProtocolHandlers {
  upsertSession(req: { platform: string; channel: string; user: string }): Promise<UpsertSessionResponse>;
  sendMessage(sessionId: string, req: { text: string; media?: { kind: string; url?: string; mime?: string; caption?: string } }): Promise<SendMessageResponse>;
  resolveApproval(reqId: string, decision: 'approve' | 'reject'): Promise<ResolveApprovalResponse>;
  createTask(req: { sessionId: string; kind: 'subagent' | 'cron'; prompt: string; schedule?: string }): Promise<TaskResponse>;
}

export interface ProtocolServerOptions {
  token: string;
  handlers: ProtocolHandlers;
  version?: string;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export class ProtocolServer {
  readonly http: HttpServer;
  readonly version: string;
  private readonly wss: WebSocketServer;
  private readonly token: string;
  private readonly handlers: ProtocolHandlers;
  private readonly listeners = new Set<(ev: ServerEvent) => void>();

  constructor(opts: ProtocolServerOptions) {
    this.token = opts.token;
    this.handlers = opts.handlers;
    this.version = opts.version ?? '0.1.0';
    this.http = createServer((req, res) => void this.route(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req, socket, head) => {
      if (!this.authenticate(req)) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });
  }

  /** 返回实际监听端口（port=0 时为随机端口）。 */
  listen(port: number, host = '127.0.0.1'): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, host, () => resolve((this.http.address() as AddressInfo).port));
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => this.http.close(() => resolve()));
    });
  }

  emit(ev: ServerEvent): void {
    const line = JSON.stringify(ev);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(line);
    }
    for (const cb of this.listeners) cb(ev);
  }

  onEvent(cb: (ev: ServerEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private authenticate(req: IncomingMessage): boolean {
    return (req.headers.authorization ?? '') === `Bearer ${this.token}`;
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authenticate(req)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'health' && parts.length === 2) {
        send(200, { status: 'ok', version: this.version } satisfies HealthResponse);
        return;
      }
      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'sessions' && parts.length === 2) {
        const body = (await readJson(req)) as { platform: string; channel: string; user: string };
        send(200, await this.handlers.upsertSession(body));
        return;
      }
      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'messages') {
        const body = (await readJson(req)) as { text: string; media?: { kind: string; url?: string; mime?: string; caption?: string } };
        send(200, await this.handlers.sendMessage(decodeURIComponent(parts[2]), body));
        return;
      }
      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'approvals' && parts[2] && parts[3] === 'resolve') {
        const body = (await readJson(req)) as { decision: 'approve' | 'reject' };
        send(200, await this.handlers.resolveApproval(decodeURIComponent(parts[2]), body.decision));
        return;
      }
      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'tasks' && parts.length === 2) {
        const body = (await readJson(req)) as { sessionId: string; kind: 'subagent' | 'cron'; prompt: string; schedule?: string };
        send(200, await this.handlers.createTask(body));
        return;
      }
      send(404, { error: 'not found' });
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'internal error' }));
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/sdk/test/server.test.ts
```
Expected: 5 个测试全 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/sdk
git commit -m "feat(sdk): ProtocolServer（HTTP 路由 + WS 事件推送 + token 认证）"
```

---

## Task 6: SDK 客户端（`GatewayClient`）

**Files:**
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/test/client.test.ts`

- [ ] **Step 1: 写失败测试 `test/client.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolServer, type ProtocolHandlers } from '../src/server.js';
import { GatewayClient } from '../src/client.js';
import type { ServerEvent } from '../src/protocol.js';

const TOKEN = 'test-token';

describe('GatewayClient', () => {
  let server: ProtocolServer | undefined;
  let port = 0;

  async function start(): Promise<GatewayClient> {
    const emit = (ev: ServerEvent): void => server!.emit(ev);
    const handlers: ProtocolHandlers = {
      async upsertSession(req) { return { sessionId: `${req.platform}:${req.channel}:${req.user}` }; },
      async sendMessage(sessionId) {
        emit({ type: 'agent.status', sessionId, ts: Date.now(), status: 'busy' });
        emit({ type: 'message.complete', sessionId, ts: Date.now(), text: 'pong' });
        emit({ type: 'agent.status', sessionId, ts: Date.now(), status: 'idle' });
        return { runId: 'run-1' };
      },
      async resolveApproval(_reqId, decision) { return { ok: decision === 'approve' }; },
      async createTask() { return { taskId: 'task-1' }; },
    };
    server = new ProtocolServer({ token: TOKEN, handlers });
    port = await server.listen(0);
    return new GatewayClient(`http://127.0.0.1:${port}`, TOKEN);
  }

  afterEach(async () => { await server?.close(); server = undefined; });

  it('health / upsert / send / resolve 全链路', async () => {
    const client = await start();
    expect(await client.health()).toMatchObject({ status: 'ok' });

    const s = await client.upsertSession({ platform: 'cli', channel: 'cli', user: 'local' });
    expect(s.sessionId).toBe('cli:cli:local');

    const run = await client.sendMessage(s.sessionId, { text: 'hi' });
    expect(run.runId).toBe('run-1');

    const ok = await client.resolveApproval('req-1', 'reject');
    expect(ok.ok).toBe(false);
  });

  it('WS 订阅到服务端事件', async () => {
    const client = await start();
    const events: ServerEvent[] = [];
    await client.connect((ev) => events.push(ev));
    await client.sendMessage('cli:cli:local', { text: 'hi' });
    await new Promise((r) => setTimeout(r, 100));
    expect(events.some((e) => e.type === 'message.complete' && e.text === 'pong')).toBe(true);
  });

  it('错误 token 抛错', async () => {
    const bad = new GatewayClient(`http://127.0.0.1:${port}`, 'wrong');
    await expect(bad.health()).rejects.toThrow(/unauthorized/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/sdk/test/client.test.ts
```
Expected: FAIL（`../src/client.js` 不存在）。

- [ ] **Step 3: 写 `src/client.ts`**

```ts
import { WebSocket } from 'ws';
import type {
  HealthResponse, ResolveApprovalRequest, ResolveApprovalResponse, SendMessageRequest,
  SendMessageResponse, ServerEvent, TaskRequest, TaskResponse,
  UpsertSessionRequest, UpsertSessionResponse,
} from './protocol.js';

export class GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `request failed: ${res.status}`);
    return data;
  }

  health(): Promise<HealthResponse> {
    return this.request('GET', '/v1/health');
  }

  upsertSession(req: UpsertSessionRequest): Promise<UpsertSessionResponse> {
    return this.request('POST', '/v1/sessions', req);
  }

  sendMessage(sessionId: string, req: SendMessageRequest): Promise<SendMessageResponse> {
    return this.request('POST', `/v1/sessions/${encodeURIComponent(sessionId)}/messages`, req);
  }

  resolveApproval(reqId: string, decision: 'approve' | 'reject'): Promise<ResolveApprovalResponse> {
    const body = { decision } satisfies ResolveApprovalRequest;
    return this.request('POST', `/v1/approvals/${encodeURIComponent(reqId)}/resolve`, body);
  }

  createTask(req: TaskRequest): Promise<TaskResponse> {
    return this.request('POST', '/v1/tasks', req);
  }

  /** 建立 WS 事件订阅，返回断开函数。 */
  connect(onEvent: (ev: ServerEvent) => void): Promise<() => void> {
    const url = this.baseUrl.replace(/^http/, 'ws') + '/v1/events';
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` } });
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve(() => ws.close()));
      ws.on('error', reject);
      ws.on('message', (data) => {
        try {
          onEvent(JSON.parse(data.toString()) as ServerEvent);
        } catch {
          // 忽略畸形事件，不中断订阅
        }
      });
    });
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/sdk/test/client.test.ts
```
Expected: 3 个测试全 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/sdk
git commit -m "feat(sdk): GatewayClient（HTTP 调用 + WS 事件订阅）"
```

---

## Task 7: Mock DSH（协议服务端实现 + 模拟 agent）

**Files:**
- Create: `packages/mock-dsh/package.json`
- Create: `packages/mock-dsh/tsconfig.json`
- Create: `packages/mock-dsh/src/index.ts`
- Create: `packages/mock-dsh/test/mock.test.ts`

- [ ] **Step 1: 写包配置**

`packages/mock-dsh/package.json`：

```json
{
  "name": "@dsh-overdrive/mock-dsh",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "tsc" },
  "dependencies": { "@dsh-overdrive/sdk": "0.1.0" },
  "devDependencies": {}
}
```

`packages/mock-dsh/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 2: 写失败测试 `test/mock.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createMockDsh } from '../src/index.js';
import { GatewayClient, type ServerEvent } from '@dsh-overdrive/sdk';

const TOKEN = 'dev-token';

describe('mock-dsh', () => {
  let server: ReturnType<typeof createMockDsh> | undefined;
  let port = 0;

  async function start(): Promise<GatewayClient> {
    server = createMockDsh({ token: TOKEN });
    port = await server.listen(0);
    return new GatewayClient(`http://127.0.0.1:${port}`, TOKEN);
  }

  afterEach(async () => { await server?.close(); server = undefined; });

  it('普通消息 → busy → 轨迹 → complete', async () => {
    const client = await start();
    const events: ServerEvent[] = [];
    await client.connect((ev) => events.push(ev));
    await client.sendMessage('cli:cli:local', { text: 'hello' });
    await new Promise((r) => setTimeout(r, 200));

    const types = events.map((e) => e.type);
    expect(types).toContain('agent.status');
    expect(types).toContain('trajectory.step');
    expect(types).toContain('message.complete');
    const done = events.find((e) => e.type === 'message.complete');
    expect(done && 'text' in done && done.text).toBe('Mock agent received: hello');
  });

  it('包含 dangerous 的消息触发审批流，拒绝后不执行', async () => {
    const client = await start();
    const events: ServerEvent[] = [];
    await client.connect((ev) => events.push(ev));
    await client.sendMessage('cli:cli:local', { text: 'dangerous rm -rf' });
    await new Promise((r) => setTimeout(r, 100));

    const req = events.find((e) => e.type === 'approval.request') as
      { type: 'approval.request'; reqId: string; summary: string } | undefined;
    expect(req).toBeDefined();
    expect(req!.summary).toContain('dangerous');

    const ok = await client.resolveApproval(req!.reqId, 'reject');
    expect(ok.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    const done = events.find((e) => e.type === 'message.complete') as
      { type: 'message.complete'; text: string } | undefined;
    expect(done!.text).toContain('拒绝');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run packages/mock-dsh/test/mock.test.ts
```
Expected: FAIL（`createMockDsh` 不存在）。

- [ ] **Step 4: 写 `src/index.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { ProtocolServer, sessionKey, type ProtocolHandlers, type ServerEvent } from '@dsh-overdrive/sdk';

export function createMockDsh(opts: { token: string; version?: string }): ProtocolServer {
  return new ProtocolServer({
    token: opts.token,
    version: opts.version,
    handlers: makeMockHandlers((ev) => server.emit(ev)),
  });
}

function makeMockHandlers(emit: (ev: ServerEvent) => void): ProtocolHandlers {
  const pendingApprovals = new Map<string, (decision: 'approve' | 'reject') => void>();

  return {
    async upsertSession(req) {
      return { sessionId: sessionKey(req.platform, req.channel, req.user) };
    },

    async sendMessage(sessionId, req) {
      const runId = randomUUID();
      emit({ type: 'agent.status', sessionId, ts: Date.now(), status: 'busy' });
      emit({ type: 'trajectory.step', sessionId, ts: Date.now(), step: { kind: 'thought', label: '分析消息' } });
      emit({ type: 'trajectory.step', sessionId, ts: Date.now(), step: { kind: 'tool', label: 'mock.tool: echo', detail: req.text } });
      emit({ type: 'message.delta', sessionId, ts: Date.now(), text: '…' });

      if (req.text.toLowerCase().includes('dangerous')) {
        const reqId = randomUUID();
        pendingApprovals.set(reqId, (decision) => {
          const text = decision === 'approve' ? `✅ 已执行: ${req.text}` : `🚫 已拒绝: ${req.text}`;
          emit({ type: 'message.complete', sessionId, ts: Date.now(), text });
          emit({ type: 'agent.status', sessionId, ts: Date.now(), status: 'idle' });
        });
        emit({
          type: 'approval.request', sessionId, ts: Date.now(), reqId,
          summary: `执行危险操作: ${req.text}`, timeoutMs: 120_000,
        });
        return { runId };
      }

      setTimeout(() => {
        emit({ type: 'message.complete', sessionId, ts: Date.now(), text: `Mock agent received: ${req.text}` });
        emit({ type: 'agent.status', sessionId, ts: Date.now(), status: 'idle' });
      }, 50);
      return { runId };
    },

    async resolveApproval(reqId, decision) {
      const resolve = pendingApprovals.get(reqId);
      if (!resolve) return { ok: false };
      pendingApprovals.delete(reqId);
      resolve(decision);
      return { ok: true };
    },

    async createTask(req) {
      const taskId = randomUUID();
      setTimeout(() => {
        emit({ type: 'task.done', sessionId: req.sessionId, ts: Date.now(), taskId, ok: true });
      }, 50);
      return { taskId };
    },
  };
}

// 注意：上方 makeMockHandlers 里引用 server，需要先声明变量（见下方修正说明）。
```

> **修正说明（重要）：** `createMockDsh` 中 `server` 在 handlers 闭包内被引用，必须先声明再赋值。把 `createMockDsh` 改为：

```ts
export function createMockDsh(opts: { token: string; version?: string }): ProtocolServer {
  let server!: ProtocolServer;
  server = new ProtocolServer({
    token: opts.token,
    version: opts.version,
    handlers: makeMockHandlers((ev) => server.emit(ev)),
  });
  return server;
}
```

并用最终版替换文件中的 `createMockDsh`（其余部分不变）。

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run packages/mock-dsh/test/mock.test.ts
```
Expected: 2 个测试全 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/mock-dsh
git commit -m "feat(mock-dsh): 协议服务端实现（echo + 轨迹 + 审批流 + 任务）"
```

---

## Task 8: Gateway 骨架（适配器接口 + 会话键 + 白名单）

**Files:**
- Create: `packages/gateway/package.json`
- Create: `packages/gateway/tsconfig.json`
- Create: `packages/gateway/src/adapter.ts`
- Create: `packages/gateway/src/session.ts`
- Create: `packages/gateway/test/session.test.ts`

- [ ] **Step 1: 写包配置**

`packages/gateway/package.json`：

```json
{
  "name": "@dsh-overdrive/gateway",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "tsc" },
  "dependencies": { "@dsh-overdrive/sdk": "0.1.0" },
  "devDependencies": {}
}
```

`packages/gateway/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 2: 写失败测试 `test/session.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { Allowlist, buildSessionKey } from '../src/session.js';

describe('buildSessionKey', () => {
  it('用 adapterId + chatId + userId 拼会话键', () => {
    expect(buildSessionKey('whatsapp', { chatId: '60123', userId: '60123' })).toBe('whatsapp:60123:60123');
  });
});

describe('Allowlist', () => {
  it('空列表放行所有（开发模式）', () => {
    const allow = new Allowlist([]);
    expect(allow.allows('anything:any:any')).toBe(true);
  });

  it('非空列表只放行白名单条目', () => {
    const allow = new Allowlist(['whatsapp:60123:60123']);
    expect(allow.allows('whatsapp:60123:60123')).toBe(true);
    expect(allow.allows('whatsapp:99999:99999')).toBe(false);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/session.test.ts
```
Expected: FAIL（`../src/session.js` 不存在）。

- [ ] **Step 4: 写 `src/adapter.ts` 与 `src/session.ts`**

`src/adapter.ts`：

```ts
export interface NormalizedMessage {
  chatId: string;
  userId: string;
  text: string;
  media?: { kind: 'voice' | 'image' | 'video' | 'file'; url?: string; mime?: string; caption?: string };
}

export interface OutboundButton { id: string; label: string; }

export interface OutboundPayload {
  text: string;
  buttons?: OutboundButton[];
}

/** 平台适配器契约：M2/M3 的 WhatsApp/Telegram/… 都实现它。 */
export interface Adapter {
  readonly id: string;
  connect(): Promise<void>;
  send(chatId: string, payload: OutboundPayload): Promise<void>;
  onMessage(cb: (msg: NormalizedMessage) => void): void;
  onReply(cb: (buttonId: string) => void): void;
}
```

`src/session.ts`：

```ts
import { sessionKey } from '@dsh-overdrive/sdk';

export function buildSessionKey(
  adapterId: string,
  msg: { chatId: string; userId: string },
): string {
  return sessionKey(adapterId, msg.chatId, msg.userId);
}

/** 空列表 = 开发模式放行所有；生产环境必须显式配置。 */
export class Allowlist {
  constructor(private readonly entries: string[]) {}

  allows(key: string): boolean {
    return this.entries.length === 0 || this.entries.includes(key);
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run packages/gateway/test/session.test.ts
```
Expected: 3 个测试全 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/gateway
git commit -m "feat(gateway): 适配器契约 + 会话键 + 白名单"
```

---

## Task 9: CLI 适配器 + Gateway 主程序

**Files:**
- Create: `packages/gateway/src/adapters/cli.ts`
- Create: `packages/gateway/src/index.ts`
- Create: `packages/gateway/test/outbound.test.ts`

- [ ] **Step 1: 写失败测试 `test/outbound.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { planOutbound } from '../src/index.js';
import type { ServerEvent } from '@dsh-overdrive/sdk';

describe('planOutbound（事件 → 平台输出）', () => {
  it('message.complete → 纯文本', () => {
    const ev: ServerEvent = { type: 'message.complete', sessionId: 'cli:cli:local', ts: 1, text: '结果' };
    expect(planOutbound(ev)?.payload).toEqual({ text: '结果' });
  });

  it('trajectory.step → 带图标的轨迹行', () => {
    const ev: ServerEvent = { type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 1, step: { kind: 'tool', label: 'grep' } };
    expect(planOutbound(ev)?.payload.text).toBe('🛠️ grep');
  });

  it('approval.request → 文本 + 同意/拒绝两个按钮', () => {
    const ev: ServerEvent = { type: 'approval.request', sessionId: 'cli:cli:local', ts: 1, reqId: 'r1', summary: '删除文件', timeoutMs: 60000 };
    const out = planOutbound(ev)!;
    expect(out.payload.text).toContain('删除文件');
    expect(out.payload.buttons).toHaveLength(2);
    expect(out.payload.buttons![0].id).toBe('approve:r1');
    expect(out.payload.buttons![1].id).toBe('reject:r1');
  });

  it('message.delta 不输出（MVP 等 complete）', () => {
    const ev: ServerEvent = { type: 'message.delta', sessionId: 'cli:cli:local', ts: 1, text: '…' };
    expect(planOutbound(ev)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/outbound.test.ts
```
Expected: FAIL（`planOutbound` 不存在）。

- [ ] **Step 3: 写 `src/adapters/cli.ts`**

```ts
import { createInterface } from 'node:readline';
import type { Adapter, NormalizedMessage, OutboundPayload } from '../adapter.js';

/** 本地命令行适配器：M1 用于验证全链路，也是 M2+ 平台适配器的样板。 */
export class CliAdapter implements Adapter {
  readonly id = 'cli';
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;
  private rl?: ReturnType<typeof createInterface>;

  async connect(): Promise<void> {
    this.rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const btn = trimmed.match(/^\/btn\s+(\S+)$/i);
      if (btn) {
        this.replyCb?.(btn[1]);
        return;
      }
      this.messageCb?.({ chatId: 'cli', userId: 'local', text: trimmed });
    });
  }

  async send(_chatId: string, payload: OutboundPayload): Promise<void> {
    const lines = [payload.text];
    for (const b of payload.buttons ?? []) {
      lines.push(`  [按钮] ${b.label} → 输入 /btn ${b.id}`);
    }
    process.stdout.write(lines.join('\n') + '\n');
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
}
```

- [ ] **Step 4: 写 `src/index.ts`（planOutbound + main）**

```ts
import { GatewayClient, type ServerEvent } from '@dsh-overdrive/sdk';
import type { Adapter, OutboundPayload } from './adapter.js';
import { Allowlist, buildSessionKey } from './session.js';
import { CliAdapter } from './adapters/cli.js';

/** 事件 → 平台输出。纯函数，便于单测。返回 null 表示该事件不产出消息。 */
export function planOutbound(ev: ServerEvent): { payload: OutboundPayload } | null {
  switch (ev.type) {
    case 'message.complete':
      return { payload: { text: ev.text } };
    case 'message.delta':
      return null; // MVP：等 complete 一次性输出，流式渲染放 M4
    case 'trajectory.step': {
      const icon = ev.step.kind === 'tool' ? '🛠️' : ev.step.kind === 'subagent' ? '🤖' : '🧠';
      return { payload: { text: `${icon} ${ev.step.label}` } };
    }
    case 'approval.request':
      return {
        payload: {
          text: `⚠️ 需要批准：${ev.summary}（${Math.round(ev.timeoutMs / 1000)}s 内有效）`,
          buttons: [
            { id: `approve:${ev.reqId}`, label: '✅ 同意' },
            { id: `reject:${ev.reqId}`, label: '🚫 拒绝' },
          ],
        },
      };
    case 'agent.status':
      return ev.status === 'subagent-spawned'
        ? { payload: { text: '🤖 派生子任务…' } }
        : null;
    case 'task.done':
      return { payload: { text: ev.ok ? `✅ 任务完成 ${ev.taskId}` : `❌ 任务失败 ${ev.taskId}` } };
    case 'error':
      return { payload: { text: `❌ 出错了：${ev.message}` } };
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const dshBaseUrl = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:3191';
  const dshToken = process.env.DSH_TOKEN ?? 'dev-token';
  const allowlist = (process.env.ALLOWLIST ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const client = new GatewayClient(dshBaseUrl, dshToken);
  const adapter: Adapter = new CliAdapter();
  const allow = new Allowlist(allowlist);
  const chatIds = new Map<string, string>();

  await client.health(); // 确认 DSH 侧（或 mock）活着
  await adapter.connect();

  adapter.onMessage(async (msg) => {
    const key = buildSessionKey(adapter.id, msg);
    if (!allow.allows(key)) {
      await adapter.send(msg.chatId, { text: '⛔ 你不在白名单里。' });
      return;
    }
    chatIds.set(key, msg.chatId);
    await client.upsertSession({ platform: adapter.id, channel: msg.chatId, user: msg.userId });
    await client.sendMessage(key, { text: msg.text, media: msg.media });
  });

  adapter.onReply(async (buttonId) => {
    const idx = buttonId.indexOf(':');
    if (idx < 0) return;
    const action = buttonId.slice(0, idx);
    const reqId = buttonId.slice(idx + 1);
    if ((action === 'approve' || action === 'reject') && reqId) {
      await client.resolveApproval(reqId, action);
    }
  });

  const chatIdFor = (sessionId: string): string => {
    const known = chatIds.get(sessionId);
    if (known) return known;
    return sessionId.split(':')[1] ?? sessionId;
  };

  await client.connect((ev) => {
    const out = planOutbound(ev);
    if (out) void adapter.send(chatIdFor(ev.sessionId), out.payload);
  });

  process.stdout.write('[gateway] 就绪。输入消息开始对话；/btn <id> 触发按钮；Ctrl+C 退出。\n');
}

if (process.argv[1]?.endsWith('index.js')) void main();
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run packages/gateway/test/outbound.test.ts
```
Expected: 4 个测试全 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/gateway
git commit -m "feat(gateway): CLI 适配器 + 主程序（planOutbound 事件映射）"
```

---

## Task 10: 端到端（mock 全链路）

**Files:**
- Create: `test/e2e.mjs`

- [ ] **Step 1: 写 `test/e2e.mjs`**

```js
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 3191;
const TOKEN = 'dev-token';

async function waitHealth(base) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${base}/v1/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
      if (res.ok) return;
    } catch { /* 未就绪 */ }
    await sleep(100);
  }
  throw new Error('mock-dsh 未在 4s 内就绪');
}

function spawnAnd(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  child.output = '';
  child.stdout.on('data', (d) => { child.output += d.toString(); });
  return child;
}

async function waitText(child, needle, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.output.includes(needle)) return;
    await sleep(50);
  }
  throw new Error(`未在 ${timeoutMs}ms 内看到: ${needle}\n实际输出:\n${child.output}`);
}

// 1) 起 mock-dsh
const mock = spawnAnd('mock', ['packages/mock-dsh/dist/index.js', '--port', String(PORT), '--token', TOKEN]);
try {
  await waitHealth(`http://127.0.0.1:${PORT}`);

  // 2) 起 gateway（CLI 适配器）
  const gw = spawnAnd('gateway', ['packages/gateway/dist/index.js'], {
    DSH_BASE_URL: `http://127.0.0.1:${PORT}`,
    DSH_TOKEN: TOKEN,
    ALLOWLIST: 'cli:cli:local',
  });
  try {
    await waitText(gw, '[gateway] 就绪');

    // 3) 普通消息全链路
    gw.stdin.write('hello\n');
    await waitText(gw, '🧠 分析消息');
    await waitText(gw, 'Mock agent received: hello');
    console.log('PASS: 普通消息全链路');

    // 4) 审批流：dangerous 消息 → 按钮 → /btn approve
    gw.stdin.write('dangerous rm -rf /\n');
    await waitText(gw, '⚠️ 需要批准');
    const m = gw.output.match(/\/btn approve:(\S+)/);
    assert.ok(m, '应出现同意按钮');
    gw.stdin.write(`/btn approve:${m[1]}\n`);
    await waitText(gw, '✅ 已执行: dangerous rm -rf /');
    console.log('PASS: 审批流全链路');

    // 5) 白名单拦截
    const gw2 = spawnAnd('gateway2', ['packages/gateway/dist/index.js'], {
      DSH_BASE_URL: `http://127.0.0.1:${PORT}`,
      DSH_TOKEN: TOKEN,
      ALLOWLIST: 'cli:somebody:else', // 不匹配 cli:cli:local
    });
    try {
      await waitText(gw2, '[gateway] 就绪');
      gw2.stdin.write('hi\n');
      await waitText(gw2, '⛔ 你不在白名单里。');
      console.log('PASS: 白名单拦截');
    } finally {
      gw2.kill();
    }

    console.log('E2E 全部通过');
  } finally {
    gw.kill();
  }
} finally {
  mock.kill();
}
```

- [ ] **Step 2: 构建所有包**

```bash
cd <workspace>
npm run build
```
Expected: 每个 workspace 产出 `dist/`，无 TS 编译错误。若报错，修复后重跑。

- [ ] **Step 3: 跑全量单测 + E2E**

```bash
npx vitest run
npm run e2e
```
Expected: 全部单测 PASS；E2E 输出 `PASS: 普通消息全链路`、`PASS: 审批流全链路`、`PASS: 白名单拦截`、`E2E 全部通过`。

- [ ] **Step 4: 提交**

```bash
git add test/e2e.mjs
git commit -m "test(e2e): mock 全链路（消息/审批/白名单）"
```

---

## Task 11: gateway-core 插件雏形（可编译、可单测，真实桥接留到下一计划）

**依赖：** 本任务使用 Task 2 报告 §7 记录的确切 Cordis npm 包名与版本（记为 `@deepseek-ai/cordis@^4.0.1`；若报告里是别的名字/版本，以报告为准）。
**Files:**
- Create: `packages/gateway-core/package.json`
- Create: `packages/gateway-core/tsconfig.json`
- Create: `packages/gateway-core/src/index.ts`
- Create: `packages/gateway-core/test/plugin.test.ts`

- [ ] **Step 1: 写包配置**

`packages/gateway-core/package.json`：

```json
{
  "name": "@dsh-overdrive/gateway-core",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@dsh-overdrive/sdk": "0.1.0",
    "@deepseek-ai/cordis": "^4.0.1"
  },
  "devDependencies": {}
}
```

`packages/gateway-core/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 2: 写失败测试 `test/plugin.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { apply, name } from '../src/index.js';

/** 最小可用的 Cordis Context 替身：只实现本插件用到的 effect。 */
function fakeCtx() {
  const disposers: Array<() => Promise<void> | void> = [];
  return {
    ctx: {
      effect(cb: () => unknown) {
        const out = cb();
        if (typeof out === 'function') disposers.push(out as () => Promise<void> | void);
      },
    } as Parameters<typeof apply>[0],
    disposers,
  };
}

describe('gateway-core 插件', () => {
  let disposers: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const d of disposers.splice(0).reverse()) await d();
  });

  it('插件名与协议服务端可启动、health 可访问', async () => {
    expect(name).toBe('dsh-overdrive-gateway-core');

    const { ctx, disposers: ds } = fakeCtx();
    disposers = ds;
    const handle = apply(ctx, { token: 'test-token', port: 0 }) as unknown as {
      ready: Promise<{ port: number }>;
    };
    const { port } = await handle.ready;

    const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', version: '0.1.0' });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run packages/gateway-core/test/plugin.test.ts
```
Expected: FAIL（`../src/index.js` 不存在）。

- [ ] **Step 4: 写 `src/index.ts`**

```ts
import { Context } from '@deepseek-ai/cordis';
import { ProtocolServer, type ProtocolHandlers } from '@dsh-overdrive/sdk';

export const name = 'dsh-overdrive-gateway-core';

export interface GatewayCoreConfig {
  token?: string;
  port?: number;
}

/**
 * DSH 插件入口（Cordis 函数式插件）。
 * M1 雏形：只暴露协议服务端，handler 全部打日志占位；
 * 真正的 sessions/轨迹/审批桥接在 M0 报告（docs/interface-report.md §7）确认后于下一计划实现。
 */
export function apply(ctx: Context, config: GatewayCoreConfig = {}) {
  const token = config.token ?? 'dev-token';
  const port = config.port ?? 3192;

  const handlers: ProtocolHandlers = {
    async upsertSession(req) {
      console.log(`[gateway-core] upsertSession ${req.platform}:${req.channel}:${req.user}`);
      return { sessionId: `${req.platform}:${req.channel}:${req.user}` };
    },
    async sendMessage(sessionId, req) {
      console.log(`[gateway-core] sendMessage ${sessionId}: ${req.text}`);
      return { runId: 'mock-run' };
    },
    async resolveApproval(reqId, decision) {
      console.log(`[gateway-core] resolveApproval ${reqId} → ${decision}`);
      return { ok: true };
    },
    async createTask(req) {
      console.log(`[gateway-core] createTask ${req.kind}: ${req.prompt}`);
      return { taskId: 'mock-task' };
    },
  };

  const server = new ProtocolServer({ token, handlers, version: '0.1.0' });
  const ready = server.listen(port).then((p) => ({ port: p }));

  ctx.effect(() => () => server.close());

  return { server, ready };
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run packages/gateway-core/test/plugin.test.ts
```
Expected: 1 个测试 PASS。

- [ ] **Step 6: 全量回归 + 提交**

```bash
npx vitest run
npm run build
git add packages/gateway-core
git commit -m "feat(gateway-core): DSH 插件雏形（协议服务端 + 占位 handlers）"
```
Expected: 全量单测 PASS、构建无错误、commit 成功。

---

## Task 12: 收尾（文档指引 + 最终提交）

**Files:**
- Modify: `README.md`
- Create: `docs/interface-report.md`（若 Task 2 已完成则跳过）

- [ ] **Step 1: 更新 README 指向 M1 状态与后续计划**

```markdown
# dsh-overdrive

> 让 DeepSeek Harness 变成"超越 Hermes / OpenClaw"的多平台聊天智能体。

## 当前进度（M1 完成）

- ✅ Remote Session Driver 协议（HTTP + WS + token 认证）
- ✅ Mock DSH（模拟轨迹 / 审批流 / 子任务）
- ✅ Gateway 骨架 + CLI 适配器（全链路端到端通过）
- ✅ gateway-core 插件雏形（协议服务端，真实桥接待 M0 报告落地）

## 文档

- 设计：`docs/superpowers/specs/2026-08-16-dsh-overdrive-design.md`
- DSH 接口调研：`docs/interface-report.md`
- 实施计划：`docs/superpowers/plans/2026-08-16-dsh-overdrive-m0-m1.md`

## 本地验证

```bash
npm install
npm run build
npx vitest run
npm run e2e
```
```

- [ ] **Step 2: 最终检查与提交**

```bash
cd <workspace>
npx vitest run
npm run build
git add README.md
git commit -m "docs: M1 完成状态与本地验证说明"
git log --oneline
```
Expected: 全部 PASS；`git log` 显示 M0/M1 全部提交历史。

---

## Self-Review 结果

- **Spec 覆盖：** 设计文档 §5 组件（sdk/mock/gateway/gateway-core/web）——web 控制台属 M5，本计划不含；§6 协议（全部端点+事件）——Task 4-6；§7 数据流——Task 9-10；§8 安全（白名单/默认拒绝/审批超时）——Task 8/9（审批超时服务端实现在 mock，真实 DSH 侧由 M0 报告 §7 驱动下一计划）；§9 错误处理（重连/排队/分段）——M2/M4 计划；§10 测试——Task 4-11；§11 平台——M2/M3；§12 部署——M5；§13 M0/M1 对应 Task 1/2/3-11。
- **占位符扫描：** 无 TBD/TODO；Task 11 的 Cordis 包名以 Task 2 报告为准（有明确出处，非占位）。
- **类型一致性：** `ProtocolHandlers`/`ProtocolServer`/`GatewayClient`/`planOutbound`/`buildSessionKey`/`Allowlist`/`Adapter` 在各任务间签名一致；`createMockDsh` 的 `server` 闭包引用已在 Task 7 内以"修正说明"显式处理。
