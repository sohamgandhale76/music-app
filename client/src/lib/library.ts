// ─── Local Music Library (IndexedDB) ─────────────────────────────────────
// Persists uploaded songs across browser sessions.
// Stores: name, artist, album, duration, mimeType, coverUrl, storedAt
// Does NOT store the raw audio buffer (too large for IndexedDB quota).
// Instead stores metadata so the host knows which songs they've uploaded
// and can drag-drop again or see their history.

export interface LibraryTrack {
  id: string;            // unique — sha of name+size
  name: string;          // track title (from filename or Spotify)
  artist: string;
  album: string;
  duration: number;      // seconds
  mimeType: string;
  coverUrl: string;      // Spotify album art URL or ''
  spotifyId: string;     // Spotify track ID or ''
  totalChunks: number;
  storedAt: number;      // Date.now()
}

const DB_NAME    = 'noirsync-library';
const DB_VERSION = 1;
const STORE      = 'tracks';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('storedAt', 'storedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function saveTrack(track: LibraryTrack): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(track);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function getAllTracks(): Promise<LibraryTrack[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req   = store.index('storedAt').getAll();
    req.onsuccess = () => resolve((req.result as LibraryTrack[]).reverse());
    req.onerror   = () => reject(req.error);
  });
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/** Generate a stable ID from filename + file size */
export function makeTrackId(name: string, size: number): string {
  return btoa(`${name}-${size}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
}
