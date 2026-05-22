const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const musicMetadata = require('music-metadata');
const logger = require('./logger');
const telegramBot = require('./telegramBot');

const DATA_DIR = path.join(__dirname, '../data');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const UPLOADS_DIR = path.join(__dirname, '../uploads');

function getMimeTypeFromExtension(filename, fallbackMime) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.flac': return 'audio/flac';
    case '.wav':  return 'audio/wav';
    case '.ogg':  return 'audio/ogg';
    case '.aac':  return 'audio/aac';
    case '.m4a':  return 'audio/mp4';
    case '.mp3':  return 'audio/mpeg';
    case '.mp4':  return 'audio/mp4';
    default:
      if (fallbackMime && fallbackMime !== 'application/octet-stream' && fallbackMime !== 'binary/octet-stream') {
        return fallbackMime;
      }
      return 'audio/mpeg';
  }
}

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

class LibraryManager {
  constructor() {
    this.tracks = [];
    this.loadCatalog();
  }

  loadCatalog() {
    try {
      if (fs.existsSync(LIBRARY_FILE)) {
        const data = fs.readFileSync(LIBRARY_FILE, 'utf8');
        this.tracks = JSON.parse(data);
        logger.info('Loaded music library catalog', { count: this.tracks.length });
      } else {
        this.tracks = [];
        this.saveCatalog();
      }
    } catch (err) {
      logger.error('Failed to load library catalog, resetting', { error: err.message });
      this.tracks = [];
    }
  }

  saveCatalog() {
    try {
      fs.writeFileSync(LIBRARY_FILE, JSON.stringify(this.tracks, null, 2), 'utf8');
    } catch (err) {
      logger.error('Failed to save library catalog', { error: err.message });
    }
  }

  async addTrack(tempFilePath, originalFilename, mimeType, fileSize) {
    // 1. Parse metadata and extract tags/art
    let metadata;
    try {
      metadata = await musicMetadata.parseFile(tempFilePath);
    } catch (err) {
      logger.warn('Failed to parse audio metadata, using fallbacks', { error: err.message });
      metadata = { common: {}, format: {} };
    }

    const duration = metadata.format.duration || 0; // seconds
    const bitrate = metadata.format.bitrate || 0;    // bits/sec (e.g. 320000 for 320kbps)
    const formatName = (metadata.format.container || '').toLowerCase();

    // 2. Validate High Quality
    // WAV, FLAC, ALAC, AIFF are automatically HQ.
    // Lossy formats (MP3, AAC, OGG, M4A) must have bitrate >= 192kbps (192000 bits/sec).
    const isLossless = ['wav', 'flac', 'aiff', 'alac', 'ape', 'wavpack'].some(ext => 
      formatName.includes(ext) || originalFilename.toLowerCase().endsWith('.' + ext)
    );

    const bitrateKbps = Math.round(bitrate / 1000);
    const isLossyHq = bitrateKbps >= 192;

    if (!isLossless && !isLossyHq && bitrate > 0) {
      throw new Error(`Audio quality too low (${bitrateKbps}kbps). We require lossless formats (FLAC/WAV) or high-quality lossy audio (>=192kbps).`);
    }

    // 3. Extract cover art to a separate file if present
    let coverFilename = null;
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      const ext = pic.format.split('/')[1] || 'jpg';
      const artId = uuidv4();
      coverFilename = `${artId}.${ext}`;
      const coverPath = path.join(UPLOADS_DIR, coverFilename);
      fs.writeFileSync(coverPath, pic.data);
    }

    // 4. Save file to destination (Telegram or Local Disk)
    const trackId = uuidv4();
    const fileExt = path.extname(originalFilename) || '.mp3';
    
    let source = 'local';
    let fileIds = null;
    let filename = null;

    if (telegramBot.isEnabled()) {
      try {
        source = 'telegram';
        const fileBuffer = fs.readFileSync(tempFilePath);
        
        const CHUNK_DURATION = 5;
        const totalChunks = Math.ceil(duration / CHUNK_DURATION) || 1;
        const bytesPerChunk = Math.ceil(fileBuffer.length / totalChunks);
        
        fileIds = [];
        logger.info(`Telegram cloud storage active. Uploading track ${trackId} in ${totalChunks} chunks...`);
        
        for (let i = 0; i < totalChunks; i++) {
          const start = i * bytesPerChunk;
          const end = Math.min(start + bytesPerChunk, fileBuffer.length);
          const slice = fileBuffer.subarray(start, end);
          
          const fileId = await telegramBot.uploadChunk(slice, `${trackId}_chunk_${i}.bin`);
          fileIds.push(fileId);
        }
        
        logger.info(`Track successfully uploaded to Telegram: ${trackId}`, { totalChunks });
        
        // Clean up temporary local file
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      } catch (err) {
        logger.error('Failed to upload chunks to Telegram. Falling back to local disk storage.', { error: err.message });
        source = 'local';
        fileIds = null;
        filename = `${trackId}${fileExt}`;
        const permanentPath = path.join(UPLOADS_DIR, filename);
        fs.renameSync(tempFilePath, permanentPath);
      }
    } else {
      filename = `${trackId}${fileExt}`;
      const permanentPath = path.join(UPLOADS_DIR, filename);
      fs.renameSync(tempFilePath, permanentPath);
    }

    // 5. Create track metadata record
    const track = {
      id: trackId,
      title: metadata.common.title || path.basename(originalFilename, fileExt),
      artist: metadata.common.artist || 'Unknown Artist',
      album: metadata.common.album || 'Unknown Album',
      genre: metadata.common.genre ? metadata.common.genre.join(', ') : '',
      year: metadata.common.year || null,
      duration,
      bitrate: bitrateKbps,
      lossless: isLossless,
      mimeType: getMimeTypeFromExtension(originalFilename, mimeType),
      fileSize,
      source,
      filename,
      fileIds,
      originalExtension: fileExt,
      coverFilename,
      uploadedAt: Date.now()
    };

    this.tracks.push(track);
    this.saveCatalog();
    logger.info('Track added to library', { trackId, title: track.title, artist: track.artist, source });

    return track;
  }

  getTracks() {
    return this.tracks;
  }

  getTrack(id) {
    return this.tracks.find(t => t.id === id);
  }

  deleteTrack(id) {
    const idx = this.tracks.findIndex(t => t.id === id);
    if (idx === -1) return false;

    const track = this.tracks[idx];
    
    // Clean up audio file if it is stored locally
    if (track.filename) {
      const trackPath = path.join(UPLOADS_DIR, track.filename);
      if (fs.existsSync(trackPath)) {
        try { fs.unlinkSync(trackPath); } catch(e) {}
      }
    }
    // Clean up cover art
    if (track.coverFilename) {
      const coverPath = path.join(UPLOADS_DIR, track.coverFilename);
      if (fs.existsSync(coverPath)) {
        try { fs.unlinkSync(coverPath); } catch(e) {}
      }
    }

    this.tracks.splice(idx, 1);
    this.saveCatalog();
    logger.info('Track deleted from library', { trackId: id });
    return true;
  }

  getTrackFilePath(filename) {
    return path.join(UPLOADS_DIR, filename);
  }
}

module.exports = new LibraryManager();
