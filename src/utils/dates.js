// src/utils/dates.js
// All wall-clock logic is in Pakistan Standard Time (UTC+5, no DST),
// independent of the server's timezone.

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

const pktParts = (date) => {
    const s = new Date(date.getTime() + PKT_OFFSET_MS);
    return {
        y: s.getUTCFullYear(),
        m: s.getUTCMonth() + 1,
        d: s.getUTCDate(),
        h: s.getUTCHours(),
        mi: s.getUTCMinutes(),
        s: s.getUTCSeconds(),
        ms: s.getUTCMilliseconds(),
    };
};

const fromPktParts = (y, m, d, h = 0, mi = 0, s = 0, ms = 0) =>
    new Date(Date.UTC(y, m - 1, d, h, mi, s, ms) - PKT_OFFSET_MS);

const normalizeEntryDate = (input) => {
    if (!input) return new Date();
    if (input instanceof Date) return isNaN(input.getTime()) ? new Date() : input;

    const str = String(input).trim();

    // "YYYY-MM-DD" -> that PKT date + current PKT time of day
    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
        const now = pktParts(new Date());
        return fromPktParts(+m[1], +m[2], +m[3], now.h, now.mi, now.s, now.ms);
    }

    // ISO datetime WITHOUT offset (what the Flutter app sends) -> PKT wall time
    m = str.match(
        /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/
    );
    if (m) {
        const ms = m[7] ? +m[7].padEnd(3, '0').slice(0, 3) : 0;
        return fromPktParts(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), ms);
    }

    // Has "Z" or explicit offset -> already an exact instant
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
};

const dayOnly = (input) => {
    const p = pktParts(normalizeEntryDate(input));
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
};

const toPktIso = (input) => {
    const p = pktParts(normalizeEntryDate(input));
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}.${pad(p.ms, 3)}+05:00`;
};

const startOfPktDay = (input) => {
    const p = pktParts(normalizeEntryDate(input));
    return fromPktParts(p.y, p.m, p.d, 0, 0, 0, 0);
};

const endOfPktDay = (input) => {
    const p = pktParts(normalizeEntryDate(input));
    return fromPktParts(p.y, p.m, p.d, 23, 59, 59, 999);
};

module.exports = {
    normalizeEntryDate,
    dayOnly,
    toPktIso,
    pktParts,
    fromPktParts,
    startOfPktDay,
    endOfPktDay,
};