import { describe, it, expect } from 'vitest';
import {
    escapeHTML,
    normalizeDayArray,
    normalizeStaffingArray,
    isWorkDay,
    isFixedCurrentDay,
    shouldMirrorCurrentToDesired,
    getWorkBlocks,
    getXBlocks,
    getXMovePairs,
    applyXMovesOnly,
    getIVDChangeIndices,
    applyIVDOnly,
    analyzePCSPair,
    ALLOWED_DAY_CODES,
} from '../lib/pcs-engine.js';

// ─── escapeHTML ──────────────────────────────────────────────────────────────

describe('escapeHTML', () => {
    it('escapes &', () => {
        expect(escapeHTML('a&b')).toBe('a&amp;b');
    });

    it('escapes <, >, ", and \'', () => {
        expect(escapeHTML('<script>"test"</script>')).toBe('&lt;script&gt;&quot;test&quot;&lt;/script&gt;');
        expect(escapeHTML("it's")).toBe("it&#39;s");
    });

    it('leaves safe strings unchanged', () => {
        expect(escapeHTML('hello world')).toBe('hello world');
    });

    it('coerces non-strings', () => {
        expect(escapeHTML(42)).toBe('42');
        expect(escapeHTML(null)).toBe('null');
    });
});

// ─── normalizeDayArray ───────────────────────────────────────────────────────

describe('normalizeDayArray', () => {
    it('returns filled array when input is wrong length', () => {
        expect(normalizeDayArray(['X', 'R'], 5)).toEqual(['X', 'X', 'X', 'X', 'X']);
    });

    it('returns filled array when input is not an array', () => {
        expect(normalizeDayArray(null, 3, 'R')).toEqual(['R', 'R', 'R']);
    });

    it('preserves valid codes', () => {
        const input = ['X', 'R', 'A', 'CQ', 'CI'];
        expect(normalizeDayArray(input, 5)).toEqual(input);
    });

    it('replaces invalid codes with fallback', () => {
        expect(normalizeDayArray(['X', 'INVALID', 'R'], 3)).toEqual(['X', 'X', 'R']);
    });

    it('replaces non-string values with fallback', () => {
        expect(normalizeDayArray([42, true, 'R'], 3)).toEqual(['X', 'X', 'R']);
    });

    it('allows IVD as a valid code', () => {
        expect(normalizeDayArray(['IVD', 'R', 'X'], 3)).toEqual(['IVD', 'R', 'X']);
    });
});

// ─── normalizeStaffingArray ──────────────────────────────────────────────────

describe('normalizeStaffingArray', () => {
    it('returns all-true when input is wrong length', () => {
        expect(normalizeStaffingArray([true], 3)).toEqual([true, true, true]);
    });

    it('returns all-true when input is not an array', () => {
        expect(normalizeStaffingArray(null, 2)).toEqual([true, true]);
    });

    it('preserves boolean values', () => {
        expect(normalizeStaffingArray([true, false, true], 3)).toEqual([true, false, true]);
    });

    it('replaces non-boolean values with true', () => {
        expect(normalizeStaffingArray([1, 'yes', false], 3)).toEqual([true, true, false]);
    });
});

// ─── isWorkDay ───────────────────────────────────────────────────────────────

describe('isWorkDay', () => {
    it('R is a work day', () => expect(isWorkDay('R')).toBe(true));
    it('CI is a work day', () => expect(isWorkDay('CI')).toBe(true));
    it('X is not a work day', () => expect(isWorkDay('X')).toBe(false));
    it('A is not a work day', () => expect(isWorkDay('A')).toBe(false));
    it('CQ is not a work day', () => expect(isWorkDay('CQ')).toBe(false));
    it('IVD is not a work day', () => expect(isWorkDay('IVD')).toBe(false));
});

// ─── isFixedCurrentDay ───────────────────────────────────────────────────────

describe('isFixedCurrentDay', () => {
    it('A is fixed', () => expect(isFixedCurrentDay('A')).toBe(true));
    it('CQ is fixed', () => expect(isFixedCurrentDay('CQ')).toBe(true));
    it('CI is fixed', () => expect(isFixedCurrentDay('CI')).toBe(true));
    it('R is not fixed', () => expect(isFixedCurrentDay('R')).toBe(false));
    it('X is not fixed', () => expect(isFixedCurrentDay('X')).toBe(false));
    it('IVD is not fixed', () => expect(isFixedCurrentDay('IVD')).toBe(false));
});

// ─── shouldMirrorCurrentToDesired ────────────────────────────────────────────

describe('shouldMirrorCurrentToDesired', () => {
    it('mirrors when prev is fixed (A)', () => {
        expect(shouldMirrorCurrentToDesired('A', 'R')).toBe(true);
    });

    it('mirrors when next is fixed (CQ)', () => {
        expect(shouldMirrorCurrentToDesired('R', 'CQ')).toBe(true);
    });

    it('does not mirror when neither is fixed', () => {
        expect(shouldMirrorCurrentToDesired('R', 'X')).toBe(false);
    });
});

// ─── getWorkBlocks ───────────────────────────────────────────────────────────

describe('getWorkBlocks', () => {
    it('finds a single work block', () => {
        expect(getWorkBlocks(['X', 'R', 'R', 'R', 'X'])).toEqual([
            { start: 1, end: 3, len: 3 },
        ]);
    });

    it('finds multiple work blocks', () => {
        expect(getWorkBlocks(['R', 'R', 'X', 'R', 'X'])).toEqual([
            { start: 0, end: 1, len: 2 },
            { start: 3, end: 3, len: 1 },
        ]);
    });

    it('includes CI as work days', () => {
        expect(getWorkBlocks(['CI', 'CI', 'R', 'X'])).toEqual([
            { start: 0, end: 2, len: 3 },
        ]);
    });

    it('CQ does not count as a work day', () => {
        expect(getWorkBlocks(['R', 'CQ', 'R'])).toEqual([
            { start: 0, end: 0, len: 1 },
            { start: 2, end: 2, len: 1 },
        ]);
    });

    it('returns empty for no work days', () => {
        expect(getWorkBlocks(['X', 'X', 'A'])).toEqual([]);
    });

    it('handles all work days', () => {
        expect(getWorkBlocks(['R', 'R', 'R'])).toEqual([
            { start: 0, end: 2, len: 3 },
        ]);
    });
});

// ─── getXBlocks ──────────────────────────────────────────────────────────────

describe('getXBlocks', () => {
    it('finds X blocks', () => {
        expect(getXBlocks(['X', 'X', 'R', 'X'])).toEqual([
            { start: 0, end: 1, len: 2 },
            { start: 3, end: 3, len: 1 },
        ]);
    });

    it('non-X codes break blocks', () => {
        expect(getXBlocks(['X', 'A', 'X'])).toEqual([
            { start: 0, end: 0, len: 1 },
            { start: 2, end: 2, len: 1 },
        ]);
    });

    it('returns empty when no X days', () => {
        expect(getXBlocks(['R', 'A', 'CQ'])).toEqual([]);
    });
});

// ─── getXMovePairs ───────────────────────────────────────────────────────────

describe('getXMovePairs', () => {
    it('finds removed and added X positions', () => {
        const curr = ['X', 'X', 'R', 'R', 'R'];
        const des =  ['R', 'R', 'R', 'X', 'X'];
        const result = getXMovePairs(curr, des);
        expect(result.removed).toEqual([0, 1]); // X→R
        expect(result.added).toEqual([3, 4]);    // R→X
    });

    it('respects firstMovableIdx', () => {
        const curr = ['X', 'R', 'R'];
        const des =  ['R', 'R', 'X'];
        const result = getXMovePairs(curr, des, 1); // fmi=1, index 0 is frozen
        expect(result.removed).toEqual([]); // index 0 is before fmi
        expect(result.added).toEqual([2]);
    });

    it('returns empty when schedules are identical', () => {
        const sched = ['X', 'R', 'X'];
        const result = getXMovePairs(sched, sched);
        expect(result.removed).toEqual([]);
        expect(result.added).toEqual([]);
    });
});

// ─── applyXMovesOnly ────────────────────────────────────────────────────────

describe('applyXMovesOnly', () => {
    it('applies only X↔R swaps', () => {
        const curr = ['X', 'X', 'R', 'R', 'R'];
        const des =  ['R', 'R', 'R', 'X', 'X'];
        expect(applyXMovesOnly(curr, des)).toEqual(['R', 'R', 'R', 'X', 'X']);
    });

    it('preserves non-X/R codes from current', () => {
        const curr = ['X', 'A', 'R', 'CQ', 'R'];
        const des =  ['R', 'A', 'X', 'CQ', 'R'];
        expect(applyXMovesOnly(curr, des)).toEqual(['R', 'A', 'X', 'CQ', 'R']);
    });

    it('respects fmi', () => {
        const curr = ['X', 'R', 'R'];
        const des =  ['R', 'R', 'X'];
        // fmi=1: index 0 frozen
        expect(applyXMovesOnly(curr, des, 1)).toEqual(['X', 'R', 'X']);
    });
});

// ─── getIVDChangeIndices ─────────────────────────────────────────────────────

describe('getIVDChangeIndices', () => {
    it('finds indices where IVD is added or removed', () => {
        const curr = ['R', 'R', 'IVD', 'X'];
        const des =  ['IVD', 'R', 'R', 'X'];
        expect(getIVDChangeIndices(curr, des)).toEqual([0, 2]);
    });

    it('ignores non-IVD changes', () => {
        const curr = ['X', 'R'];
        const des =  ['R', 'X'];
        expect(getIVDChangeIndices(curr, des)).toEqual([]);
    });

    it('returns empty when identical', () => {
        const sched = ['IVD', 'R', 'X'];
        expect(getIVDChangeIndices(sched, sched)).toEqual([]);
    });
});

// ─── applyIVDOnly ────────────────────────────────────────────────────────────

describe('applyIVDOnly', () => {
    it('applies IVD changes without touching X/R moves', () => {
        const curr = ['R', 'R', 'IVD', 'X', 'X'];
        const des =  ['IVD', 'X', 'R', 'R', 'X'];
        // Only IVD changes at index 0 (R→IVD) and 2 (IVD→R)
        expect(applyIVDOnly(curr, des)).toEqual(['IVD', 'R', 'R', 'X', 'X']);
    });
});

// ─── analyzePCSPair ──────────────────────────────────────────────────────────

describe('analyzePCSPair', () => {
    const settings = { minWork: 4, maxXblocks: 4 };
    const bidMonth = { firstMovableIdx: 0, start: new Date(2025, 3, 1) }; // Apr 1

    it('validates identical schedules as valid', () => {
        const sched = ['R', 'R', 'R', 'R', 'X', 'X', 'X', 'R', 'R', 'R', 'R', 'R', 'R', 'R',
                       'R', 'R', 'R', 'R', 'R', 'X', 'X', 'X', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R'];
        const result = analyzePCSPair(sched, sched, settings, bidMonth);
        expect(result.valid).toBe(true);
        expect(result.blocked).toBe(false);
        expect(result.violations).toEqual([]);
    });

    it('blocks when X count mismatches (D2)', () => {
        const curr = ['X', 'X', 'R', 'R', 'R'];
        const des =  ['X', 'R', 'R', 'R', 'R']; // 1 X vs 2
        const result = analyzePCSPair(curr, des, settings, bidMonth);
        expect(result.blocked).toBe(true);
        expect(result.blockedReason).toContain('X-day count mismatch');
    });

    it('blocks when frozen day is changed', () => {
        const bm = { firstMovableIdx: 3, start: new Date(2025, 3, 1) };
        const curr = ['X', 'R', 'R', 'R', 'R'];
        const des =  ['R', 'R', 'X', 'R', 'R']; // changed day 0 which is before fmi=3
        const result = analyzePCSPair(curr, des, settings, bm);
        expect(result.blocked).toBe(true);
        expect(result.blockedReason).toContain('cannot be changed');
    });

    it('detects P2 violation: X placed on non-R day', () => {
        const curr = ['CQ', 'R', 'R', 'R', 'R', 'R', 'X', 'X'];
        const des =  ['X', 'R', 'R', 'R', 'R', 'R', 'R', 'X']; // X on CQ day
        const result = analyzePCSPair(curr, des, settings, bidMonth);
        expect(result.violations.some(v => v.rule === 'P2')).toBe(true);
    });

    it('detects P3 violation: short work block', () => {
        // Current: 4R 3X 4R 3X 3R 3X 3R 7X (30 days, 10X)
        const curr = [
            'R', 'R', 'R', 'R', 'X', 'X', 'X', 'R', 'R', 'R',
            'R', 'X', 'X', 'X', 'R', 'R', 'R', 'X', 'X', 'X',
            'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R',
        ];
        // Desired: move X to create a 2-day R block in middle
        const des = [
            'R', 'R', 'R', 'R', 'R', 'X', 'X', 'R', 'R', 'R',
            'R', 'X', 'X', 'X', 'R', 'R', 'X', 'X', 'X', 'X',
            'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R',
        ];
        const result = analyzePCSPair(curr, des, settings, bidMonth);
        // Day 14-15 is a 2-day block, below minWork 4
        expect(result.violations.some(v => v.rule === 'P3')).toBe(true);
    });

    it('allows short work block at end of period (E1)', () => {
        // Short R block touching the last day
        const curr = ['X', 'X', 'R', 'R', 'R', 'R', 'R', 'R'];
        const des =  ['R', 'R', 'R', 'R', 'R', 'R', 'X', 'X'];
        // Des has work block at end: days 0-5 (6R) then X,X
        // Actually des[0-5] = R (6 days), des[6-7] = X
        // That's fine. Let me make a case where end block is short.
        const curr2 = ['X', 'X', 'X', 'R', 'R', 'R', 'R', 'R'];
        const des2 =  ['R', 'X', 'X', 'X', 'R', 'R', 'R', 'R'];
        // des2: R X X X R R R R → work blocks: {0,0,1}, {4,7,4}
        // block at index 0 has len=1, below minWork, but doesn't touch end
        // Let me create a proper end-of-period case:
        const curr3 = ['R', 'R', 'R', 'R', 'X', 'X', 'R', 'R', 'R', 'R'];
        const des3 =  ['R', 'R', 'R', 'R', 'R', 'R', 'X', 'X', 'R', 'R'];
        // des3: work blocks: {0,5,6}, {8,9,2}
        // block {8,9,2} touches lastIdx=9 → E1 exempt
        const result = analyzePCSPair(curr3, des3, settings, bidMonth);
        expect(result.violations.filter(v => v.rule === 'P3')).toEqual([]);
    });

    it('detects P10 violation: removing X from middle of block', () => {
        // Current X block at indices 4-8, desired removes index 6 (middle)
        const curr = ['R', 'R', 'R', 'R', 'X', 'X', 'X', 'X', 'X', 'R', 'R', 'R', 'R', 'R'];
        const des =  ['R', 'R', 'R', 'R', 'X', 'X', 'R', 'X', 'X', 'R', 'R', 'R', 'X', 'R'];
        const result = analyzePCSPair(curr, des, settings, bidMonth);
        expect(result.violations.some(v => v.rule === 'P10')).toBe(true);
    });

    it('allows P10 when removing from ends of X block', () => {
        // Remove first X from block (touch start)
        const curr = ['R', 'R', 'R', 'R', 'X', 'X', 'X', 'R', 'R', 'R', 'R', 'R', 'R', 'R'];
        const des =  ['R', 'R', 'R', 'R', 'R', 'X', 'X', 'R', 'R', 'R', 'R', 'R', 'X', 'R'];
        const result = analyzePCSPair(curr, des, settings, bidMonth);
        expect(result.violations.filter(v => v.rule === 'P10')).toEqual([]);
    });

    it('detects maxXblocks violation', () => {
        const s = { minWork: 1, maxXblocks: 2 };
        // 3 X blocks
        const curr = ['X', 'R', 'X', 'R', 'X', 'R', 'R', 'R'];
        const des =  ['X', 'R', 'X', 'R', 'X', 'R', 'R', 'R'];
        const result = analyzePCSPair(curr, des, s, bidMonth);
        expect(result.violations.some(v => v.rule === 'maxXblocks')).toBe(true);
    });

    it('detects P9 violation: IVD placed on non-R day', () => {
        const curr = ['X', 'R', 'R', 'R', 'R', 'R', 'R', 'R'];
        const des =  ['IVD', 'R', 'R', 'R', 'R', 'R', 'R', 'R']; // IVD on X day
        // X count: curr has 1 X, des has 0 X → blocked by D2 first
        // Let me fix: keep same X count
        const curr2 = ['X', 'X', 'R', 'R', 'R', 'R', 'R', 'A'];
        const des2 =  ['IVD', 'X', 'R', 'R', 'R', 'R', 'R', 'A']; // IVD on X day
        // X count: curr2 has 2, des2 has 1 → mismatch. Need to balance.
        // Better test:
        const curr3 = ['CQ', 'R', 'R', 'R', 'R', 'R', 'X', 'X'];
        const des3 =  ['CQ', 'R', 'R', 'R', 'R', 'R', 'X', 'X'];
        // P9: IVD newly placed on CQ
        const curr4 = ['R', 'R', 'R', 'R', 'X', 'X', 'CQ', 'R'];
        const des4 =  ['R', 'R', 'R', 'R', 'X', 'X', 'IVD', 'R']; // IVD on CQ
        // X count same (2). IVD on CQ day → P9 violation
        const result = analyzePCSPair(curr4, des4, settings, bidMonth);
        expect(result.violations.some(v => v.rule === 'P9')).toBe(true);
    });

    it('allows P9: IVD placed on R day', () => {
        const curr = ['R', 'R', 'R', 'R', 'X', 'X', 'R', 'R'];
        const des =  ['R', 'R', 'R', 'R', 'X', 'X', 'IVD', 'R'];
        // IVD on R day → allowed (P9 satisfied)
        // X count same (2). Work block: des has {0,3,4} and {7,7,1}
        // block {7,7,1} is 1 day, below minWork, but P9 exemption applies
        const result = analyzePCSPair(curr, des, settings, bidMonth);
        expect(result.violations.filter(v => v.rule === 'P9')).toEqual([]);
    });

    it('blocks when CI is not contiguous from day 0 (D3)', () => {
        const curr = ['R', 'CI', 'R', 'R', 'X', 'X', 'R', 'R']; // CI at index 1, not 0
        const des =  ['R', 'CI', 'R', 'R', 'X', 'X', 'R', 'R'];
        const result = analyzePCSPair(curr, des, settings, bidMonth);
        expect(result.blocked).toBe(true);
        expect(result.blockedReason).toContain('CI day placement');
    });

    it('returns summary with adds/removes count', () => {
        const curr = ['R', 'R', 'R', 'R', 'X', 'X', 'R', 'R', 'R', 'R'];
        const des =  ['R', 'R', 'X', 'X', 'R', 'R', 'R', 'R', 'R', 'R'];
        const result = analyzePCSPair(curr, des, settings, bidMonth);
        expect(result.summary.adds).toBe(2);    // R→X
        expect(result.summary.removes).toBe(2);  // X→R
    });

    it('reports P12 advisory for R→X on staffing-blocked day', () => {
        const curr = ['R', 'R', 'R', 'R', 'X', 'X', 'R', 'R', 'R', 'R'];
        const des =  ['R', 'R', 'X', 'X', 'R', 'R', 'R', 'R', 'R', 'R'];
        const staffing = [true, true, false, true, true, true, true, true, true, true];
        const result = analyzePCSPair(curr, des, settings, bidMonth, staffing);
        expect(result.advisories.some(a => a.rule === 'P12')).toBe(true);
        expect(result.valid).toBe(false);
    });
});

// ─── ALLOWED_DAY_CODES ───────────────────────────────────────────────────────

describe('ALLOWED_DAY_CODES', () => {
    it('contains all expected codes', () => {
        expect(ALLOWED_DAY_CODES.has('X')).toBe(true);
        expect(ALLOWED_DAY_CODES.has('R')).toBe(true);
        expect(ALLOWED_DAY_CODES.has('A')).toBe(true);
        expect(ALLOWED_DAY_CODES.has('CQ')).toBe(true);
        expect(ALLOWED_DAY_CODES.has('CI')).toBe(true);
        expect(ALLOWED_DAY_CODES.has('IVD')).toBe(true);
    });

    it('does not contain invalid codes', () => {
        expect(ALLOWED_DAY_CODES.has('Z')).toBe(false);
        expect(ALLOWED_DAY_CODES.has('C')).toBe(false);
        expect(ALLOWED_DAY_CODES.has('')).toBe(false);
    });
});
