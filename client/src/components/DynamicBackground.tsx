import { useEffect, useState } from 'react';
import { SERVER_URL } from '../lib/constants';

interface DynamicBackgroundProps {
  coverFilename: string | null;
  songName: string | null;
}

export function DynamicBackground({ coverFilename, songName }: DynamicBackgroundProps) {
  const [colors, setColors] = useState<[string, string]>(['#121212', '#1a1a1a']);

  useEffect(() => {
    if (!songName) return;
    // Generate two distinct hue values based on song name string hash
    let hash1 = 0;
    let hash2 = 0;
    for (let i = 0; i < songName.length; i++) {
      hash1 = songName.charCodeAt(i) + ((hash1 << 5) - hash1);
      hash2 = songName.charCodeAt(songName.length - 1 - i) + ((hash2 << 5) - hash2);
    }
    const h1 = Math.abs(hash1 % 360);
    const h2 = Math.abs((hash2 + 120) % 360);
    setColors([`hsl(${h1}, 70%, 25%)`, `hsl(${h2}, 70%, 18%)`]);
  }, [songName]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none z-0">
      {/* Dynamic base colors */}
      {songName && (
        <>
          <div
            className="absolute -top-[20%] -left-[20%] w-[90%] h-[90%] rounded-full opacity-[0.22] blur-[120px] mix-blend-screen animate-blob-slow transition-all duration-[3s]"
            style={{ backgroundColor: colors[0] }}
          />
          <div
            className="absolute -bottom-[20%] -right-[20%] w-[90%] h-[90%] rounded-full opacity-[0.18] blur-[120px] mix-blend-screen animate-blob-reverse transition-all duration-[3s]"
            style={{ backgroundColor: colors[1] }}
          />
        </>
      )}
      
      {/* Blurred Cover Art Overlay */}
      {coverFilename && (
        <img
          key={coverFilename}
          src={`${SERVER_URL || ''}/api/library/covers/${coverFilename}`}
          className="absolute inset-0 w-full h-full object-cover scale-150 blur-[110px] saturate-[200%] opacity-[0.32] transition-all duration-[2.5s] ease-in-out animate-pulse-slow"
          alt=""
        />
      )}
    </div>
  );
}
