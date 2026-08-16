import { describe, expect, it } from 'vitest';
import {
  buildNumberedText,
  decryptWeComPayload,
  encryptWeComPayload,
  matchNumberedButton,
  parseWeComXmlMessage,
} from '../src/adapters/wecom.js';

const KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'; // 43 位 EncodingAESKey

describe('企业微信 AES 加解密（往返）', () => {
  it('encrypt → decrypt 还原原文（含 receiveId）', () => {
    const { encrypted } = encryptWeComPayload(KEY, 'hello', 'corpid123');
    const out = decryptWeComPayload(KEY, encrypted);
    expect(out.message).toBe('hello');
    expect(out.receiveId).toBe('corpid123');
  });

  it('中文消息往返', () => {
    const { encrypted } = encryptWeComPayload(KEY, '你好，世界', 'ww1234567890');
    const out = decryptWeComPayload(KEY, encrypted);
    expect(out.message).toBe('你好，世界');
    expect(out.receiveId).toBe('ww1234567890');
  });
});

describe('parseWeComXmlMessage（回调 XML → NormalizedMessage）', () => {
  it('文本消息', () => {
    const xml = `<xml><ToUserName><![CDATA[ww1]]></ToUserName><FromUserName><![CDATA[user1]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[你好]]></Content></xml>`;
    const out = parseWeComXmlMessage(xml);
    expect(out).toMatchObject({ chatId: 'user1', userId: 'user1', text: '你好' });
  });
  it('非文本返回 null', () => {
    const xml = `<xml><FromUserName><![CDATA[u]]></FromUserName><MsgType><![CDATA[image]]></MsgType></xml>`;
    expect(parseWeComXmlMessage(xml)).toBeNull();
  });
});

describe('buildNumberedText（审批编号回复）', () => {
  it('生成 1/2 选项文本', () => {
    const text = buildNumberedText('需要批准', [
      { id: 'approve:r1', label: '同意' },
      { id: 'reject:r1', label: '拒绝' },
    ]);
    expect(text).toContain('1) 同意');
    expect(text).toContain('2) 拒绝');
    expect(text).toContain('回复数字选择');
  });
  it('无按钮时原样返回', () => {
    expect(buildNumberedText('plain', [])).toBe('plain');
  });
  it('matchNumberedButton 命中选项', () => {
    const buttons = [
      { id: 'approve:r1', label: '同意' },
      { id: 'reject:r1', label: '拒绝' },
    ];
    expect(matchNumberedButton('2', buttons)).toEqual(buttons[1]);
    expect(matchNumberedButton('3', buttons)).toBeUndefined();
    expect(matchNumberedButton('abc', buttons)).toBeUndefined();
  });
});
