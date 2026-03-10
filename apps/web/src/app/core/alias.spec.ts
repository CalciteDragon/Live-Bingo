import { generateAlias } from './alias';

describe('generateAlias', () => {
  it('returns a non-empty string', () => {
    const alias = generateAlias();
    expect(typeof alias).toBe('string');
    expect(alias.length).toBeGreaterThan(0);
  });

  it('returns a string with no spaces', () => {
    expect(generateAlias()).not.toContain(' ');
  });

  it('generates different values across repeated calls', () => {
    const results = new Set(Array.from({ length: 30 }, () => generateAlias()));
    // With 10×10 = 100 combinations and 30 draws, near-zero chance of only 1 unique value
    expect(results.size).toBeGreaterThan(1);
  });
});
