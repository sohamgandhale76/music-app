// ─── Shared constants ─────────────────────────────────────────────────────

/** Duration of each audio chunk in seconds */
export const CHUNK_DURATION = 5;

/** How many future chunks to prefetch ahead of current position */
export const PREFETCH_AHEAD = 4;

/** Server base URL — falls back to same-origin proxy in dev */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

/** Number of NTP rounds to run on connection */
export const NTP_ROUNDS = 5;

/** Re-sync NTP every N milliseconds */
export const NTP_RESYNC_INTERVAL = 30_000;

/** Milliseconds the server schedules ahead for play synchronization */
export const PLAY_SCHEDULE_OFFSET = 2_000;
