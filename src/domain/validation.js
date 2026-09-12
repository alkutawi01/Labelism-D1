// Pure validation helpers -- no D1/Worker imports, portable if the platform
// ever changes again (Director's "domain logic stays portable" rule).

export class ValidationError extends Error {}

export function requireInt(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${label} must be a whole number >= 0.`);
  }
  return value;
}
