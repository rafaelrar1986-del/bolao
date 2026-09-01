'use strict';

/**
 * Parse an integer identifier that must be a positive, finite integer.
 * Returns null for invalid values.
 */
function parsePositiveInteger(value) {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (raw === '' || !/^\d+$/.test(raw)) return null;

  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number <= 0) return null;

  return number;
}

module.exports = {
  parsePositiveInteger
};
