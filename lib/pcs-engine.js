// Pure business-logic functions extracted from pcs/pcs.js.
// These have no DOM, localStorage, or Supabase dependencies.

export const ALLOWED_DAY_CODES = new Set(['X', 'R', 'A', 'CQ', 'CI', 'IVD']);
export const FIXED_CURRENT_CODES = new Set(['A', 'CQ', 'CI']);

export function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function normalizeDayArray(arr, expectedDays, fallbackCode = 'X') {
    if (!Array.isArray(arr) || arr.length !== expectedDays) {
        return Array(expectedDays).fill(fallbackCode);
    }
    return arr.map(code => (typeof code === 'string' && ALLOWED_DAY_CODES.has(code)) ? code : fallbackCode);
}

export function normalizeStaffingArray(arr, expectedDays) {
    if (!Array.isArray(arr) || arr.length !== expectedDays) {
        return Array(expectedDays).fill(true);
    }
    return arr.map(v => typeof v === 'boolean' ? v : true);
}

export function isWorkDay(code) {
    return code === 'R' || code === 'CI';
}

export function isFixedCurrentDay(code) {
    return FIXED_CURRENT_CODES.has(code);
}

export function shouldMirrorCurrentToDesired(prevCode, nextCode) {
    return isFixedCurrentDay(prevCode) || isFixedCurrentDay(nextCode);
}

export function getWorkBlocks(days) {
    const blocks = [];
    let i = 0;
    while (i < days.length) {
        if (isWorkDay(days[i])) {
            let j = i;
            while (j < days.length && isWorkDay(days[j])) j++;
            blocks.push({ start: i, end: j - 1, len: j - i });
            i = j;
        } else { i++; }
    }
    return blocks;
}

export function getXBlocks(days) {
    const blocks = [];
    let i = 0;
    while (i < days.length) {
        if (days[i] === 'X') {
            let j = i;
            while (j < days.length && days[j] === 'X') j++;
            blocks.push({ start: i, end: j - 1, len: j - i });
            i = j;
        } else { i++; }
    }
    return blocks;
}

export function getXMovePairs(curr, des, fmi = 0) {
    const removed = [];
    const added = [];
    curr.forEach((code, i) => {
        if (i < fmi) return;
        if (code === 'X' && des[i] === 'R') removed.push(i);
        if (code === 'R' && des[i] === 'X') added.push(i);
    });
    return { removed, added };
}

export function applyXMovesOnly(curr, des, fmi = 0) {
    const next = [...curr];
    const { removed, added } = getXMovePairs(curr, des, fmi);
    removed.forEach(i => { next[i] = 'R'; });
    added.forEach(i => { next[i] = 'X'; });
    return next;
}

export function getIVDChangeIndices(curr, des) {
    const idxs = [];
    for (let i = 0; i < curr.length; i++) {
        if (curr[i] === des[i]) continue;
        if (curr[i] === 'IVD' || des[i] === 'IVD') idxs.push(i);
    }
    return idxs;
}

export function applyIVDOnly(curr, des) {
    const next = [...curr];
    getIVDChangeIndices(curr, des).forEach(i => {
        next[i] = des[i];
    });
    return next;
}

// Analyze a PCS schedule pair (current → desired) for rule violations.
//
// Unlike the browser version (pcs.js), this accepts all dependencies as parameters
// rather than reading from globals/DOM:
//   - settings: { minWork, maxXblocks }
//   - bidMonth: { firstMovableIdx, start }  (start is a Date for calDate formatting)
//   - staffing: boolean[] (optional; defaults to all-true if not provided)
//
// Returns { blocked, blockedReason?, violations, advisories?, valid, summary? }
export function analyzePCSPair(curr, des, settings, bidMonth, staffing) {
    const { minWork, maxXblocks } = settings;
    const lastIdx = curr.length - 1;
    const violations = [];
    const advisories = [];
    const p9AddedIVDOnR = new Set();
    const fmi = bidMonth.firstMovableIdx || 0;
    const staffArr = staffing || Array(curr.length).fill(true);

    // Helper to format day index as a calendar date string
    const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function calDate(dIdx) {
        const d = new Date(bidMonth.start);
        d.setDate(bidMonth.start.getDate() + dIdx);
        return `${MON_NAMES[d.getMonth()]} ${d.getDate()}`;
    }
    function calDateRange(startIdx, endIdx) {
        if (startIdx === endIdx) return calDate(startIdx);
        const s = new Date(bidMonth.start); s.setDate(bidMonth.start.getDate() + startIdx);
        const e = new Date(bidMonth.start); e.setDate(bidMonth.start.getDate() + endIdx);
        if (s.getMonth() === e.getMonth()) {
            return `${MON_NAMES[s.getMonth()]} ${s.getDate()}\u2013${e.getDate()}`;
        }
        return `${MON_NAMES[s.getMonth()]} ${s.getDate()}\u2013${MON_NAMES[e.getMonth()]} ${e.getDate()}`;
    }

    // Freeze check: days before firstMovableIdx cannot differ
    for (let i = 0; i < fmi && i < curr.length; i++) {
        if (curr[i] !== des[i]) {
            return {
                blocked: true,
                blockedReason: `${calDate(i)} cannot be changed. The deadline to move a day is 2200 ET four days prior.`,
                violations: [],
            };
        }
    }

    // D2: X count must match
    const currX = curr.filter(d => d === 'X').length;
    const desX = des.filter(d => d === 'X').length;
    if (currX !== desX) {
        return {
            blocked: true,
            blockedReason: `X-day count mismatch: Current has ${currX}, Desired has ${desX}.`,
            violations: [],
        };
    }

    // D3: CI must be contiguous and touch the first day
    const ciIndices = curr.reduce((a, d, i) => (d === 'CI' ? [...a, i] : a), []);
    if (ciIndices.length > 0) {
        if (curr[0] !== 'CI') {
            return { blocked: true, blockedReason: 'Check CI day placement in current month', violations: [] };
        }
        for (let k = 1; k < ciIndices.length; k++) {
            if (ciIndices[k] !== ciIndices[k - 1] + 1) {
                return { blocked: true, blockedReason: 'Check CI day placement in current month', violations: [] };
            }
        }
    }

    // P12: R→X transitions on staffing-blocked dates
    for (let i = 0; i <= lastIdx; i++) {
        if (curr[i] === 'R' && des[i] === 'X' && staffArr[i] === false) {
            advisories.push({
                rule: 'P12',
                message: `${calDate(i)}: Res Avail < Res Req... Moving this X day probably won't work. To continue, remove black day(s) and try again.`,
            });
        }
    }
    if (advisories.length > 0) {
        return { blocked: false, violations: [], advisories, valid: false, summary: null };
    }

    // P2: X in desired can only land on days that were R in current
    for (let i = 0; i <= lastIdx; i++) {
        if (des[i] === 'X' && curr[i] !== 'X' && curr[i] !== 'R') {
            violations.push({
                rule: 'P2',
                message: `${calDate(i)}: X cannot be placed on a ${curr[i]} day`,
            });
        }

        // P9: IVD may be newly placed only on days that are R in current
        if (des[i] === 'IVD' && curr[i] !== 'IVD') {
            if (curr[i] === 'R') {
                p9AddedIVDOnR.add(i);
            } else {
                violations.push({
                    rule: 'P9',
                    message: `${calDate(i)}: IVD can only be newly placed on an R day`,
                });
            }
        }
    }

    // P10: X days moved from a block must touch first day, last day, or both ends
    const currXBlocks = getXBlocks(curr);
    for (const block of currXBlocks) {
        const removedFromBlock = [];
        for (let i = block.start; i <= block.end; i++) {
            if (des[i] === 'R') removedFromBlock.push(i);
        }
        if (removedFromBlock.length === 0) continue;

        const groups = [];
        let gStart = 0;
        for (let k = 1; k <= removedFromBlock.length; k++) {
            if (k === removedFromBlock.length || removedFromBlock[k] !== removedFromBlock[k - 1] + 1) {
                groups.push(removedFromBlock.slice(gStart, k));
                gStart = k;
            }
        }

        let p10Valid = false;
        if (groups.length === 1) {
            const g = groups[0];
            if (g[0] === block.start || g[g.length - 1] === block.end) p10Valid = true;
        } else if (groups.length === 2) {
            const g1 = groups[0], g2 = groups[1];
            if (g1[0] === block.start && g2[g2.length - 1] === block.end) p10Valid = true;
        }

        if (!p10Valid) {
            violations.push({
                rule: 'P10',
                message: `${calDateRange(block.start, block.end)}: Can only move the first day(s), last day(s), or the entire X-day block \u2014 not days from the middle`,
            });
        }
    }

    // Precompute opening conditions
    let ciEndIdx = -1;
    if (curr[0] === 'CI') {
        ciEndIdx = 0;
        while (ciEndIdx + 1 <= lastIdx && curr[ciEndIdx + 1] === 'CI') ciEndIdx++;
    }

    const currWorkBlocks = getWorkBlocks(curr);
    const currOpenShort = (
        currWorkBlocks.length > 0 &&
        currWorkBlocks[0].start === 0 &&
        currWorkBlocks[0].len < minWork
    ) ? currWorkBlocks[0] : null;
    const currStartsWithX = curr[0] === 'X';
    const currStartsWithCI = curr[0] === 'CI';

    // P3: Work blocks in desired must meet minWork (with exceptions)
    const desWorkBlocks = getWorkBlocks(des);
    for (const block of desWorkBlocks) {
        if (block.len >= minWork) continue;

        // E1: block touches the last day of the period
        if (block.end === lastIdx) continue;

        // E2: short block can remain short when touching CQ/IVD
        const leftDay = block.start > 0 ? des[block.start - 1] : null;
        const rightDay = block.end < lastIdx ? des[block.end + 1] : null;
        const desiredTouchesCQorIVD =
            leftDay === 'CQ' || rightDay === 'CQ' || leftDay === 'IVD' || rightDay === 'IVD';

        if (desiredTouchesCQorIVD) {
            const match = currWorkBlocks.find(b => b.start <= block.end && b.end >= block.start);
            if (match && match.len < minWork) {
                const currLeftNeighbor = match.start > 0 ? curr[match.start - 1] : null;
                const currRightNeighbor = match.end < lastIdx ? curr[match.end + 1] : null;
                const currentTouchesCQorIVD =
                    currLeftNeighbor === 'CQ' || currRightNeighbor === 'CQ' ||
                    currLeftNeighbor === 'IVD' || currRightNeighbor === 'IVD';
                if (currentTouchesCQorIVD) continue;
            }
        }

        // P9: short block created by adding IVD on R day
        if (p9AddedIVDOnR.has(block.start - 1) || p9AddedIVDOnR.has(block.end + 1)) continue;

        // P5: current opened with a short work block
        if (currOpenShort) {
            if (block.start <= currOpenShort.end && block.end >= currOpenShort.start) continue;
        }

        // P6: current opened with X days
        if (currStartsWithX && block.start === 0) continue;

        // P7: current opened with CI
        if (currStartsWithCI && ciEndIdx >= 0 && block.start === ciEndIdx + 1) continue;
        if (currStartsWithCI && ciEndIdx >= 0 && block.start === 0 && block.end === ciEndIdx) continue;

        violations.push({
            rule: 'P3',
            message: `${calDateRange(block.start, block.end)}: ${block.len} day${block.len === 1 ? '' : 's'} on call is below the minimum on-call duration (${minWork}).`,
        });
    }

    // maxXblocks
    const desXBlocks = getXBlocks(des);
    if (desXBlocks.length > maxXblocks) {
        violations.push({
            rule: 'maxXblocks',
            message: `Desired has ${desXBlocks.length} X-day block(s); maximum allowed is ${maxXblocks}`,
        });
    }

    const adds = des.filter((d, i) => d === 'X' && curr[i] === 'R').length;
    const removes = des.filter((d, i) => d === 'R' && curr[i] === 'X').length;

    return {
        blocked: false,
        violations,
        advisories,
        valid: violations.length === 0 && advisories.length === 0,
        summary: { adds, removes, xBlockCount: desXBlocks.length },
    };
}
