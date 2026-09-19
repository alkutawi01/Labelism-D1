// Pure validation helpers -- no D1/Worker imports, portable if the platform
// ever changes again (Director's "domain logic stays portable" rule).

export class ValidationError extends Error {}

// Thrown for things that are probably fine but worth a second look (e.g. two
// size spellings that might be a typo). The caller may retry the same request
// with acknowledgeWarnings: true to proceed.
export class ConfirmationRequired extends ValidationError {
  constructor(message, warnings) {
    super(message);
    this.warnings = warnings;
  }
}

export function requireInt(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${label} must be a whole number >= 0.`);
  }
  return value;
}

// Text that names a group of recipients (a school, a branch). Display keeps
// what the person typed, minus stray/duplicated whitespace; duplicate
// detection compares a case-insensitive key of the same text.
export function cleanLabelText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
// Looser key for spotting near-duplicates only (never for merging): letters
// and digits, lowercased, so "X-L", "X L" and "xl" all give "xl".
export function looseKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
export function labelKey(value) {
  return cleanLabelText(value).toLowerCase();
}
