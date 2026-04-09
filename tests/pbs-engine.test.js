import { describe, it, expect } from 'vitest';
import {
    PRORATION_LOOKUP,
    countAvailableDays,
    countXUsed,
    getRequiredXDays,
    countXBlocks,
    checkWorkBlock,
    validateSchedule,
} from '../lib/pbs-engine.js';

// ─── countAvailableDays ──────────────────────────────────────────────────────

describe('countAvailableDays', () => {
    it('counts all days when no A days present', () => {
        expect(countAvailableDays(['X', 'R', 'R', 'X', 'R'])).toBe(5);
    });

    it('excludes A days', () => {
        expect(countAvailableDays(['A', 'R', 'R', 'A', 'X'])).toBe(3);
    });

    it('does not exclude CQ, CI, or Z', () => {
        expect(countAvailableDays(['CQ', 'CI', 'Z', 'R', 'X'])).toBe(5);
    });

    it('returns 0 for all A days', () => {
        expect(countAvailableDays(['A', 'A', 'A'])).toBe(0);
    });

    it('handles empty array', () => {
        expect(countAvailableDays([])).toBe(0);
    });
});

// ─── countXUsed ──────────────────────────────────────────────────────────────

describe('countXUsed', () => {
    it('counts X days', () => {
        expect(countXUsed(['X', 'R', 'X', 'R', 'X'])).toBe(3);
    });

    it('counts Z as X', () => {
        expect(countXUsed(['X', 'Z', 'R', 'Z'])).toBe(3);
    });

    it('ignores other codes', () => {
        expect(countXUsed(['A', 'CQ', 'CI', 'R'])).toBe(0);
    });
});

// ─── getRequiredXDays ────────────────────────────────────────────────────────

describe('getRequiredXDays', () => {
    it('returns correct base requirement for 30-day cat1 period', () => {
        // 30-day period, 30 available days, cat1 → lookup[30]["cat1"][30] = 13
        expect(getRequiredXDays(30, 30, 'cat1', false)).toBe(13);
    });

    it('returns correct base requirement for 31-day cat2 period', () => {
        // 31-day period, 31 available days, cat2 → lookup[31]["cat2"][31] = 13
        expect(getRequiredXDays(31, 31, 'cat2', false)).toBe(13);
    });

    it('adds 1 when extraX is true', () => {
        const base = getRequiredXDays(30, 30, 'cat1', false);
        expect(getRequiredXDays(30, 30, 'cat1', true)).toBe(base + 1);
    });

    it('returns 0 for 0 available days', () => {
        expect(getRequiredXDays(30, 0, 'cat1', false)).toBe(0);
    });

    it('returns 0 for unknown day count', () => {
        expect(getRequiredXDays(28, 20, 'cat1', false)).toBe(0);
    });

    it('handles reduced availability from A days', () => {
        // 30-day period, only 15 available (15 A days), cat1 → lookup[30]["cat1"][15] = 7
        expect(getRequiredXDays(30, 15, 'cat1', false)).toBe(7);
    });
});

// ─── countXBlocks ────────────────────────────────────────────────────────────

describe('countXBlocks', () => {
    it('counts a single block', () => {
        expect(countXBlocks(['R', 'R', 'X', 'X', 'X', 'R'])).toBe(1);
    });

    it('counts multiple separated blocks', () => {
        expect(countXBlocks(['X', 'X', 'R', 'R', 'X', 'R', 'X', 'X'])).toBe(3);
    });

    it('treats Z as X', () => {
        expect(countXBlocks(['Z', 'Z', 'R', 'X', 'Z'])).toBe(2);
    });

    it('A days do not break an X block', () => {
        // X A X should be 1 block (A doesn't break)
        expect(countXBlocks(['X', 'A', 'X'])).toBe(1);
    });

    it('R breaks an X block', () => {
        expect(countXBlocks(['X', 'R', 'X'])).toBe(2);
    });

    it('returns 0 when no X or Z days', () => {
        expect(countXBlocks(['R', 'R', 'A', 'CQ'])).toBe(0);
    });

    it('handles all X days as one block', () => {
        expect(countXBlocks(['X', 'X', 'X', 'X'])).toBe(1);
    });
});

// ─── checkWorkBlock ──────────────────────────────────────────────────────────

describe('checkWorkBlock', () => {
    const settings = { minW: 4, maxW: 99 };

    it('returns no alerts for empty indices', () => {
        const result = checkWorkBlock([], 0, 10, [], settings);
        expect(result.alerts).toEqual([]);
        expect(result.illegal).toEqual([]);
    });

    it('skips blocks with only CQ/CI (no R or C)', () => {
        const combo = ['CQ', 'CQ', 'CI'];
        const result = checkWorkBlock([0, 1, 2], 0, 3, combo, settings);
        expect(result.alerts).toEqual([]);
    });

    it('flags short work blocks below minWork', () => {
        // 3-day R block in a 10-day month, minWork=4
        const combo = ['X', 'R', 'R', 'R', 'X', 'X', 'X', 'X', 'X', 'X'];
        const result = checkWorkBlock([1, 2, 3], 0, 10, combo, settings);
        expect(result.alerts).toContain('Short Work Block');
        expect(result.illegal).toEqual([1, 2, 3]);
    });

    it('exempts end-of-month blocks from minWork', () => {
        // 2-day R block touching the last day of the period
        const combo = ['X', 'X', 'X', 'R', 'R'];
        const result = checkWorkBlock([3, 4], 0, 5, combo, settings);
        expect(result.alerts).toEqual([]);
    });

    it('flags blocks exceeding maxWork', () => {
        const s = { minW: 1, maxW: 3 };
        const combo = ['R', 'R', 'R', 'R'];
        const result = checkWorkBlock([0, 1, 2, 3], 0, 4, combo, s);
        expect(result.alerts).toContain('Work Block exceeds Max');
    });

    it('handles cross-month blocks with offset', () => {
        // Previous month: [R, R], Current month: [R, X, X] → 3-day block spans boundary
        const combo = ['R', 'R', 'R', 'X', 'X'];
        const result = checkWorkBlock([0, 1, 2], 2, 3, combo, settings);
        // Block is 3 days, minW is 4 → short, but only current-month indices flagged
        expect(result.alerts).toContain('Short Work Block');
        expect(result.illegal).toEqual([0]); // index 2 in combo → 0 in current
    });
});

// ─── validateSchedule ────────────────────────────────────────────────────────

describe('validateSchedule', () => {
    const defaultSettings = { minW: 4, maxW: 99, maxX: 4, alv: 'cat1', extraX: false };

    it('validates a legal 30-day schedule', () => {
        // 30-day period: 30 avail, cat1 → need 13 X days
        const days = [
            'X', 'X', 'X', 'X', 'R', 'R', 'R', 'R', 'R', 'R',
            'X', 'X', 'X', 'R', 'R', 'R', 'R', 'R', 'R', 'R',
            'X', 'X', 'X', 'R', 'R', 'R', 'R', 'X', 'X', 'X',
        ];
        const result = validateSchedule(days, 30, defaultSettings);
        expect(result.xUsed).toBe(13);
        expect(result.xReq).toBe(13);
        expect(result.alerts).toEqual([]);
        expect(result.illegalIndices).toEqual([]);
    });

    it('detects too few X days', () => {
        // All R in a 30-day period → 0 X, needs 13
        const days = Array(30).fill('R');
        const result = validateSchedule(days, 30, defaultSettings);
        expect(result.xUsed).toBe(0);
        expect(result.alerts).toContain('Need 13 more X');
    });

    it('detects too many X days', () => {
        // All X in 30 days → 30 X, needs 13
        const days = Array(30).fill('X');
        const result = validateSchedule(days, 30, defaultSettings);
        expect(result.alerts).toContain('Too many X');
    });

    it('detects exceeding max X blocks', () => {
        const settings = { ...defaultSettings, maxX: 2 };
        // 3 separate X blocks
        const days = [
            'X', 'R', 'R', 'R', 'R', 'X', 'R', 'R', 'R', 'R',
            'X', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R',
            'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R',
        ];
        const result = validateSchedule(days, 30, settings);
        expect(result.xBlks).toBe(3);
        expect(result.alerts).toContain('Exceeds Max X Blocks');
    });

    it('detects short work blocks', () => {
        // 2-day R block in the middle (minWork=4)
        const days = [
            'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X',
            'R', 'R', 'X', 'R', 'R', 'R', 'R', 'R', 'R', 'R',
            'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'X',
        ];
        const result = validateSchedule(days, 30, defaultSettings);
        expect(result.alerts).toContain('Short Work Block');
        expect(result.illegalIndices).toContain(10);
        expect(result.illegalIndices).toContain(11);
    });

    it('accounts for A days in availability', () => {
        // 5 A days reduces availability from 30 to 25
        const days = [
            'A', 'A', 'A', 'A', 'A', 'X', 'X', 'X', 'X', 'X',
            'X', 'X', 'X', 'X', 'X', 'X', 'R', 'R', 'R', 'R',
            'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R',
        ];
        const result = validateSchedule(days, 30, defaultSettings);
        expect(result.availCount).toBe(25);
        // cat1, 30-day, 25 avail → lookup = 11
        expect(result.xReq).toBe(11);
    });

    it('validates cross-month work block spanning boundary', () => {
        // Previous month ends with [R, R], current month starts with [R, X, ...]
        // Combined: [R, R, R, X, ...] → 3-day block, minWork=4 → short
        const prevDays = Array(28).fill('X');
        prevDays[26] = 'R';
        prevDays[27] = 'R';

        const days = [
            'R', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X',
            'X', 'X', 'X', 'R', 'R', 'R', 'R', 'R', 'R', 'R',
            'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R',
        ];
        const result = validateSchedule(days, 30, defaultSettings, prevDays);
        expect(result.alerts).toContain('Short Work Block');
        expect(result.illegalIndices).toContain(0);
    });
});

// ─── PRORATION_LOOKUP ────────────────────────────────────────────────────────

describe('PRORATION_LOOKUP', () => {
    it('has entries for 30 and 31 day periods', () => {
        expect(PRORATION_LOOKUP).toHaveProperty('30');
        expect(PRORATION_LOOKUP).toHaveProperty('31');
    });

    it('30-day cat1 has 31 entries (indices 0-30)', () => {
        expect(PRORATION_LOOKUP['30']['cat1']).toHaveLength(31);
    });

    it('31-day cat1 has 32 entries (indices 0-31)', () => {
        expect(PRORATION_LOOKUP['31']['cat1']).toHaveLength(32);
    });

    it('cat1 always >= cat2 for same availability', () => {
        for (const period of ['30', '31']) {
            const cat1 = PRORATION_LOOKUP[period]['cat1'];
            const cat2 = PRORATION_LOOKUP[period]['cat2'];
            for (let i = 0; i < cat1.length; i++) {
                expect(cat1[i]).toBeGreaterThanOrEqual(cat2[i]);
            }
        }
    });

    it('proration values are monotonically non-decreasing', () => {
        for (const period of ['30', '31']) {
            for (const cat of ['cat1', 'cat2']) {
                const arr = PRORATION_LOOKUP[period][cat];
                for (let i = 1; i < arr.length; i++) {
                    expect(arr[i]).toBeGreaterThanOrEqual(arr[i - 1]);
                }
            }
        }
    });
});
