import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { getAdminToken, clearAdminToken, clearAdminProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, Camera, Zap, Loader2, ImagePlus, X,
         Maximize2, RefreshCw, ChevronDown, ArrowLeft, CreditCard, UserCog } from "lucide-react";
import { createDecartClient } from "@decartai/sdk";

const LUCY_MODEL = "lucy-2.1" as const;
type Style = { id: string; name: string; description: string; prompt: string };

const STYLES: Style[] = [
  { id: "natural",      name: "Natural",      description: "Clean, realistic look",   prompt: "A person with a natural, realistic face, high quality portrait, sharp details" },
  { id: "anime",        name: "Anime",        description: "Japanese anime art style", prompt: "Anime style, vibrant colors, detailed anime art, expressive eyes" },
  { id: "superhero",    name: "Superhero",    description: "Comic book superhero",     prompt: "Superhero costume, dynamic lighting, comic book style, heroic pose" },
  { id: "cinematic",    name: "Cinematic",    description: "Professional film look",   prompt: "Cinematic color grading, film grain, professional movie scene lighting" },
  { id: "cyberpunk",    name: "Cyberpunk",    description: "Neon futuristic style",    prompt: "Cyberpunk style, neon lights, futuristic city, electric blue and purple glow" },
  { id: "oil-painting", name: "Oil Painting", description: "Classic oil painting",    prompt: "Oil painting style, thick brush strokes, classical art, museum quality" },
  { id: "sketch",       name: "Sketch",       description: "Pencil drawing style",     prompt: "Pencil sketch, hand drawn, detailed line art, black and white" },
  { id: "3d-render",    name: "3D Render",    description: "Photorealistic CGI",       prompt: "Photorealistic 3D render, high quality CGI, sharp details, ray tracing" },
  { id: "vintage",      name: "Vintage Film", description: "Retro 70s film look",      prompt: "Vintage film photography, aged warm tones, film grain, 1970s aesthetic" },
];

async function fetchDecartToken(): Promise<string> {
  const token = getAdminToken();
  const res = await fetch("/api/decart/token", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? "Failed to fetch Decart token"); }
  const data = await res.json();
  return data.apiKey as string;
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60); const s = secs % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

type DecartClient = Awaited<ReturnType<ReturnType<typeof createDecartClient>["realtime"]["connect"]>>;

function NoMinutesOverlay({ onBilling }: { onBilling: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-md" style={{ background: "hsl(222 47% 4% / 0.92)" }} />
      <div className="relative z-10 max-w-md w-full mx-4 text-center"
           style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(187 100% 52% / 0.25)",
                    borderRadius: "1.25rem", padding: "2.5rem 2rem",
                    boxShadow: "0 0 80px hsl(187 100% 52% / 0.12)" }}>
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
             style={{ background: "hsl(187 100% 52% / 0.08)", border: "2px solid hsl(187 100% 52% / 0.25)" }}>
          <CreditCard className="w-9 h-9 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-3 font-mono tracking-wide">No Streaming Minutes</h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          You need purchased streaming minutes to use the streaming feature. Visit the <span className="text-primary font-semibold">Billing tab</span> in your dashboard to top up.
        </p>
        <Button className="w-full gap-2 h-12 text-base font-bold tracking-wide" onClick={onBilling}
                style={{ boxShadow: "0 0 24px hsl(187 100% 52% / 0.3)" }}>
          <CreditCard className="w-5 h-5" /> Go to Billing
        </Button>
      </div>
    </div>
  );
}

export default function SubAdminStreamPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const localVideoRef      = useRef<HTMLVideoElement>(null);
  const remoteVideoRef     = useRef<HTMLVideoElement>(null);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  const timerRef           = useRef<NodeJS.Timeout | null>(null);
  const tokenRefreshRef    = useRef<NodeJS.Timeout | null>(null);
  const decartClientRef    = useRef<DecartClient | null>(null);
  const cameraStreamRef    = useRef<MediaStream | null>(null);
  const refImageInputRef   = useRef<HTMLInputElement>(null);
  const activeSessionRef   = useRef<string | null>(null);
  const heartbeatRef       = useRef<NodeJS.Timeout | null>(null);

  const [totalMinutesPurchased, setTotalMinutesPurchased] = useState<number | null>(null);
  const [totalSecondsUsed, setTotalSecondsUsed] = useState(0);
  const [selectedStyle,     setSelectedStyle]     = useState("natural");
  const [isStreaming,       setIsStreaming]        = useState(false);
  const [cameraReady,       setCameraReady]        = useState(false);
  const [elapsedSecs,       setElapsedSecs]        = useState(0);
  const [connectionStatus,  setConnectionStatus]   = useState<"idle"|"connecting"|"connected"|"error"|"dropped">("idle");
  const [customPrompt,      setCustomPrompt]       = useState("");
  const [referenceImage,    setReferenceImage]     = useState<File | null>(null);
  const [referenceImageUrl, setReferenceImageUrl]  = useState<string | null>(null);
  const [cameras,           setCameras]            = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId,  setSelectedCameraId]   = useState<string>("");
  const [isFullscreen,      setIsFullscreen]       = useState(false);
  const [showStylePicker,   setShowStylePicker]    = useState(false);

  const authH = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAdminToken() ?? ""}`,
  }), []);

  // Check auth + fetch balance on mount
  useEffect(() => {
    const tok = getAdminToken();
    if (!tok || localStorage.getItem("fullswap_sub_admin") !== "1") { setLocation("/subadmin"); return; }
    fetch("/api/subadmin/me", { headers: authH() })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { setLocation("/subadmin"); return; }
        setTotalMinutesPurchased(d.totalMinutesPurchased ?? 0);
        setTotalSecondsUsed(0); // reset display
      })
      .catch(() => setLocation("/subadmin"));
  }, [authH, setLocation]);

  // Fullscreen listener
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Camera
  async function enumerateCameras() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const cams = devs.filter(d => d.kind === "videoinput");
      setCameras(cams);
    } catch { /* ignore */ }
  }

  async function startCamera(deviceId?: string) {
    try {
      if (cameraStreamRef.current) cameraStreamRef.current.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { width: 1280, height: 720, facingMode: "user" },
        audio: true,
      });
      cameraStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCameraReady(true);
      await enumerateCameras();
    } catch {
      toast({ title: "Camera access denied", description: "Allow camera and microphone access", variant: "destructive" });
    }
  }

  async function switchCamera(deviceId: string) {
    setSelectedCameraId(deviceId);
    await startCamera(deviceId);
  }

  useEffect(() => {
    startCamera();
    return () => { cameraStreamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  // Stop stream helper
  const stopStreamInternally = useCallback(async (sessionId: string, elapsed: number, navigate = true) => {
    // Stop timer and heartbeat
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    if (tokenRefreshRef.current) { clearTimeout(tokenRefreshRef.current); tokenRefreshRef.current = null; }

    // Disconnect Decart
    decartClientRef.current?.disconnect();
    decartClientRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    activeSessionRef.current = null;

    try { await fetch(`/api/sessions/${sessionId}/stop`, { method: "POST", headers: authH() }); } catch { /* ignore */ }

    setIsStreaming(false);
    setElapsedSecs(0);
    setConnectionStatus("idle");
    if (navigate) setLocation("/subadmin/dashboard");
  }, [authH, setLocation]);

  // Start streaming
  async function startStreaming() {
    if (!cameraStreamRef.current) { toast({ title: "Camera not ready", variant: "destructive" }); return; }
    if ((totalMinutesPurchased ?? 0) <= 0) return;

    setConnectionStatus("connecting");

    try {
      // Start session
      const sessRes = await fetch("/api/sessions", {
        method: "POST", headers: authH(),
        body: JSON.stringify({ style: selectedStyle }),
      });
      if (!sessRes.ok) {
        const d = await sessRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to start session");
      }
      const session = await sessRes.json();
      activeSessionRef.current = session.id;

      // Fetch Decart token
      const apiKey = await fetchDecartToken();
      const client = createDecartClient({ apiKey });

      // Schedule token refresh (55 min)
      tokenRefreshRef.current = setTimeout(async () => {
        try {
          const newKey = await fetchDecartToken();
          (decartClientRef.current as any)?.updateToken(newKey);
        } catch { /* ignore */ }
      }, 55 * 60 * 1000);

      // Build prompt
      const style = STYLES.find(s => s.id === selectedStyle);
      const prompt = customPrompt.trim() || style?.prompt || "";

      const refImageData: string | undefined = referenceImage
        ? await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = e => resolve((e.target?.result as string)?.split(",")[1]);
            reader.readAsDataURL(referenceImage);
          })
        : undefined;

      // Connect Decart
      const connected = await (client.realtime as any).connect({
        stream: cameraStreamRef.current,
        model: LUCY_MODEL,
        prompt,
        ...(refImageData ? { referenceImage: refImageData } : {}),
        onRemoteStream: (editedStream: MediaStream) => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = editedStream;
          if (timerRef.current) return;
          // Mark billing start
          if (activeSessionRef.current) {
            fetch(`/api/sessions/${activeSessionRef.current}/output-started`, { method: "POST", headers: authH() }).catch(() => {});
          }
          // Start timer
          timerRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
          setConnectionStatus("connected");
          setIsStreaming(true);
          toast({ title: "Stream live" });
        },
        onConnectionChange: (status: string) => {
          if (status === "disconnected" && isStreaming) setConnectionStatus("dropped");
        },
      });
      decartClientRef.current = connected;

      // Heartbeat every 15s
      heartbeatRef.current = setInterval(() => {
        if (activeSessionRef.current) {
          fetch(`/api/sessions/${activeSessionRef.current}/heartbeat`, { method: "POST", headers: authH() }).catch(() => {});
        }
      }, 15000);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start stream";
      setConnectionStatus("error");
      toast({ title: "Stream failed", description: msg, variant: "destructive" });
      if (activeSessionRef.current) {
        await stopStreamInternally(activeSessionRef.current, elapsedSecs, false);
      }
    }
  }

  async function stopStreaming() {
    if (activeSessionRef.current) {
      await stopStreamInternally(activeSessionRef.current, elapsedSecs, false);
    }
    setIsStreaming(false);
    setConnectionStatus("idle");
  }

  function handleFullscreen() {
    if (!document.fullscreenElement && outputContainerRef.current) {
      outputContainerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }

  const selectedStyleData = STYLES.find(s => s.id === selectedStyle);
  const hasMinutes = (totalMinutesPurchased ?? 0) > 0;

  if (totalMinutesPurchased === null) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: "hsl(222 47% 4%)" }}>
      {!hasMinutes && <NoMinutesOverlay onBilling={() => setLocation("/subadmin/dashboard")} />}

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-sm px-6 py-3 flex items-center gap-3">
        <Button size="sm" variant="ghost" className="gap-2 text-muted-foreground" onClick={() => {
          if (isStreaming && activeSessionRef.current) stopStreamInternally(activeSessionRef.current, elapsedSecs);
          else setLocation("/subadmin/dashboard");
        }}>
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Button>
        <div className="flex items-center gap-2 ml-2">
          <UserCog className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold font-mono text-foreground">FULL SWAP BY RICH</span>
          <span className="text-xs text-muted-foreground">Sub Admin Stream</span>
        </div>
        {isStreaming && (
          <div className="ml-auto flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-sm font-mono text-foreground">{formatTime(elapsedSecs)}</span>
          </div>
        )}
        {hasMinutes && !isStreaming && (
          <div className="ml-auto text-xs text-muted-foreground">
            {totalMinutesPurchased} min available
          </div>
        )}
      </header>

      <div className="p-4 lg:p-6 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* LEFT: Output */}
          <div className="lg:col-span-2 space-y-4">
            {/* Main output video */}
            <div
              ref={outputContainerRef}
              className="relative rounded-2xl overflow-hidden"
              style={{
                ...(isFullscreen ? { position: "fixed", inset: 0, borderRadius: 0, zIndex: 100, width: "100vw", height: "100vh" }
                               : { width: "100%", aspectRatio: "16/9",
                                   boxShadow: connectionStatus === "connected"
                                     ? "0 0 40px hsl(187 100% 52% / 0.25), 0 0 0 1px hsl(187 100% 52% / 0.15)"
                                     : "0 0 0 1px hsl(222 40% 14%)" })
              }}
              data-testid="transform-output"
            >
              {/* FIX: scaleX(-1) mirrors AI output to match local webcam preview orientation */}
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />

              {/* Idle placeholder */}
              {connectionStatus === "idle" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4"
                     style={{ zIndex: 1, background: "radial-gradient(ellipse at center, hsl(222 44% 8%) 0%, hsl(222 47% 4%) 100%)" }}>
                  <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Zap className="w-10 h-10 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-base font-semibold text-foreground">Real Time Output</p>
                    <p className="text-sm text-muted-foreground mt-1">Start streaming to see your transformation</p>
                  </div>
                </div>
              )}

              {/* Connecting */}
              {connectionStatus === "connecting" && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-4" style={{ zIndex: 1 }}>
                  <Loader2 className="w-12 h-12 text-primary animate-spin" />
                  <p className="text-sm text-primary font-mono tracking-wide">Connecting to stream...</p>
                </div>
              )}

              {/* Labels */}
              <div className="absolute top-3 left-3 flex flex-col items-start gap-2" style={{ zIndex: 20 }}>
                <div className="px-3 py-1 bg-black/60 rounded-full text-[11px] text-white/80 font-mono tracking-widest">REAL TIME OUTPUT</div>
                {isFullscreen && (
                  <button onClick={() => { if (activeSessionRef.current) stopStreamInternally(activeSessionRef.current, elapsedSecs); setIsFullscreen(false); }}
                    className="flex items-center justify-center w-8 h-8 rounded-full"
                    style={{ background: "rgba(220,38,38,0.75)", color: "#fff", border: "1px solid rgba(255,100,100,0.4)" }}>
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {connectionStatus === "connected" && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full bg-primary/90 text-primary-foreground text-[11px] font-bold font-mono tracking-wide" style={{ zIndex: 10 }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
                </div>
              )}
              {!isFullscreen && (
                <button onClick={handleFullscreen} title="Fullscreen"
                  className="absolute top-3 right-3 flex items-center justify-center w-8 h-8 rounded-full"
                  style={{ zIndex: 20, background: "rgba(0,0,0,0.55)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}>
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              )}

              {/* PiP camera */}
              {!isFullscreen && (
                <div className="absolute bottom-3 left-3 rounded-xl overflow-hidden border border-white/20 bg-black"
                     style={{ width: "22%", aspectRatio: "16/9", boxShadow: "0 4px 20px rgba(0,0,0,0.6)", zIndex: 10 }}>
                  <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
                  {!cameraReady && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-2 p-2">
                      <Camera className="w-5 h-5 text-muted-foreground" />
                      <button onClick={() => startCamera()} className="text-[10px] text-primary font-semibold underline cursor-pointer">Enable Camera</button>
                    </div>
                  )}
                  <div className="absolute bottom-1 left-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white/70 font-mono tracking-widest truncate">INPUT</div>
                </div>
              )}
            </div>

            {/* Camera selector */}
            {cameras.length > 1 && (
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-muted-foreground shrink-0" />
                <select value={selectedCameraId} onChange={e => switchCamera(e.target.value)}
                  className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground">
                  {cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${c.deviceId.slice(0,8)}`}</option>)}
                </select>
              </div>
            )}

            {/* Start / Stop */}
            <div className="flex gap-3">
              {!isStreaming ? (
                <Button onClick={startStreaming} disabled={!cameraReady || !hasMinutes || connectionStatus === "connecting"}
                  className="flex-1 h-12 text-base font-bold gap-3"
                  style={{ boxShadow: "0 0 24px hsl(187 100% 52% / 0.3)" }}>
                  {connectionStatus === "connecting"
                    ? <><Loader2 className="w-5 h-5 animate-spin" /> Connecting...</>
                    : <><Play className="w-5 h-5" /> Start Stream</>}
                </Button>
              ) : (
                <Button onClick={stopStreaming} variant="destructive" className="flex-1 h-12 text-base font-bold gap-3">
                  <Square className="w-5 h-5" /> Stop Stream
                </Button>
              )}
            </div>
          </div>

          {/* RIGHT: Controls */}
          <div className="space-y-4">
            {/* Style picker */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 12%)" }}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground mb-1 tracking-wide">Transformation Style</h3>
                <button onClick={() => setShowStylePicker(v => !v)} className="text-muted-foreground hover:text-foreground">
                  <ChevronDown className={`w-4 h-4 transition-transform ${showStylePicker ? "rotate-180" : ""}`} />
                </button>
              </div>

              {/* Active style */}
              {!showStylePicker && selectedStyleData && (
                <button onClick={() => setShowStylePicker(true)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left"
                  style={{ background: "hsl(187 100% 52% / 0.08)", border: "1px solid hsl(187 100% 52% / 0.3)" }}>
                  <Zap className="w-4 h-4 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-foreground">{selectedStyleData.name}</p>
                    <p className="text-xs text-muted-foreground">{selectedStyleData.description}</p>
                  </div>
                </button>
              )}

              {/* Style grid */}
              {showStylePicker && (
                <div className="grid grid-cols-1 gap-2">
                  {STYLES.map(style => (
                    <button key={style.id} onClick={() => { setSelectedStyle(style.id); setShowStylePicker(false); }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                      style={{
                        background: selectedStyle === style.id ? "hsl(187 100% 52% / 0.08)" : "hsl(222 47% 5%)",
                        border: selectedStyle === style.id ? "1px solid hsl(187 100% 52% / 0.3)" : "1px solid hsl(222 40% 12%)",
                      }}>
                      <Zap className={`w-4 h-4 shrink-0 ${selectedStyle === style.id ? "text-primary" : "text-muted-foreground"}`} />
                      <div>
                        <p className={`text-sm font-bold ${selectedStyle === style.id ? "text-primary" : "text-foreground"}`}>{style.name}</p>
                        <p className="text-xs text-muted-foreground">{style.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Reference image */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 12%)" }}>
              <h3 className="font-semibold text-foreground tracking-wide">Reference Image</h3>
              <input ref={refImageInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0] ?? null;
                  setReferenceImage(f);
                  setReferenceImageUrl(f ? URL.createObjectURL(f) : null);
                }} />
              {referenceImageUrl ? (
                <div className="relative">
                  <img src={referenceImageUrl} alt="Reference" className="w-full rounded-lg object-cover" style={{ maxHeight: "160px" }} />
                  <button onClick={() => { setReferenceImage(null); setReferenceImageUrl(null); if (refImageInputRef.current) refImageInputRef.current.value = ""; }}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center text-white hover:bg-black/90">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button onClick={() => refImageInputRef.current?.click()}
                  className="w-full h-24 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 hover:border-primary/40 transition-colors">
                  <ImagePlus className="w-6 h-6 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Upload face or style reference</span>
                </button>
              )}
            </div>

            {/* Custom prompt */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: "hsl(222 44% 6%)", border: "1px solid hsl(222 40% 12%)" }}>
              <h3 className="font-semibold text-foreground tracking-wide">Custom Prompt</h3>
              <textarea
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                placeholder={selectedStyleData?.prompt ?? "Describe the transformation..."}
                rows={3}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Refresh style */}
            {isStreaming && (
              <Button variant="outline" className="w-full gap-2" onClick={async () => {
                try { await (decartClientRef.current as any)?.updatePrompt(customPrompt.trim() || selectedStyleData?.prompt || ""); }
                catch { /* ignore */ }
              }}>
                <RefreshCw className="w-4 h-4" /> Apply Style
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
