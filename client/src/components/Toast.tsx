import { useEffect, useState } from 'react';
import type { Toast, ToastType } from '../hooks/useToast';

const ICONS: Record<ToastType, string> = {
  info:    'ℹ',
  success: '✓',
  warning: '⚠',
  error:   '✕',
};

const COLORS: Record<ToastType, string> = {
  info:    'border-noir-border text-noir-ash',
  success: 'border-green-800/50 text-green-400',
  warning: 'border-yellow-800/50 text-yellow-400',
  error:   'border-red-900/50 text-red-400',
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Slight delay for mount animation
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        glass-panel flex items-start gap-3 px-4 py-3 min-w-[280px] max-w-sm
        border ${COLORS[toast.type]}
        transition-all duration-300
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
      `}
    >
      <span className="mt-0.5 text-base leading-none shrink-0">{ICONS[toast.type]}</span>
      <p className="font-ui text-sm text-noir-white leading-snug flex-1">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 text-noir-dim hover:text-noir-pale transition-colors mt-0.5 leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
