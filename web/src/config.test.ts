import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatXlm, isClosed, parseXlm, percentFunded, STROOPS_PER_XLM, timeLeft } from './config';

const NOW_SECONDS = 1_800_000_000;

function freezeClock() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_SECONDS * 1000);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseXlm', () => {
  it('converts whole and fractional XLM to stroops', () => {
    expect(parseXlm('1')).toBe(STROOPS_PER_XLM);
    expect(parseXlm('0.5')).toBe(5_000_000n);
    expect(parseXlm('25.1234567')).toBe(251_234_567n);
    expect(parseXlm('  10  ')).toBe(100_000_000n);
  });

  it('treats a bare fraction and a trailing dot as valid', () => {
    expect(parseXlm('.25')).toBe(2_500_000n);
    expect(parseXlm('3.')).toBe(30_000_000n);
  });

  it('rejects more precision than XLM has', () => {
    expect(() => parseXlm('1.12345678')).toThrow(/7 decimal places/);
  });

  it.each(['', '.', 'abc', '1,5', '-1', '1.2.3'])('rejects %j', (input) => {
    expect(() => parseXlm(input)).toThrow();
  });
});

describe('formatXlm', () => {
  it('renders stroops as XLM without trailing zeros', () => {
    expect(formatXlm(STROOPS_PER_XLM)).toBe('1');
    expect(formatXlm(5_000_000n)).toBe('0.5');
    expect(formatXlm(0n)).toBe('0');
  });

  it('groups thousands', () => {
    expect(formatXlm(10_000_000_000n)).toBe('1,000');
  });

  it('truncates beyond the requested precision rather than rounding up', () => {
    expect(formatXlm(19_999_999n)).toBe('1.9999');
    expect(formatXlm(19_999_999n, 7)).toBe('1.9999999');
  });

  it('keeps the sign on negative amounts', () => {
    expect(formatXlm(-5_000_000n)).toBe('-0.5');
  });
});

describe('parseXlm / formatXlm round trip', () => {
  // formatXlm groups thousands for display, so compare without the separators.
  it.each(['0', '1', '0.5', '25.1234567', '1000'])('survives %j', (input) => {
    expect(formatXlm(parseXlm(input), 7).replace(/,/g, '')).toBe(Number(input).toString());
  });
});

describe('percentFunded', () => {
  it('reports progress toward the goal', () => {
    expect(percentFunded(0n, 100n)).toBe(0);
    expect(percentFunded(25n, 100n)).toBe(25);
    expect(percentFunded(1n, 3n)).toBeCloseTo(33.33, 2);
  });

  it('goes past 100 for an over-funded campaign, so callers can clamp', () => {
    expect(percentFunded(250n, 100n)).toBe(250);
  });

  it('does not divide by a zero goal', () => {
    expect(percentFunded(10n, 0n)).toBe(0);
  });
});

describe('timeLeft', () => {
  it('counts down in the largest useful unit', () => {
    freezeClock();
    const inSeconds = (offset: number) => BigInt(NOW_SECONDS + offset);

    expect(timeLeft(inSeconds(3 * 86_400 + 4 * 3_600))).toBe('3d 4h left');
    expect(timeLeft(inSeconds(5 * 3_600 + 30 * 60))).toBe('5h 30m left');
    expect(timeLeft(inSeconds(90))).toBe('1m left');
  });

  it('reports a passed deadline as closed', () => {
    freezeClock();
    expect(timeLeft(BigInt(NOW_SECONDS))).toBe('Closed');
    expect(timeLeft(BigInt(NOW_SECONDS - 1))).toBe('Closed');
  });
});

describe('isClosed', () => {
  it('flips exactly at the deadline', () => {
    freezeClock();
    expect(isClosed(BigInt(NOW_SECONDS + 1))).toBe(false);
    expect(isClosed(BigInt(NOW_SECONDS))).toBe(true);
    expect(isClosed(BigInt(NOW_SECONDS - 1))).toBe(true);
  });
});
