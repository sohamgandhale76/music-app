import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSocket } from '../lib/socket';

export interface MemberInfo {
  id: string;
  role: 'host' | 'viewer';
  displayName: string;
}

export interface RoomState {
  isPlaying: boolean;
  currentTime: number;
  chunkIndex: number;
  scheduledStartTime: number | null;
  mimeType: string;
  totalChunks: number | null;
  songName: string;
  memberCount: number;
  members: MemberInfo[];
  libraryTrackId: string | null;
  coverFilename: string | null;
  lyrics: Array<{ time: number; text: string }>;
  lrcMeta: { title?: string; artist?: string; album?: string };
  queue: any[];
  currentQueueIndex: number;
}

const DEFAULT_STATE: RoomState = {
  isPlaying: false,
  currentTime: 0,
  chunkIndex: 0,
  scheduledStartTime: null,
  mimeType: 'audio/mpeg',
  totalChunks: null,
  songName: '',
  memberCount: 0,
  members: [],
  libraryTrackId: null,
  coverFilename: null,
  lyrics: [],
  lrcMeta: {},
  queue: [],
  currentQueueIndex: -1,
};

export interface UseRoomReturn {
  connected: boolean;
  roomState: RoomState;
  roomError: string | null;
  emitPlay: (currentTime: number, chunkIndex: number) => void;
  emitPause: (currentTime: number) => void;
  emitSeek: (currentTime: number, chunkIndex: number) => void;
  emitChunkPlaying: (chunkIndex: number) => void;
  emitLoadLibraryTrack: (trackId: string) => void;
  emitUpdateQueue: (queue: any[], currentQueueIndex: number) => void;
  emitUpdateTrackMetadata: (metadata: Partial<RoomState>) => void;
}

export function useRoom(
  roomId: string,
  role: 'host' | 'viewer',
  displayName: string
): UseRoomReturn {
  const [connected, setConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState>(DEFAULT_STATE);
  const [roomError, setRoomError] = useState<string | null>(null);

  const socketRef = useRef(connectSocket());
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  useEffect(() => {
    const socket = socketRef.current;

    const handleConnect = () => {
      setConnected(true);
      setRoomError(null);
      socket.emit('room:join', { roomId, role, displayName });
    };

    const handleDisconnect = () => setConnected(false);

    const handleRoomJoined = ({ state }: { state: RoomState }) => {
      setRoomState((prev) => ({ ...prev, ...state }));
    };

    const handleRoomError = ({ message }: { message: string }) => {
      setRoomError(message);
    };

    const handleMemberJoined = ({ memberCount, members }: { memberCount: number; members: MemberInfo[] }) => {
      setRoomState((s) => ({ ...s, memberCount, members }));
    };

    const handleMemberLeft = ({ memberCount, members }: { memberCount: number; members: MemberInfo[] }) => {
      setRoomState((s) => ({ ...s, memberCount, members }));
    };

    const handleSyncPlay = (data: {
      scheduledStartTime: number;
      currentTime: number;
      chunkIndex: number;
    }) => {
      setRoomState((s) => ({ ...s, isPlaying: true, ...data }));
    };

    const handleSyncPause = ({ currentTime }: { currentTime: number }) => {
      setRoomState((s) => ({ ...s, isPlaying: false, currentTime }));
    };

    const handleSyncSeek = (data: { currentTime: number; chunkIndex: number; scheduledStartTime?: number | null }) => {
      setRoomState((s) => ({ ...s, ...data }));
    };

    const handleSyncTrackLoaded = (state: RoomState) => {
      setRoomState((prev) => ({ ...prev, ...state }));
    };

    // Register all listeners
    socket.on('connect',           handleConnect);
    socket.on('disconnect',        handleDisconnect);
    socket.on('room:joined',       handleRoomJoined);
    socket.on('room:error',        handleRoomError);
    socket.on('room:member_joined', handleMemberJoined);
    socket.on('room:member_left',  handleMemberLeft);
    socket.on('sync:play',         handleSyncPlay);
    socket.on('sync:pause',        handleSyncPause);
    socket.on('sync:seek',         handleSyncSeek);
    socket.on('sync:track_loaded',  handleSyncTrackLoaded);

    // If already connected, join immediately
    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.off('connect',            handleConnect);
      socket.off('disconnect',         handleDisconnect);
      socket.off('room:joined',        handleRoomJoined);
      socket.off('room:error',         handleRoomError);
      socket.off('room:member_joined', handleMemberJoined);
      socket.off('room:member_left',   handleMemberLeft);
      socket.off('sync:play',          handleSyncPlay);
      socket.off('sync:pause',         handleSyncPause);
      socket.off('sync:seek',          handleSyncSeek);
      socket.off('sync:track_loaded',  handleSyncTrackLoaded);
    };
  }, [roomId, role, displayName]);

  const emitPlay = useCallback((currentTime: number, chunkIndex: number) => {
    socketRef.current.emit('host:play', { roomId: roomIdRef.current, currentTime, chunkIndex });
  }, []);

  const emitPause = useCallback((currentTime: number) => {
    socketRef.current.emit('host:pause', { roomId: roomIdRef.current, currentTime });
  }, []);

  const emitSeek = useCallback((currentTime: number, chunkIndex: number) => {
    socketRef.current.emit('host:seek', { roomId: roomIdRef.current, currentTime, chunkIndex });
  }, []);

  const emitChunkPlaying = useCallback((chunkIndex: number) => {
    socketRef.current.emit('host:chunk_playing', { roomId: roomIdRef.current, chunkIndex });
  }, []);

  const emitLoadLibraryTrack = useCallback((trackId: string) => {
    socketRef.current.emit('host:load_library_track', { roomId: roomIdRef.current, trackId });
  }, []);

  const emitUpdateQueue = useCallback((queue: any[], currentQueueIndex: number) => {
    socketRef.current.emit('host:update_queue', { roomId: roomIdRef.current, queue, currentQueueIndex });
  }, []);

  const emitUpdateTrackMetadata = useCallback((metadata: Partial<RoomState>) => {
    socketRef.current.emit('host:update_track_metadata', { roomId: roomIdRef.current, ...metadata });
  }, []);

  return {
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
  };
}
