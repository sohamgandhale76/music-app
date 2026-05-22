// ─── NTP Clock Synchronization ────────────────────────────────────────────
// Runs NTP_ROUNDS HTTP ping/pong rounds, takes the median RTT offset.
//
// Algorithm (simplified NTP):
//   t0 = client send time
//   t1 = server receive time (≈ serverTime in response)
//   t3 = client receive time
//   RTT   = t3 - t0
//   offset = t1 - (t0 + RTT/2)
//
// After sync: getServerTime() = Date.now() + offset

import { SERVER_URL, NTP_ROUNDS, NTP_RESYNC_INTERVAL } from './constants';

let _offset = 0;
let _synced = false;
let _lastSyncAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function syncNtpClock(): Promise<number> {
  const samples: number[] = [];
  const baseUrl = SERVER_URL || window.location.origin;

  for (let i = 0; i < NTP_ROUNDS; i++) {
    try {
      const t0 = Date.now();
      const res = await fetch(`${baseUrl}/api/ntp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientSendTime: t0 }),
        signal: AbortSignal.timeout(3_000),
      });
      const t3 = Date.now();

      if (!res.ok) throw new Error(`NTP HTTP ${res.status}`);

      const { serverTime } = (await res.json()) as { serverTime: number };
      const rtt = t3 - t0;
      const offset = serverTime - (t0 + rtt / 2);
      samples.push(offset);
    } catch (err) {
      console.warn(`[ntp] round ${i + 1} failed:`, err);
    }
    await sleep(100);
  }

  if (samples.length === 0) {
    console.warn('[ntp] all rounds failed — using offset 0');
    return _offset;
  }

  _offset = Math.round(median(samples));
  _synced = true;
  _lastSyncAt = Date.now();

  console.info(`[ntp] synced — offset: ${_offset > 0 ? '+' : ''}${_offset}ms (${samples.length}/${NTP_ROUNDS} samples)`);
  return _offset;
}

/** Kick off automatic re-sync in the background */
export function startNtpAutoResync(): () => void {
  const id = setInterval(() => {
    syncNtpClock().catch(console.warn);
  }, NTP_RESYNC_INTERVAL);
  return () => clearInterval(id);
}

export function getServerTime(): number {
  return Date.now() + _offset;
}

export function getNtpOffset(): number {
  return _offset;
}

export function isNtpSynced(): boolean {
  return _synced;
}

export function getLastSyncAge(): number {
  return _lastSyncAt ? Date.now() - _lastSyncAt : -1;
}
