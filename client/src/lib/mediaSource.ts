// ─── MediaSource Extensions (MSE) SourceBuffer Manager ───────────────────
// Manages sequential chunk appending for seamless streaming playback.
// MSE spec: only one append operation may be active at a time.
// This class queues pending chunks and flushes them serially.

import { CHUNK_DURATION } from './constants';

export type MseReadyState = 'idle' | 'open' | 'ended' | 'closed' | 'error';

export class SourceBufferManager {
  private readonly ms: MediaSource;
  private sb: SourceBuffer | null = null;
  private queue: Array<{ buffer: ArrayBuffer; index: number }> = [];
  private _appending = false;
  private _state: MseReadyState = 'idle';
  private _onError?: (err: Error) => void;

  public readonly objectUrl: string;

  constructor(mimeType: string, onError?: (err: Error) => void) {
    this.ms = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.ms);
    this._onError = onError;

    this.ms.addEventListener('sourceopen', () => {
      try {
        this.sb = this.ms.addSourceBuffer(mimeType);
        this.sb.mode = 'sequence'; // prevents timestamp discontinuity errors
        this.sb.addEventListener('updateend', () => {
          this._appending = false;
          this._flush();
        });
        this._state = 'open';
        this._flush(); // flush anything queued before open
        console.info('[mse] SourceBuffer opened:', mimeType);
      } catch (e) {
        this._state = 'error';
        const err = e instanceof Error ? e : new Error(String(e));
        console.error('[mse] addSourceBuffer failed:', err);
        this._onError?.(err);
      }
    });

    this.ms.addEventListener('sourceended', () => {
      this._state = 'ended';
    });

    this.ms.addEventListener('sourceclose', () => {
      this._state = 'closed';
    });
  }

  get state(): MseReadyState {
    return this._state;
  }

  get bufferedLength(): number {
    return this.queue.length;
  }

  /** Queue a chunk for appending */
  appendChunk(buffer: ArrayBuffer, index: number): void {
    this.queue.push({ buffer, index });
    this._flush();
  }

  /** Signal that all chunks have been uploaded (closes MediaSource gracefully) */
  endStream(): void {
    if (this.ms.readyState === 'open') {
      // Wait for queue to drain before ending
      const tryEnd = () => {
        if (this.queue.length === 0 && !this._appending) {
          try { this.ms.endOfStream(); } catch (_) {}
        } else {
          setTimeout(tryEnd, 100);
        }
      };
      tryEnd();
    }
  }

  /** Free object URL and close MediaSource */
  destroy(): void {
    URL.revokeObjectURL(this.objectUrl);
    this.queue = [];
    if (this.ms.readyState === 'open') {
      try { this.ms.endOfStream(); } catch (_) {}
    }
    this._state = 'closed';
  }

  private _flush(): void {
    if (
      this._appending      ||
      this.queue.length === 0  ||
      !this.sb             ||
      this.sb.updating     ||
      this.ms.readyState !== 'open'
    ) return;

    const next = this.queue.shift()!;
    this._appending = true;

    try {
      this.sb.timestampOffset = next.index * CHUNK_DURATION;
      this.sb.appendBuffer(next.buffer);
    } catch (e) {
      this._appending = false;
      const err = e instanceof Error ? e : new Error(String(e));
      console.error('[mse] appendBuffer error:', err);
      this._onError?.(err);
    }
  }
}

/** Check whether MSE is supported and the given MIME type is usable */
export function isMseSupported(mimeType: string): boolean {
  return (
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported(mimeType)
  );
}
