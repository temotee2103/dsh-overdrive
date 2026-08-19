import { createInterface } from 'node:readline';
import type { Adapter, NormalizedMessage, OutboundPayload } from '../adapter.js';

/** 本地命令行适配器：M1 用于验证全链路，也是 M2+ 平台适配器的样板。 */
export class CliAdapter implements Adapter {
  readonly id = 'cli';
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string, sender: { chatId: string; userId: string }) => void;
  private rl?: ReturnType<typeof createInterface>;

  async connect(): Promise<void> {
    this.rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const btn = trimmed.match(/^\/btn\s+(\S+)$/i);
      if (btn) {
        this.replyCb?.(btn[1], { chatId: 'cli', userId: 'local' });
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
  onReply(cb: (buttonId: string, sender: { chatId: string; userId: string }) => void): void { this.replyCb = cb; }
  /** CLI 是本地进程内适配器：恒为已连接。 */
  status(): { connected: boolean } { return { connected: true }; }
}
