async function canvasHash(): Promise<string> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("FULLSWAP\u{1F3A5}", 2, 15);
    ctx.fillStyle = "rgba(102,204,0,0.7)";
    ctx.fillText("FULLSWAP\u{1F3A5}", 4, 17);
    ctx.font = "11px Georgia";
    ctx.fillStyle = "#800080";
    ctx.fillText("device-id-probe", 10, 30);
    return canvas.toDataURL().slice(-80);
  } catch {
    return "canvas-err";
  }
}

function webglInfo(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    if (!gl) return "no-webgl";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const version = gl.getParameter(gl.VERSION);
    const shadingVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxViewport = (gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null)?.join("x") ?? "";
    return [vendor, renderer, version, shadingVersion, maxTextureSize, maxViewport].join("|");
  } catch {
    return "webgl-err";
  }
}

async function audioFingerprint(): Promise<string> {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return "no-audio";
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const analyser = ctx.createAnalyser();
    const gain = ctx.createGain();
    const scriptProcessor = ctx.createScriptProcessor(4096, 1, 1);

    gain.gain.value = 0;
    oscillator.type = "triangle";
    oscillator.frequency.value = 10000;

    oscillator.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(0);

    const fingerprint = await new Promise<string>((resolve) => {
      scriptProcessor.onaudioprocess = (event) => {
        const data = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]);
        oscillator.stop();
        scriptProcessor.disconnect();
        ctx.close();
        resolve(sum.toFixed(10));
      };
      setTimeout(() => {
        try { oscillator.stop(); ctx.close(); } catch { /* ignore */ }
        resolve("audio-timeout");
      }, 300);
    });

    return fingerprint;
  } catch {
    return "audio-err";
  }
}

function detectFonts(): string {
  const probe = ["Arial", "Courier New", "Georgia", "Times New Roman", "Verdana",
    "Helvetica", "Trebuchet MS", "Impact", "Comic Sans MS", "Palatino",
    "Garamond", "Tahoma", "Lucida Console", "Monaco", "Calibri",
    "Cambria", "Consolas", "Segoe UI", "Roboto", "Ubuntu"];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return "no-font-canvas";
  const baseFonts = ["monospace", "sans-serif", "serif"];
  const testStr = "mmmmmmmmmmlli";
  const testSize = "72px";
  const baseSizes: Record<string, number> = {};
  for (const base of baseFonts) {
    ctx.font = `${testSize} ${base}`;
    baseSizes[base] = ctx.measureText(testStr).width;
  }
  const detected: string[] = [];
  for (const font of probe) {
    let found = false;
    for (const base of baseFonts) {
      ctx.font = `${testSize} '${font}',${base}`;
      if (ctx.measureText(testStr).width !== baseSizes[base]) { found = true; break; }
    }
    if (found) detected.push(font);
  }
  return detected.join(",");
}

function connectionInfo(): string {
  const conn = (navigator as any).connection ?? (navigator as any).mozConnection ?? (navigator as any).webkitConnection;
  if (!conn) return "no-conn";
  return [
    conn.effectiveType ?? "",
    String(conn.downlink ?? ""),
    String(conn.rtt ?? ""),
    conn.saveData ? "save" : "nosave",
  ].join("|");
}

async function sha256(str: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const enc = new TextEncoder().encode(str);
      const buf = await crypto.subtle.digest("SHA-256", enc);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch { /* fall through */ }
  }
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export async function collectBrowserFingerprint(): Promise<string> {
  const nav = navigator as any;

  const [canvas, audio, fonts] = await Promise.all([
    canvasHash(),
    audioFingerprint(),
    Promise.resolve(detectFonts()),
  ]);

  const signals: string[] = [
    nav.userAgent ?? "",
    nav.language ?? "",
    (nav.languages ?? []).join(","),
    nav.vendor ?? "",
    nav.product ?? "",
    nav.platform ?? "",
    String(screen.width),
    String(screen.height),
    String(screen.availWidth ?? ""),
    String(screen.availHeight ?? ""),
    String(screen.colorDepth),
    String(screen.pixelDepth),
    String(window.devicePixelRatio ?? ""),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    Intl.DateTimeFormat().resolvedOptions().locale ?? "",
    String(new Date().getTimezoneOffset()),
    String(nav.hardwareConcurrency ?? ""),
    String(nav.deviceMemory ?? ""),
    String(nav.maxTouchPoints ?? ""),
    String(nav.cookieEnabled),
    String(nav.doNotTrack ?? ""),
    String(typeof window.indexedDB !== "undefined"),
    String(typeof window.sessionStorage !== "undefined"),
    String(typeof window.localStorage !== "undefined"),
    String(typeof (window as any).openDatabase !== "undefined"),
    String((nav.plugins ?? []).length),
    Array.from(nav.plugins ?? []).map((p: any) => p.name).join(","),
    connectionInfo(),
    webglInfo(),
    canvas,
    audio,
    fonts,
  ];

  const raw = signals.join("||");
  return sha256(raw);
}
