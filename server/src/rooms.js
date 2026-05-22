// ─── Sliding Window Buffer Architecture ───────────────────────────────────
//
// Memory model:
//   chunks[N] = { buffer: Buffer, mimeType: string, uploadedAt: number }
//
// GC rule: delete all chunks where index < (currentPlayingChunk - KEEP_PAST)
//   This keeps ~15s behind + ~30s ahead = ≈45s max in RAM per room
//
// Room TTL: rooms with no activity for ROOM_TTL_MS are auto-expired.

const logger = require('./logger');

const KEEP_PAST_CHUNKS   = 3;  // chunks behind current (≈15 s at 5 s/chunk)
const KEEP_FUTURE_CHUNKS = 6;  // chunks ahead of current (≈30 s prefetch)
const ROOM_TTL_MS = parseInt(process.env.ROOM_TTL_MS || '7200000', 10); // 2 hours

// ─── Room ─────────────────────────────────────────────────────────────────
class Room {
  constructor(roomId) {
    this.roomId   = roomId;
    this.chunks   = new Map(); // Map<chunkIndex: number, ChunkEntry>
    this.members  = new Map(); // Map<socketId: string, MemberInfo>
    this.state    = {
      isPlaying: false,
      currentTime: 0,
      chunkIndex: 0,
      scheduledStartTime: null,
      mimeType: 'audio/mpeg',
      totalChunks: null,
      songName: '',
      libraryTrackId: null, // Track ID if playing from catalog
      coverFilename: null,
      lyrics: [],
      lrcMeta: {},
      queue: [],
      currentQueueIndex: -1,
    };
    this.libraryFileBuffer = null;
    this.bytesPerChunk     = null;
    this.telegramFileIds   = null;
    this.createdAt   = Date.now();
    this.lastActivity = Date.now();
  }

  // ── Chunk management ──

  setLibraryTrack(track, fileBuffer) {
    this.libraryFileBuffer = fileBuffer;
    this.telegramFileIds = null;
    this.state.libraryTrackId = track.id;
    this.state.mimeType = track.mimeType;
    this.state.songName = track.title;
    this.state.coverFilename = track.coverFilename || null;
    
    // Calculate total chunks (5s per chunk)
    const CHUNK_DURATION = 5;
    const totalChunks = Math.ceil(track.duration / CHUNK_DURATION);
    this.state.totalChunks = totalChunks;
    
    // Calculate byte size per chunk
    this.bytesPerChunk = Math.ceil(fileBuffer.length / totalChunks);
    
    this.touch();
    logger.info('Room loaded track from library', {
      roomId: this.roomId,
      trackId: track.id,
      title: track.title,
      totalChunks,
      fileSize: fileBuffer.length
    });
  }

  setTelegramLibraryTrack(track) {
    this.libraryFileBuffer = null;
    this.bytesPerChunk = null;
    this.telegramFileIds = track.fileIds;
    this.state.libraryTrackId = track.id;
    this.state.mimeType = track.mimeType;
    this.state.songName = track.title;
    this.state.coverFilename = track.coverFilename || null;
    this.state.totalChunks = track.fileIds.length;
    
    this.touch();
    logger.info('Room loaded Telegram track from library', {
      roomId: this.roomId,
      trackId: track.id,
      title: track.title,
      totalChunks: track.fileIds.length
    });
  }

  async getTelegramChunk(index) {
    if (this.chunks.has(index)) {
      return this.chunks.get(index);
    }

    if (!this.telegramFileIds || index >= this.telegramFileIds.length) {
      return null;
    }

    const fileId = this.telegramFileIds[index];
    const telegramBot = require('./telegramBot');
    
    logger.debug('Fetching chunk from Telegram CDN', { room: this.roomId, index });
    const buffer = await telegramBot.getChunkBuffer(fileId);
    
    const entry = {
      buffer,
      mimeType: this.state.mimeType,
      uploadedAt: Date.now(),
      size: buffer.length
    };
    
    this.chunks.set(index, entry);
    return entry;
  }

  addChunk(index, buffer, mimeType) {
    this.chunks.set(index, {
      buffer,
      mimeType: mimeType || this.state.mimeType,
      uploadedAt: Date.now(),
      size: buffer.length,
    });
    if (mimeType) this.state.mimeType = mimeType;
    this.touch();

    logger.debug('Chunk stored', {
      room: this.roomId,
      chunkIndex: index,
      sizeKB: (buffer.length / 1024).toFixed(1),
      totalChunks: this.chunks.size,
    });
  }

  getChunk(index) {
    // If backed by library file buffer, slice dynamically
    if (this.libraryFileBuffer && this.bytesPerChunk) {
      const start = index * this.bytesPerChunk;
      if (start >= this.libraryFileBuffer.length) return null;
      
      const end = Math.min(start + this.bytesPerChunk, this.libraryFileBuffer.length);
      const slice = this.libraryFileBuffer.subarray(start, end);
      return {
        buffer: slice,
        mimeType: this.state.mimeType,
        uploadedAt: Date.now(),
        size: slice.length
      };
    }
    return this.chunks.get(index) || null;
  }

  /**
   * Garbage-collect chunks older than KEEP_PAST_CHUNKS behind current.
   * Also drops chunks far ahead (> current + KEEP_FUTURE_CHUNKS) on seek.
   */
  gcOldChunks(currentChunkIndex) {
    const lowerBound = currentChunkIndex - KEEP_PAST_CHUNKS;
    let freed = 0;
    for (const [idx] of this.chunks) {
      if (idx < lowerBound) {
        this.chunks.delete(idx);
        freed++;
      }
    }
    if (freed > 0) {
      logger.debug('GC freed chunks', { room: this.roomId, freed, remaining: this.chunks.size });
    }
  }

  getAvailableChunkIndices() {
    return Array.from(this.chunks.keys()).sort((a, b) => a - b);
  }

  /** Total bytes currently buffered in this room */
  totalBufferedBytes() {
    let total = 0;
    for (const [, entry] of this.chunks) total += entry.size;
    return total;
  }

  // ── Member management ──

  addMember(socketId, info) {
    this.members.set(socketId, { ...info, joinedAt: Date.now() });
    this.touch();
  }

  removeMember(socketId) {
    this.members.delete(socketId);
    this.touch();
  }

  getMemberCount() {
    return this.members.size;
  }

  getMembersArray() {
    return Array.from(this.members.entries()).map(([id, info]) => ({ id, ...info }));
  }

  // ── State ──

  setState(partial) {
    Object.assign(this.state, partial);
    this.touch();
  }

  getState() {
    return {
      ...this.state,
      chunkCount: this.chunks.size,
      availableChunks: this.getAvailableChunkIndices(),
      memberCount: this.getMemberCount(),
      members: this.getMembersArray(),
    };
  }

  // ── TTL ──

  touch() {
    this.lastActivity = Date.now();
  }

  isExpired() {
    return Date.now() - this.lastActivity > ROOM_TTL_MS;
  }
}

// ─── RoomManager ──────────────────────────────────────────────────────────
class RoomManager {
  constructor() {
    this.rooms       = new Map(); // Map<roomId, Room>
    this.memberIndex = new Map(); // Map<socketId, roomId> for O(1) disconnect lookup

    // TTL sweep: check every 5 minutes, remove expired rooms
    this._gcInterval = setInterval(() => this._sweepExpiredRooms(), 5 * 60 * 1000);
    logger.info('RoomManager initialised', { ttlMs: ROOM_TTL_MS });
  }

  createRoom(roomId) {
    const room = new Room(roomId);
    this.rooms.set(roomId, room);
    logger.info('Room created', { roomId });
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  addMemberToRoom(roomId, socketId, info) {
    const room = this.getRoom(roomId);
    if (room) {
      room.addMember(socketId, info);
      this.memberIndex.set(socketId, roomId);
    }
  }

  removeMember(socketId) {
    const roomId = this.memberIndex.get(socketId);
    if (!roomId) return null;

    const room = this.getRoom(roomId);
    if (room) {
      room.removeMember(socketId);
      if (room.getMemberCount() === 0) {
        this.rooms.delete(roomId);
        logger.info('Room deleted (empty)', { roomId });
      }
    }
    this.memberIndex.delete(socketId);
    return roomId;
  }

  getRoomStats() {
    const stats = [];
    for (const [id, room] of this.rooms) {
      stats.push({
        roomId: id,
        members: room.getMemberCount(),
        chunks: room.chunks.size,
        bufferedMB: (room.totalBufferedBytes() / 1024 / 1024).toFixed(2),
        ageMinutes: ((Date.now() - room.createdAt) / 60_000).toFixed(1),
      });
    }
    return stats;
  }

  /** Remove rooms that have exceeded ROOM_TTL_MS with no activity */
  _sweepExpiredRooms() {
    let swept = 0;
    for (const [id, room] of this.rooms) {
      if (room.isExpired()) {
        this.rooms.delete(id);
        // Clean up member index entries for this room
        for (const [sid, rid] of this.memberIndex) {
          if (rid === id) this.memberIndex.delete(sid);
        }
        swept++;
        logger.info('Room expired (TTL)', { roomId: id });
      }
    }
    if (swept > 0) logger.info(`TTL sweep removed ${swept} room(s)`);
  }

  /** Call on process exit to clean up the interval */
  destroy() {
    clearInterval(this._gcInterval);
  }
}

module.exports = { RoomManager, Room };
