/**
 * Real-time Decart "AI Generated ✦" watermark remover.
 *
 * How it works:
 *  1. A hidden <video> reads the raw Decart MediaStream frame by frame.
 *  2. Every requestAnimationFrame, the frame is drawn to an offscreen <canvas>.
 *  3. The canvas pixel data is scanned for the moving white pill badge
 *     (bright, low-saturation, pill-shaped blob).
 *  4. The badge region is inpainted by blending pixels sampled from just
 *     above and below it, reconstructing the background.
 *  5. canvas.captureStream(30) returns a clean MediaStream with no badge.
 *
 * Badge profile (analysed from real Decart output frames):
 *   Shape  : rounded pill — wider than tall, aspect ratio 1.5–12×
 *   Size   : 44–460 px wide, 10–85 px tall
 *   Color  : bright warm-white, avg RGB ≈ (222, 204, 183), brightness > 175
 *   Motion : jumps to a random new position every ~1 second
 */

export interface WatermarkRemover {
  cleanStream: MediaStream;
  inputStream: MediaStream;
  stop: () => void;
}

export function createWatermarkRemover(inputStream: MediaStream): WatermarkRemover {
  const video = document.createElement("video");
  video.srcObject = inputStream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  Object.assign(video.style, {
    position: "fixed",
    top: "-9999px",
    left: "-9999px",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(video);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  let rafId: number | null = null;
  let lastBbox: [number, number, number, number] | null = null;
  let missCount = 0;

  function detectBadge(w: number, h: number): [number, number, number, number] | null {
    const VSTEP  = 3;
    const HSTEP  = 2;
    const BRIGHT = 175;
    const SAT    = 0.36;
    const MIN_W  = 44;
    const MAX_W  = 460;
    const MIN_H  = 10;
    const MAX_H  = 85;

    const y0 = lastBbox && missCount < 6 ? Math.max(0, lastBbox[1] - 100) : 0;
    const y1 = lastBbox && missCount < 6 ? Math.min(h, lastBbox[1] + lastBbox[3] + 100) : h;

    const region = ctx.getImageData(0, y0, w, y1 - y0);
    const data   = region.data;
    const rh     = y1 - y0;

    let best: [number, number, number, number] | null = null;
    let bestW = 0;

    for (let row = 0; row < rh; row += VSTEP) {
      let runX   = -1;
      let runCols = 0;

      for (let col = 0; col <= w; col += HSTEP) {
        let bright = false;
        if (col < w) {
          const i = (row * w + col) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const avg = (r + g + b) / 3;
          const mx  = Math.max(r, g, b);
          const mn  = Math.min(r, g, b);
          bright = avg >= BRIGHT && (mx > 0 ? (mx - mn) / mx : 0) <= SAT;
        }

        if (bright) {
          if (runX === -1) runX = col;
          runCols++;
        } else if (runX !== -1) {
          const runW = runCols * HSTEP;
          if (runW >= MIN_W && runW <= MAX_W && runW > bestW) {
            const cx         = runX + runW / 2;
            const globalRow  = row + y0;
            let   topRow     = globalRow;
            let   botRow     = globalRow;

            const isBrightAt = (gy: number) => {
              const ly = gy - y0;
              if (ly < 0 || ly >= rh) return false;
              const ci  = (ly * w + Math.floor(cx)) * 4;
              const avg = (data[ci] + data[ci + 1] + data[ci + 2]) / 3;
              const mx  = Math.max(data[ci], data[ci + 1], data[ci + 2]);
              const mn  = Math.min(data[ci], data[ci + 1], data[ci + 2]);
              return avg >= 162 && (mx > 0 ? (mx - mn) / mx : 0) <= 0.43;
            };

            for (let y = globalRow - VSTEP; y >= y0; y -= VSTEP) {
              if (isBrightAt(y)) topRow = y; else break;
            }
            for (let y = globalRow + VSTEP; y < y1; y += VSTEP) {
              if (isBrightAt(y)) botRow = y; else break;
            }

            const bh     = Math.max(botRow - topRow + VSTEP, MIN_H);
            const aspect = runW / bh;

            if (aspect >= 1.5 && aspect <= 12 && bh <= MAX_H) {
              bestW = runW;
              best  = [runX, topRow, runW, bh];
            }
          }
          runX    = -1;
          runCols = 0;
        }
      }
    }

    return best;
  }

  function removeBadge(bbox: [number, number, number, number], w: number, h: number): void {
    const PAD    = 10;
    const [bx, by, bw, bh] = bbox;
    const x1     = Math.max(0, bx - PAD);
    const x2     = Math.min(w, bx + bw + PAD);
    const y1     = Math.max(0, by - PAD);
    const y2     = Math.min(h, by + bh + PAD);
    const fillW  = x2 - x1;
    const fillH  = y2 - y1;
    if (fillW <= 0 || fillH <= 0) return;

    const stripAboveH = Math.min(6, y1);
    const stripBelowH = Math.min(6, h - y2);

    const above = stripAboveH > 0 ? ctx.getImageData(x1, y1 - stripAboveH, fillW, stripAboveH) : null;
    const below = stripBelowH > 0 ? ctx.getImageData(x1, y2, fillW, stripBelowH) : null;

    const fill = new ImageData(fillW, fillH);

    for (let row = 0; row < fillH; row++) {
      const t = row / Math.max(fillH - 1, 1);
      for (let col = 0; col < fillW; col++) {
        const dst = (row * fillW + col) * 4;
        let r = 0, g = 0, b = 0;

        if (above && below) {
          const ai  = ((row % stripAboveH) * fillW + col) * 4;
          const bi  = ((row % stripBelowH) * fillW + col) * 4;
          r = Math.round(above.data[ai] * (1 - t) + below.data[bi] * t);
          g = Math.round(above.data[ai + 1] * (1 - t) + below.data[bi + 1] * t);
          b = Math.round(above.data[ai + 2] * (1 - t) + below.data[bi + 2] * t);
        } else if (above) {
          const ai  = ((row % stripAboveH) * fillW + col) * 4;
          r = above.data[ai]; g = above.data[ai + 1]; b = above.data[ai + 2];
        } else if (below) {
          const bi  = ((row % stripBelowH) * fillW + col) * 4;
          r = below.data[bi]; g = below.data[bi + 1]; b = below.data[bi + 2];
        }

        fill.data[dst] = r; fill.data[dst + 1] = g;
        fill.data[dst + 2] = b; fill.data[dst + 3] = 255;
      }
    }

    ctx.putImageData(fill, x1, y1);
  }

  function processFrame(): void {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (canvas.width !== vw || canvas.height !== vh) {
        canvas.width  = vw;
        canvas.height = vh;
      }
      ctx.drawImage(video, 0, 0, vw, vh);
      const bbox = detectBadge(vw, vh);
      if (bbox) {
        lastBbox  = bbox;
        missCount = 0;
        removeBadge(bbox, vw, vh);
      } else {
        missCount++;
        if (missCount > 8) lastBbox = null;
      }
    }
    rafId = requestAnimationFrame(processFrame);
  }

  const start = () => {
    if (rafId === null) rafId = requestAnimationFrame(processFrame);
  };

  video.addEventListener("loadedmetadata", () => {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    video.play().catch(() => {});
    start();
  });

  video.play().catch(() => {});
  if (video.readyState >= 2) {
    canvas.width  = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
    start();
  }

  const cleanStream = canvas.captureStream(30);

  return {
    cleanStream,
    inputStream,
    stop(): void {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      video.srcObject = null;
      video.remove();
    },
  };
}
