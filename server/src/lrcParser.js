// ─── Server-Side LRC Lyrics Parser ──────────────────────────────────────────
// Parses standard LRC format: [mm:ss.xx]Lyric text
// Extended LRC with multi-timestamp lines is supported.

const TIME_REGEX = /\[(\d{1,2}):(\d{2})\.(\d{2,3})\]/g;
const META_REGEX = /^\[(\w+):(.+)\]$/;

function parseLrc(content) {
  const lines = [];
  const meta = {};

  if (!content) return { lines, meta };

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // ── Metadata tags ──
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
      if (!line.match(/\]\S/)) continue;
    }

    // ── Timestamp extraction ──
    const timestamps = [];
    let match;
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
      const adjustedTime = time + (meta.offset || 0) / 1000;
      lines.push({ time: adjustedTime, text });
    }
  }

  return {
    lines: lines.sort((a, b) => a.time - b.time),
    meta,
  };
}

module.exports = { parseLrc };
