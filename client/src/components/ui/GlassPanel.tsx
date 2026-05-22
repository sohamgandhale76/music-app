import { type HTMLAttributes } from 'react';

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
}

export function GlassPanel({ glow = false, className = '', children, ...rest }: GlassPanelProps) {
  return (
    <div
      className={`glass-panel ${glow ? 'shadow-noir-glow' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
