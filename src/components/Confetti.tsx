import { useEffect, useRef } from "react";

/**
 * A burst of confetti over the whole page, drawn on one canvas. No library.
 *
 * The result dialog opens with `showModal()`, which puts it in the browser's
 * top layer, above any z-index. To fall in front of it rather than behind its
 * backdrop, the canvas is shown as a popover — the top layer stacks in the
 * order things enter it, and this enters after the dialog. Browsers without
 * popovers fall back to a high z-index, where it still covers the board.
 *
 * Each new value of `burst` plays it once. Zero plays nothing, so restoring a
 * game that was won earlier stays quiet. Skipped entirely for anyone who has
 * asked their system for reduced motion.
 */

const COLORS = ["#d21034", "#007229", "#f5c518", "#2b7fff", "#ff7a00", "#a855f7"];
const PIECES = 160;
const DURATION_MS = 4200;
const GRAVITY = 0.12;
const DRAG = 0.992;

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  angle: number;
  spin: number;
  /** Phase of the flutter, which narrows the piece as it turns over. */
  flip: number;
  flipSpeed: number;
};

/** Two cannons in the bottom corners, aimed up and inwards. */
function launch(width: number, height: number): Piece[] {
  return Array.from({ length: PIECES }, (_, index) => {
    const fromLeft = index % 2 === 0;
    const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
    const speed = (height / 52) * (0.75 + Math.random() * 0.5);
    return {
      x: fromLeft ? 0 : width,
      y: height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 6,
      color: COLORS[index % COLORS.length],
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      flip: Math.random() * Math.PI,
      flipSpeed: 0.08 + Math.random() * 0.1,
    };
  });
}

export function Confetti({ burst }: { burst: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (burst === 0 || !canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.scale(ratio, ratio);

    canvas.hidden = false;
    if (typeof canvas.showPopover === "function") canvas.showPopover();

    const pieces = launch(width, height);
    const started = performance.now();
    let frame = 0;

    const draw = (now: number) => {
      const elapsed = now - started;
      context.clearRect(0, 0, width, height);
      // Fade the last second out rather than stopping mid-air.
      context.globalAlpha = Math.min(1, (DURATION_MS - elapsed) / 1000);

      for (const piece of pieces) {
        piece.vx *= DRAG;
        piece.vy = piece.vy * DRAG + GRAVITY;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.angle += piece.spin;
        piece.flip += piece.flipSpeed;

        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.angle);
        context.fillStyle = piece.color;
        context.fillRect(
          -piece.size / 2,
          (-piece.size / 2) * Math.abs(Math.cos(piece.flip)),
          piece.size,
          piece.size * 0.6 * Math.abs(Math.cos(piece.flip)),
        );
        context.restore();
      }

      if (elapsed < DURATION_MS) {
        frame = requestAnimationFrame(draw);
      } else {
        stop();
      }
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (typeof canvas.hidePopover === "function" && canvas.matches(":popover-open")) {
        canvas.hidePopover();
      }
      canvas.hidden = true;
    };

    frame = requestAnimationFrame(draw);
    return stop;
  }, [burst]);

  return <canvas ref={canvasRef} popover="manual" hidden aria-hidden="true" className="confetti" />;
}
