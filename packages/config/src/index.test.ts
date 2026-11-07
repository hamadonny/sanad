import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig } from './index.js';

describe('config schema', () => {
  it('accepts the launch defaults', () => {
    expect(parseConfig(defaultConfig)).toEqual(defaultConfig);
  });

  it('rejects N outside 4..24', () => {
    expect(() =>
      parseConfig({ ...defaultConfig, circle: { ...defaultConfig.circle, membersPerCircle: 3 } }),
    ).toThrow();
    expect(() =>
      parseConfig({ ...defaultConfig, circle: { ...defaultConfig.circle, membersPerCircle: 25 } }),
    ).toThrow();
  });

  it('rejects P >= N', () => {
    expect(() =>
      parseConfig({
        ...defaultConfig,
        circle: { ...defaultConfig.circle, membersPerCircle: 4, prioritySpots: 4 },
      }),
    ).toThrow(/prioritySpots/);
  });
});
