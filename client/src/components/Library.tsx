import { useEffect, useState, useRef, useCallback } from 'react';
import { SERVER_URL } from '../lib/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface R2Track {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  size: number | null;
  format: string | null;
  audio_key: string;
  cover_key: string | null;
  lyrics_key: string | null;
  uploaded_at: number;
}

interface StorageStats {
  used: number;
  limit: number;
  usedGB: string;
  limitGB: string;
  percentUsed: string;
  isFull: boolean;
}

interface LibraryProps {
  /** When provided, Library runs in "host picker" mode — clicking Play calls this instead of local playback */
  onSelectTrack?: (track: R2Track, signedUrl: string) => void;
}

interface TrackCardProps {
  track: R2Track;
  onDelete: (id: string) => void;
  onPlay: (track: R2Track) => void;
  isPlaying: boolean;
}

interface UploadFormProps {
  onUploaded: () => void;
  isFull: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number | null): string {
  if (!bytes) return '0 B';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtDuration(secs: number | null): string {
  if (!secs) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBadge(format: string | null) {
  const f = (format || 'mp3').toUpperCase();
  const colors: Record<string, string> = {
    FLAC: 'border-green-700/50 bg-green-950/30 text-green-400',
    WAV:  'border-blue-700/50  bg-blue-950/30  text-blue-400',
    OGG:  'border-purple-700/50 bg-purple-950/30 text-purple-400',
    MP3:  'border-yellow-700/50 bg-yellow-950/30 text-yellow-400',
    M4A:  'border-orange-700/50 bg-orange-950/30 text-orange-400',
  };
  const cls = colors[f] ?? 'border-noir-border bg-noir-graphite text-noir-ash';
  return (
    <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${cls} uppercase tracking-wider`}>
      {f}
    </span>
  );
}

// ─── StorageBar ───────────────────────────────────────────────────────────────

function StorageBar({ storage }: { storage: StorageStats | null }) {
  if (!storage) return null;
  const pct = parseFloat(storage.percentUsed) || 0;
  const isFull = storage.isFull;
  const isWarn = pct >= 90 && !isFull;

  const barColor = isFull
    ? 'bg-red-500'
    : isWarn
    ? 'bg-amber-400'
    : 'bg-gradient-to-r from-[#c8a96e] to-[#d4882a]';

  const textColor = isFull ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-[#c8a96e]';

  return (
    <div className="rounded-xl border border-noir-border/40 bg-noir-charcoal/60 backdrop-blur-sm p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.2em] text-noir-ash uppercase">R2 Storage</span>
        <span className={`font-mono text-[11px] font-semibold ${textColor}`}>
          {storage.usedGB} / {storage.limitGB} GB
          <span className="text-noir-dim ml-1">({storage.percentUsed}%)</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-noir-graphite overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {isFull && (
        <p className="font-mono text-[10px] text-red-400">
          ⚠ Library full — delete tracks to free space
        </p>
      )}
    </div>
  );
}

// ─── TrackCard ────────────────────────────────────────────────────────────────

function TrackCard({ track, onDelete, onPlay, isPlaying }: TrackCardProps) {
  const base = SERVER_URL || '';
  const coverUrl = track.cover_key ? `${base}/library/${track.id}/cover` : null;

  return (
    <div
      className={`
        relative flex gap-3 p-3.5 rounded-xl border transition-all duration-300 group
        ${isPlaying
          ? 'border-[#c8a96e]/60 bg-[#c8a96e]/[0.06] shadow-[0_0_24px_rgba(200,169,110,0.15)]'
          : 'border-noir-border/40 bg-noir-charcoal/50 hover:border-noir-border hover:bg-noir-charcoal/80'
        }
      `}
    >
      {/* Cover art */}
      <div className="w-14 h-14 rounded-lg overflow-hidden bg-noir-graphite flex-shrink-0 flex items-center justify-center border border-noir-border/40 relative">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt="Cover"
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <span className="text-2xl opacity-25">🎵</span>
        )}
        {isPlaying && (
          <div className="absolute inset-0 bg-[#c8a96e]/10 flex items-center justify-center">
            <span className="text-xs animate-pulse">▶</span>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <p className="font-mono text-sm text-noir-white truncate leading-tight" title={track.title}>
            {track.title}
          </p>
          <p className="font-mono text-[11px] text-noir-ash truncate mt-0.5">
            {track.artist || 'Unknown Artist'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {formatBadge(track.format)}
          {track.lyrics_key && (
            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-[#c8a96e]/40 bg-[#c8a96e]/10 text-[#c8a96e] uppercase tracking-wider">
              📝 LRC
            </span>
          )}
          <span className="font-mono text-[10px] text-noir-dim">{fmtDuration(track.duration)}</span>
          <span className="font-mono text-[10px] text-noir-dim">{fmtBytes(track.size)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 justify-center shrink-0">
        <button
          onClick={() => onPlay(track)}
          className={`
            w-8 h-8 rounded-lg border flex items-center justify-center text-sm
            transition-all hover:scale-105 active:scale-95
            ${isPlaying
              ? 'border-[#c8a96e]/60 bg-[#c8a96e]/20 text-[#c8a96e]'
              : 'border-noir-border text-noir-ash hover:border-[#c8a96e]/40 hover:text-[#c8a96e] hover:bg-[#c8a96e]/5'
            }
          `}
          title={isPlaying ? 'Playing' : 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => onDelete(track.id)}
          className="w-8 h-8 rounded-lg border border-red-900/40 text-red-500/60 flex items-center justify-center text-xs transition-all hover:border-red-500/50 hover:text-red-400 hover:bg-red-950/20 active:scale-95"
          title="Delete from library"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

// Helper functions for parsing filename metadata
function titleCase(str: string): string {
  return str
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function parseFilename(filename: string): { title: string; artist: string } {
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  let artist = '';
  let title = nameWithoutExt;

  if (nameWithoutExt.includes(' - ')) {
    const parts = nameWithoutExt.split(' - ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  } else if (nameWithoutExt.includes(' -')) {
    const parts = nameWithoutExt.split(' -');
    artist = parts[0].trim();
    title = parts.slice(1).join(' -').trim();
  } else if (nameWithoutExt.includes('- ')) {
    const parts = nameWithoutExt.split('- ');
    artist = parts[0].trim();
    title = parts.slice(1).join('- ').trim();
  } else if (nameWithoutExt.includes('_')) {
    const parts = nameWithoutExt.split('_');
    if (parts.length === 2) {
      artist = parts[0].trim();
      title = parts[1].trim();
    }
  }

  const cleanTitle = title.replace(/[-_]/g, ' ').trim();
  const cleanArtist = artist.replace(/[-_]/g, ' ').trim();

  return {
    title: titleCase(cleanTitle),
    artist: cleanArtist ? titleCase(cleanArtist) : '',
  };
}

// ─── UploadForm ───────────────────────────────────────────────────────────────

function UploadForm({ onUploaded, isFull }: UploadFormProps) {
  const [audioFile, setAudioFile]   = useState<File | null>(null);
  const [coverFile, setCoverFile]   = useState<File | null>(null);
  const [lyricsFile, setLyricsFile] = useState<File | null>(null);
  const [title, setTitle]           = useState('');
  const [artist, setArtist]         = useState('');
  const [duration, setDuration]     = useState<number | null>(null);
  const [progress, setProgress]     = useState(0);
  const [uploading, setUploading]   = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const reset = () => {
    setAudioFile(null); setCoverFile(null); setLyricsFile(null);
    setTitle(''); setArtist(''); setDuration(null); setProgress(0); setError(null);
  };

  const handleAudioSelect = (file: File) => {
    setAudioFile(file);
    const { title: parsedTitle, artist: parsedArtist } = parseFilename(file.name);
    setTitle(parsedTitle);
    setArtist(parsedArtist);

    // Extract duration using HTML5 Audio
    const audio = new Audio();
    audio.src = URL.createObjectURL(file);
    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
      URL.revokeObjectURL(audio.src);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!audioFile) { setError('Please select an audio file.'); return; }
    setUploading(true); setError(null); setProgress(0);

    const form = new FormData();
    form.append('audio',  audioFile);
    if (coverFile)  form.append('cover',  coverFile);
    if (lyricsFile) form.append('lyrics', lyricsFile);
    if (title)  form.append('title',  title);
    if (artist) form.append('artist', artist);
    if (duration !== null) form.append('duration', duration.toString());

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', `${SERVER_URL || ''}/library/upload`);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status === 507) {
        setError('Storage full — delete some tracks first.');
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        try { setError((JSON.parse(xhr.responseText) as { error: string }).error || 'Upload failed'); }
        catch { setError('Upload failed'); }
        return;
      }
      reset();
      onUploaded();
    };
    xhr.onerror = () => { setUploading(false); setError('Network error during upload.'); };
    xhr.send(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-noir-border/40 bg-noir-charcoal/40 backdrop-blur-sm p-4">
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-noir-ash mb-2">Upload to R2 Library</p>

      {/* Audio file — required */}
      <label className="block">
        <span className="font-mono text-[10px] text-noir-dim mb-1 block">Audio File *</span>
        <div className={`
          relative border border-dashed rounded-lg p-3 text-center cursor-pointer transition-all
          ${audioFile ? 'border-[#c8a96e]/50 bg-[#c8a96e]/5' : 'border-noir-border hover:border-[#c8a96e]/30'}
        `}>
          <input
            type="file"
            accept="audio/mp3,audio/mpeg,audio/wav,audio/flac,audio/ogg,audio/*"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAudioSelect(f);
            }}
          />
          <p className="font-mono text-xs text-noir-ash">
            {audioFile ? `✓ ${audioFile.name}` : '🎵 MP3 / WAV / FLAC / OGG'}
          </p>
        </div>
      </label>

      {/* Title & Artist */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="font-mono text-[10px] text-noir-dim mb-1 block">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Track title..."
            className="w-full bg-noir-graphite border border-noir-border text-noir-white px-3 py-1.5 rounded-lg font-mono text-xs focus:outline-none focus:border-[#c8a96e]/50 transition-all placeholder:text-noir-dim"
          />
        </div>
        <div>
          <span className="font-mono text-[10px] text-noir-dim mb-1 block">Artist</span>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist name..."
            className="w-full bg-noir-graphite border border-noir-border text-noir-white px-3 py-1.5 rounded-lg font-mono text-xs focus:outline-none focus:border-[#c8a96e]/50 transition-all placeholder:text-noir-dim"
          />
        </div>
      </div>

      {/* Optional files */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="font-mono text-[10px] text-noir-dim mb-1 block">Cover Image (optional)</span>
          <div className={`relative border border-dashed rounded-lg px-2 py-2 text-center cursor-pointer transition-all ${coverFile ? 'border-blue-500/40 bg-blue-950/10' : 'border-noir-border hover:border-blue-500/20'}`}>
            <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
            <p className="font-mono text-[10px] text-noir-dim">{coverFile ? `✓ ${coverFile.name.slice(0,20)}` : '🖼 Image...'}</p>
          </div>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] text-noir-dim mb-1 block">Lyrics .lrc (optional)</span>
          <div className={`relative border border-dashed rounded-lg px-2 py-2 text-center cursor-pointer transition-all ${lyricsFile ? 'border-[#c8a96e]/40 bg-[#c8a96e]/5' : 'border-noir-border hover:border-[#c8a96e]/20'}`}>
            <input type="file" accept=".lrc" className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => setLyricsFile(e.target.files?.[0] ?? null)} />
            <p className="font-mono text-[10px] text-noir-dim">{lyricsFile ? `✓ ${lyricsFile.name.slice(0,20)}` : '📝 .lrc file...'}</p>
          </div>
        </label>
      </div>

      {/* Progress */}
      {uploading && (
        <div className="space-y-1">
          <div className="h-1 rounded-full bg-noir-graphite overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#c8a96e] to-[#d4882a] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="font-mono text-[10px] text-[#c8a96e]">Uploading… {progress}%</p>
        </div>
      )}

      {error && (
        <p className="font-mono text-[11px] text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={uploading || isFull || !audioFile}
        className="
          w-full py-2 px-4 rounded-lg font-mono text-xs font-semibold uppercase tracking-wider
          transition-all duration-200 active:scale-[0.98]
          bg-gradient-to-r from-[#c8a96e] to-[#d4882a] text-[#0a0a0a]
          hover:brightness-110 hover:shadow-[0_0_20px_rgba(200,169,110,0.3)]
          disabled:opacity-40 disabled:cursor-not-allowed disabled:brightness-100
        "
      >
        {uploading ? `Uploading ${progress}%…` : isFull ? 'Storage Full' : '📤 Upload to Library'}
      </button>
    </form>
  );
}

// ─── Main Library Component ───────────────────────────────────────────────────

/**
 * Library — Self-contained R2 music library component.
 *
 * Props:
 *   onSelectTrack(track, signedUrl) — called when host picks a track to play in the room.
 *                                     If not provided, the component is in standalone mode.
 */
export function Library({ onSelectTrack }: LibraryProps) {
  const [tracks, setTracks]         = useState<R2Track[]>([]);
  const [storage, setStorage]       = useState<StorageStats | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [playingId, setPlayingId]   = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const base = SERVER_URL || '';

  const fetchTracks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/library`);
      if (!res.ok) throw new Error('Failed to load R2 library');
      setTracks(await res.json() as R2Track[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [base]);

  const fetchStorage = useCallback(async () => {
    try {
      const res = await fetch(`${base}/library/storage`);
      if (res.ok) setStorage(await res.json() as StorageStats);
    } catch { /* non-fatal */ }
  }, [base]);

  useEffect(() => {
    fetchTracks();
    fetchStorage();
  }, [fetchTracks, fetchStorage]);

  const handlePlay = useCallback(async (track: R2Track) => {
    try {
      const res = await fetch(`${base}/library/${track.id}/stream`);
      if (!res.ok) throw new Error('Could not get stream URL');
      const { url } = await res.json() as { url: string };

      if (onSelectTrack) {
        // Host mode: pass the signed URL up to the parent
        onSelectTrack(track, url);
        return;
      }

      // Standalone playback
      if (audioRef.current) {
        if (playingId === track.id) {
          if (audioRef.current.paused) {
            audioRef.current.play().catch(() => {});
          } else {
            audioRef.current.pause();
          }
          return;
        }
        audioRef.current.src = url;
        audioRef.current.load();
        audioRef.current.play().catch(() => {});
        setPlayingId(track.id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Playback error');
    }
  }, [base, onSelectTrack, playingId]);

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('Delete this track from the R2 library?')) return;
    try {
      const res = await fetch(`${base}/library/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      if (playingId === id && audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        setPlayingId(null);
      }
      setTracks((prev) => prev.filter((t) => t.id !== id));
      fetchStorage();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete error');
    }
  }, [base, playingId, fetchStorage]);

  const handleUploaded = useCallback(() => {
    fetchTracks();
    fetchStorage();
  }, [fetchTracks, fetchStorage]);

  const filtered = tracks.filter((t) => {
    const q = search.toLowerCase();
    return (
      (t.title  || '').toLowerCase().includes(q) ||
      (t.artist || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4 font-mono">
      {/* Hidden audio element for standalone playback */}
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} />

      {/* Storage bar */}
      <StorageBar storage={storage} />

      {/* Header + Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 relative min-w-[160px]">
          <input
            type="text"
            placeholder="Search tracks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-noir-graphite border border-noir-border text-noir-white px-3 py-2 rounded-lg font-mono text-xs focus:outline-none focus:border-[#c8a96e]/50 transition-all placeholder:text-noir-dim"
          />
        </div>
        <button
          onClick={() => setShowUpload((p) => !p)}
          className="
            px-3 py-2 rounded-lg font-mono text-[11px] uppercase tracking-wider font-semibold
            border transition-all hover:scale-[1.02] active:scale-[0.98]
            border-[#c8a96e]/40 text-[#c8a96e] bg-[#c8a96e]/5 hover:bg-[#c8a96e]/10
          "
        >
          {showUpload ? '✕ Close' : '📤 Upload'}
        </button>
      </div>

      {/* Upload form */}
      {showUpload && (
        <UploadForm
          onUploaded={() => { setShowUpload(false); handleUploaded(); }}
          isFull={storage?.isFull ?? false}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-950/20 border border-red-900/40 text-red-400 text-[11px]">
          {error}
          <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Track list */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 opacity-60">
          <div className="w-6 h-6 border-2 border-[#c8a96e] border-t-transparent rounded-full animate-spin" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-noir-dim">Loading R2 Library…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 border border-dashed border-noir-border/40 rounded-xl">
          <span className="text-3xl opacity-20">📭</span>
          <p className="font-mono text-sm text-noir-ash">No tracks in R2 library</p>
          <p className="font-mono text-[10px] text-noir-dim">
            {search ? 'Try a different search' : 'Upload an audio file above to get started'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((track) => (
            <TrackCard
              key={track.id}
              track={track}
              onPlay={handlePlay}
              onDelete={handleDelete}
              isPlaying={playingId === track.id}
            />
          ))}
          <p className="font-mono text-[10px] text-noir-dim text-right pt-1">
            {filtered.length} track{filtered.length !== 1 ? 's' : ''}
            {storage ? ` · ${storage.usedGB} GB used` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
