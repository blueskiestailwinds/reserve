// Pure business-logic functions extracted from pbs/pbs.js.
// These have no DOM or browser dependencies and are safe to import in Node/Vitest.

// X-day proration lookup tables — §12 M. 2.
// Index = available days (total bid period days minus A days).
// cat1 = reserve guarantee 72:00–74:59; cat2 = 75:00–80:00.
export const PRORATION_LOOKUP = {
    "30": {
        "cat1": [0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12, 12, 13, 13],
        "cat2": [0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 7, 7, 8, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12, 12]
    },
    "31": {
        "cat1": [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14],
        "cat2": [0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12, 12, 13, 13]
    }
};

// Count available days (total days minus A days) — §12 M. 2.
// CQ, CI, Z do not reduce availability.
export function countAvailableDays(days) {
    return days.filter(d => d !== 'A').length;
}

// Count X days used — §12 M. 2.
// Z counts as X for all rule purposes.
export function countXUsed(days) {
    return days.filter(d => d === 'X' || d === 'Z').length;
}

// Look up required X-day count from the proration table.
export function getRequiredXDays(dayCount, availCount, alv, extraX) {
    const lookup = PRORATION_LOOKUP[dayCount.toString()];
    const baseReq = lookup ? (lookup[alv][availCount] || 0) : 0;
    return baseReq + (extraX ? 1 : 0);
}

// Count X-day blocks — §12 M. 8. d.
// Z counts as X. A days do not break an X block.
export function countXBlocks(days) {
    let xBlks = 0, inX = false;
    days.forEach(d => {
        if (d === 'X' || d === 'Z') {
            if (!inX) { xBlks++; inX = true; }
        } else if (d !== 'A') {
            inX = false;
        }
    });
    return xBlks;
}

// Validate a contiguous work block against minWork and maxWork — §12 M. 8. d. 2)
//
// Returns { illegal: number[], alerts: string[] } for the indices/alerts added.
//
// Rules:
//   - A block of only CQ/CI (no R or C) is always legal.
//   - A block touching the last day of the current bid period is exempt from minWork.
//   - A block exceeding maxWork is always flagged.
export function checkWorkBlock(indices, offset, currLen, combo, settings) {
    const illegal = [];
    const alerts = [];

    if (indices.length === 0) return { illegal, alerts };

    // Only enforce minWork if the block contains at least one R or C day.
    if (!indices.some(i => ['R', 'C'].includes(combo[i]))) return { illegal, alerts };

    // tEnd: block touches the last day of the current bid period — exempt from minWork
    const tEnd = indices.includes(offset + currLen - 1);

    if (indices.length < settings.minW && !tEnd) {
        indices.forEach(i => { if (i >= offset && i < offset + currLen) illegal.push(i - offset); });
        if (indices.some(i => i >= offset && i < offset + currLen)) alerts.push('Short Work Block');
    }
    if (indices.length > settings.maxW) {
        indices.forEach(i => { if (i >= offset && i < offset + currLen) illegal.push(i - offset); });
        alerts.push('Work Block exceeds Max');
    }

    return { illegal, alerts };
}

// Run full PBS validation on a schedule.
// Returns { availCount, xUsed, xReq, xBlks, alerts, illegalIndices }
export function validateSchedule(days, dayCount, settings, prevMonthDays = null) {
    const illegalIndices = new Set();
    const alerts = [];

    const availCount = countAvailableDays(days);
    const xUsed = countXUsed(days);
    const xReq = getRequiredXDays(dayCount, availCount, settings.alv, settings.extraX);

    if (xUsed !== xReq) {
        alerts.push(xUsed < xReq ? `Need ${xReq - xUsed} more X` : `Too many X`);
    }

    const xBlks = countXBlocks(days);
    if (xBlks > settings.maxX) alerts.push('Exceeds Max X Blocks');

    // Cross-month work block validation
    const combo = [...(prevMonthDays || []), ...days];
    const offset = prevMonthDays ? prevMonthDays.length : 0;
    let block = [];
    combo.forEach((code, i) => {
        if (['R', 'C', 'CQ', 'CI'].includes(code)) {
            block.push(i);
        } else {
            const result = checkWorkBlock(block, offset, days.length, combo, settings);
            result.illegal.forEach(idx => illegalIndices.add(idx));
            result.alerts.forEach(a => alerts.push(a));
            block = [];
        }
    });
    // Final block
    const result = checkWorkBlock(block, offset, days.length, combo, settings);
    result.illegal.forEach(idx => illegalIndices.add(idx));
    result.alerts.forEach(a => alerts.push(a));

    return {
        availCount,
        xUsed,
        xReq,
        xBlks,
        alerts: [...new Set(alerts)],
        illegalIndices: [...illegalIndices],
    };
}
