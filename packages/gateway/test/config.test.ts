import { describe, expect, it } from 'vitest';
import { createAdapter, parseAdapterIds, type AdapterEnv } from '../src/config.js';

describe('parseAdapterIds', () => {
  it('逗号分隔 + 去空格 + 去空项', () => {
    expect(parseAdapterIds('cli, whatsapp, telegram,')).toEqual(['cli', 'whatsapp', 'telegram']);
  });
  it('缺省为 cli', () => {
    expect(parseAdapterIds('')).toEqual(['cli']);
  });
});

describe('createAdapter 注册表', () => {
  it('cli 恒可用', () => {
    const a = createAdapter('cli', {});
    expect(a.id).toBe('cli');
  });
  it('未知适配器抛错', () => {
    expect(() => createAdapter('nope', {})).toThrow(/unknown adapter/);
  });
});
