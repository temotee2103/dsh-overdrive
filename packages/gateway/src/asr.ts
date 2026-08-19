// ASR 语音转写（Roadmap v0.2）。
// 通过 OpenAI 兼容的 /audio/transcriptions 端点（OpenAI / SiliconFlow / Groq 等）把
// 语音消息转成文本。未配置 API key 时完全禁用（保持原有"不支持转写"降级路径）。

export interface AsrConfig {
  apiKey?: string;
  /** OpenAI 兼容 API 根地址，默认 https://api.openai.com/v1 */
  baseUrl?: string;
  /** 转写模型，默认 whisper-1 */
  model?: string;
}

export interface AsrVoiceInput {
  url?: string;
  mime?: string;
}

export interface AsrTranscriber {
  readonly enabled: boolean;
  /** 转写语音消息 → 文本；未启用 / 下载或转写失败 → null（调用方走原降级路径）。 */
  transcribe(voice: AsrVoiceInput): Promise<string | null>;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'whisper-1';

/** MIME → 文件扩展名（OpenAI 转写接口要求带正确扩展名的文件名）。 */
export function extensionForMime(mime?: string): string {
  if (!mime) return 'oga';
  const map: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/oga': 'oga',
    'audio/opus': 'opus',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
  };
  const key = mime.split(';')[0].trim().toLowerCase();
  return map[key] ?? 'oga';
}

export function createTranscriber(config: AsrConfig = {}): AsrTranscriber {
  const enabled = Boolean(config.apiKey);
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = config.model ?? DEFAULT_MODEL;

  async function transcribe(voice: AsrVoiceInput): Promise<string | null> {
    if (!enabled || !voice.url) return null;
    try {
      const audioRes = await fetch(voice.url);
      if (!audioRes.ok) {
        console.warn(`[asr] 下载音频失败: ${audioRes.status}`);
        return null;
      }
      const audioBlob = await audioRes.blob();
      const form = new FormData();
      form.append('file', audioBlob, `voice.${extensionForMime(voice.mime)}`);
      form.append('model', model);
      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        console.warn(`[asr] 转写失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const data = (await res.json()) as { text?: string };
      const text = data.text?.trim();
      return text ? text : null;
    } catch (error) {
      console.warn(`[asr] 转写异常: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  return { enabled, transcribe };
}
