// ─── Input Validation Middleware ──────────────────────────────────────────
// Lightweight validators without a heavy schema library.
// Returns 400 with a structured error body on invalid input.

/**
 * Validates that req.params.roomId is an alphanumeric string 4–16 chars.
 */
function validateRoomId(req, res, next) {
  const { roomId } = req.params;
  if (!roomId || !/^[A-Z0-9]{4,16}$/i.test(roomId)) {
    return res.status(400).json({ error: 'Invalid roomId — must be 4–16 alphanumeric characters.' });
  }
  req.params.roomId = roomId.toUpperCase();
  next();
}

/**
 * Validates that req.params.chunkIndex is a non-negative integer.
 */
function validateChunkIndex(req, res, next) {
  const idx = parseInt(req.params.chunkIndex, 10);
  if (Number.isNaN(idx) || idx < 0 || idx > 99_999) {
    return res.status(400).json({ error: 'Invalid chunkIndex.' });
  }
  req.params.chunkIndex = idx; // normalise to number
  next();
}

/**
 * Validates multipart chunk upload body fields.
 */
function validateChunkUpload(req, res, next) {
  const { chunkIndex, totalChunks, mimeType } = req.body;

  const idx = parseInt(chunkIndex, 10);
  if (Number.isNaN(idx) || idx < 0) {
    return res.status(400).json({ error: 'Invalid chunkIndex in body.' });
  }

  const total = parseInt(totalChunks, 10);
  if (Number.isNaN(total) || total < 1 || total > 99_999) {
    return res.status(400).json({ error: 'Invalid totalChunks in body.' });
  }

  const allowedMimes = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
    'audio/webm', 'audio/ogg', 'audio/aac',
  ];
  if (mimeType && !allowedMimes.includes(mimeType)) {
    return res.status(400).json({ error: `Unsupported mimeType: ${mimeType}` });
  }

  next();
}

/**
 * Validates that req.file exists (after multer) and is within size limit.
 */
function validateChunkFile(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }
  const maxBytes = parseInt(process.env.MAX_CHUNK_SIZE_MB || '10', 10) * 1024 * 1024;
  if (req.file.size > maxBytes) {
    return res.status(413).json({ error: `Chunk exceeds maximum size of ${process.env.MAX_CHUNK_SIZE_MB || 10} MB.` });
  }
  next();
}

module.exports = { validateRoomId, validateChunkIndex, validateChunkUpload, validateChunkFile };
