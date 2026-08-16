import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

// 用 fileURLToPath 而非 URL.pathname：后者在含空格路径上返回百分号编码的
// POSIX 风格路径（如 /C:/Users/Temo%20Tee/...），Windows spawn 的 cwd 无法识别。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
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

  // 2) 起 gateway（CLI 适配器）；GATEWAY_CONSOLE_PORT=0 让系统分配空闲端口，避免多实例/本机端口冲突
  const gw = spawnAnd('gateway', ['packages/gateway/dist/index.js'], {
    DSH_BASE_URL: `http://127.0.0.1:${PORT}`,
    DSH_TOKEN: TOKEN,
    ALLOWLIST: 'cli:cli:local',
    GATEWAY_CONSOLE_PORT: '0',
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
      GATEWAY_CONSOLE_PORT: '0',
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
