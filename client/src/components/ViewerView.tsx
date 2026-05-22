import { useEffect, useRef, useState, useCallback } from 'react';
import { GlassPanel } from './ui/GlassPanel';
import { WaveformBar } from './ui/WaveformBar';
import { ProgressBar } from './ui/ProgressBar';
import { Spinner } from './ui/Spinner';
import { LyricsRenderer } from './LyricsRenderer';
import { GlowSpotlight } from './GlowSpotlight';
import { ToastContainer } from './Toast';
import { DynamicBackground } from './DynamicBackground';
import { useRoom } from '../hooks/useRoom';
import { useAudioSync } from '../hooks/useAudioSync';
import { useToast } from '../hooks/useToast';
import { SourceBufferManager, isMseSupported } from '../lib/mediaSource';
import { toMseMimeType, CHUNK_DURATION } from '../lib/chunker';
import { SERVER_URL } from '../lib/constants';
import { LibraryBrowser } from './LibraryBrowser';
import { Button } from './ui/Button';
import { getServerTime } from '../lib/ntp';

interface Props {
  roomId: string;
  displayName: string;
}

const PREFETCH_AHEAD = 4;

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ViewerView({ roomId, displayName }: Props) {
  const { connected, roomState, roomError } = useRoom(roomId, 'viewer', displayName);
  const toast = useToast();

  const audioRef         = useRef<HTMLAudioElement>(null);
  const mseRef           = useRef<SourceBufferManager | null>(null);
  const downloadedRef    = useRef<Set<number>>(new Set());
  const prefetchQueueRef = useRef<boolean>(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [buffering, setBuffering]      = useState(true);
  const [mseError, setMseError]        = useState<string | null>(null);
  const [activeTab, setActiveTab]      = useState<'player' | 'library'>('player');
  const [mobileTab, setMobileTab]      = useState<'player' | 'lyrics' | 'library'>('player');
  const [localPlaying, setLocalPlaying] = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [duration, setDuration] = useState(0);

  // Wire up NTP-scheduled play
  useAudioSync(
    audioRef,
    roomState.scheduledStartTime,
    roomState.currentTime,
    roomState.isPlaying,
  );

  // Show room errors
  useEffect(() => {
    if (roomError) toast.error(roomError);
  }, [roomError]);

  // Update buffered percentage for progress bars
  const updateBuffered = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (roomState.libraryTrackId) {
      if (audio.duration > 0) {
        let bufferedEnd = 0;
        for (let i = 0; i < audio.buffered.length; i++) {
          const start = audio.buffered.start(i);
          const end = audio.buffered.end(i);
          if (audio.currentTime >= start && audio.currentTime <= end) {
            bufferedEnd = end;
            break;
          }
        }
        setBufferedPercent((bufferedEnd / audio.duration) * 100);
      } else {
        setBufferedPercent(0);
      }
    } else {
      if (roomState.totalChunks) {
        setBufferedPercent((downloadedRef.current.size / roomState.totalChunks) * 100);
      } else {
        setBufferedPercent(0);
      }
    }
  }, [roomState.libraryTrackId, roomState.totalChunks]);

  // ── Initialize MSE or direct streaming when mimeType/libraryTrackId changes ──
  useEffect(() => {
    if (!roomState.mimeType) return;

    const audio = audioRef.current;
    if (!audio) return;

    // Clean up previous MSE instance
    mseRef.current?.destroy();
    mseRef.current = null;
    downloadedRef.current.clear();
    setMseError(null);
    setBufferedPercent(0);
    setDuration(0);

    if (roomState.libraryTrackId) {
      // Direct stream mode for library tracks
      const url = `${SERVER_URL || ''}/api/library/tracks/${roomState.libraryTrackId}/download`;
      audio.src = url;
      audio.load();
      setBuffering(false);
    } else {
      // MSE mode for dropped tracks
      const mseMime = toMseMimeType(roomState.mimeType);
      const supported = isMseSupported(mseMime);

      if (supported) {
        mseRef.current = new SourceBufferManager(mseMime, (err) => {
          setMseError(err.message);
          toast.error('Streaming error: ' + err.message);
        });

        audio.src = mseRef.current.objectUrl;
        audio.load();
      } else {
        // Fallback: direct chunk URL (works for MP3 without MSE)
        setMseError(null);
        console.warn('[viewer] MSE not supported for', mseMime, '— using fallback');
      }
    }

    return () => {
      mseRef.current?.destroy();
      mseRef.current = null;
    };
  }, [roomState.mimeType, roomState.libraryTrackId]);

  // ── Download a single chunk and append to MSE ──────────────────────────
  const downloadChunk = useCallback(async (idx: number) => {
    if (downloadedRef.current.has(idx)) return;
    downloadedRef.current.add(idx);

    try {
      const url = `${SERVER_URL || ''}/api/rooms/${roomId}/chunks/${idx}`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          downloadedRef.current.delete(idx); // retry later
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const buffer = await res.arrayBuffer();

      if (mseRef.current) {
        mseRef.current.appendChunk(buffer, idx);
      } else if (audioRef.current && !audioRef.current.src.startsWith('blob:')) {
        // Fallback: blob URL for first chunk
        const blob = new Blob([buffer], { type: roomState.mimeType });
        audioRef.current.src = URL.createObjectURL(blob);
        audioRef.current.load();
      }

      setBuffering(false);
      updateBuffered();
    } catch (err) {
      downloadedRef.current.delete(idx); // allow retry
      console.warn('[viewer] chunk download failed:', err);
    }
  }, [roomId, roomState.mimeType, updateBuffered]);

  // ── Prefetch window: download current + PREFETCH_AHEAD chunks ─────────
  const triggerPrefetch = useCallback((fromChunkIndex: number) => {
    if (roomState.libraryTrackId) return; // Bypass for library tracks
    if (prefetchQueueRef.current) return;
    prefetchQueueRef.current = true;

    const end = fromChunkIndex + PREFETCH_AHEAD;
    const promises: Promise<void>[] = [];

    for (let i = fromChunkIndex; i <= end; i++) {
      if (!downloadedRef.current.has(i)) {
        promises.push(downloadChunk(i));
      }
    }

    Promise.all(promises).finally(() => {
      prefetchQueueRef.current = false;
    });
  }, [downloadChunk, roomState.libraryTrackId]);

  // ── Listen for chunk:available events and trigger prefetch ────────────
  useEffect(() => {
    triggerPrefetch(roomState.chunkIndex);
  }, [roomState.chunkIndex, triggerPrefetch]);

  // ── Also prefetch when audio advances ─────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      const idx = Math.floor(audio.currentTime / CHUNK_DURATION);
      triggerPrefetch(idx);
      updateBuffered();
    };

    const handleWaiting  = () => setBuffering(true);
    const handlePlaying  = () => {
      setBuffering(false);
      setLocalPlaying(true);
    };
    const handlePause    = () => {
      setLocalPlaying(false);
    };
    const handleCanPlay  = () => {
      setBuffering(false);
    };
    const handleProgress = () => {
      updateBuffered();
    };
    const handleMetadata = () => {
      if (audio.duration) {
        setDuration(audio.duration);
      }
      updateBuffered();
    };

    audio.addEventListener('timeupdate',      handleTimeUpdate);
    audio.addEventListener('waiting',         handleWaiting);
    audio.addEventListener('playing',         handlePlaying);
    audio.addEventListener('pause',           handlePause);
    audio.addEventListener('canplay',         handleCanPlay);
    audio.addEventListener('progress',        handleProgress);
    audio.addEventListener('loadedmetadata',  handleMetadata);

    return () => {
      audio.removeEventListener('timeupdate',     handleTimeUpdate);
      audio.removeEventListener('waiting',        handleWaiting);
      audio.removeEventListener('playing',        handlePlaying);
      audio.removeEventListener('pause',           handlePause);
      audio.removeEventListener('canplay',        handleCanPlay);
      audio.removeEventListener('progress',       handleProgress);
      audio.removeEventListener('loadedmetadata', handleMetadata);
    };
  }, [triggerPrefetch, updateBuffered]);

  const handleSyncAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const doPlayAndSeek = () => {
      if (roomState.scheduledStartTime !== null) {
        const now = getServerTime();
        const msUntil = roomState.scheduledStartTime - now;
        if (msUntil <= 0) {
          const driftSecs = Math.abs(msUntil) / 1000;
          const target = Math.max(0, roomState.currentTime) + driftSecs;
          audio.currentTime = target;
        } else {
          audio.currentTime = Math.max(0, roomState.currentTime);
        }
      } else {
        audio.currentTime = Math.max(0, roomState.currentTime);
      }

      audio.play().then(() => {
        setLocalPlaying(true);
        setBuffering(false);
      }).catch((err) => {
        console.warn('[viewer] user sync trigger failed:', err);
      });
    };

    if (audio.readyState < 1) {
      // Play immediately to capture user gesture, then seek when metadata loads
      audio.play().catch(() => {});
      
      const onLoadedMetadata = () => {
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        if (roomState.scheduledStartTime !== null) {
          const now = getServerTime();
          const msUntil = roomState.scheduledStartTime - now;
          if (msUntil <= 0) {
            const driftSecs = Math.abs(msUntil) / 1000;
            audio.currentTime = Math.max(0, roomState.currentTime) + driftSecs;
          } else {
            audio.currentTime = Math.max(0, roomState.currentTime);
          }
        } else {
          audio.currentTime = Math.max(0, roomState.currentTime);
        }
        audio.play().then(() => {
          setLocalPlaying(true);
          setBuffering(false);
        }).catch((err) => {
          console.warn('[viewer] play after metadata load failed:', err);
        });
      };
      audio.addEventListener('loadedmetadata', onLoadedMetadata);
    } else {
      doPlayAndSeek();
    }
  }, [roomState.scheduledStartTime, roomState.currentTime]);

  // ── Handle seek from host ──────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || roomState.isPlaying) return;
    if (Math.abs(audio.currentTime - roomState.currentTime) > 1) {
      audio.currentTime = roomState.currentTime;
    }
  }, [roomState.currentTime, roomState.isPlaying]);

  const trackDuration = roomState.libraryTrackId && duration > 0
    ? duration
    : (roomState.totalChunks ? roomState.totalChunks * CHUNK_DURATION : 0);

  const pct = trackDuration > 0
    ? Math.min(100, (currentTime / trackDuration) * 100)
    : 0;

  const shareLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink).then(() => toast.success('Invite link copied!'));
  };

  return (
    <div className="relative min-h-screen bg-noir-black grain-overlay flex flex-col overflow-hidden">
      <DynamicBackground coverFilename={roomState.coverFilename || null} songName={roomState.songName || null} />
      <GlowSpotlight />
      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismiss} />

      {/* ── DESKTOP LAYOUT (lg and up) ────────────────────────────────── */}
      <div className="hidden lg:flex lg:flex-row w-full h-screen overflow-hidden">
        {/* ── Left sidebar: controls/queue ────────────────────────────────── */}
        <aside className="lg:w-[22rem] xl:w-96 flex flex-col shrink-0 border-r border-noir-border/50 bg-noir-deep/50 backdrop-blur-sm z-10">
          
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-5 border-b border-noir-border/40">
            <span className="font-display text-xl text-accent-gold">NoirSync</span>
            <span className="text-noir-dim">·</span>
            <span className="font-mono text-xs text-noir-ash tracking-widest">LISTENING</span>
            <div className="ml-auto flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse-slow' : 'bg-red-500'}`}
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
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={copyShareLink}
                  >
                    📋 Copy Invite Link
                  </Button>
                </GlassPanel>

                {/* Playback status */}
                <GlassPanel className="p-5 space-y-4">
                  {roomState.songName && (
                    <div>
                      <p className="font-mono text-[10px] tracking-widest text-noir-ash uppercase mb-1">Playing</p>
                      <p className="font-display text-lg text-noir-white leading-snug truncate">
                        {roomState.songName}
                      </p>
                      {roomState.lrcMeta?.artist && (
                        <p className="font-body text-xs text-noir-dim mt-0.5 truncate">
                          {roomState.lrcMeta.artist}
                        </p>
                      )}
                    </div>
                  )}

                  {/* State indicator */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {roomState.isPlaying ? (
                        <>
                          <WaveformBar active={localPlaying} />
                          <span className="font-mono text-xs text-green-400 tracking-widest">
                            {localPlaying ? 'SYNCED' : 'BLOCKED'}
                          </span>
                        </>
                      ) : (
                        <>
                          <WaveformBar active={false} />
                          <span className="font-mono text-xs text-noir-dim tracking-widest">
                            {connected ? 'WAITING FOR HOST' : 'CONNECTING…'}
                          </span>
                        </>
                      )}
                      {buffering && roomState.isPlaying && (
                        <Spinner size="sm" />
                      )}
                    </div>

                    {roomState.isPlaying && !localPlaying && (
                      <Button
                        variant="gold"
                        size="sm"
                        onClick={handleSyncAudio}
                        className="animate-pulse py-1 px-2.5 text-[10px]"
                      >
                        🔊 Sync Audio
                      </Button>
                    )}
                  </div>

                  {/* Progress */}
                  {roomState.songName && (
                    <div className="space-y-1">
                      <div
                        className="h-1 w-full bg-noir-border rounded-full overflow-hidden"
                        role="progressbar"
                        aria-valuenow={Math.round(pct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Playback progress"
                      >
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            background: 'linear-gradient(90deg, #c8a96e, #d4882a)',
                            boxShadow: '0 0 8px rgba(200,169,110,0.4)',
                          }}
                        />
                      </div>
                      <p className="font-mono text-[10px] text-noir-dim">
                        {formatTime(currentTime)} / {formatTime(trackDuration)}
                      </p>
                    </div>
                  )}

                  {/* Chunk stats */}
                  {roomState.totalChunks && (
                    <ProgressBar
                      value={bufferedPercent}
                      total={100}
                      label="BUFFERED"
                      showPercent
                    />
                  )}
                </GlassPanel>

                {mseError && (
                  <div className="px-4 py-3 rounded-lg border border-yellow-800/40 bg-yellow-950/20 font-mono text-[10px] text-yellow-500">
                    ⚠ MSE error — falling back to basic playback
                  </div>
                )}

                {/* Up Next Queue */}
                <div className="flex flex-col min-h-[200px] max-h-[300px] border-t border-noir-border/30 pt-4 mt-2">
                  <div className="flex items-center justify-between shrink-0 mb-3 px-1">
                    <span className="font-mono text-[10px] tracking-widest text-noir-ash uppercase">Up Next</span>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2 scrollbar-none pr-1">
                    {roomState.queue.length === 0 ? (
                      <div className="text-center py-8 text-noir-dim font-mono text-[10px] border border-dashed border-noir-border/50 rounded-xl">
                        Queue is empty.
                      </div>
                    ) : (
                      roomState.queue.map((track, idx) => (
                        <div
                          key={`${track.id}-${idx}`}
                          className={`
                            p-2 rounded-lg border flex items-center gap-2.5 transition-all duration-200
                            ${roomState.currentQueueIndex === idx
                              ? 'border-accent-gold/45 bg-accent-gold/5 shadow-sm shadow-accent-gold/5'
                              : 'border-noir-border/40 bg-noir-deep/40'}
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
                              roomState.currentQueueIndex === idx ? 'text-accent-gold' : 'text-noir-white'
                            }`}>
                              {track.title}
                            </p>
                            <p className="font-ui text-[9px] text-noir-dim truncate mt-0.5">
                              {track.artist}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="text-center py-4 px-4 border border-dashed border-noir-border rounded-xl">
                  <p className="font-ui text-sm text-noir-ash">📚 Library Mode</p>
                  <p className="font-mono text-[10px] text-noir-dim mt-1">
                    Browse the library or upload tracks. Only the host can play them.
                  </p>
                </div>
              </div>
            )}
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
                    Browse the room playlist catalog or contribute to the library. Only the host can play songs.
                  </p>
                </div>
                <LibraryBrowser
                  isHost={false}
                  activeTrackId={roomState.libraryTrackId}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Song header */}
              {roomState.songName && (
                <div className="px-8 pt-8 pb-2 shrink-0">
                  <h1 className="font-display text-3xl text-noir-white">{roomState.lrcMeta?.title || roomState.songName}</h1>
                  {roomState.lrcMeta?.artist && (
                    <p className="font-body text-noir-ash mt-1">{roomState.lrcMeta.artist}</p>
                  )}
                </div>
              )}

              {/* Lyrics area */}
              <LyricsRenderer
                lines={roomState.lyrics}
                currentTime={currentTime}
                className="flex-1"
              />

              {!roomState.songName && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
                  <div className="text-6xl opacity-20">♪</div>
                  <p className="font-display text-2xl text-noir-charcoal">Waiting for audio</p>
                  <p className="font-mono text-xs text-noir-dim tracking-widest">
                    The host has not loaded any tracks in this room yet
                  </p>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* ── MOBILE LAYOUT (less than lg) ──────────────────────────────── */}
      <div className="flex lg:hidden flex-col h-[calc(100vh-4rem)] overflow-y-auto z-10 p-4 pb-24 space-y-4">
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

            {/* Playback status */}
            <GlassPanel className="p-4 space-y-4">
              <div>
                <p className="font-mono text-[10px] tracking-widest text-noir-ash uppercase mb-1">Playing</p>
                <p className="font-display text-lg text-noir-white leading-snug truncate">
                  {roomState.songName || 'No Song Loaded'}
                </p>
                {roomState.lrcMeta?.artist && (
                  <p className="font-body text-xs text-noir-dim mt-0.5 truncate">{roomState.lrcMeta.artist}</p>
                )}
              </div>

              {/* State indicator */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {roomState.isPlaying ? (
                    <>
                      <WaveformBar active={localPlaying} />
                      <span className="font-mono text-xs text-green-400 tracking-widest">
                        {localPlaying ? 'SYNCED' : 'BLOCKED'}
                      </span>
                    </>
                  ) : (
                    <>
                      <WaveformBar active={false} />
                      <span className="font-mono text-xs text-noir-dim tracking-widest">
                        {connected ? 'WAITING FOR HOST' : 'CONNECTING…'}
                      </span>
                    </>
                  )}
                  {buffering && roomState.isPlaying && (
                    <Spinner size="sm" />
                  )}
                </div>

                {roomState.isPlaying && !localPlaying && (
                  <Button
                    variant="gold"
                    size="sm"
                    onClick={handleSyncAudio}
                    className="animate-pulse py-1 px-2.5 text-[10px]"
                  >
                    🔊 Sync Audio
                  </Button>
                )}
              </div>

              {/* Progress */}
              {roomState.songName && (
                <div className="space-y-1">
                  <div className="h-1 w-full bg-noir-border rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: 'linear-gradient(90deg, #c8a96e, #d4882a)',
                      }}
                    />
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-noir-dim">
                    <span>{formatTime(currentTime)} / {formatTime(trackDuration)}</span>
                  </div>
                </div>
              )}

              {/* Buffer progress */}
              {roomState.totalChunks && (
                <ProgressBar
                  value={bufferedPercent}
                  total={100}
                  label="BUFFERED"
                  showPercent
                />
              )}
            </GlassPanel>

            {/* Queue Panel */}
            <GlassPanel className="p-4 flex flex-col max-h-[300px]">
              <div className="flex items-center justify-between shrink-0 mb-3">
                <span className="font-mono text-[10px] tracking-widest text-noir-ash uppercase">Up Next</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 scrollbar-none pr-1">
                {roomState.queue.length === 0 ? (
                  <div className="text-center py-6 text-noir-dim font-mono text-[10px] border border-dashed border-noir-border/50 rounded-xl">
                    Queue is empty.
                  </div>
                ) : (
                  roomState.queue.map((track, idx) => (
                    <div
                      key={`${track.id}-${idx}`}
                      className={`p-2 rounded-lg border flex items-center justify-between ${
                        roomState.currentQueueIndex === idx
                          ? 'border-accent-gold/45 bg-accent-gold/5'
                          : 'border-noir-border/40 bg-noir-deep/40'
                      }`}
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
                          <p className={`font-ui text-xs font-semibold truncate ${roomState.currentQueueIndex === idx ? 'text-accent-gold' : 'text-noir-white'}`}>{track.title}</p>
                          <p className="font-ui text-[10px] text-noir-dim truncate mt-0.5">{track.artist}</p>
                        </div>
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
            {roomState.songName && (
              <div className="px-4 py-2 shrink-0">
                <h1 className="font-display text-2xl text-noir-white">{roomState.lrcMeta?.title || roomState.songName}</h1>
                {roomState.lrcMeta?.artist && (
                  <p className="font-body text-xs text-noir-ash mt-0.5">{roomState.lrcMeta.artist}</p>
                )}
              </div>
            )}
            <LyricsRenderer
              lines={roomState.lyrics}
              currentTime={currentTime}
              className="flex-1"
            />
          </div>
        )}

        {mobileTab === 'library' && (
          <div className="space-y-4">
            <div className="text-center py-4 px-4 border border-dashed border-noir-border rounded-xl">
              <p className="font-ui text-sm text-noir-ash">📚 Library Mode</p>
              <p className="font-mono text-[10px] text-noir-dim mt-1">
                Browse the library or upload tracks. Only the host can play them.
              </p>
            </div>
            <LibraryBrowser
              isHost={false}
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

      {/* Hidden audio */}
      <audio ref={audioRef} preload="auto" className="hidden" aria-hidden="true" />
    </div>
  );
}
