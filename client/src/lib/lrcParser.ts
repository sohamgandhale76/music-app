// ─── LRC Lyrics Parser ────────────────────────────────────────────────────
// Parses standard LRC format: [mm:ss.xx]Lyric text
// Extended LRC with multi-timestamp lines is fully supported.

export interface LrcLine {
  time: number;   // seconds (float)
  text: string;
}

export interface LrcMeta {
  title?: string;
  artist?: string;
  album?: string;
  by?: string;
  offset?: number; // global timing offset in ms
}

export interface ParsedLrc {
  lines: LrcLine[];
  meta: LrcMeta;
}

const TIME_REGEX = /\[(\d{1,2}):(\d{2})\.(\d{2,3})\]/g;
const META_REGEX = /^\[(\w+):(.+)\]$/;

export function parseLrc(content: string): ParsedLrc {
  const lines: LrcLine[] = [];
  const meta: LrcMeta = {};

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // ── Metadata tags ────────────────────────────────────────────────────
    const metaMatch = META_REGEX.exec(line);
    if (metaMatch) {
      const [, key, value] = metaMatch;
      switch ((key || '').toLowerCase()) {
        case 'ti': meta.title  = value.trim(); break;
        case 'ar': meta.artist = value.trim(); break;
        case 'al': meta.album  = value.trim(); break;
        case 'by': meta.by     = value.trim(); break;
        case 'offset': meta.offset = parseInt(value.trim(), 10); break;
      }
      // If it's a metadata-only line with no text after, skip lyric parse
      if (!line.match(/\]\S/)) continue;
    }

    // ── Timestamp extraction ─────────────────────────────────────────────
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    let lastTagEnd = 0;

    TIME_REGEX.lastIndex = 0;
    while ((match = TIME_REGEX.exec(line)) !== null) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const ms   = parseInt(match[3].padEnd(3, '0'), 10);
      timestamps.push(mins * 60 + secs + ms / 1000);
      lastTagEnd = match.index + match[0].length;
    }

    if (timestamps.length === 0) continue;

    const text = line.slice(lastTagEnd).trim();
    if (!text) continue;

    for (const time of timestamps) {
      // Apply global offset if present
      const adjustedTime = time + (meta.offset ?? 0) / 1000;
      lines.push({ time: adjustedTime, text });
    }
  }

  return {
    lines: lines.sort((a, b) => a.time - b.time),
    meta,
  };
}

/**
 * Returns the index of the lyric line that should be highlighted
 * at the given playback position.
 */
export function getCurrentLyricIndex(lines: LrcLine[], currentTime: number): number {
  if (lines.length === 0) return -1;

  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;

  // Binary search for the last line with time <= currentTime
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].time <= currentTime) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result;
}
