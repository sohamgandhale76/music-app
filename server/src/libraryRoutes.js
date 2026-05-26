// ─── R2 Music Library Router ──────────────────────────────────────────────────
// Mounts at /library in index.js
// All new persistent-library endpoints backed by Cloudflare R2 + PostgreSQL.

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const {
  uploadToR2,
  getStreamUrl,
  getUploadUrl,
  deleteFromR2,
  getTotalStorageUsed,
  checkStorageLimit,
} = require('./r2');

const {
  insertTrack,
  getAllTracks,
  getTrack,
  deleteTrack,
} = require('./db');

const logger = require('./logger');

const router = express.Router();

// Multer: memory storage — only used for small optional files (cover, lyrics).
// The large audio file now goes directly client → R2 via presigned PUT URL.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB cap (covers + lyrics only)
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: derive file extension from mime type or original filename
// ─────────────────────────────────────────────────────────────────────────────
function getExtFromMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('flac'))       return 'flac';
  if (m.includes('wav'))        return 'wav';
  if (m.includes('ogg'))        return 'ogg';
  if (m.includes('aac'))        return 'aac';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  return 'mp3';
}

function getExt(file) {
  if (file.originalname && file.originalname.includes('.')) {
    return path.extname(file.originalname).replace('.', '').toLowerCase() || getExtFromMime(file.mimetype);
  }
  return getExtFromMime(file.mimetype);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /library
// Returns all tracks from PostgreSQL as a JSON array
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const tracks = await getAllTracks();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json(tracks);
  } catch (err) {
    logger.error('GET /library failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch library tracks' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /library/storage
// Returns R2 bucket storage usage stats
// ─────────────────────────────────────────────────────────────────────────────
const LIMIT_BYTES = 9.5 * 1024 * 1024 * 1024;

router.get('/storage', async (_req, res) => {
  try {
    const used = await getTotalStorageUsed();
    const percentUsed = ((used / LIMIT_BYTES) * 100).toFixed(1);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json({
      used,
      limit: Math.round(LIMIT_BYTES),
      usedGB: (used / (1024 ** 3)).toFixed(2),
      limitGB: '9.5',
      percentUsed,
      isFull: used >= LIMIT_BYTES,
    });
  } catch (err) {
    logger.error('GET /library/storage failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch storage stats' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /library/upload-url
// Step 1 of direct-to-R2 upload flow.
// Client requests a presigned PUT URL for a specific file; the large audio
// bytes never transit the Render server, completely bypassing its 30s timeout.
//
// Query params:
//   filename    - original filename (used to derive extension)
//   contentType - MIME type of the file
//   size        - file size in bytes (for storage limit check)
//   kind        - "audio" | "cover" | "lyrics" (default "audio")
//   id          - (optional) reuse an existing track UUID for cover/lyrics
// ─────────────────────────────────────────────────────────────────────────────
router.get('/upload-url', async (req, res) => {
  try {
    const { filename, contentType, size, kind = 'audio', id: existingId } = req.query;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType are required' });
    }

    const id = existingId || uuidv4();

    // Derive extension from filename first, fall back to MIME
    const rawExt = filename.includes('.')
      ? path.extname(filename).replace('.', '').toLowerCase()
      : getExtFromMime(contentType);

    // Build the R2 key for each asset type
    let key;
    if (kind === 'cover') {
      key = `covers/${id}.${rawExt || 'jpg'}`;
    } else if (kind === 'lyrics') {
      key = `lyrics/${id}.lrc`;
    } else {
      // audio — run storage limit check
      const fileSizeBytes = parseInt(size, 10) || 0;
      if (fileSizeBytes > 0) {
        try {
          await checkStorageLimit(fileSizeBytes);
        } catch (err) {
          if (err.code === 'STORAGE_FULL' || err.message === 'STORAGE_FULL') {
            return res.status(507).json({
              error: 'Storage full',
              message: 'Library has reached its 9.5 GB limit. Delete some tracks to free space.',
            });
          }
          logger.error('Storage check failed', { error: err.message });
          return res.status(500).json({ error: 'Failed to check storage capacity' });
        }
      }
      key = `audio/${id}.${rawExt || getExtFromMime(contentType)}`;
    }

    const uploadUrl = await getUploadUrl(key, contentType, 3600);
    logger.info('Presigned upload URL issued', { id, kind, key });

    res.json({ uploadUrl, key, id });
  } catch (err) {
    logger.error('GET /library/upload-url failed', { error: err.message });
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /library/confirm-upload
// Step 2 of direct-to-R2 upload flow.
// Called AFTER the client has PUT the file directly to R2.
// Saves metadata to PostgreSQL and returns the new track record.
//
// JSON body:
//   id, key (audio_key), title, artist, duration, size, format,
//   cover_key (optional), lyrics_key (optional)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/confirm-upload', express.json(), async (req, res) => {
  try {
    const {
      id, key, title, artist, duration, size, format,
      cover_key = null, lyrics_key = null,
    } = req.body;

    if (!id || !key) {
      return res.status(400).json({ error: 'id and key are required' });
    }

    const cleanTitle  = (title || '').trim() || 'Untitled';
    const cleanArtist = (artist || '').trim() || null;
    const cleanDur    = parseFloat(duration) || null;
    const cleanSize   = parseInt(size, 10) || null;
    const cleanFmt    = format || key.split('.').pop() || 'mp3';

    const track = await insertTrack({
      id,
      title:      cleanTitle,
      artist:     cleanArtist,
      duration:   cleanDur,
      size:       cleanSize,
      format:     cleanFmt,
      audio_key:  key,
      cover_key,
      lyrics_key,
    });

    logger.info('Track confirmed and saved to DB', { id, title: cleanTitle, format: cleanFmt, size: cleanSize });
    res.json({ success: true, track });
  } catch (err) {
    logger.error('POST /library/confirm-upload failed', { error: err.message });
    res.status(500).json({ error: 'Failed to save track metadata' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /library/upload  (legacy — kept for small files / API compatibility)
// Extend socket timeouts to 5 minutes. This path is still used as fallback
// but direct upload is preferred for audio files.
// ─────────────────────────────────────────────────────────────────────────────
const uploadTimeout = (req, res, next) => {
  req.setTimeout(300_000);
  res.setTimeout(300_000);
  next();
};

router.post(
  '/upload',
  uploadTimeout,
  upload.fields([
    { name: 'audio',  maxCount: 1 },
    { name: 'cover',  maxCount: 1 },
    { name: 'lyrics', maxCount: 1 },
  ]),
  async (req, res) => {
    console.log('[library/upload] files received:', req.files ? Object.keys(req.files) : 'none', 'body:', req.body);
    const audio  = req.files?.audio?.[0];
    const cover  = req.files?.cover?.[0];
    const lyrics = req.files?.lyrics?.[0];

    if (!audio) {
      return res.status(400).json({ error: 'audio field is required' });
    }

    // ── Storage guard — check BEFORE any upload ──────────────────────────
    try {
      await checkStorageLimit(audio.size);
    } catch (err) {
      if (err.code === 'STORAGE_FULL' || err.message === 'STORAGE_FULL') {
        return res.status(507).json({
          error: 'Storage full',
          message: 'Library has reached its 9.5GB limit. Delete some tracks to free space.',
        });
      }
      logger.error('Storage check failed', { error: err.message });
      return res.status(500).json({ error: 'Failed to check storage capacity' });
    }

    const id     = uuidv4();
    const format = getExt(audio);

    // ── Upload audio to R2 ───────────────────────────────────────────────
    const audioKey = `audio/${id}.${format}`;
    try {
      await uploadToR2(audioKey, audio.buffer, audio.mimetype || 'audio/mpeg');
    } catch (err) {
      logger.error('R2 audio upload failed', { error: err.message });
      return res.status(500).json({ error: 'Failed to upload audio to R2' });
    }

    // ── Upload cover image (optional) ───────────────────────────────────
    let coverKey = null;
    if (cover) {
      const coverExt = getExt(cover);
      coverKey = `covers/${id}.${coverExt}`;
      try {
        await uploadToR2(coverKey, cover.buffer, cover.mimetype || 'image/jpeg');
      } catch (err) {
        logger.warn('R2 cover upload failed (non-fatal)', { error: err.message });
        coverKey = null;
      }
    }

    // ── Upload lyrics .lrc (optional) ───────────────────────────────────
    let lyricsKey = null;
    if (lyrics) {
      lyricsKey = `lyrics/${id}.lrc`;
      try {
        await uploadToR2(lyricsKey, lyrics.buffer, 'text/plain');
      } catch (err) {
        logger.warn('R2 lyrics upload failed (non-fatal)', { error: err.message });
        lyricsKey = null;
      }
    }

    // ── Persist metadata to PostgreSQL ──────────────────────────────────
    const title    = (req.body?.title  || '').trim() || audio.originalname?.replace(/\.[^.]+$/, '') || 'Untitled';
    const artist   = (req.body?.artist || '').trim() || null;
    const duration = parseFloat(req.body?.duration) || null;

    let track;
    try {
      track = await insertTrack({
        id,
        title,
        artist,
        duration,
        size: audio.size,
        format,
        audio_key: audioKey,
        cover_key: coverKey,
        lyrics_key: lyricsKey,
      });
    } catch (err) {
      logger.error('DB insert failed', { error: err.message });
      deleteFromR2(audioKey).catch(() => {});
      if (coverKey)  deleteFromR2(coverKey).catch(() => {});
      if (lyricsKey) deleteFromR2(lyricsKey).catch(() => {});
      return res.status(500).json({ error: 'Failed to save track metadata' });
    }

    logger.info('Track uploaded to R2 library (legacy path)', { id, title, format, size: audio.size });
    res.json({ success: true, track });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /library/:id/stream
// Returns a signed URL for the audio file (valid 1 hour)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/stream', async (req, res) => {
  try {
    const track = await getTrack(req.params.id);
    if (!track) return res.status(404).json({ error: 'Track not found' });
    const url = await getStreamUrl(track.audio_key);
    res.json({ url });
  } catch (err) {
    logger.error('GET /library/:id/stream failed', { error: err.message });
    res.status(500).json({ error: 'Failed to generate stream URL' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /library/:id/lyrics
// Redirects to signed URL for the .lrc file
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/lyrics', async (req, res) => {
  try {
    const track = await getTrack(req.params.id);
    if (!track) return res.status(404).json({ error: 'Track not found' });
    if (!track.lyrics_key) return res.status(404).json({ error: 'No lyrics for this track' });
    const url = await getStreamUrl(track.lyrics_key);
    res.redirect(url);
  } catch (err) {
    logger.error('GET /library/:id/lyrics failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch lyrics URL' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /library/:id/cover
// Redirects to signed URL for the cover image
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/cover', async (req, res) => {
  try {
    const track = await getTrack(req.params.id);
    if (!track) return res.status(404).json({ error: 'Track not found' });
    if (!track.cover_key) return res.status(404).json({ error: 'No cover for this track' });
    const url = await getStreamUrl(track.cover_key);
    res.redirect(url);
  } catch (err) {
    logger.error('GET /library/:id/cover failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch cover URL' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /library/:id
// Deletes audio + cover + lyrics from R2, then removes DB record
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const track = await getTrack(req.params.id);
    if (!track) return res.status(404).json({ error: 'Track not found' });

    // Delete R2 objects (all best-effort in parallel)
    const deletions = [deleteFromR2(track.audio_key)];
    if (track.cover_key)  deletions.push(deleteFromR2(track.cover_key));
    if (track.lyrics_key) deletions.push(deleteFromR2(track.lyrics_key));

    await Promise.allSettled(deletions); // never throw on partial failures

    // Remove from PostgreSQL
    await deleteTrack(track.id);

    logger.info('Track deleted from R2 library', { id: track.id, title: track.title });
    res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /library/:id failed', { error: err.message });
    res.status(500).json({ error: 'Failed to delete track' });
  }
});

module.exports = router;
