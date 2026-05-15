import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useStartSession, useStopSession, getGetUserDashboardQueryKey, useGetUserDashboard } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, Camera, Zap, Monitor, Loader2, ImagePlus, X, CreditCard, Lock, Maximize2, RefreshCw, ChevronDown, Key, AlertCircle, CheckCircle, Timer } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { createDecartClient, models } from "@decartai/sdk";
import { Link } from "wouter";
import { useLicense } from "@/hooks/useLicense";
import { LicenseActivationModal } from "@/components/license-modal";

const LUCY_MODEL = "lucy-2.1" as const;
const FREE_TRIAL_SECS = 50;

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
  const licenseKey = localStorage.getItem("fullswap_license_key");
  if (!licenseKey) {
    window.location.href = "/";
    throw new Error("License key required.");
  }
  const res = await fetch("/api/decart/token", {
    headers: { "X-License-Key": licenseKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      window.location.href = "/";
      throw new Error("Session expired. Please log in again.");
    }
    throw new Error(body.error ?? "Failed to fetch Decart token from server");
  }
  const data = await res.json();
  return data.apiKey as string;
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

type DecartClient = Awaited<ReturnType<ReturnType<typeof createDecartClient>["realtime"]["connect"]>>;

function TrialLockedOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-md" style={{ background: "hsl(222 47% 4% / 0.92)" }} />
      <div className="relative z-10 max-w-md w-full mx-4 text-center"
           style={{
             background: "hsl(222 44% 6%)",
             border: "1px solid hsl(187 100% 52% / 0.25)",
             borderRadius: "1.25rem",
             padding: "2.5rem 2rem",
             boxShadow: "0 0 80px hsl(187 100% 52% / 0.12), 0 0 0 1px hsl(187 100% 52% / 0.08)",
           }}>
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
             style={{ background: "hsl(187 100% 52% / 0.08)", border: "2px solid hsl(187 100% 52% / 0.25)" }}>
          <Lock className="w-9 h-9 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-3 font-mono tracking-wide">Free Trial Ended</h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-2">
          Your <span className="text-primary font-semibold">1 minute 30 second</span> free trial has been used up.
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          Purchase streaming time to unlock the stream window and continue your real time video transformation.
        </p>
        <div className="flex items-center justify-center gap-6 mb-8 py-4 rounded-xl"
             style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(222 40% 11%)" }}>
          <div className="text-center">
            <p className="text-2xl font-bold text-primary font-mono">1:30</p>
            <p className="text-xs text-muted-foreground mt-1">Trial Used</p>
          </div>
          <div className="w-px h-10" style={{ background: "hsl(222 40% 14%)" }} />
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground font-mono">$0</p>
            <p className="text-xs text-muted-foreground mt-1">Paid So Far</p>
          </div>
          <div className="w-px h-10" style={{ background: "hsl(222 40% 14%)" }} />
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground font-mono">∞</p>
            <p className="text-xs text-muted-foreground mt-1">Styles Available</p>
          </div>
        </div>
        <Link href="/billing">
          <Button className="w-full gap-2 h-12 text-base font-bold tracking-wide"
                  style={{ boxShadow: "0 0 24px hsl(187 100% 52% / 0.3)" }}>
            <CreditCard className="w-5 h-5" />
            Purchase Streaming Time
          </Button>
        </Link>
        <p className="text-xs text-muted-foreground mt-4">
          Pay with USDT · Instant activation after payment confirmation
        </p>
      </div>
    </div>
  );
}

function NoAccessOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-md" style={{ background: "hsl(222 47% 4% / 0.92)" }} />
      <div className="relative z-10 max-w-md w-full mx-4 text-center"
           style={{
             background: "hsl(222 44% 6%)",
             border: "1px solid hsl(187 100% 52% / 0.25)",
             borderRadius: "1.25rem",
             padding: "2.5rem 2rem",
             boxShadow: "0 0 80px hsl(187 100% 52% / 0.12), 0 0 0 1px hsl(187 100% 52% / 0.08)",
           }}>
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
             style={{ background: "hsl(187 100% 52% / 0.08)", border: "2px solid hsl(187 100% 52% / 0.25)" }}>
          <Lock className="w-9 h-9 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-3 font-mono tracking-wide">No Streaming Time</h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          You have no streaming time remaining. Purchase streaming time to access the stream window and start your real time video transformation.
        </p>
        <Link href="/billing">
          <Button className="w-full gap-2 h-12 text-base font-bold tracking-wide"
                  style={{ boxShadow: "0 0 24px hsl(187 100% 52% / 0.3)" }}>
            <CreditCard className="w-5 h-5" />
            Purchase Streaming Time
          </Button>
        </Link>
        <p className="text-xs text-muted-foreground mt-4">
          Pay with USDT · Instant activation after payment confirmation
        </p>
      </div>
    </div>
  );
}

export default function StreamPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const localVideoRef      = useRef<HTMLVideoElement>(null);
  const remoteVideoRef     = useRef<HTMLVideoElement>(null);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  const timerRef              = useRef<NodeJS.Timeout | null>(null);
  // FIX: Ref mirror for elapsedSecs so heartbeat can read latest value
  // without adding elapsedSecs to the heartbeat useEffect dependency array.
  const elapsedSecsRef        = useRef<number>(0);
  const tokenRefreshRef       = useRef<NodeJS.Timeout | null>(null);
  const decartClientRef       = useRef<DecartClient | null>(null);
  const prewarmedTokenRef     = useRef<string | null>(null);   // pre-fetched before click
  const prewarmedTokenExpiry  = useRef<number>(0);             // expiry timestamp (ms)
  const cameraStreamRef       = useRef<MediaStream | null>(null);
  const refImageInputRef      = useRef<HTMLInputElement>(null);
  const trialLimitRef         = useRef<number>(Infinity);
  const activeSessionRef      = useRef<string | null>(null);
  const connectionStatusRef   = useRef<"idle"|"connecting"|"connected"|"error"|"dropped">("idle");

  const [activeSession,     setActiveSession]     = useState<string | null>(null);
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
  const [isFullscreen,      setIsFullscreen]        = useState(false);
  // Bug #5: track when license minutes are fully exhausted to show splash screen
  const [licenseExhausted,  setLicenseExhausted]   = useState(false);
  const [isStreamStarting,  setIsStreamStarting]   = useState(false);

  // Desktop license gate
  const { isElectron, isLicensed, isLoading: licenseLoading, error: licenseError, activateLicense } = useLicense();

  const handleBuyKey = useCallback(() => {
    const buyUrl = "https://fullswapbyrich.xyz/billing";
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(buyUrl);
    } else {
      window.open(buyUrl, "_blank");
    }
  }, []);

  // ── License renewal ─────────────────────────────────────────────────
  const [renewKey, setRenewKey] = useState<string>("");
  const [renewLoading, setRenewLoading] = useState<boolean>(false);
  const [renewMsg, setRenewMsg] = useState<string | null>(null);
  const [renewOk, setRenewOk] = useState<boolean>(false);

  const startSession = useStartSession({ mutation: {} });
  const stopSession  = useStopSession({ mutation: {} });
  const dashboard    = useGetUserDashboard({
    query: {
      queryKey: getGetUserDashboardQueryKey(),
    },
  });

  const user          = dashboard.data?.user;
  const isAdminUser   = !!(user?.isAdmin);
  const isFreeTrial   = user?.membership === "free_trial";
  const freeSecsLeft  = user?.freeSecondsRemaining ?? 0;
  const hasPaidTime        = (user?.totalMinutesPurchased ?? 0) > (user?.totalMinutesUsed ?? 0);
  const paidMinsRemaining  = Math.max(0, (user?.totalMinutesPurchased ?? 0) - (user?.totalMinutesUsed ?? 0));
  const totalAvailableSecs = paidMinsRemaining * 60 + (isFreeTrial ? freeSecsLeft : 0);
  const trialLocked        = dashboard.isSuccess && !isAdminUser && isFreeTrial && freeSecsLeft <= 0 && !hasPaidTime;
  const noAccess           = dashboard.isSuccess && !isAdminUser && totalAvailableSecs <= 0;

  // Keep connectionStatusRef in sync so interval callbacks always read the latest value
  useEffect(() => { connectionStatusRef.current = connectionStatus; }, [connectionStatus]);

  useEffect(() => {
    if (!localStorage.getItem("fullswap_license_key")) setLocation("/");
  }, [setLocation]);

  useEffect(() => {
    return () => { if (referenceImageUrl) URL.revokeObjectURL(referenceImageUrl); };
  }, [referenceImageUrl]);

  const selectedStyleData = STYLES.find(s => s.id === selectedStyle);

  const stopStreamInternally = useCallback(async (sessionId: string, secs: number, trialExpired = false) => {
    if (timerRef.current)        clearInterval(timerRef.current);
    timerRef.current = null;  // must null so next stream's first-frame guard works correctly
    if (tokenRefreshRef.current) clearInterval(tokenRefreshRef.current);
    tokenRefreshRef.current = null;
    decartClientRef.current?.disconnect();
    decartClientRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    activeSessionRef.current = null;

    try {
      await stopSession.mutateAsync({ sessionId });
      queryClient.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
      dashboard.refetch();
    } catch { /* best effort */ }

    setIsStreaming(false);
    setActiveSession(null);
    setElapsedSecs(0);
    setConnectionStatus("idle");

    if (!trialExpired) {
      toast({ title: "Session stopped", description: `Streamed for ${formatTime(secs)}` });
    }
  }, [stopSession, queryClient, dashboard, toast]);

  const enumerateCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === "videoinput");
      setCameras(videoDevices);
      if (videoDevices.length > 0) {
        setSelectedCameraId(prev => prev || videoDevices[0]!.deviceId);
      }
    } catch { /* ignore */ }
  }, []);

  // Auto-detect all cameras on page load and when devices change (plug/unplug)
  useEffect(() => {
    enumerateCameras();
    navigator.mediaDevices.addEventListener("devicechange", enumerateCameras);
    return () => navigator.mediaDevices.removeEventListener("devicechange", enumerateCameras);
  }, [enumerateCameras]);

  const startCamera = async (deviceId?: string) => {
    try {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }
      const model = models.realtime(LUCY_MODEL);
      const videoConstraints: MediaTrackConstraints = {
        frameRate: model.fps,
        width: model.width,
        height: model.height,
      };
      if (deviceId || selectedCameraId) {
        videoConstraints.deviceId = { exact: deviceId || selectedCameraId };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: videoConstraints,
      });
      cameraStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCameraReady(true);
      await enumerateCameras();
    } catch {
      toast({ title: "Camera access denied", description: "Please allow camera and microphone access", variant: "destructive" });
    }
  };

  const handleCameraSwitch = async (deviceId: string) => {
    setSelectedCameraId(deviceId);
    if (cameraReady) await startCamera(deviceId);
  };

  const handleReferenceImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file (JPG, PNG, WebP)", variant: "destructive" });
      return;
    }
    if (referenceImageUrl) URL.revokeObjectURL(referenceImageUrl);
    setReferenceImage(file);
    setReferenceImageUrl(URL.createObjectURL(file));
    if (decartClientRef.current && isStreaming) {
      try {
        await decartClientRef.current.setImage(file, { prompt: customPrompt || selectedStyleData?.prompt });
        toast({ title: "Reference image applied" });
      } catch { /* non-fatal */ }
    }
    e.target.value = "";
  };

  const handleClearReferenceImage = async () => {
    if (referenceImageUrl) URL.revokeObjectURL(referenceImageUrl);
    setReferenceImage(null);
    setReferenceImageUrl(null);
    if (decartClientRef.current && isStreaming) {
      try { await decartClientRef.current.setImage(null); } catch { /* non-fatal */ }
    }
  };

  const handleStartStream = async () => {
    // FIX #3: Debounce rapid re-clicks during startup to prevent duplicate sessions
    if (isStreamStarting) return;
    setIsStreamStarting(true);

    // Desktop license guard
    if (typeof window !== "undefined" && (window as any).electronAPI?.isElectron) {
      const licCheck = await (window as any).electronAPI.license.check().catch(() => ({ licensed: false }));
      if (!licCheck.licensed) {
        setIsStreamStarting(false);
        return;
      }
    }

    if (!cameraReady || !cameraStreamRef.current) {
      toast({ title: "Camera not ready", description: "Please enable your camera first", variant: "destructive" });
      setIsStreamStarting(false);
      return;
    }

    // Guard: verify WebRTC is available before attempting to use the Decart SDK
    if (typeof RTCPeerConnection === "undefined" || !RTCPeerConnection) {
      toast({
        title: "WebRTC not supported",
        description: "Your browser doesn't support WebRTC. Please use Chrome, Firefox, Safari, or Edge.",
        variant: "destructive",
      });
      setIsStreamStarting(false);
      return;
    }

    // Guard: verify the Decart SDK exported correctly
    if (typeof createDecartClient !== "function") {
      console.error("[Decart] createDecartClient is not available:", createDecartClient);
      toast({ title: "SDK error", description: "Streaming SDK failed to load. Please refresh the page.", variant: "destructive" });
      setIsStreamStarting(false);
      return;
    }

    try {
      // Fire session creation and token fetch in parallel — they are independent
      setIsStreaming(true);
      setElapsedSecs(0);
      setConnectionStatus("connecting");

      // Use pre-warmed token if fresh (saves ~1-2s), otherwise fetch now
      const cachedToken = prewarmedTokenRef.current;
      const tokenIsFresh = !!cachedToken && prewarmedTokenExpiry.current > Date.now() + 30_000;
      if (tokenIsFresh) prewarmedTokenRef.current = null; // consume once
      const tokenPromise = tokenIsFresh ? Promise.resolve(cachedToken!) : fetchDecartToken();

      const [session, shortLivedKey] = await Promise.all([
        startSession.mutateAsync({ data: { style: selectedStyle } }),
        tokenPromise,
      ]);

      const sessionId = session.id;
      setActiveSession(sessionId);
      activeSessionRef.current = sessionId;
      setIsStreamStarting(false);

      const paidSecsRemaining = Math.max(0, ((user?.totalMinutesPurchased ?? 0) - (user?.totalMinutesUsed ?? 0)) * 60);
      const totalAvailableSecs = (isFreeTrial ? freeSecsLeft : 0) + paidSecsRemaining;
      trialLimitRef.current = isAdminUser ? Infinity : (totalAvailableSecs > 0 ? totalAvailableSecs : Infinity);

      // Timer starts only when Decart output actually appears — not here at click time
      let elapsed = 0;

      const model = models.realtime(LUCY_MODEL);

      console.info("[Decart] Initialising SDK client with model:", LUCY_MODEL, "| enhance: false (real-time mode)");
      let client;
      try {
        client = createDecartClient({ apiKey: shortLivedKey });
      } catch (sdkErr) {
        console.error("[Decart] SDK createDecartClient failed:", sdkErr);
        throw new Error("Streaming SDK failed to initialise. Please refresh and try again.");
      }
      const prompt = customPrompt || selectedStyleData?.prompt || "A person with a natural, realistic face";

      const realtimeClient = await client.realtime.connect(cameraStreamRef.current, {
        model,
        initialState: {
          prompt: { text: prompt, enhance: false },
          ...(referenceImage ? { image: referenceImage } : {}),
        },
        onRemoteStream: (editedStream) => {
          // Update video element on every frame (lightweight, no React state)
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = editedStream;

          // Only run first-frame logic once — skip all state updates after the first frame
          if (timerRef.current) return;

          const frameTs = performance.now();
          console.info("[Decart] First remote frame at", frameTs.toFixed(1), "ms — stream live");
          setConnectionStatus("connected"); // called ONCE on first frame only

          // Now start the visible timer — only increments while the live feed is connected
          timerRef.current = setInterval(() => {
            if (connectionStatusRef.current !== "connected") return;
            elapsed += 1;
            setElapsedSecs(elapsed);
            elapsedSecsRef.current = elapsed;
            if (elapsed >= trialLimitRef.current) {
              // Bug #5: show splash screen when minutes reach zero
              setLicenseExhausted(true);
              stopStreamInternally(sessionId, elapsed, isFreeTrial);
            }
          }, 1000);
        },
        onStatus: (status) => {
          // Backup: transition to connected when SDK signals ready
          // (fires before first remote frame, ensures overlay hides promptly)
          if (status === "connected") setConnectionStatus("connected");
        },
        onConnectionStateChange: (state) => {
          console.info("[Decart] Connection state →", state);
          if (state === "disconnected" || state === "failed") {
            connectionStatusRef.current = "dropped";
            setConnectionStatus("dropped");
            toast({
              title: "Stream disconnected",
              description: "Connection lost — click Stream Now to reconnect.",
              variant: "destructive",
            });
          }
        },
        onError: (err) => {
          const msg = (err as any)?.message ?? "Stream error — please try again.";
          console.error("[Decart] Stream error:", msg);
          setConnectionStatus("error");
          toast({ title: "Stream error", description: msg, variant: "destructive" });
        },
      });

      decartClientRef.current = realtimeClient;
      console.info("[Decart] SDK client connected successfully. Waiting for first remote frame...");

      // ── Loophole fix #3: bill from connect-resolved, not from first frame ──
      // Decart's WebRTC peer is now established and Lucy 2.1 is metering wall-clock
      // seconds against our API key. Stamp billingStartedAt server-side NOW so our
      // incremental debit covers the same window Decart bills us for.
      {
        const licKey = localStorage.getItem("fullswap_license_key") ?? "";
        fetch(`/api/sessions/${sessionId}/output-started`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-License-Key": licKey },
        }).catch(() => {});
      }

      if (isFreeTrial) {
        toast({
          title: "Free trial started",
          description: `You have ${formatTime(freeSecsLeft)} — stream will auto-stop when trial ends`,
        });
      } else {
        toast({ title: "Session started", description: "Stream is live — Real Time transformation active" });
      }
    } catch (err: unknown) {
      setConnectionStatus("error");
      setIsStreaming(false);
      setActiveSession(null);
      setIsStreamStarting(false);
      if (timerRef.current)        clearInterval(timerRef.current);
      if (tokenRefreshRef.current) clearInterval(tokenRefreshRef.current);
      // BILLING-FIX: Immediately stop failed/errored session to prevent orphan.
      // If Decart connection failed after DB session was created, the 1-second
      // reservation is settled and the session closed — no 45s sweeper wait.
      const failedSid = activeSessionRef.current;
      activeSessionRef.current = null;
      if (failedSid) {
        const licKey = localStorage.getItem("fullswap_license_key") ?? "";
        console.info(`[Stream] session_failed_cleanup sessionId=${failedSid}`);
        fetch(`/api/sessions/${failedSid}/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-License-Key": licKey },
          body: JSON.stringify({}),
          keepalive: true,
        }).catch(() => {});
      }
      const errMsg = err instanceof Error ? err.message : "Could not connect";
      if (errMsg.toLowerCase().includes("401") || errMsg.toLowerCase().includes("unauthorized") || errMsg.toLowerCase().includes("expired")) {
        localStorage.removeItem("fullswap_license_key");
        toast({ title: "License expired", description: "Please renew your license key.", variant: "destructive" });
        setTimeout(() => setLocation("/"), 1800);
        return;
      }
      toast({ title: "Cannot start session", description: errMsg, variant: "destructive" });
    }
  };

  const handleStopStream = async () => {
    if (activeSession) {
      // BILLING-FIX: Log close button stop for billing audit trail
      console.info(`[Stream] close_button_stop sessionId=${activeSession} elapsed=${elapsedSecs}s`);
      await stopStreamInternally(activeSession, elapsedSecs, false);
    }
  };

  const handleStyleChange = async (styleId: string) => {
    setSelectedStyle(styleId);
    if (!decartClientRef.current || !isStreaming) return;
    const style = STYLES.find(s => s.id === styleId);
    try { await decartClientRef.current.set({ prompt: customPrompt || style?.prompt || "", enhance: false }); } catch { /* non-fatal */ }
  };

  const handlePromptChange = async (prompt: string) => {
    setCustomPrompt(prompt);
    if (!decartClientRef.current || !isStreaming) return;
    try { await decartClientRef.current.setPrompt(prompt || selectedStyleData?.prompt || "", { enhance: false }); } catch { /* non-fatal */ }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current)        clearInterval(timerRef.current);
      if (tokenRefreshRef.current) clearInterval(tokenRefreshRef.current);
      decartClientRef.current?.disconnect();
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      const sid = activeSessionRef.current;
      if (sid) {
        const licKey = localStorage.getItem("fullswap_license_key") ?? "";
        fetch(`/api/sessions/${sid}/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-License-Key": licKey },
          body: JSON.stringify({}),
          keepalive: true,
        }).catch(() => {});
        activeSessionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    function handleUnload() {
      const sid = activeSessionRef.current;
      if (!sid) return;
      const licKey = localStorage.getItem("fullswap_license_key") ?? "";
      // ── Loophole fix #2: navigator.sendBeacon is the ONLY transport the
      // browser guarantees to flush during pagehide / tab-close. fetch+keepalive
      // is best-effort and is silently dropped on many mobile browsers when the
      // tab is killed by the OS. We send both for belt-and-braces.
      const url = `/api/sessions/${sid}/stop`;
      try {
        const blob = new Blob(
          [JSON.stringify({ licenseKey: licKey })],
          { type: "application/json" },
        );
        const ok = typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
          ? navigator.sendBeacon(url + `?licenseKey=${encodeURIComponent(licKey)}`, blob)
          : false;
        if (!ok) {
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-License-Key": licKey },
            body: JSON.stringify({}),
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-License-Key": licKey },
          body: JSON.stringify({}),
          keepalive: true,
        }).catch(() => {});
      }
      activeSessionRef.current = null;
    }
    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  // Heartbeat — ping the server every 10s while streaming.
  // The server re-checks the user's live balance on each ping.
  // FREEZE DETECTION: 3 consecutive failures (30s) = stream is frozen →
  // auto-kill the session immediately to stop wasting Decart credits.
  useEffect(() => {
    if (!isStreaming || !activeSession) return;
    let consecutiveFailures = 0;
    const MAX_FAILURES = 3; // 3 × 10s = 30s of silence → treat as frozen

    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${activeSession}/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-License-Key": (localStorage.getItem("fullswap_license_key") ?? "") },
          signal: AbortSignal.timeout(8_000), // 8s timeout per heartbeat
        });

        if (res.ok) {
          consecutiveFailures = 0; // reset on success
          const data: { ok: boolean; reason?: string } = await res.json();
          if (data.ok === false && data.reason === "no_time") {
            toast({
              title: "Streaming time exhausted",
              description: "You have run out of streaming minutes. Please purchase more time to continue.",
              variant: "destructive",
            });
            setLicenseExhausted(true);
            const sid = activeSessionRef.current;
            if (sid) stopStreamInternally(sid, elapsedSecsRef.current, true);
          }
        } else {
          consecutiveFailures++;
        }
      } catch {
        // Network error or timeout counts as a failure
        consecutiveFailures++;
        console.warn(`[Stream] heartbeat_fail consecutiveFailures=${consecutiveFailures}/${MAX_FAILURES}`);
      }

      // ── Freeze detected — kill stream to save Decart credits ─────────────
      if (consecutiveFailures >= MAX_FAILURES) {
        const sid = activeSessionRef.current;
        console.warn(`[Stream] freeze_detected sessionId=${sid} — killing stream after ${consecutiveFailures} failed heartbeats`);
        toast({
          title: "Stream connection lost",
          description: "The streaming connection froze. Your session has been stopped to protect your credits.",
          variant: "destructive",
        });
        if (sid) stopStreamInternally(sid, elapsedSecsRef.current, false);
      }
    }, 10_000); // 10s — well under the server's 20s HEARTBEAT_GRACE_MS

    return () => clearInterval(id);
  // elapsedSecs removed from deps — read via elapsedSecsRef.current instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, activeSession, stopStreamInternally]);

  // FIX #2: Real-time balance sync during active streaming.
  // Poll dashboard every 15s to refresh UI with actual server-side balance (usedSeconds).
  // This prevents stale frontend estimates from diverging from actual billing.
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => {
      dashboard.refetch();
    }, 15_000); // 15s — sync every 15s during active stream
    return () => clearInterval(id);
  }, [isStreaming, dashboard]);

  // ── License renewal handler ──────────────────────────────────────────
  const handleRenewLicense = useCallback(async () => {
    const trimmedKey = renewKey.trim().toUpperCase();
    if (!trimmedKey) return;
    setRenewLoading(true);
    setRenewMsg(null);
    try {
      const res = await fetch("/api/license/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmedKey, deviceId: "web-browser" }),
      });
      const data = await res.json();
      if (data.valid) {
        localStorage.setItem("fullswap_license_key", trimmedKey);
        setLicenseExhausted(false); // reset exhaustion state on new license
        setRenewOk(true);
        const remMins = Math.floor((data.remainingSeconds ?? 0) / 60);
        const allMins = data.minutesAllocated ?? 0;
        setRenewMsg(
          `License activated! ${remMins > 0 ? remMins + " minutes remaining" : allMins + " minutes allocated"}.`
        );
        setRenewKey("");
        queryClient.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
      } else {
        setRenewOk(false);
        setRenewMsg("Invalid license key. " + (data.error ? "(" + data.error + ") " : "") + "Please check your key and try again.");
      }
    } catch {
      setRenewOk(false);
      setRenewMsg("Network error. Please try again.");
    } finally {
      setRenewLoading(false);
    }
  }, [renewKey, queryClient]);
  // Listen for stop/close signals from the popout window
  // Fires when user clicks "Stop Stream" in the popout OR closes the popout window
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data === "fullswap-stop") {
        const sid = activeSessionRef.current;
        if (sid) stopStreamInternally(sid, elapsedSecsRef.current, false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopStreamInternally]);

  // Pre-warm the Decart token as soon as the camera is ready
  // so the first click on "Stream Now" doesn't wait for the API round-trip
  useEffect(() => {
    if (!cameraReady || prewarmedTokenRef.current) return;
    fetchDecartToken()
      .then(key => {
        prewarmedTokenRef.current = key;
        prewarmedTokenExpiry.current = Date.now() + 55 * 60 * 1000; // valid 55 min
        console.info("[Decart] Token pre-warmed — stream start will be instant");
      })
      .catch(() => {}); // silent fail — will retry on click
  }, [cameraReady]);

  // CSS-based fullscreen — works in all contexts including sandboxed iframes
  const handleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Keyboard shortcuts: F to enter, Escape to exit (and stop stream if active)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Always stop the active stream on Escape — regardless of fullscreen state
        const sid = activeSessionRef.current;
        if (sid) {
          // BILLING-FIX: Log ESC key stop for billing audit trail
          console.info(`[Stream] esc_key_stop sessionId=${sid} elapsed=${elapsedSecsRef.current}s`);
          stopStreamInternally(sid, elapsedSecsRef.current, false);
        }
        setIsFullscreen(false);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setIsFullscreen(prev => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stopStreamInternally]);

  const trialSecsRemaining = isFreeTrial ? Math.max(0, freeSecsLeft - elapsedSecs) : 0;
  const trialPct           = isFreeTrial ? Math.max(0, 1 - elapsedSecs / FREE_TRIAL_SECS) : 1;
  const paidSecsRemaining  = Math.max(0, paidMinsRemaining * 60 - (isStreaming ? Math.max(0, elapsedSecs - freeSecsLeft) : 0));

  // ── License deduction bar ────────────────────────────────────────────────
  // Total capacity = everything ever allocated to this key (paid + free trial)
  const totalCapacitySecs    = Math.max(1, (user?.totalMinutesPurchased ?? 0) * 60 + (isFreeTrial ? FREE_TRIAL_SECS : 0));
  // Live remaining ticks down in real-time during streaming (driven by elapsedSecs every 1s)
  const liveRemainingBarSecs = isStreaming
    ? Math.max(0, trialSecsRemaining + paidSecsRemaining)
    : totalAvailableSecs;
  const barPct = Math.max(0, Math.min(1, liveRemainingBarSecs / totalCapacitySecs));

  return (
    <AppLayout>
      {isElectron && licenseLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "hsl(222 47% 4%)" }}>
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      )}
      {(isElectron && !licenseLoading && !isLicensed) && (
        <LicenseActivationModal onActivate={activateLicense} onBuyKey={handleBuyKey} error={licenseError} mode="no-license" />
      )}
      {(noAccess || licenseExhausted) && <LicenseActivationModal onActivate={activateLicense} onBuyKey={handleBuyKey} error={licenseError} mode="exhausted" />}
      {!noAccess && trialLocked && <TrialLockedOverlay />}

      <div className="p-6 lg:p-8 space-y-6" data-testid="stream-page">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-wide">Live Stream</h1>
            <p className="text-muted-foreground mt-1 text-sm">Real-time live video transformation</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Free trial time remaining */}
            {isFreeTrial && !isStreaming && freeSecsLeft > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/30 rounded-lg">
                <Zap className="w-4 h-4 text-primary" />
                <span className="text-primary text-sm font-semibold font-mono">{formatTime(freeSecsLeft)}</span>
                <span className="text-muted-foreground text-xs">free trial left</span>
              </div>
            )}
            {/* Paid minutes remaining */}
            {!isAdminUser && paidMinsRemaining > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
                <CreditCard className="w-4 h-4 text-green-400" />
                <span className="text-green-400 text-sm font-semibold font-mono">
                  {isStreaming ? formatTime(paidSecsRemaining) : `${paidMinsRemaining.toFixed(1)} min`}
                </span>
                <span className="text-muted-foreground text-xs">{isStreaming ? "paid time left" : "paid time"}</span>
              </div>
            )}
            {/* Live session timer */}
            {isStreaming && (
              <div className="flex items-center gap-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg" data-testid="status-live">
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                <span className="text-red-400 font-mono font-bold text-sm">{isAdminUser ? formatTime(elapsedSecs) : formatTime(Math.max(0, trialSecsRemaining + paidSecsRemaining))}</span>
                {connectionStatus === "connecting" && (
                  <span className="text-xs text-yellow-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Connecting...
                  </span>
                )}
                {connectionStatus === "connected" && <span className="text-xs text-green-400">● Live</span>}
              </div>
            )}
          </div>
        </div>

        {/* ── License Time Deduction Bar ─────────────────────────────── */}
        {!isAdminUser && totalCapacitySecs > 1 && (
          <div className="p-4 bg-card border border-border rounded-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">License Time</span>
                {isStreaming && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-red-400 ml-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                    DEDUCTING
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-sm font-mono font-bold tabular-nums ${barPct <= 0.15 ? "text-red-400 animate-pulse" : barPct <= 0.3 ? "text-amber-400" : "text-green-400"}`}>
                  {formatTime(liveRemainingBarSecs)}
                </span>
                <span className="text-xs text-muted-foreground">/ {formatTime(totalCapacitySecs)}</span>
              </div>
            </div>

            {/* The bar itself — shrinks left-to-right as minutes are consumed */}
            <div className="relative h-4 bg-muted/50 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                  barPct <= 0.15 ? "bg-red-500" : barPct <= 0.3 ? "bg-amber-500" : "bg-green-500"
                }`}
                style={{ width: `${(barPct * 100).toFixed(3)}%` }}
              />
              {/* Subtle shimmer when streaming */}
              {isStreaming && barPct > 0 && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse rounded-full pointer-events-none" />
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{Math.round(barPct * 100)}% remaining</span>
              {barPct <= 0.15 && liveRemainingBarSecs > 0 ? (
                <Link href="/billing">
                  <span className="text-red-400 underline cursor-pointer font-medium">⚠ Running low — buy more time</span>
                </Link>
              ) : (
                <span>{Math.floor(liveRemainingBarSecs / 60)}m {liveRemainingBarSecs % 60}s left</span>
              )}
            </div>
          </div>
        )}

        {/* Trial countdown bar */}
        {isStreaming && isFreeTrial && (
          <div className="p-3 bg-card border border-primary/20 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Zap className="w-3 h-3 text-primary" /> Free trial
              </span>
              <span className={`text-xs font-mono font-bold ${trialSecsRemaining <= 20 ? "text-red-400 animate-pulse" : "text-primary"}`}>
                {formatTime(trialSecsRemaining)} remaining
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${trialSecsRemaining <= 20 ? "bg-red-400" : "bg-primary"}`}
                style={{ width: `${trialPct * 100}%` }}
              />
            </div>
            {trialSecsRemaining <= 20 && (
              <p className="text-xs text-red-400">
                Trial ending soon — stream will stop automatically.{" "}
                <Link href="/billing"><span className="underline cursor-pointer">Purchase time now</span></Link>
              </p>
            )}
          </div>
        )}

        {/* Main layout: video area + style sidebar */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">

            {/* ── BIG AI OUTPUT — full width, tall ── */}
            <div
              ref={outputContainerRef}
              className="relative overflow-hidden bg-black"
              style={isFullscreen ? {
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                borderRadius: 0,
                width: "100vw",
                height: "100vh",
              } : {
                width: "100%",
                aspectRatio: "16/9",
                borderRadius: "1rem",
                boxShadow: connectionStatus === "connected"
                  ? "0 0 40px hsl(187 100% 52% / 0.25), 0 0 0 1px hsl(187 100% 52% / 0.15)"
                  : "0 0 0 1px hsl(222 40% 14%)",
              }}
              data-testid="transform-output"
            >
              {/* FIX: scaleX(-1) mirrors the AI output to match the local webcam preview.
              The Decart SDK receives the raw unmirrored camera stream, so its output is
              also raw (unmirrored). Without this transform, a right-hand movement in the
              webcam preview appears as a left-hand movement in the AI output. */}
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />

              {/* Idle placeholder — z-index 1 so controls above it */}
              {connectionStatus === "idle" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4"
                     style={{ zIndex: 1, background: "radial-gradient(ellipse at center, hsl(222 44% 8%) 0%, hsl(222 47% 4%) 100%)" }}>
                  <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Zap className="w-10 h-10 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-base font-semibold text-foreground">Real Time Output</p>
                    <p className="text-sm text-muted-foreground mt-1">Start streaming to see your transformation here</p>
                  </div>
                </div>
              )}

              {/* Connecting overlay — z-index 1 */}
              {connectionStatus === "connecting" && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-4"
                     style={{ zIndex: 1 }}>
                  <Loader2 className="w-12 h-12 text-primary animate-spin" />
                  <p className="text-sm text-primary font-mono tracking-wide">Connecting to stream...</p>
                </div>
              )}

              {/* Top-left group: OUTPUT badge + close button below it — z-index 20 */}
              <div className="absolute top-3 left-3 flex flex-col items-start gap-2" style={{ zIndex: 20 }}>
                <div className="px-3 py-1 bg-black/60 rounded-full text-[11px] text-white/80 font-mono tracking-widest">
                  REAL TIME OUTPUT
                </div>
                {/* X close button — only visible in fullscreen, sits directly below the label */}
                {isFullscreen && (
                  <button
                    onClick={() => {
                      if (activeSession) stopStreamInternally(activeSession, elapsedSecs, false);
                      setIsFullscreen(false);
                    }}
                    title="Close and stop streaming"
                    className="flex items-center justify-center w-8 h-8 rounded-full transition-all hover:bg-red-500/60 cursor-pointer"
                    style={{ background: "rgba(220,38,38,0.75)", color: "#fff", border: "1px solid rgba(255,100,100,0.4)" }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Live badge — z-index 10 */}
              {connectionStatus === "connected" && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full bg-primary/90 text-primary-foreground text-[11px] font-bold font-mono tracking-wide"
                     style={{ zIndex: 10 }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  LIVE
                </div>
              )}

              {/* Fullscreen enter button — top-right, only when NOT in fullscreen */}
              {!isFullscreen && (
                <button
                  onClick={handleFullscreen}
                  title="Fullscreen"
                  className="absolute top-3 right-3 flex items-center justify-center w-8 h-8 rounded-full transition-all hover:bg-white/20 cursor-pointer"
                  style={{ zIndex: 20, background: "rgba(0,0,0,0.55)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Webcam PiP — hidden in fullscreen so only AI output shows */}
              {!isFullscreen && (
                <div
                  className="absolute bottom-3 left-3 rounded-xl overflow-hidden border border-white/20 bg-black"
                  style={{ width: "22%", aspectRatio: "16/9", boxShadow: "0 4px 20px rgba(0,0,0,0.6)", zIndex: 10 }}
                >
                  <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
                  {!cameraReady && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-2 p-2">
                      <Camera className="w-5 h-5 text-muted-foreground" />
                      <button
                        onClick={() => startCamera()}
                        className="text-[10px] text-primary font-semibold underline cursor-pointer"
                        data-testid="button-enable-camera"
                      >
                        Enable Camera
                      </button>
                    </div>
                  )}
                  <div className="absolute bottom-1 left-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white/70 font-mono tracking-widest truncate">
                    INPUT{cameras.length > 0 && selectedCameraId
                      ? ` · ${(cameras.find(c => c.deviceId === selectedCameraId)?.label || `Camera ${cameras.findIndex(c => c.deviceId === selectedCameraId) + 1}`)}`
                      : ""}
                  </div>
                </div>
              )}
            </div>

            {/* ── Camera Source Selector — hidden in fullscreen/output window ── */}
            {!isFullscreen && (
            <div className="p-3 bg-card border border-border rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Camera className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-foreground tracking-wide">Input Camera Source</p>
                    <span className="text-[10px] text-muted-foreground">
                      {cameras.length === 0
                        ? "No cameras detected"
                        : `${cameras.length} camera${cameras.length > 1 ? "s" : ""} detected`}
                    </span>
                  </div>
                  {cameras.length === 0 ? (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground italic flex-1">
                        Enable your camera or plug in your webcam to see available devices.
                      </p>
                      <button
                        onClick={enumerateCameras}
                        title="Scan for cameras"
                        className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
                      >
                        <RefreshCw className="w-3 h-3" /> Scan
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        data-testid="select-camera"
                        value={selectedCameraId}
                        onChange={e => handleCameraSwitch(e.target.value)}
                        disabled={isStreaming}
                        className="w-full appearance-none text-sm rounded-lg border border-border bg-background text-foreground pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {cameras.map((cam, i) => (
                          <option key={cam.deviceId} value={cam.deviceId}>
                            {cam.label || `Camera ${i + 1}`}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    </div>
                  )}
                </div>
                <button
                  onClick={enumerateCameras}
                  title="Refresh camera list"
                  className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              {cameras.length > 0 && !cameraReady && (
                <p className="text-[11px] text-muted-foreground mt-2 pl-11">
                  Select your camera above, then click <span className="text-primary font-medium">Enable Camera</span> on the input preview to activate it.
                </p>
              )}
              {isStreaming && (
                <p className="text-[11px] text-amber-400 mt-2 pl-11">
                  Camera switching is disabled during an active stream. Stop the session first.
                </p>
              )}
            </div>)}

            {/* Start / Stop button */}
            <div className="flex items-center gap-3">
              {!isStreaming ? (
                <Button
                  data-testid="button-start-stream"
                  onClick={handleStartStream}
                  disabled={startSession.isPending || !cameraReady}
                  className="gap-2 flex-1 h-12 text-base font-bold tracking-wide"
                  style={{ boxShadow: "0 0 24px hsl(187 100% 52% / 0.25)" }}
                >
                  <Play className="w-5 h-5" />
                  {startSession.isPending ? "Starting..." : "Stream Now"}
                </Button>
              ) : (
                <Button
                  data-testid="button-stop-stream"
                  onClick={handleStopStream}
                  variant="destructive"
                  disabled={stopSession.isPending}
                  className="gap-2 flex-1 h-12 text-base font-bold"
                >
                  <Square className="w-5 h-5" />
                  {stopSession.isPending ? "Stopping..." : "Stop Session"}
                </Button>
              )}
            </div>

            {/* Reference image */}
            <div className="p-4 bg-card border border-border rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    <ImagePlus className="w-4 h-4 text-primary" /> Reference Image
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Upload a face or style reference — Real Time will match your transformation
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {referenceImage && (
                    <button onClick={handleClearReferenceImage} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors">
                      <X className="w-3 h-3" /> Clear
                    </button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => refImageInputRef.current?.click()}>
                    {referenceImage ? "Change" : "Upload"}
                  </Button>
                  <input ref={refImageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleReferenceImageChange} />
                </div>
              </div>
              {referenceImageUrl && (
                <div className="flex items-center gap-3 p-2 bg-background rounded-lg border border-border">
                  <img src={referenceImageUrl} alt="Reference" className="w-12 h-12 object-cover rounded" />
                  <div>
                    <p className="text-xs font-medium text-foreground truncate max-w-[180px]">{referenceImage?.name}</p>
                    {isStreaming && connectionStatus === "connected"
                      ? <p className="text-xs text-green-400 mt-0.5">● Applied to live session</p>
                      : <p className="text-xs text-primary mt-0.5">Will apply at stream start</p>}
                  </div>
                </div>
              )}
            </div>

            {/* Live prompt */}
            <div className="p-4 bg-card border border-border rounded-xl space-y-2">
              <label className="text-sm font-medium text-foreground">Live Prompt Override</label>
              <input
                type="text"
                value={customPrompt}
                onChange={e => handlePromptChange(e.target.value)}
                placeholder={selectedStyleData?.prompt ?? "Describe the transformation..."}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
              />
              <p className="text-xs text-muted-foreground">Changes apply in real-time. Leave blank to use style default.</p>
            </div>

            {/* OBS instructions */}
            <div className="p-4 bg-card border border-border rounded-xl space-y-3">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">OBS Output</span>
              </div>
              <ol className="space-y-1.5 text-xs text-muted-foreground list-none">
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">1</span>
                  Start your stream above and wait for the AI output to appear.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">2</span>
                  Click <span className="text-foreground font-medium">Fullscreen</span> on the output — the AI video fills your entire screen.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">3</span>
                  In OBS: Add source → <span className="text-foreground font-medium">Window Capture</span> → select this browser window.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">4</span>
                  Or use <span className="text-foreground font-medium">Browser Source</span> in OBS and enter your FULL SWAP BY RICH page URL.
                </li>
              </ol>
            </div>
          </div>

          {/* Style selector sidebar */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-1 tracking-wide">Transformation Style</h3>
            <p className="text-xs text-muted-foreground mb-4">Pick a style to apply</p>
            <div className="space-y-2">
              {STYLES.map((style) => (
                <button
                  key={style.id}
                  data-testid={`style-${style.id}`}
                  onClick={() => handleStyleChange(style.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedStyle === style.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background hover:border-primary/40 text-foreground"
                  }`}
                  style={selectedStyle === style.id ? { boxShadow: "0 0 12px hsl(187 100% 52% / 0.12)" } : {}}
                >
                  <p className="text-sm font-medium">{style.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{style.description}</p>
                </button>
              ))}
            </div>
          </div>


{/* ── RENEW / TOP UP LICENSE KEY ─────────────────────────── */}
          <div className="p-4 rounded-xl space-y-3"
             style={{ background: "hsl(187 100% 52% / 0.04)", border: "1px solid hsl(187 100% 52% / 0.22)" }}>
            <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-primary shrink-0" />
            <p className="text-xs font-bold text-primary tracking-widest font-mono uppercase">
              Renew / Top Up License Key Here
            </p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
            Enter a valid license key — minutes will be added to your existing balance instantly.
            </p>
            <div className="flex gap-2">
            <input
              type="text"
              value={renewKey}
              onChange={e => { setRenewKey(e.target.value.toUpperCase()); setRenewMsg(null); }}
              onKeyDown={e => e.key === "Enter" && !renewLoading && handleRenewLicense()}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              className="flex-1 px-3 py-2.5 rounded-lg text-sm font-mono tracking-widest placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 transition-colors"
              style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(187 100% 52% / 0.3)", color: "hsl(187 100% 90%)", focusRingColor: "hsl(187 100% 52%)" }}
              disabled={renewLoading}
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              onClick={handleRenewLicense}
              disabled={renewLoading || !renewKey.trim()}
              size="sm"
              className="shrink-0 gap-1.5 font-bold text-xs tracking-wide h-10"
              style={{ boxShadow: "0 0 14px hsl(187 100% 52% / 0.2)" }}
            >
              {renewLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
              {renewLoading ? "Validating..." : "Renew License"}
            </Button>
            </div>
            {renewMsg && (
            <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs leading-relaxed ${
              renewOk
              ? "text-emerald-400"
              : "text-red-400"
            }`}
            style={{
              background: renewOk ? "hsl(143 72% 42% / 0.08)" : "hsl(0 84% 60% / 0.08)",
              border: `1px solid ${renewOk ? "hsl(143 72% 42% / 0.25)" : "hsl(0 84% 60% / 0.25)"}`,
            }}>
              {renewOk
              ? <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
              <span>{renewMsg}</span>
            </div>
            )}
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
