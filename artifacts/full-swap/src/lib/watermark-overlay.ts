/**
 * Watermark overlay — covers the moving "AI Generated ✦" badge
 * using a transparent canvas positioned on top of the video element.
 *
 * Key difference from stream re-encoding approaches:
 *   - The <video> element displays the raw Decart stream unmodified.
 *   - We only draw OVER the badge region on an overlay <canvas>.
 *   - No captureStream(), no RAF re-encoding loop, no stream timing issues.
 *   - If this loop stumbles, the video still plays perfectly.
 *
 * Detection: reads raw video pixels to a hidden canvas every 50 ms,
 * locates the bright warm-white pill blob, samples adjacent pixels
 * for the fill colour, then paints that fill on the overlay canvas.
 */

const BRIGHT    = 172;
const MAX_SAT   = 0.38;
const MIN_W     = 40;
const MAX_W     = 480;
const MIN_H     = 8;
const MAX_H     = 90;
const VSTEP     = 3;
const HSTEP     = 2;
const PAD       = 12;
const INTERVAL  = 50;   // ms  (~20 fps — plenty for visual masking)
const MISS_TTL  = 10;   // clear overlay after this many misses

function isBright(r: number, g: number, b: number): boolean {
  const avg = (r + g + b) / 3;
  const mx  = Math.max(r, g, b);
  const mn  = Math.min(r, g, b);
  const sat = mx > 0 ? (mx - mn) / mx : 0;
  return avg >= BRIGHT && sat <= MAX_SAT;
}

function detectBadge(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hint: [number, number, number, number] | null,
  missCount: number,
): [number, number, number, number] | null {
  const y0 = hint && missCount < 8 ? Math.max(0, hint[1] - 120) : 0;
  const y1 = hint && missCount < 8 ? Math.min(h, hint[1] + hint[3] + 120) : h;

  const region = ctx.getImageData(0, y0, w, y1 - y0);
  const data   = region.data;
  const rh     = y1 - y0;

  let best: [number, number, number, number] | null = null;
  let bestW = 0;

  for (let row = 0; row < rh; row += VSTEP) {
    let runX  = -1;
    let runCols = 0;

    for (let col = 0; col <= w; col += HSTEP) {
      let bright = false;
      if (col < w) {
        const i = (row * w + col) * 4;
        bright = isBright(data[i], data[i + 1], data[i + 2]);
      }

      if (bright) {
        if (runX === -1) runX = col;
        runCols++;
      } else if (runX !== -1) {
        const runW   = runCols * HSTEP;
        const aspect = runW / Math.max(1, VSTEP);

        if (runW >= MIN_W && runW <= MAX_W && aspect >= 1.5 && runW > bestW) {
          const cx        = runX + runW / 2;
          const globalRow = row + y0;
          let topRow      = globalRow;
          let botRow      = globalRow;

          const brightAt = (gy: number) => {
            const ly = gy - y0;
            if (ly < 0 || ly >= rh) return false;
            const ci  = (ly * w + Math.floor(cx)) * 4;
            return isBright(data[ci], data[ci + 1], data[ci + 2]);
          };

          for (let y = globalRow - VSTEP; y >= y0; y -= VSTEP) {
            if (brightAt(y)) topRow = y; else break;
          }
          for (let y = globalRow + VSTEP; y < y1; y += VSTEP) {
            if (brightAt(y)) botRow = y; else break;
          }

          const bh     = Math.max(botRow - topRow + VSTEP, MIN_H);
          const aspect2 = runW / bh;
          if (aspect2 >= 1.5 && aspect2 <= 14 && bh <= MAX_H) {
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

function sampleFillColour(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, fw: number,
  h: number,
): string {
  const sampleH  = Math.min(8, y1);
  const sampleY  = Math.max(0, y1 - sampleH - 4);
  const belowY   = Math.min(h - 1, y1 + fw + 4);
  const belowH   = Math.min(8, h - belowY);

  let r = 0, g = 0, b = 0, n = 0;

  const addSample = (imgData: ImageData) => {
    for (let i = 0; i < imgData.data.length; i += 4) {
      r += imgData.data[i];
      g += imgData.data[i + 1];
      b += imgData.data[i + 2];
      n++;
    }
  };

  if (sampleH > 0) addSample(ctx.getImageData(x1, sampleY, Math.max(1, fw), sampleH));
  if (belowH > 0)  addSample(ctx.getImageData(x1, belowY, Math.max(1, fw), belowH));

  if (n === 0) return "rgb(0,0,0)";
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
}

export function startWatermarkOverlay(
  video: HTMLVideoElement,
  overlayCanvas: HTMLCanvasElement,
): () => void {
  const hiddenCanvas = document.createElement("canvas");
  const hiddenCtx    = hiddenCanvas.getContext("2d", { willReadFrequently: true });
  const overlayCtx   = overlayCanvas.getContext("2d");

  if (!hiddenCtx || !overlayCtx) return () => {};

  let lastBbox:   [number, number, number, number] | null = null;
  let missCount = 0;

  const id = setInterval(() => {
    if (video.readyState < 2 || video.videoWidth === 0) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (hiddenCanvas.width  !== vw) hiddenCanvas.width  = vw;
    if (hiddenCanvas.height !== vh) hiddenCanvas.height = vh;
    if (overlayCanvas.width  !== vw) overlayCanvas.width  = vw;
    if (overlayCanvas.height !== vh) overlayCanvas.height = vh;

    try {
      hiddenCtx.drawImage(video, 0, 0, vw, vh);
    } catch {
      return; // tainted canvas (cross-origin guard)
    }

    const bbox = detectBadge(hiddenCtx, vw, vh, lastBbox, missCount);

    overlayCtx.clearRect(0, 0, vw, vh);

    if (bbox) {
      lastBbox  = bbox;
      missCount = 0;

      const [bx, by, bw, bh] = bbox;
      const x1 = Math.max(0, bx - PAD);
      const y1 = Math.max(0, by - PAD);
      const x2 = Math.min(vw, bx + bw + PAD);
      const y2 = Math.min(vh, by + bh + PAD);
      const fw = x2 - x1;
      const fh = y2 - y1;

      const fill = sampleFillColour(hiddenCtx, x1, y1, fw, vh);
      overlayCtx.fillStyle = fill;
      overlayCtx.fillRect(x1, y1, fw, fh);
    } else {
      missCount++;
      if (missCount >= MISS_TTL) {
        lastBbox  = null;
        missCount = 0;
      }
    }
  }, INTERVAL);

  return () => {
    clearInterval(id);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  };
}
