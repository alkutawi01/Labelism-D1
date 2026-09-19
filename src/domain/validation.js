// Pure validation helpers -- no D1/Worker imports, portable if the platform
// ever changes again (Director's "domain logic stays portable" rule).

export class ValidationError extends Error {}

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
export function labelKey(value) {
  return cleanLabelText(value).toLowerCase();
}
