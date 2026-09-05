import type { Context } from '@deepseek-ai/cordis';
import { createDshRuntime, type DshRuntime, type DshRuntimeOptions, type MediaRef } from './dsh-runtime.js';
import { extractAssistantText, type DshSessionEvent } from './derive.js';
import { fromDshSessionId, toDshSessionId } from './keys.js';

/**
 * 进程内原生桥接接缝（P0，进程内化迁移第一阶段）。
 *
 * 与旧架构的区别：不再经 ProtocolServer + 外部 gateway，而是平台 driver
 * 直接在 DSH 进程内驱动 ctx.agents 会话。会话 id 沿用 `dsh:<platform>:<channel>:<user>`
 * （keys.ts），出站事件由 DSH session/event 映射回平台消息。
 */

/** 平台 driver 收到的出站载荷（由 DSH 会话事件派生）。 */
export type NativeOutbound =
  | { kind: 'status'; status: 'busy' | 'idle' }
  | { kind: 'delta'; text: string }
  | { kind: 'complete'; text: string }
  | { kind: 'trajectory'; step: { kind: 'tool' | 'thought' | 'note'; label: string } };

/** 一个平台驱动的抽象面：平台连接 + 把载荷发给会话的 (channel,user)。 */
export interface NativeDriver {
  /** 平台名（进会话 key，如 'telegram'/'feishu'/'cli'）。 */
  readonly platform: string;
  /** 发送一条出站载荷到该会话；实现方负责分片/排版/按钮。 */
  send(to: { channel: string; user: string }, outbound: NativeOutbound): Promise<void> | void;
}

/** NativeBridge 构造参数：runtime 选项 + 平台 driver。 */
export interface NativeBridgeOptions extends DshRuntimeOptions {
  driver: NativeDriver;
}

export interface NativeBridge {
  /** 入站：用户消息进入会话并唤醒 agent。media 可选（图片/语音，见 DshRuntime）。 */
  handleUserMessage(
    to: { channel: string; user: string },
    text: string,
    media?: MediaRef,
  ): Promise<void>;
  /** 访问底层 runtime（测试/高级扩展用）。 */
  readonly runtime: DshRuntime;
}

/** DSH SessionEvent → NativeOutbound 的纯函数映射（与 deriveProtocolEvents 同语义，但不依赖 SDK 类型）。 */
export function deriveNativeOutbound(event: DshSessionEvent): NativeOutbound[] {
  switch (event.type) {
    case 'turn/start':
      return [{ kind: 'status', status: 'busy' }];
    case 'turn/end':
      return [{ kind: 'status', status: 'idle' }];
    case 'assistant/chunk': {
      const chunk = event.data.chunk as { type?: string; text?: string } | undefined;
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        return [{ kind: 'delta', text: chunk.text }];
      }
      return [];
    }
    case 'assistant/message': {
      const text = extractAssistantText(event);
      if (!text) return [];
      return [{ kind: 'complete', text }];
    }
    case 'tool/call': {
      const name = typeof event.data.name === 'string' ? event.data.name : 'unknown';
      return [{ kind: 'trajectory', step: { kind: 'tool', label: name } }];
    }
    default:
      return [];
  }
}

/** 会话事件里该会话的 (channel,user)，供 driver 回投；非网关前缀返回 null。 */
export function outboundTarget(
  sessionId: string,
  prefix = 'dsh',
): { channel: string; user: string } | null {
  try {
    const { platform: _platform, channel, user } = fromDshSessionId(sessionId, prefix);
    return { channel, user };
  } catch {
    return null;
  }
}

/**
 * 创建进程内原生桥接：入站消息 → runtime.ensureAgent/followup；
 * runtime 的 session/event → deriveNativeOutbound → driver.send。
 */
export function createNativeBridge(ctx: Context, options: NativeBridgeOptions): NativeBridge {
  const runtime = createDshRuntime(ctx, {
    cwd: options.cwd,
    sessionPrefix: options.sessionPrefix,
    model: options.model,
  });
  const driver = options.driver;
  const prefix = options.sessionPrefix ?? 'dsh';

  runtime.onSessionEvent((sessionId, event) => {
    const target = outboundTarget(sessionId, prefix);
    if (!target) return; // 非本网关注入的会话（如 Web 创建的）不在此桥接
    for (const outbound of deriveNativeOutbound(event)) {
      try {
        void driver.send(target, outbound);
      } catch (error) {
        console.warn(
          `[gateway-core] ${driver.platform} 出站发送失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  });

  return {
    runtime,
    async handleUserMessage(to, text, media) {
      const dshSessionId = toDshSessionId(driver.platform, to.channel, to.user, prefix);
      const agent = await runtime.ensureAgent(dshSessionId);
      agent.followup(await runtime.buildUserMessage(text, media));
    },
  };
}
