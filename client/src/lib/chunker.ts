// ─── Audio Chunker ────────────────────────────────────────────────────────
// Slices an audio file into fixed-duration byte segments for streaming.
//
// Strategy: Raw ArrayBuffer byte-slice by estimated bytes-per-chunk.
// Works well for constant-bitrate MP3. For VBR audio, frames may be slightly
// misaligned but the Web Audio API is tolerant of this.

import { CHUNK_DURATION } from './constants';

export { CHUNK_DURATION };

export interface AudioChunk {
  index: number;
  buffer: ArrayBuffer;
  startTime: number;  // seconds
  duration: number;   // seconds
  mimeType: string;
}

export interface ChunkResult {
  totalChunks: number;
  duration: number;
  mimeType: string;
}

/**
 * Slices an audio file into CHUNK_DURATION-second segments.
 * Calls onChunk synchronously for each chunk before resolving.
 */
export async function sliceAudioFile(
  file: File,
  onChunk: (chunk: AudioChunk) => void | Promise<void>,
): Promise<ChunkResult> {
  const arrayBuffer = await file.arrayBuffer();

  // Decode to measure actual duration (we don't use the decoded PCM)
  const audioCtx = new AudioContext();
  let duration: number;
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    duration = decoded.duration;
  } finally {
    await audioCtx.close();
  }

  const totalChunks = Math.ceil(duration / CHUNK_DURATION);
  const bytesPerChunk = Math.ceil(arrayBuffer.byteLength / totalChunks);
  const mimeType = file.type || 'audio/mpeg';

  console.info(
    `[chunker] ${file.name}: ${duration.toFixed(1)}s → ${totalChunks} chunks × ${CHUNK_DURATION}s ` +
    `(~${(bytesPerChunk / 1024).toFixed(0)} KB each)`
  );

  for (let i = 0; i < totalChunks; i++) {
    const start = i * bytesPerChunk;
    const end = Math.min(start + bytesPerChunk, arrayBuffer.byteLength);

    const chunk: AudioChunk = {
      index: i,
      buffer: arrayBuffer.slice(start, end),
      startTime: i * CHUNK_DURATION,
      duration: i < totalChunks - 1 ? CHUNK_DURATION : duration - i * CHUNK_DURATION,
      mimeType,
    };

    await onChunk(chunk);
  }

  return { totalChunks, duration, mimeType };
}

/**
 * Returns the chunk index that contains the given playback position.
 */
export function timeToChunkIndex(currentTime: number): number {
  return Math.floor(currentTime / CHUNK_DURATION);
}

/**
 * Returns a list of chunk indices that should be prefetched
 * starting from the current playing chunk.
 */
export function getPrefetchIndices(currentIndex: number, totalChunks: number, ahead = 4): number[] {
  const indices: number[] = [];
  for (let i = currentIndex; i < Math.min(currentIndex + ahead, totalChunks); i++) {
    indices.push(i);
  }
  return indices;
}

/**
 * Returns MIME type appropriate for MediaSource based on upload MIME.
 */
export function toMseMimeType(uploadMime: string): string {
  if (uploadMime.includes('webm')) return 'audio/webm; codecs="opus"';
  if (uploadMime.includes('ogg'))  return 'audio/ogg; codecs="opus"';
  return 'audio/mpeg';
}
