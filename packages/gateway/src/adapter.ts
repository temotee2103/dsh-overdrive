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
  /** 可选：平台"正在输入"指示（Telegram/WhatsApp 实现，其余默认无操作）。 */
  sendTyping?(chatId: string): Promise<void>;
  onMessage(cb: (msg: NormalizedMessage) => void): void;
  onReply(cb: (buttonId: string) => void): void;
}
