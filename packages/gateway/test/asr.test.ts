import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranscriber, extensionForMime } from '../src/asr.js';

describe('extensionForMime', () => {
  it('maps known audio mimes', () => {
    expect(extensionForMime('audio/ogg')).toBe('ogg');
    expect(extensionForMime('audio/mpeg')).toBe('mp3');
    expect(extensionForMime('audio/mp4')).toBe('m4a');
    expect(extensionForMime('audio/wav')).toBe('wav');
    expect(extensionForMime('audio/webm')).toBe('webm');
  });
  it('ignores parameters and case', () => {
    expect(extensionForMime('audio/OGG; codecs=opus')).toBe('ogg');
  });
  it('falls back for unknown or missing mime', () => {
    expect(extensionForMime('application/x-foo')).toBe('oga');
    expect(extensionForMime(undefined)).toBe('oga');
    expect(extensionForMime('')).toBe('oga');
  });
});

describe('createTranscriber.transcribe', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('未配置 API key 时禁用且不发起请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const asr = createTranscriber({})
    expect(asr.enabled).toBe(false)
    expect(await asr.transcribe({ url: 'https://x/v.ogg' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('下载音频并调用 OpenAI 兼容转写端点，返回文本', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['fake-audio']) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: '  你好世界  ' }) })
    vi.stubGlobal('fetch', fetchMock)
    const asr = createTranscriber({ apiKey: 'sk-test', baseUrl: 'https://api.siliconflow.cn/v1', model: 'whisper-1' })
    expect(asr.enabled).toBe(true)
    const text = await asr.transcribe({ url: 'https://x/v.ogg', mime: 'audio/ogg' })
    expect(text).toBe('你好世界')

    // 第一次 fetch：下载音频；第二次：转写端点
    expect(fetchMock.mock.calls[0][0]).toBe('https://x/v.ogg')
    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toBe('https://api.siliconflow.cn/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer sk-test')
    expect(init.body).toBeInstanceOf(FormData)
    const filename = (init.body as FormData).get('file') as File
    expect(filename.name).toBe('voice.ogg')
  })

  it('下载失败返回 null（不抛错）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 403 }))
    const asr = createTranscriber({ apiKey: 'sk-test' })
    expect(await asr.transcribe({ url: 'https://x/v.ogg' })).toBeNull()
  })

  it('转写端点失败返回 null', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['x']) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' })
    vi.stubGlobal('fetch', fetchMock)
    const asr = createTranscriber({ apiKey: 'sk-test' })
    expect(await asr.transcribe({ url: 'https://x/v.ogg' })).toBeNull()
  })

  it('无 url 返回 null', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const asr = createTranscriber({ apiKey: 'sk-test' })
    expect(await asr.transcribe({ mime: 'audio/ogg' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
