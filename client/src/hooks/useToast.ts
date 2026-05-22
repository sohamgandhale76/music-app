import { useCallback, useRef, useState } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

let _idCounter = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, type: ToastType = 'info', durationMs = 4000) => {
      const id = `toast-${++_idCounter}`;
      setToasts((prev) => [...prev.slice(-4), { id, message, type }]); // cap at 5

      const timer = setTimeout(() => dismiss(id), durationMs);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss]
  );

  return {
    toasts,
    show,
    dismiss,
    success: (msg: string) => show(msg, 'success'),
    error:   (msg: string) => show(msg, 'error', 6000),
    warn:    (msg: string) => show(msg, 'warning'),
    info:    (msg: string) => show(msg, 'info'),
  };
}
