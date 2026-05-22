// ─── Rate Limiters ────────────────────────────────────────────────────────
// Protects the API from abuse. Different limits for different route groups.

const rateLimit = require('express-rate-limit');

const windowMs = 60 * 1000; // 1 minute

/** General API: 100 req/min per IP */
const apiLimiter = rateLimit({
  windowMs,
  max: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
});

/** Chunk upload: 30 req/min per IP (each ~400 KB, heavy endpoint) */
const uploadLimiter = rateLimit({
  windowMs,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Upload rate limit exceeded — please wait before sending more chunks.' },
});

/** NTP endpoint: 60 req/min per IP */
const ntpLimiter = rateLimit({
  windowMs,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'NTP rate limit exceeded.' },
});

module.exports = { apiLimiter, uploadLimiter, ntpLimiter };
