// src/utils/bankMatcher.js
// Server-side port of the Flutter bank matcher, so bank_name is stored
// using the canonical display name (matches pakistaniBanks[].name).

const PAKISTANI_BANKS = [
    'Allied Bank',
    'Habib Bank Limited (HBL)',
    'United Bank Limited (UBL)',
    'MCB Bank',
    'Bank Alfalah',
    'Meezan Bank',
    'National Bank of Pakistan (NBP)',
    'Askari Bank',
    'Faysal Bank',
    'Standard Chartered Bank',
    'Bank Of Punjab',
    'Bank Al-Habib Limited (BAHL)',
    'JazzCash',
    'EasyPaisa',
    'NayaPay',
    'SadaPay',
    'Khaibar Bank',
    'JS Bank',
    'Habib MetroPolitan',
    'Silk Bank',
    'Soneri Bank',
    'Bank Islami',
    'Al Barka',
    'Dubai Islamic',
];

const BANK_ALIASES = {
    'hbl': 'Habib Bank Limited (HBL)',
    'habib bank': 'Habib Bank Limited (HBL)',
    'ubl': 'United Bank Limited (UBL)',
    'united bank': 'United Bank Limited (UBL)',
    'nbp': 'National Bank of Pakistan (NBP)',
    'national bank': 'National Bank of Pakistan (NBP)',
    'bop': 'Bank Of Punjab',
    'punjab bank': 'Bank Of Punjab',
    'bahl': 'Bank Al-Habib Limited (BAHL)',
    'bank al habib': 'Bank Al-Habib Limited (BAHL)',
    'al habib': 'Bank Al-Habib Limited (BAHL)',
    'scb': 'Standard Chartered Bank',
    'standard chartered': 'Standard Chartered Bank',
    'hmb': 'Habib MetroPolitan',
    'habib metro': 'Habib MetroPolitan',
    'metropolitan': 'Habib MetroPolitan',
    'js': 'JS Bank',
    'meezan': 'Meezan Bank',
    'alfalah': 'Bank Alfalah',
    'askari': 'Askari Bank',
    'faysal': 'Faysal Bank',
    'allied': 'Allied Bank',
    'soneri': 'Soneri Bank',
    'silk': 'Silk Bank',
    'bank islamic': 'Bank Islami',
    'bankislami': 'Bank Islami',
    'al barka': 'Al Barka',
    'albaraka': 'Al Barka',
    'dubai islamic': 'Dubai Islamic',
    'dib': 'Dubai Islamic',
    'jazz cash': 'JazzCash',
    'jazzcash': 'JazzCash',
    'easypaisa': 'EasyPaisa',
    'easy paisa': 'EasyPaisa',
    'nayapay': 'NayaPay',
    'naya pay': 'NayaPay',
    'sadapay': 'SadaPay',
    'sada pay': 'SadaPay',
    'khyber bank': 'Khaibar Bank',
    'khyber': 'Khaibar Bank',
};

const normalize = (s) =>
    String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .trim();

/**
 * Returns the canonical bank name for a free-text input, or the original
 * trimmed string if nothing matches. Never returns null/empty if input
 * was non-empty.
 */
const canonicalBankName = (bankName) => {
    if (!bankName || !String(bankName).trim()) return bankName;

    const query = normalize(bankName);
    if (!query) return String(bankName).trim();

    // 1. Exact normalized match
    for (const name of PAKISTANI_BANKS) {
        if (normalize(name) === query) return name;
    }

    // 2. Alias exact
    if (BANK_ALIASES[query]) return BANK_ALIASES[query];

    // 3. Alias contains
    for (const [alias, target] of Object.entries(BANK_ALIASES)) {
        if (query.includes(alias)) return target;
    }

    // 4. Partial match both directions
    for (const name of PAKISTANI_BANKS) {
        const n = normalize(name);
        if (n.includes(query) || query.includes(n)) return name;
        const stripped = normalize(name.replace(/\(.*?\)/g, ''));
        if (stripped && (stripped.includes(query) || query.includes(stripped))) {
            return name;
        }
    }

    // 5. Give up — keep original trimmed
    return String(bankName).trim();
};

module.exports = { canonicalBankName, PAKISTANI_BANKS, BANK_ALIASES };