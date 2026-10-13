import { useEffect, useRef, useState } from "react";

import { formatDuration, splitDuration } from "#/lib/sudan-time.ts";

/**
 * Counts down to the next Sudan midnight.
 *
 * The server's remaining time seeds the first render (so server and client
 * markup agree during hydration), then the display is re-aligned to the
 * browser's own clock and ticks locally — no polling.
 */
export function Countdown({
  msRemaining,
  endsAt,
  label,
  onElapsed,
}: {
  msRemaining: number;
  endsAt: string;
  label: string;
  onElapsed: () => void;
}) {
  const [remaining, setRemaining] = useState(msRemaining);
  const firedRef = useRef(false);

  useEffect(() => {
    setRemaining(msRemaining);
    firedRef.current = false;
  }, [msRemaining]);

  useEffect(() => {
    setRemaining(Math.max(0, new Date(endsAt).getTime() - Date.now()));
  }, [endsAt]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemaining((previous) => Math.max(0, previous - 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remaining > 0 || firedRef.current) return;
    firedRef.current = true;
    onElapsed();
  }, [remaining, onElapsed]);

  const { hours, minutes, seconds } = splitDuration(remaining);

  return (
    <div className="flex items-center justify-center gap-2 text-sm">
      <span className="text-base-content/60">{label}</span>
      <span className="badge badge-lg gap-1 font-mono tabular-nums" dir="ltr">
        <span>{String(hours).padStart(2, "0")}</span>
        <span className="text-base-content/40">:</span>
        <span>{String(minutes).padStart(2, "0")}</span>
        <span className="text-base-content/40">:</span>
        <span>{String(seconds).padStart(2, "0")}</span>
      </span>
      <span className="sr-only">{formatDuration(remaining)}</span>
    </div>
  );
}
