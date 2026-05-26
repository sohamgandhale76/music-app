import { useRef, useState, useCallback, useEffect } from 'react';
import { GlassPanel } from './ui/GlassPanel';
import { Button } from './ui/Button';
import { WaveformBar } from './ui/WaveformBar';
import { ProgressBar } from './ui/ProgressBar';
import { LyricsRenderer } from './LyricsRenderer';
import { GlowSpotlight } from './GlowSpotlight';
import { useRoom } from '../hooks/useRoom';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from './Toast';
import { LibraryBrowser } from './LibraryBrowser';
import { Library } from './Library';
import { DynamicBackground } from './DynamicBackground';
import { sliceAudioFile, timeToChunkIndex, CHUNK_DURATION } from '../lib/chunker';
import { parseLrc, type LrcLine, type LrcMeta } from '../lib/lrcParser';
import { SERVER_URL } from '../lib/constants';
import { getSocket } from '../lib/socket';

interface Props {
  roomId: string;
  displayName: string;
  onLeave: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function HostView({ roomId, displayName, onLeave, audioRef }: Props) {
  const {
    connected,
    roomState,
    roomError,
    emitPlay,
    emitPause,
    emitSeek,
    emitChunkPlaying,
    emitLoadLibraryTrack,
    emitUpdateQueue,
    emitUpdateTrackMetadata,
  } = useRoom(roomId, 'host', displayName);
  const toast = useToast();

  const sortedMembers = [...(roomState.members || [])].sort((a, b) => {
    if (a.role === 'host' && b.role !== 'host') return -1;
    if (a.role !== 'host' && b.role === 'host') return 1;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });
  const [lyrics, setLyrics]           = useState<LrcLine[]>([]);
  const [lrcMeta, setLrcMeta]         = useState<LrcMeta>({});
  const [activeTrack, setActiveTrack] = useState<any>(null);
  const [totalChunks, setTotalChunks] = useState(0);
  const [uploadedCount, setUploaded]  = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]       = useState(0);
  const [songName, setSongName]       = useState('');
  const [audioReady, setAudioReady]   = useState(false);
  const [dragOver, setDragOver]       = useState(false);
  const [activeTab, setActiveTab]     = useState<'player' | 'library'>('player');
  const [mobileTab, setMobileTab]     = useState<'player' | 'lyrics' | 'library'>('player');
  const [showR2Library, setShowR2Library] = useState(false);

  // Queue and Playback states
  const [libraryTracks, setLibraryTracks] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number>(-1);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState<'none' | 'all' | 'one'>('none');
  const [volume, setVolume] = useState(1);

  // References to keep event listeners static
  const playNextRef = useRef<() => void>(() => {});
  const isRepeatRef = useRef<'none' | 'all' | 'one'>('none');
  const emitPlayRef = useRef(emitPlay);

  emitPlayRef.current = emitPlay;
  isRepeatRef.current = isRepeat;

  // Show room errors as toasts
  useEffect(() => {
    if (roomError) toast.error(roomError);
  }, [roomError]);

  // Sync queue state with listeners
  useEffect(() => {
    emitUpdateQueue(queue, currentQueueIndex);
  }, [queue, currentQueueIndex, emitUpdateQueue]);

  // Sync roomState song details (crucial for library-loaded tracks)
  useEffect(() => {
    if (roomState.songName) {
      setSongName(roomState.songName);
    }
    if (roomState.totalChunks) {
      setTotalChunks(roomState.totalChunks);
    }
  }, [roomState.songName, roomState.totalChunks]);

  // Restore audio source if room has an active library track and audio is not loaded
  useEffect(() => {
    if (roomState.libraryTrackId && !audioReady && audioRef.current) {
      const url = `${SERVER_URL || ''}/api/library/tracks/${roomState.libraryTrackId}/download`;
      audioRef.current.src = url;
      audioRef.current.load();
      setAudioReady(true);
    }
  }, [roomState.libraryTrackId, audioReady]);

  // Track current time for lyrics + seek bar
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      const idx = timeToChunkIndex(audio.currentTime);
      emitChunkPlaying(idx); // triggers GC on server
    };
    const handleEnded = () => {
      setIsPlaying(false);
      if (isRepeatRef.current === 'one') {
        if (audio) {
          audio.currentTime = 0;
          audio.play().then(() => {
            setIsPlaying(true);
            emitPlayRef.current(0, 0);
          }).catch(() => {});
        }
      } else {
        playNextRef.current();
      }
    };
    const handleDuration = () => setDuration(audio.duration);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleDuration);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleDuration);
    };
  }, [emitChunkPlaying]);

  // ── Load audio + upload chunks ──────────────────────────────────────────

  const handleAudioFile = useCallback(async (file: File, lrcData?: { lines: any[]; meta: any } | null) => {
    setIsUploading(true);
    setUploaded(0);
    setAudioReady(false);
    setSongName(file.name.replace(/\.[^.]+$/, ''));
    setActiveTrack(null);

    let resolvedTotal = 0;

    try {
      const result = await sliceAudioFile(file, async (chunk) => {
        const form = new FormData();
        form.append('chunk', new Blob([chunk.buffer], { type: chunk.mimeType }));
        form.append('chunkIndex', String(chunk.index));
        form.append('totalChunks', '9999'); // placeholder
        form.append('mimeType', chunk.mimeType);
        form.append('songName', file.name.replace(/\.[^.]+$/, ''));

        const res = await fetch(`${SERVER_URL || ''}/api/rooms/${roomId}/chunks`, {
          method: 'POST',
          body: form,
        });

        if (!res.ok) {
          const { error } = await res.json() as { error: string };
          throw new Error(error || `HTTP ${res.status}`);
        }

        setUploaded((u) => u + 1);
      });

      resolvedTotal = result.totalChunks;
      setTotalChunks(resolvedTotal);
      setDuration(result.duration);

      // Load audio locally for host playback control
      const objectUrl = URL.createObjectURL(file);
      if (audioRef.current) {
        audioRef.current.src = objectUrl;
        audioRef.current.load();
        setAudioReady(true);
      }

      toast.success(`"${file.name.replace(/\.[^.]+$/, '')}" uploaded — ${resolvedTotal} chunks ready`);

      // Emit metadata update to the room state
      emitUpdateTrackMetadata({
        songName: file.name.replace(/\.[^.]+$/, ''),
        totalChunks: resolvedTotal,
        mimeType: file.type || 'audio/mpeg',
        libraryTrackId: null,
        coverFilename: null,
        lyrics: lrcData ? lrcData.lines : [],
        lrcMeta: lrcData ? lrcData.meta : {},
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setIsUploading(false);
    }
  }, [roomId, toast, emitUpdateTrackMetadata]);

  // Fetch tracks list on mount and whenever active tab changes to keep library metadata up-to-date
  const fetchLibraryCatalog = useCallback(() => {
    fetch(`${SERVER_URL || ''}/api/library/tracks`)
      .then(res => res.json())
      .then(data => {
        setLibraryTracks(data.tracks || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchLibraryCatalog();
  }, [fetchLibraryCatalog, activeTab]);

  // Automatically fetch and load lyrics when a library track plays
  useEffect(() => {
    if (!roomState.libraryTrackId) {
      setActiveTrack(null);
      return;
    }
    
    let active = true;
    fetch(`${SERVER_URL || ''}/api/library/tracks/${roomState.libraryTrackId}`)
      .then((res) => {
        if (!res.ok) throw new Error('No track details');
        return res.json();
      })
      .then((data) => {
        if (!active || !data.track) return;
        const track = data.track;
        setActiveTrack(track);
        if (track.lrcText) {
          const { lines, meta } = parseLrc(track.lrcText);
          setLyrics(lines);
          setLrcMeta((prev) => ({
            title: meta.title || track.title || prev.title,
            artist: meta.artist || track.artist || prev.artist,
          }));
        } else {
          setLyrics([]);
        }
      })
      .catch(() => {
        if (active) {
          setLyrics([]);
          setActiveTrack(null);
        }
      });

    return () => {
      active = false;
    };
  }, [roomState.libraryTrackId]);

  const playTrack = useCallback(async (track: any) => {
    if (!audioRef.current) return;
    
    // Reset state for new song
    setLyrics([]);
    setLrcMeta({ title: track.title, artist: track.artist });
    setSongName(track.title);
    setActiveTrack(track);

    emitLoadLibraryTrack(track.id);

    // Fetch fresh track metadata to get lrcText (may not be on the cached list object)
    let lyricsLines: any[] = [];
    let lyricsMeta: any = { title: track.title, artist: track.artist };
    try {
      const res = await fetch(`${SERVER_URL || ''}/api/library/tracks/${track.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.track?.lrcText) {
          const parsed = parseLrc(data.track.lrcText);
          lyricsLines = parsed.lines;
          lyricsMeta = {
            title: parsed.meta.title || track.title,
            artist: parsed.meta.artist || track.artist,
          };
          setLyrics(parsed.lines);
          setLrcMeta(lyricsMeta);
        }
      }
    } catch { /* non-fatal */ }

    // Broadcast lyrics + metadata to all listeners via room state
    emitUpdateTrackMetadata({
      songName: track.title,
      totalChunks: 0,
      mimeType: track.mimeType || 'audio/mpeg',
      libraryTrackId: track.id,
      coverFilename: track.coverFilename || null,
      lyrics: lyricsLines,
      lrcMeta: lyricsMeta,
    });

    const url = `${SERVER_URL || ''}/api/library/tracks/${track.id}/download`;
    audioRef.current.src = url;
    audioRef.current.load();
    setAudioReady(true);

    audioRef.current.play().then(() => {
      setIsPlaying(true);
      emitPlay(0, 0);
    }).catch(() => {});

    toast.success(`Playing "${track.title}" from library...`);
  }, [emitLoadLibraryTrack, emitPlay, emitUpdateTrackMetadata, toast]);

  const playNext = useCallback(() => {
    if (queue.length === 0) return;
    
    let nextIndex = currentQueueIndex + 1;
    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * queue.length);
    }
    
    if (nextIndex < queue.length) {
      setCurrentQueueIndex(nextIndex);
      playTrack(queue[nextIndex]);
    } else {
      if (isRepeat === 'all') {
        setCurrentQueueIndex(0);
        playTrack(queue[0]);
      } else {
        setIsPlaying(false);
        emitPause(currentTime);
      }
    }
  }, [queue, currentQueueIndex, isShuffle, isRepeat, playTrack, currentTime, emitPause]);

  playNextRef.current = playNext;

  const playPrev = useCallback(() => {
    if (queue.length === 0) return;
    
    let prevIndex = currentQueueIndex - 1;
    if (prevIndex >= 0) {
      setCurrentQueueIndex(prevIndex);
      playTrack(queue[prevIndex]);
    } else {
      if (isRepeat === 'all') {
        const lastIdx = queue.length - 1;
        setCurrentQueueIndex(lastIdx);
        playTrack(queue[lastIdx]);
      } else {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = 0;
          setCurrentTime(0);
          emitSeek(0, 0);
        }
      }
    }
  }, [queue, currentQueueIndex, isRepeat, playTrack, emitSeek]);

  const handleHostLibraryTrack = useCallback((trackId: string) => {
    const track = libraryTracks.find(t => t.id === trackId);
    if (track) {
      let idx = queue.findIndex(t => t.id === trackId);
      if (idx === -1) {
        const newQueue = [...queue, track];
        setQueue(newQueue);
        idx = newQueue.length - 1;
      }
      setCurrentQueueIndex(idx);
      playTrack(track);
    } else {
      emitLoadLibraryTrack(trackId);
      const url = `${SERVER_URL || ''}/api/library/tracks/${trackId}/download`;
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
        setAudioReady(true);
      }
      toast.success('Loading track...');
    }
    setActiveTab('player');
  }, [libraryTracks, queue, playTrack, emitLoadLibraryTrack, toast]);

  // ── R2 Library: host picks a track from R2 → signed URL → audioRef ──────
  const handleR2TrackSelect = useCallback((track: any, signedUrl: string) => {
    if (!audioRef.current) return;
    setShowR2Library(false);
    
    const coverFilename = track.cover_key ? `r2-${track.id}` : null;
    setSongName(track.title || 'Unknown');
    setActiveTrack({ ...track, coverFilename });
    setLyrics([]);
    setLrcMeta({ title: track.title, artist: track.artist });

    // Load signed URL directly into the audio element (same pattern as playTrack)
    audioRef.current.src = signedUrl;
    audioRef.current.load();
    setAudioReady(true);

    // Broadcast track metadata to all listeners in the room
    emitUpdateTrackMetadata({
      songName: track.title,
      totalChunks: 0,
      mimeType: `audio/${track.format || 'mpeg'}`,
      libraryTrackId: track.id,
      coverFilename,
      lyrics: [],
      lrcMeta: { title: track.title, artist: track.artist },
    });

    if (track.lyrics_key) {
      fetch(`${SERVER_URL || ''}/library/${track.id}/lyrics`)
        .then((res) => {
          if (!res.ok) throw new Error('Failed to load lyrics');
          return res.text();
        })
        .then((text) => {
          const lrcData = parseLrc(text);
          setLyrics(lrcData.lines);
          const lyricsMeta = {
            title: lrcData.meta.title || track.title,
            artist: lrcData.meta.artist || track.artist,
          };
          setLrcMeta(lyricsMeta);
          emitUpdateTrackMetadata({
            lyrics: lrcData.lines,
            lrcMeta: lyricsMeta,
          });
        })
        .catch((err) => {
          console.warn('Failed to load R2 lyrics:', err);
        });
    }

    audioRef.current.play().then(() => {
      setIsPlaying(true);
      emitPlay(0, 0);
    }).catch(() => {});

    toast.success(`Playing "${track.title}" from R2 Library`);
  }, [emitUpdateTrackMetadata, emitPlay, toast]);

  const handleHostLibraryTrackList = useCallback((tracksToHost: any[], startIndex = 0) => {
    if (tracksToHost.length === 0) return;
    setQueue(tracksToHost);
    setCurrentQueueIndex(startIndex);
    playTrack(tracksToHost[startIndex]);
    setActiveTab('player');
    toast.success(`Hosting set of ${tracksToHost.length} songs`);
  }, [playTrack, toast]);

  const handleAddToQueue = useCallback((track: any) => {
    setQueue(prev => {
      const alreadyIn = prev.some(t => t.id === track.id);
      if (alreadyIn) {
        toast.success(`"${track.title}" is already in queue`);
        return prev;
      }
      toast.success(`Added "${track.title}" to queue`);
      return [...prev, track];
    });
  }, [toast]);

  const handleAddTracksToQueue = useCallback((newTracks: any[]) => {
    setQueue(prev => {
      const filtered = newTracks.filter(nt => !prev.some(pt => pt.id === nt.id));
      if (filtered.length === 0) {
        toast.success('All songs are already in the queue');
        return prev;
      }
      toast.success(`Added ${filtered.length} songs to queue`);
      return [...prev, ...filtered];
    });
  }, [toast]);

  const handleRemoveFromQueue = useCallback((idx: number) => {
    setQueue(prev => prev.filter((_, i) => i !== idx));
    if (currentQueueIndex === idx) {
      playNext();
    } else if (currentQueueIndex > idx) {
      setCurrentQueueIndex(prev => prev - 1);
    }
  }, [currentQueueIndex, playNext]);

  const handleClearQueue = useCallback(() => {
    setQueue([]);
    setCurrentQueueIndex(-1);
    setIsPlaying(false);
    setAudioReady(false);
    if (audioRef.current) {
      audioRef.current.src = '';
      audioRef.current.load();
    }
    toast.success('Queue cleared');
  }, [toast]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
    }
  }, []);

  // Sync volume on audio source changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, audioReady]);


  const processFiles = useCallback(async (files: File[]) => {
    const audio = files.find((f) => f?.type?.startsWith('audio/'));
    const lrc   = files.find((f) => (f?.name || '').toLowerCase().endsWith('.lrc'));
    
    let lrcData: { lines: any[]; meta: any } | null = null;
    if (lrc) {
      try {
        const text = await lrc.text();
        lrcData = parseLrc(text);
        setLyrics(lrcData.lines);
        setLrcMeta(lrcData.meta);
        toast.success(`Lyrics loaded — ${lrcData.lines.length} lines`);
      } catch {
        toast.error('Could not parse lyrics file.');
      }
    }

    if (audio) {
      await handleAudioFile(audio, lrcData);
    } else if (lrcData) {
      // If ONLY lyrics file dropped, emit metadata update
      emitUpdateTrackMetadata({
        lyrics: lrcData.lines,
        lrcMeta: lrcData.meta,
      });
    }
  }, [handleAudioFile, toast, emitUpdateTrackMetadata]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    processFiles(Array.from(e.dataTransfer.files));
  }, [processFiles]);

  // ── Playback controls ───────────────────────────────────────────────────

  const handlePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioReady) return;
    audio.play().catch(() => {});
    setIsPlaying(true);
    emitPlay(audio.currentTime, timeToChunkIndex(audio.currentTime));
  }, [audioReady, emitPlay]);

  const handlePause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    emitPause(audio.currentTime);
  }, [emitPause]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = parseFloat(e.target.value);
    audio.currentTime = t;
    setCurrentTime(t);
    emitSeek(t, timeToChunkIndex(t));
  }, [emitSeek]);

  const handleLyricsLineClick = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
    emitSeek(time, timeToChunkIndex(time));
  }, [emitSeek]);

  const shareLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink).then(() => toast.success('Invite link copied!'));
  };

  return (
    <div className="relative min-h-screen bg-noir-black grain-overlay flex flex-col overflow-hidden">
      <DynamicBackground coverFilename={activeTrack?.coverFilename || null} songName={roomState.songName || songName || null} />
      <GlowSpotlight />
      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismiss} />

      {/* ── DESKTOP LAYOUT (lg and up) ────────────────────────────────── */}
      <div className="hidden lg:flex lg:flex-row w-full h-screen overflow-hidden">
        {/* ── Left sidebar: controls ──────────────────────────────────────── */}
        <aside className="lg:w-[22rem] xl:w-96 flex flex-col shrink-0 border-r border-noir-border/50 bg-noir-deep/50 backdrop-blur-sm z-10">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-5 border-b border-noir-border/40">
            <button
              onClick={onLeave}
              className="mr-2 text-noir-ash hover:text-accent-gold transition-colors text-sm flex items-center gap-1 font-mono cursor-pointer"
              title="Leave Room"
            >
              ← Back
            </button>
            <span className="font-display text-xl text-accent-gold">NoirSync</span>
            <span className="text-noir-dim">·</span>
            <span className="font-mono text-xs text-noir-ash tracking-widest">HOST</span>
            <div className="ml-auto flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
                title={connected ? 'Connected' : 'Disconnected'}
              />
              <span className="font-mono text-[10px] text-noir-dim">
                {connected ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-noir-border/30 bg-noir-black/20">
            <button
              onClick={() => setActiveTab('player')}
              className={`flex-1 py-3 text-xs font-mono tracking-wider transition-colors ${
                activeTab === 'player'
                  ? 'text-accent-gold border-b-2 border-accent-gold bg-noir-charcoal/20'
                  : 'text-noir-dim hover:text-noir-white'
              }`}
            >
              🎛 Player
            </button>
            <button
              onClick={() => setActiveTab('library')}
              className={`flex-1 py-3 text-xs font-mono tracking-wider transition-colors ${
                activeTab === 'library'
                  ? 'text-accent-gold border-b-2 border-accent-gold bg-noir-charcoal/20'
                  : 'text-noir-dim hover:text-noir-white'
              }`}
            >
              📚 Music Library
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {activeTab === 'player' ? (
              <>
                {/* Room info */}
                <GlassPanel className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] tracking-[0.25em] text-noir-ash uppercase">Room Code</span>
                    <span className="font-mono text-[10px] text-noir-dim">
                      {roomState.memberCount} listener{roomState.memberCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="font-mono text-3xl font-bold text-accent-gold tracking-[0.25em]">{roomId}</p>
                  <Button
                    id="copy-invite-btn"
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={copyShareLink}
                  >
                    📋 Copy Invite Link
                  </Button>
                </GlassPanel>

                {/* Active Listeners */}
                <GlassPanel className="p-4 space-y-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-noir-border/30">
                    <span className="font-mono text-[10px] tracking-[0.25em] text-noir-ash uppercase">
                      Listeners ({sortedMembers.length})
                    </span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {sortedMembers.map((m) => (
                      <div key={m.id} className="flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="shrink-0" title={m.role === 'host' ? 'Host' : 'Viewer'}>
                            {m.role === 'host' ? '👑' : '🎧'}
                          </span>
                          <span className="text-noir-white truncate" title={m.displayName}>
                            {m.displayName}
                          </span>
                        </div>
                        {m.id === getSocket().id && (
                          <span className="text-[9px] text-accent-gold bg-accent-gold/10 px-1 rounded border border-accent-gold/20">
                            You
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </GlassPanel>

                {/* Drop zone */}
                <div
                  id="audio-drop-zone"
                  role="button"
                  tabIndex={0}
                  aria-label="Drop audio or LRC file here, or click to browse"
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onKeyDown={(e) => e.key === 'Enter' && document.getElementById('audio-input')?.click()}
                  onClick={() => document.getElementById('audio-input')?.click()}
                  className={`
                    border-2 border-dashed rounded-xl p-7 text-center cursor-pointer
                    transition-all duration-200 group
                    ${dragOver
                      ? 'border-accent-gold/60 bg-accent-glow'
                      : 'border-noir-border hover:border-accent-gold/30 hover:bg-noir-graphite/30'}
                  `}
                >
                  <div className="text-3xl mb-2 transition-transform group-hover:scale-110">🎵</div>
                  <p className="font-ui text-sm text-noir-ash">Drop MP3 / WAV here</p>
                  <p className="font-mono text-[10px] text-noir-dim mt-1">+ .lrc file for lyrics</p>
                  <input
                    id="audio-input"
                    type="file"
                    accept="audio/*,.lrc"
                    multiple
                    className="hidden"
                    onChange={(e) => processFiles(Array.from(e.target.files ?? []))}
                  />
                </div>

                {/* ── Pick from R2 Library button ────────────────────── */}
                <button
                  id="pick-r2-library-btn"
                  onClick={() => setShowR2Library(true)}
                  className="
                    w-full flex items-center justify-center gap-2 py-2.5 px-4
                    rounded-xl border border-accent-gold/25 bg-accent-gold/[0.04]
                    font-mono text-[11px] text-accent-gold uppercase tracking-widest
                    hover:border-accent-gold/50 hover:bg-accent-gold/[0.08]
                    transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]
                  "
                >
                  <span className="text-base">☁</span>
                  Pick from R2 Library
                </button>
              </>
            ) : null}

            {activeTab === 'library' && (
              <div className="space-y-4">
                <div className="text-center py-4 px-4 border border-dashed border-noir-border rounded-xl">
                  <p className="font-ui text-sm text-noir-ash">📚 Library Mode Active</p>
                  <p className="font-mono text-[10px] text-noir-dim mt-1">
                    Selecting a song plays it instantly for the room.
                  </p>
                </div>

                {/* Drop zone in Library tab */}
                <div
                  id="audio-drop-zone-lib"
                  role="button"
                  tabIndex={0}
                  aria-label="Drop audio or LRC file here, or click to browse"
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onKeyDown={(e) => e.key === 'Enter' && document.getElementById('audio-input-lib')?.click()}
                  onClick={() => document.getElementById('audio-input-lib')?.click()}
                  className={`
                    border-2 border-dashed rounded-xl p-6 text-center cursor-pointer
                    transition-all duration-200 group
                    ${dragOver
                      ? 'border-accent-gold/60 bg-accent-glow'
                      : 'border-noir-border hover:border-accent-gold/30 hover:bg-noir-graphite/30'}
                  `}
                >
                  <div className="text-2xl mb-1 transition-transform group-hover:scale-110">🎵</div>
                  <p className="font-ui text-xs text-noir-ash">Drop MP3 / WAV here</p>
                  <p className="font-mono text-[10px] text-noir-dim mt-0.5">+ .lrc file for lyrics</p>
                  <input
                    id="audio-input-lib"
                    type="file"
                    accept="audio/*,.lrc"
                    multiple
                    className="hidden"
                    onChange={(e) => processFiles(Array.from(e.target.files ?? []))}
                  />
                </div>
              </div>
            )}

            {/* Upload progress */}
            {isUploading && (
              <GlassPanel className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <WaveformBar active />
                  <span className="font-mono text-xs text-noir-ash">Uploading chunks…</span>
                </div>
                <ProgressBar
                  value={uploadedCount}
                  total={totalChunks || Math.max(uploadedCount + 1, 1)}
                  showPercent
                />
                <p className="font-mono text-[10px] text-noir-dim mt-2">
                  {uploadedCount} / {totalChunks || '?'} chunks
                </p>
              </GlassPanel>
            )}

            {/* Now hosting */}
            {!isUploading && (
              <GlassPanel className="p-4 space-y-4" glow={audioReady}>
                <div>
                  <p className="font-mono text-[10px] tracking-widest text-noir-ash uppercase mb-1">Now Hosting</p>
                  <p className="font-display text-lg text-noir-white leading-snug">
                    {audioReady ? songName : 'No Song Loaded'}
                  </p>
                  <p className="font-body text-sm text-noir-dim mt-0.5">
                    {audioReady && lrcMeta.artist
                      ? lrcMeta.artist
                      : audioReady
                      ? 'Unknown Artist'
                      : 'Upload a file or choose from Library'}
                  </p>
                </div>

                {/* Hidden native audio element (managed by parent App) */}

                {/* Progress/seek */}
                <div className="space-y-1">
                  <input
                    id="seek-bar"
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.5}
                    value={audioReady ? currentTime : 0}
                    onChange={handleSeek}
                    disabled={!audioReady}
                    className={`w-full accent-accent-gold ${!audioReady ? 'opacity-40 cursor-not-allowed' : ''}`}
                    aria-label="Seek"
                    style={{
                      background: `linear-gradient(to right, #c8a96e ${(audioReady ? (currentTime / (duration || 1)) * 100 : 0)}%, #3a3a3a ${(audioReady ? (currentTime / (duration || 1)) * 100 : 0)}%)`,
                    }}
                  />
                  <div className="flex justify-between font-mono text-[10px] text-noir-dim">
                    <span>{formatTime(audioReady ? currentTime : 0)}</span>
                    <span>{formatTime(audioReady ? duration : 0)}</span>
                  </div>
                </div>

                {/* Apple Music Style Controls */}
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between px-2">
                    {/* Shuffle Button */}
                    <button
                      onClick={() => {
                        setIsShuffle(prev => !prev);
                        toast.success(isShuffle ? 'Shuffle Off' : 'Shuffle On');
                      }}
                      className={`text-lg p-2 transition-all hover:scale-110 ${
                        isShuffle ? 'text-accent-gold drop-shadow-gold' : 'text-noir-ash opacity-40 hover:opacity-100'
                      }`}
                      title="Shuffle Queue"
                    >
                      🔀
                    </button>

                    <div className="flex items-center gap-3 justify-center">
                      {/* Previous Button */}
                      <button
                        onClick={playPrev}
                        disabled={queue.length === 0}
                        className="text-2xl p-2 text-noir-white hover:text-accent-gold transition-all active:scale-95 disabled:opacity-30 disabled:hover:text-noir-white"
                        title="Previous Track"
                      >
                        ⏮
                      </button>

                      {/* Play/Pause Button */}
                      <button
                        id="play-pause-btn"
                        onClick={isPlaying && audioReady ? handlePause : handlePlay}
                        disabled={!audioReady}
                        className={`
                          w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all active:scale-90
                          ${audioReady 
                            ? 'bg-accent-gold text-noir-black hover:scale-105 hover:bg-accent-gold/90 shadow-noir-glow' 
                            : 'bg-noir-graphite text-noir-dim cursor-not-allowed opacity-50'}
                        `}
                        title={isPlaying && audioReady ? 'Pause' : 'Play'}
                      >
                        {isPlaying && audioReady ? '⏸' : '▶'}
                      </button>

                      {/* Next Button */}
                      <button
                        onClick={playNext}
                        disabled={queue.length === 0}
                        className="text-2xl p-2 text-noir-white hover:text-accent-gold transition-all active:scale-95 disabled:opacity-30 disabled:hover:text-noir-white"
                        title="Next Track"
                      >
                        ⏭
                      </button>
                    </div>

                    {/* Repeat Button */}
                    <button
                      onClick={() => {
                        const nextRepeat = 
                          isRepeat === 'none' ? 'all' : 
                          isRepeat === 'all' ? 'one' : 'none';
                        setIsRepeat(nextRepeat);
                        toast.success(
                          nextRepeat === 'all' ? 'Repeat All' : 
                          nextRepeat === 'one' ? 'Repeat One' : 'Repeat Off'
                        );
                      }}
                      className={`text-lg p-2 transition-all hover:scale-110 relative ${
                        isRepeat !== 'none' ? 'text-accent-gold drop-shadow-gold' : 'text-noir-ash opacity-40 hover:opacity-100'
                      }`}
                      title={`Repeat Mode: ${isRepeat}`}
                    >
                      🔁
                      {isRepeat === 'one' && (
                        <span className="absolute bottom-1 right-1 text-[8px] bg-accent-gold text-noir-black w-3 h-3 rounded-full flex items-center justify-center font-bold font-mono">1</span>
                      )}
                    </button>
                  </div>

                  {/* Volume Slider */}
                  <div className="flex items-center gap-3 px-2">
                    <span className="text-xs text-noir-ash opacity-60">🔈</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={handleVolumeChange}
                      className="flex-1 accent-accent-gold h-1 bg-noir-graphite rounded-lg appearance-none cursor-pointer"
                      aria-label="Volume"
                    />
                    <span className="text-xs text-noir-ash opacity-60">🔊</span>
                  </div>
                </div>

                {/* Chunk info */}
                <p className="font-mono text-[10px] text-noir-dim text-center">
                  {audioReady ? totalChunks : 0} chunks · {CHUNK_DURATION}s/chunk · ~{audioReady ? Math.round(totalChunks * CHUNK_DURATION / 60) : 0}min
                </p>
              </GlassPanel>
            )}

            {/* Listeners badge */}
            {roomState.memberCount > 0 && (
              <div className="flex items-center justify-center gap-2 py-2">
                <WaveformBar bars={3} active={isPlaying} />
                <span className="font-mono text-xs text-noir-dim">
                  {roomState.memberCount} synced listener{roomState.memberCount !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            {/* Up Next Queue */}
            <div className="flex flex-col min-h-[200px] max-h-[300px] border-t border-noir-border/30 pt-4 mt-2">
              <div className="flex items-center justify-between shrink-0 mb-3 px-1">
                <span className="font-mono text-[10px] tracking-widest text-noir-ash uppercase">Up Next</span>
                {queue.length > 0 && (
                  <button
                    onClick={handleClearQueue}
                    className="font-mono text-[9px] text-red-400 hover:text-red-300 transition-colors uppercase tracking-wider"
                  >
                    Clear Queue
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 scrollbar-none pr-1">
                {queue.length === 0 ? (
                  <div className="text-center py-8 text-noir-dim font-mono text-[10px] border border-dashed border-noir-border/50 rounded-xl">
                    Queue is empty.<br />Click "➕ Queue" in Library.
                  </div>
                ) : (
                  queue.map((track, idx) => (
                    <div
                      key={`${track.id}-${idx}`}
                      className={`
                        p-2 rounded-lg border flex items-center gap-2.5 transition-all duration-200 group
                        ${currentQueueIndex === idx
                          ? 'border-accent-gold/45 bg-accent-gold/5 shadow-sm shadow-accent-gold/5'
                          : 'border-noir-border/40 hover:border-noir-border bg-noir-deep/40'}
                      `}
                    >
                      {/* Artwork / Icon */}
                      <div className="w-8 h-8 rounded bg-noir-graphite flex-shrink-0 flex items-center justify-center border border-noir-border/50 overflow-hidden">
                        {track.coverFilename ? (
                          <img
                            src={`${SERVER_URL || ''}/api/library/covers/${track.coverFilename}`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-sm opacity-40">🎵</span>
                        )}
                      </div>

                      {/* Metadata */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-ui text-[11px] font-semibold truncate ${
                          currentQueueIndex === idx ? 'text-accent-gold' : 'text-noir-white'
                        }`}>
                          {track.title}
                        </p>
                        <p className="font-ui text-[9px] text-noir-dim truncate mt-0.5">
                          {track.artist}
                        </p>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {currentQueueIndex !== idx && (
                          <button
                            onClick={() => {
                              setCurrentQueueIndex(idx);
                              const t = 0;
                              if (audioRef.current) {
                                audioRef.current.currentTime = t;
                                setCurrentTime(t);
                              }
                              emitLoadLibraryTrack(track.id);
                            }}
                            className="text-[10px] text-accent-gold hover:scale-110 transition-transform"
                            title="Play track"
                          >
                            ▶
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveFromQueue(idx)}
                          className="text-[10px] text-red-400 hover:text-red-300 hover:scale-110 transition-transform"
                          title="Remove from queue"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* ── Right: main content area ────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {activeTab === 'library' ? (
            <div className="flex-1 p-8 overflow-y-auto z-10">
              <div className="max-w-4xl mx-auto space-y-6">
                <div>
                  <h1 className="font-display text-3xl text-noir-white">Music Library</h1>
                  <p className="font-body text-noir-ash mt-1">
                    High-quality persistent audio tracks catalog. Stream or host direct synced playback rooms.
                  </p>
                </div>
                <LibraryBrowser
                  isHost={true}
                  onHostTrack={handleHostLibraryTrack}
                  onHostTrackList={handleHostLibraryTrackList}
                  onAddToQueue={handleAddToQueue}
                  onAddTracksToQueue={handleAddTracksToQueue}
                  activeTrackId={roomState.libraryTrackId}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Song header */}
              {songName && (
                <div className="px-8 pt-8 pb-2 shrink-0">
                  <h1 className="font-display text-3xl text-noir-white">{lrcMeta.title || songName}</h1>
                  {lrcMeta.artist && (
                    <p className="font-body text-noir-ash mt-1">{lrcMeta.artist}</p>
                  )}
                </div>
              )}

              {/* Lyrics area */}
              <LyricsRenderer
                lines={lyrics}
                currentTime={currentTime}
                onLineClick={handleLyricsLineClick}
                className="flex-1"
              />

              {!songName && !isUploading && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
                  <div className="text-6xl opacity-20">♪</div>
                  <p className="font-display text-2xl text-noir-charcoal">Waiting for audio</p>
                  <p className="font-mono text-xs text-noir-dim tracking-widest">
                    Drop a file or select a track from the Music Library tab to begin
                  </p>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* ── MOBILE LAYOUT (less than lg) ──────────────────────────────── */}
      <div className="flex lg:hidden flex-col h-[calc(100vh-4rem)] overflow-y-auto z-10 p-4 pb-24 space-y-4">
        {/* Mobile Header Bar */}
        <div className="flex items-center justify-between pb-2 border-b border-noir-border/30">
          <button
            onClick={onLeave}
            className="text-noir-ash hover:text-accent-gold transition-colors text-sm flex items-center gap-1 font-mono cursor-pointer"
          >
            ← Leave Room
          </button>
          <div className="flex items-center gap-1.5 bg-noir-charcoal/50 px-2.5 py-1 rounded-full border border-noir-border/30">
            <span className="font-mono text-[9px] text-noir-ash uppercase tracking-wider">Host</span>
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
        </div>

        {mobileTab === 'player' && (
          <div className="space-y-4">
            {/* Room info card */}
            <GlassPanel className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.25em] text-noir-ash uppercase">Room Code</span>
                <span className="font-mono text-[10px] text-noir-dim">
                  {roomState.memberCount} listener{roomState.memberCount !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="font-mono text-3xl font-bold text-accent-gold tracking-[0.25em]">{roomId}</p>
              <Button
                variant="default"
                size="sm"
                className="w-full"
                onClick={copyShareLink}
              >
                📋 Copy Invite Link
              </Button>
            </GlassPanel>

            {/* Active Listeners */}
            <GlassPanel className="p-4 space-y-3">
              <div className="flex items-center justify-between pb-1.5 border-b border-noir-border/30">
                <span className="font-mono text-[10px] tracking-[0.25em] text-noir-ash uppercase">
                  Listeners ({sortedMembers.length})
                </span>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {sortedMembers.map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="shrink-0" title={m.role === 'host' ? 'Host' : 'Viewer'}>
                        {m.role === 'host' ? '👑' : '🎧'}
                      </span>
                      <span className="text-noir-white truncate" title={m.displayName}>
                        {m.displayName}
                      </span>
                    </div>
                    {m.id === getSocket().id && (
                      <span className="text-[9px] text-accent-gold bg-accent-gold/10 px-1 rounded border border-accent-gold/20">
                        You
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </GlassPanel>

            {/* Drop zone */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Drop audio or LRC file here, or click to browse"
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => document.getElementById('audio-input-mobile')?.click()}
              className={`
                border-2 border-dashed rounded-xl p-7 text-center cursor-pointer
                transition-all duration-200 group
                ${dragOver
                  ? 'border-accent-gold/60 bg-accent-glow'
                  : 'border-noir-border hover:border-accent-gold/30 hover:bg-noir-graphite/30'}
              `}
            >
              <div className="text-3xl mb-2 transition-transform group-hover:scale-110">🎵</div>
              <p className="font-ui text-sm text-noir-ash">Drop MP3 / WAV here</p>
              <p className="font-mono text-[10px] text-noir-dim mt-1">+ .lrc file for lyrics</p>
              <input
                id="audio-input-mobile"
                type="file"
                accept="audio/*,.lrc"
                multiple
                className="hidden"
                onChange={(e) => processFiles(Array.from(e.target.files ?? []))}
              />
            </div>

            {/* Upload progress */}
            {isUploading && (
              <GlassPanel className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <WaveformBar active />
                  <span className="font-mono text-xs text-noir-ash">Uploading chunks…</span>
                </div>
                <ProgressBar
                  value={uploadedCount}
                  total={totalChunks || Math.max(uploadedCount + 1, 1)}
                  showPercent
                />
              </GlassPanel>
            )}

            {/* Now Hosting controls */}
            <GlassPanel className="p-4 space-y-4">
              <div>
                <p className="font-mono text-[10px] tracking-widest text-noir-ash uppercase mb-1">Now Hosting</p>
                <p className="font-display text-lg text-noir-white leading-snug">
                  {audioReady ? songName : 'No Song Loaded'}
                </p>
                {audioReady && lrcMeta.artist && (
                  <p className="font-body text-xs text-noir-dim mt-0.5">{lrcMeta.artist}</p>
                )}
              </div>

              {/* Progress */}
              <div className="space-y-1">
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.5}
                  value={audioReady ? currentTime : 0}
                  onChange={handleSeek}
                  disabled={!audioReady}
                  className="w-full accent-accent-gold"
                  aria-label="Seek"
                  style={{
                    background: `linear-gradient(to right, #c8a96e ${(audioReady ? (currentTime / (duration || 1)) * 100 : 0)}%, #3a3a3a ${(audioReady ? (currentTime / (duration || 1)) * 100 : 0)}%)`,
                  }}
                />
                <div className="flex justify-between font-mono text-[10px] text-noir-dim">
                  <span>{formatTime(audioReady ? currentTime : 0)}</span>
                  <span>{formatTime(audioReady ? duration : 0)}</span>
                </div>
              </div>

              {/* Apple Music Style Controls */}
              <div className="flex items-center justify-around">
                <button
                  onClick={playPrev}
                  disabled={queue.length === 0}
                  className="text-xl p-2 text-noir-white disabled:opacity-30"
                >
                  ⏮
                </button>
                <button
                  onClick={isPlaying && audioReady ? handlePause : handlePlay}
                  disabled={!audioReady}
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${
                    audioReady ? 'bg-accent-gold text-noir-black shadow-noir-glow' : 'bg-noir-graphite text-noir-dim opacity-50'
                  }`}
                >
                  {isPlaying && audioReady ? '⏸' : '▶'}
                </button>
                <button
                  onClick={playNext}
                  disabled={queue.length === 0}
                  className="text-xl p-2 text-noir-white disabled:opacity-30"
                >
                  ⏭
                </button>
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-3 px-2">
                <span className="text-xs text-noir-ash opacity-60">🔈</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={handleVolumeChange}
                  className="flex-1 accent-accent-gold h-1 bg-noir-graphite rounded-lg appearance-none cursor-pointer"
                  aria-label="Volume"
                />
                <span className="text-xs text-noir-ash opacity-60">🔊</span>
              </div>
            </GlassPanel>

            {/* Queue Panel */}
            <GlassPanel className="p-4 flex flex-col max-h-[300px]">
              <div className="flex items-center justify-between shrink-0 mb-3">
                <span className="font-mono text-[10px] tracking-widest text-noir-ash uppercase">Up Next</span>
                {queue.length > 0 && (
                  <button
                    onClick={handleClearQueue}
                    className="font-mono text-[9px] text-red-400 uppercase tracking-wider"
                  >
                    Clear Queue
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 scrollbar-none pr-1">
                {queue.length === 0 ? (
                  <div className="text-center py-6 text-noir-dim font-mono text-[10px] border border-dashed border-noir-border/50 rounded-xl">
                    Queue is empty.
                  </div>
                ) : (
                  queue.map((track, idx) => (
                    <div
                      key={`${track.id}-${idx}`}
                      className="p-2 rounded-lg border border-noir-border/40 bg-noir-deep/40 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded bg-noir-graphite flex-shrink-0 flex items-center justify-center border border-noir-border/50 overflow-hidden">
                          {track.coverFilename ? (
                            <img
                              src={`${SERVER_URL || ''}/api/library/covers/${track.coverFilename}`}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-sm opacity-40">🎵</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className={`font-ui text-xs font-semibold truncate ${currentQueueIndex === idx ? 'text-accent-gold' : 'text-noir-white'}`}>{track.title}</p>
                          <p className="font-ui text-[10px] text-noir-dim truncate mt-0.5">{track.artist}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {currentQueueIndex !== idx && (
                          <button
                            onClick={() => {
                              setCurrentQueueIndex(idx);
                              if (audioRef.current) audioRef.current.currentTime = 0;
                              emitLoadLibraryTrack(track.id);
                            }}
                            className="text-accent-gold text-xs px-2"
                          >
                            ▶
                          </button>
                        )}
                        <button onClick={() => handleRemoveFromQueue(idx)} className="text-red-400 text-xs px-2">✕</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </GlassPanel>
          </div>
        )}

        {mobileTab === 'lyrics' && (
          <div className="flex-1 flex flex-col h-[70vh] min-h-[400px]">
            {songName && (
              <div className="px-4 py-2 shrink-0">
                <h1 className="font-display text-2xl text-noir-white">{lrcMeta.title || songName}</h1>
                {lrcMeta.artist && (
                  <p className="font-body text-xs text-noir-ash mt-0.5">{lrcMeta.artist}</p>
                )}
              </div>
            )}
            <LyricsRenderer
              lines={lyrics}
              currentTime={currentTime}
              onLineClick={handleLyricsLineClick}
              className="flex-1"
            />
          </div>
        )}

        {mobileTab === 'library' && (
          <div className="space-y-4">
            <div className="text-center py-4 px-4 border border-dashed border-noir-border rounded-xl">
              <p className="font-ui text-sm text-noir-ash">📚 Library Mode Active</p>
              <p className="font-mono text-[10px] text-noir-dim mt-1">
                Selecting a song plays it instantly for the room.
              </p>
            </div>
            <LibraryBrowser
              isHost={true}
              onHostTrack={handleHostLibraryTrack}
              onHostTrackList={handleHostLibraryTrackList}
              onAddToQueue={handleAddToQueue}
              onAddTracksToQueue={handleAddTracksToQueue}
              activeTrackId={roomState.libraryTrackId}
            />
          </div>
        )}
      </div>

      {/* Sticky Bottom Tab Bar (mobile only) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-noir-deep/95 border-t border-noir-border/50 backdrop-blur-md flex items-center justify-around z-20 px-4">
        <button
          onClick={() => setMobileTab('player')}
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-mono tracking-wider transition-colors ${
            mobileTab === 'player' ? 'text-accent-gold' : 'text-noir-dim hover:text-noir-white'
          }`}
        >
          <span className="text-lg">🎛</span>
          <span>Player</span>
        </button>
        <button
          onClick={() => setMobileTab('lyrics')}
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-mono tracking-wider transition-colors ${
            mobileTab === 'lyrics' ? 'text-accent-gold' : 'text-noir-dim hover:text-noir-white'
          }`}
        >
          <span className="text-lg">🎤</span>
          <span>Lyrics</span>
        </button>
        <button
          onClick={() => setMobileTab('library')}
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-mono tracking-wider transition-colors ${
            mobileTab === 'library' ? 'text-accent-gold' : 'text-noir-dim hover:text-noir-white'
          }`}
        >
          <span className="text-lg">📚</span>
          <span>Library</span>
        </button>
      </div>
      {/* ── R2 Library Modal ──────────────────────────────────────────── */}
      {showR2Library && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setShowR2Library(false); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-noir-black/80 backdrop-blur-sm" onClick={() => setShowR2Library(false)} />

          {/* Panel */}
          <div className="relative z-10 w-full sm:max-w-2xl max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-noir-border/50 bg-noir-deep/95 backdrop-blur-xl shadow-[0_-4px_60px_rgba(0,0,0,0.8)] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-noir-border/30 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-accent-gold text-sm">☁</span>
                <span className="font-mono text-[11px] text-accent-gold uppercase tracking-[0.2em]">R2 Library</span>
                <span className="font-mono text-[10px] text-noir-dim">— pick a track to play in the room</span>
              </div>
              <button
                onClick={() => setShowR2Library(false)}
                className="w-7 h-7 rounded-lg border border-noir-border text-noir-ash hover:text-noir-white hover:border-noir-dim flex items-center justify-center text-sm transition-all"
              >
                ✕
              </button>
            </div>

            {/* Library content */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <Library onSelectTrack={handleR2TrackSelect} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

