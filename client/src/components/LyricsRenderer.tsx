import { useEffect, useRef, memo } from 'react';
import { type LrcLine, getCurrentLyricIndex } from '../lib/lrcParser';

interface LyricsRendererProps {
  lines: LrcLine[];
  currentTime: number;
  className?: string;
  onLineClick?: (time: number) => void;
}

export const LyricsRenderer = memo(function LyricsRenderer({
  lines,
  currentTime,
  className = '',
  onLineClick,
}: LyricsRendererProps) {
  const activeIndex = getCurrentLyricIndex(lines, currentTime);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef    = useRef<HTMLParagraphElement>(null);

  // Auto-scroll active line into view (centered inside container ONLY, preventing viewport page scroll)
  useEffect(() => {
    if (!activeRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const activeEl = activeRef.current;

    const containerHeight = container.clientHeight;
    const activeHeight = activeEl.clientHeight;
    const activeTop = activeEl.offsetTop;

    // Center active element inside scroll view
    const targetScrollTop = activeTop - (containerHeight / 2) + (activeHeight / 2);

    container.scrollTo({
      top: targetScrollTop,
      behavior: 'smooth',
    });
  }, [activeIndex]);

  if (lines.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <p className="font-mono text-xs text-noir-dim tracking-widest">
          NO LYRICS · DROP A .LRC FILE
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-y-auto px-6 py-[35vh] space-y-6 text-center select-none ${className}`}
      style={{
        scrollbarWidth: 'none',
        maskImage: 'linear-gradient(to bottom, transparent 0%, white 30%, white 70%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, white 30%, white 70%, transparent 100%)',
      }}
      aria-label="Synchronized lyrics"
      aria-live="polite"
      aria-atomic="false"
    >
      {lines.map((line, i) => {
        const isCurrent = i === activeIndex;
        const isPast    = i < activeIndex;

        return (
          <p
            key={i}
            ref={isCurrent ? activeRef : undefined}
            onClick={onLineClick ? () => onLineClick(line.time) : undefined}
            className={`
              font-body text-xl md:text-2xl transition-all duration-[600ms] ease-out px-4 select-none
              ${isCurrent ? 'lyric-current animate-lyric-glow' : ''}
              ${isPast    ? 'lyric-past'    : ''}
              ${!isCurrent && !isPast ? 'lyric-future' : ''}
              ${onLineClick ? 'cursor-pointer hover:text-noir-white hover:scale-105 active:scale-[0.98]' : ''}
            `}
            aria-current={isCurrent ? 'true' : undefined}
          >
            {line.text}
          </p>
        );
      })}
    </div>
  );
});
