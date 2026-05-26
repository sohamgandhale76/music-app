// ─── PostgreSQL Database Module ───────────────────────────────────────────────
// Uses the `pg` package to connect to a PostgreSQL database (Render-compatible).
// Exports async CRUD functions for the `tracks` table.

const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render Postgres requires SSL in production
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/**
 * Create the `tracks` table if it doesn't already exist.
 * Called once on server startup before accepting requests.
 */
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracks (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        artist      TEXT,
        duration    REAL,
        size        INTEGER,
        format      TEXT,
        audio_key   TEXT NOT NULL,
        cover_key   TEXT,
        lyrics_key  TEXT,
        uploaded_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )
    `);
    logger.info('PostgreSQL: tracks table ready');
  } catch (err) {
    logger.error('PostgreSQL: failed to create tracks table', { error: err.message });
    throw err;
  }
}

/**
 * Insert a new track record.
 * @param {{ id, title, artist, duration, size, format, audio_key, cover_key, lyrics_key }} track
 */
async function insertTrack(track) {
  const { id, title, artist, duration, size, format, audio_key, cover_key, lyrics_key } = track;
  const result = await pool.query(
    `INSERT INTO tracks (id, title, artist, duration, size, format, audio_key, cover_key, lyrics_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [id, title, artist || null, duration || null, size || null, format || null,
     audio_key, cover_key || null, lyrics_key || null]
  );
  return result.rows[0];
}

/**
 * Retrieve all tracks ordered by upload time descending.
 * @returns {Promise<Array>}
 */
async function getAllTracks() {
  const result = await pool.query(
    'SELECT * FROM tracks ORDER BY uploaded_at DESC'
  );
  return result.rows;
}

/**
 * Retrieve a single track by its ID.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function getTrack(id) {
  const result = await pool.query('SELECT * FROM tracks WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Delete a track record by ID.
 * @param {string} id
 */
async function deleteTrack(id) {
  await pool.query('DELETE FROM tracks WHERE id = $1', [id]);
}

module.exports = { initDb, insertTrack, getAllTracks, getTrack, deleteTrack };
