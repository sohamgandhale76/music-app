interface ProgressBarProps {
  value: number;   // 0–100
  total?: number;  // if provided, calculates percentage from value/total
  label?: string;
  className?: string;
  showPercent?: boolean;
}

export function ProgressBar({ value, total, label, className = '', showPercent = false }: ProgressBarProps) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : Math.min(100, value);

  return (
    <div className={`space-y-1.5 ${className}`}>
      {(label || showPercent) && (
        <div className="flex items-center justify-between">
          {label && <span className="font-mono text-xs text-noir-ash tracking-wider">{label}</span>}
          {showPercent && <span className="font-mono text-xs text-accent-gold">{pct}%</span>}
        </div>
      )}
      <div className="h-1 w-full bg-noir-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #c8a96e, #d4882a)',
            boxShadow: pct > 0 ? '0 0 8px rgba(200,169,110,0.4)' : 'none',
          }}
        />
      </div>
    </div>
  );
}
