const { pool } = require("../db/pool");

const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedParts(value, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const result = {};
  for (const part of formatter.formatToParts(value)) if (part.type !== "literal") result[part.type] = part.value;
  return result;
}

function toMinutes(hour, minute) { return Number(hour) * 60 + Number(minute); }

function localDateTimeToUtc({ year, month, day, hour, minute, timeZone }) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), 0);
    guess += desired - represented;
  }
  return new Date(guess);
}

async function getCounsellorAvailability(counsellorId, dbClient = pool) {
  const [profileResult, windowsResult, blocksResult] = await Promise.all([
    dbClient.query(`SELECT cp.is_available, cp.availability_timezone, cp.default_session_duration_minutes, u.is_active FROM counsellor_profiles cp INNER JOIN users u ON u.id=cp.user_id WHERE cp.user_id=$1`, [counsellorId]),
    dbClient.query(`SELECT id, day_of_week, start_time, end_time, is_enabled FROM counsellor_availability_windows WHERE counsellor_id=$1 ORDER BY day_of_week`, [counsellorId]),
    dbClient.query(`SELECT id, starts_at, ends_at, reason FROM counsellor_unavailability_blocks WHERE counsellor_id=$1 AND ends_at > NOW() - INTERVAL '1 day' ORDER BY starts_at`, [counsellorId]),
  ]);
  return { profile: profileResult.rows[0] || null, windows: windowsResult.rows, blocks: blocksResult.rows };
}

async function assertCounsellorAvailable({ counsellorId, startAt, endAt, dbClient = pool }) {
  const availability = await getCounsellorAvailability(counsellorId, dbClient);
  if (!availability.profile || !availability.profile.is_active) return { allowed: false, reason: "The counsellor is not active." };
  if (!availability.profile.is_available) return { allowed: false, reason: "The counsellor is currently unavailable." };
  const tz = availability.profile.availability_timezone || "Asia/Kolkata";
  const start = new Date(startAt), end = new Date(endAt);
  const startParts = zonedParts(start, tz), endParts = zonedParts(end, tz);
  if (`${startParts.year}-${startParts.month}-${startParts.day}` !== `${endParts.year}-${endParts.month}-${endParts.day}`) return { allowed: false, reason: "A session must fit within one local counsellor working day." };
  const day = weekdayIndex[startParts.weekday];
  const window = availability.windows.find((row) => row.day_of_week === day && row.is_enabled);
  if (!window) return { allowed: false, reason: "The counsellor does not accept sessions on this day." };
  const startMinute = toMinutes(startParts.hour, startParts.minute), endMinute = toMinutes(endParts.hour, endParts.minute);
  const [windowStartHour, windowStartMinute] = String(window.start_time).slice(0,5).split(":");
  const [windowEndHour, windowEndMinute] = String(window.end_time).slice(0,5).split(":");
  if (startMinute < toMinutes(windowStartHour, windowStartMinute) || endMinute > toMinutes(windowEndHour, windowEndMinute)) return { allowed: false, reason: "The selected time is outside the counsellor's published working hours." };
  const blocked = availability.blocks.some((row) => new Date(row.starts_at) < end && new Date(row.ends_at) > start);
  if (blocked) return { allowed: false, reason: "The selected time is unavailable because the counsellor has blocked it." };
  return { allowed: true, timezone: tz, defaultDurationMinutes: availability.profile.default_session_duration_minutes };
}

async function listAvailableSlots({ counsellorId, fromDate, toDate, dbClient = pool }) {
  const availability = await getCounsellorAvailability(counsellorId, dbClient);
  if (!availability.profile || !availability.profile.is_active || !availability.profile.is_available) return { timezone: availability.profile?.availability_timezone || "Asia/Kolkata", durationMinutes: 60, slots: [] };
  const tz = availability.profile.availability_timezone || "Asia/Kolkata";
  const duration = Number(availability.profile.default_session_duration_minutes || 60);
  const windowsByDay = new Map(availability.windows.filter((row) => row.is_enabled).map((row) => [row.day_of_week, row]));
  const busyResult = await dbClient.query(`SELECT scheduled_start_at, scheduled_end_at FROM sessions WHERE counsellor_id=$1 AND status='scheduled' AND scheduled_start_at < $3::date + INTERVAL '1 day' AND scheduled_end_at > $2::date`, [counsellorId, fromDate, toDate]);
  const busy = [...busyResult.rows, ...availability.blocks];
  const startDay = new Date(`${fromDate}T12:00:00Z`), endDay = new Date(`${toDate}T12:00:00Z`);
  const slots = [];
  for (let cursor = new Date(startDay); cursor <= endDay; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const parts = zonedParts(cursor, tz); const dayKey = weekdayIndex[parts.weekday]; const window = windowsByDay.get(dayKey); if (!window) continue;
    const date = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
    const [sh, sm] = String(window.start_time).slice(0,5).split(":").map(Number); const [eh, em] = String(window.end_time).slice(0,5).split(":").map(Number);
    for (let minute = sh * 60 + sm; minute + duration <= eh * 60 + em; minute += duration) {
      const start = localDateTimeToUtc({ ...date, hour: Math.floor(minute / 60), minute: minute % 60, timeZone: tz }); const end = new Date(start.getTime() + duration * 60000);
      if (start.getTime() < Date.now() + 10 * 60 * 1000) continue;
      const conflict = busy.some((row) => new Date(row.scheduled_start_at || row.starts_at) < end && new Date(row.scheduled_end_at || row.ends_at) > start);
      if (!conflict) slots.push({ startAt: start.toISOString(), endAt: end.toISOString(), timezone: tz });
    }
  }
  return { timezone: tz, durationMinutes: duration, slots };
}

module.exports = { getCounsellorAvailability, assertCounsellorAvailable, listAvailableSlots };
