import { useEffect, useRef, useState } from "react";

import { formatDuration, splitDuration } from "#/lib/sudan-time.ts";

/**
 * Counts down to the next Sudan midnight.
 *
 * The server's remaining time seeds the first render (so server and client
 * markup agree during hydration) and fixes a deadline on the browser's clock;
 * every tick then measures against that deadline — no polling.
 *
 * Both halves matter. Counting down by a fixed step drifts whenever the browser
 * throttles timers, as it does in background tabs. Comparing against the
 * server's `endsAt` instead would trust the browser's clock, and a clock that
 * runs fast would reach zero, reload, still be on the old day, and reload again
 * until the server caught up.
 */
export function Countdown({
  msRemaining,
  label,
  onElapsed,
}: {
  msRemaining: number;
  label: string;
  onElapsed: () => void;
}) {
  const [remaining, setRemaining] = useState(msRemaining);
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    const deadline = Date.now() + msRemaining;
    const tick = () => setRemaining(Math.max(0, deadline - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [msRemaining]);

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
