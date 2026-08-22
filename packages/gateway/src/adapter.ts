export interface NormalizedMessage {
  chatId: string;
  userId: string;
  text: string;
  media?: { kind: 'voice' | 'image' | 'video' | 'file'; url?: string; mime?: string; caption?: string };
}

export interface OutboundButton { id: string; label: string; }

/** 出站媒体（/send 等）：path 为本地文件路径。 */
export interface OutboundMedia {
  kind: 'image' | 'file' | 'voice';
  path: string;
  caption?: string;
}

export interface OutboundPayload {
  text: string;
  buttons?: OutboundButton[];
  /** 可选：随消息发送的本地媒体文件；不支持媒体的适配器忽略并只发文本。 */
  media?: OutboundMedia;
}

/** 按钮回执的点击者身份（用于白名单校验）。chatId 在个别平台回调中可能缺失，缺失时按未授权处理（fail-closed）。 */
export interface ReplySender {
  chatId: string;
  userId: string;
}

/** 平台适配器契约：M2/M3 的 WhatsApp/Telegram/… 都实现它。 */
export interface Adapter {
  readonly id: string;
  connect(): Promise<void>;
  send(chatId: string, payload: OutboundPayload): Promise<void>;
  /** 可选：平台"正在输入"指示（Telegram/WhatsApp 实现，其余默认无操作）。 */
  sendTyping?(chatId: string): Promise<void>;
  /** 可选：连接状态（供控制台）。 */
  status?(): { connected: boolean };
  onMessage(cb: (msg: NormalizedMessage) => void): void;
  /** 按钮点击回执：buttonId + 点击者身份。身份缺失即传空字符串，由上层按未授权处理。 */
  onReply(cb: (buttonId: string, sender: ReplySender) => void): void;
}
