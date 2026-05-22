interface WaveformBarProps {
  bars?: number;
  active?: boolean;
  className?: string;
}

export function WaveformBar({ bars = 5, active = true, className = '' }: WaveformBarProps) {
  return (
    <div className={`flex items-end gap-[3px] h-5 ${className}`} aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-accent-gold"
          style={{
            height: active ? undefined : '4px',
            animation: active
              ? `waveform ${0.8 + i * 0.15}s ease-in-out infinite`
              : 'none',
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  );
}
