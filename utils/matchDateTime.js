'use strict';

/**
 * Match date/time policy:
 * - Match.date + Match.time are civil date/time values in America/Sao_Paulo.
 * - They are NOT UTC clock values.
 * - When an instant is required, this module converts the civil value to an
 *   absolute Date using the IANA timezone, independently of the server TZ.
 *
 * This keeps robot-created and manually-created matches consistent.
 */

const MATCH_TIME_ZONE = 'America/Sao_Paulo';

function parseCivilMatchParts(dateStr, timeStr = '00:00') {
  if (typeof dateStr !== 'string') return null;

  const date = dateStr.trim();
  const dateMatch = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) ||
                    date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return null;

  let day, month, year;
  if (date[2] === '/') {
    day = Number(dateMatch[1]);
    month = Number(dateMatch[2]);
    year = Number(dateMatch[3]);
  } else {
    year = Number(dateMatch[1]);
    month = Number(dateMatch[2]);
    day = Number(dateMatch[3]);
  }

  const time = String(timeStr || '00:00').trim();
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return null;

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);

  const probe = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    hours < 0 || hours > 23 ||
    minutes < 0 || minutes > 59
  ) return null;

  return { year, month, day, hours, minutes };
}

function getTimeZoneOffsetMs(date, timeZone = MATCH_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }

  const asUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second
  );

  return asUtc - date.getTime();
}

/**
 * Converts a civil São Paulo date/time to the corresponding absolute Date.
 * The calculation is independent of process.env.TZ.
 */
function parseMatchDateTime(dateStr, timeStr = '00:00') {
  const parts = parseCivilMatchParts(dateStr, timeStr);
  if (!parts) return null;

  const utcGuess = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hours,
    parts.minutes,
    0,
    0
  ));

  const offset = getTimeZoneOffsetMs(utcGuess, MATCH_TIME_ZONE);
  const instant = new Date(utcGuess.getTime() - offset);

  if (isNaN(instant.getTime())) return null;
  return instant;
}

function getMatchTimestamp(dateStr, timeStr = '00:00') {
  const d = parseMatchDateTime(dateStr, timeStr);
  return d ? d.getTime() : null;
}

module.exports = {
  MATCH_TIME_ZONE,
  parseCivilMatchParts,
  parseMatchDateTime,
  getMatchTimestamp
};
