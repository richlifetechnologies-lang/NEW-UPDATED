import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useStartSession, useStopSession } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, Camera, Zap, Monitor, Loader2, ImagePlus, X, CreditCard, Lock, Maximize2, RefreshCw, ChevronDown, Key, AlertCircle, CheckCircle, Timer, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { createDecartClient, models } from "@decartai/sdk";
import { Link } from "wouter";
import { useLicense } from "@/hooks/useLicense";
import { getLicenseKey, getDeviceId } from "@/lib/auth";
import { LicenseActivationModal } from "@/components/license-modal";

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
  const licenseKey = localStorage.getItem("fullswap_license_key");
  if (!licenseKey) {
    window.location.href = "/";
    throw new Error("License key required.");
  }
  const deviceId = (() => {
    const STORAGE_KEY = "fullswap_device_id";
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  })();
  const res = await fetch("/api/decart/token", {
    headers: { "X-License-Key": licenseKey, "X-Device-ID": deviceId },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const apiErr = body.error ?? "Failed to get streaming token";
    // Only clear the key and redirect for a genuinely invalid / not-found key
    if (res.status === 401) {
      localStorage.removeItem("fullswap_license_key");
      window.location.href = "/";
    }
    throw new Error(apiErr);
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
        <div className="w-full px-4 py-3 rounded-xl text-center" style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
          <p className="text-sm font-semibold text-foreground mb-1">Need more time?</p>
          <p className="text-xs text-muted-foreground">Contact your admin to add more streaming minutes to your license key.</p>
          <p className="text-xs text-primary font-mono mt-1">@rich_life2k15 on Telegram</p>
        </div>
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
  const streamStartRemRef     = useRef<number>(0);   // remaining secs captured at stream start for smooth countdown
  const activeSessionRef      = useRef<string | null>(null);
  const connectionStatusRef   = useRef<"idle"|"connecting"|"connected"|"error"|"dropped">("idle");
  // Wall-clock start for elapsed timer (avoids setInterval drift when tab is hidden/throttled)
  const timerStartMsRef       = useRef<number>(0);
  // Remaining seconds from the most recent validate call — used as fallback when
  // licenseStatus query hasn't loaded yet for a freshly-entered key.
  const validatedRemainingRef = useRef<number>(0);
  // Counts Decart generationTick events (1 tick = 1 billed second = 2 credits).
  // Sent to the server on stop so billing matches Decart's exact charge.
  const tickCountRef          = useRef<number>(0);

  // ── Audio sync refs ──────────────────────────────────────────────────
  const audioContextRef     = useRef<AudioContext | null>(null);
  const audioDelayNodeRef   = useRef<DelayNode | null>(null);
  const audioGainNodeRef    = useRef<GainNode | null>(null);
  const audioAnalyserRef    = useRef<AnalyserNode | null>(null);
  const micStreamRef        = useRef<MediaStream | null>(null);
  const vuAnimFrameRef      = useRef<number | null>(null);
  const connectStartMsRef   = useRef<number>(0);
  // Ref mirrors for state values used inside SDK callbacks
  const audioEnabledRef     = useRef<boolean>(false);
  const audioDelayMsRef     = useRef<number>(150);
  const audioMutedRef       = useRef<boolean>(false);
  const audioGainRef        = useRef<number>(1.0);

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

  // ── Audio sync state ─────────────────────────────────────────────────
  const [audioEnabled,        setAudioEnabled]        = useState(false);
  const [audioDelayMs,        setAudioDelayMs]        = useState(150);
  const [audioMuted,          setAudioMuted]          = useState(false);
  const [audioGain,           setAudioGain]           = useState(1.0);
  const [microphones,         setMicrophones]         = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId,       setSelectedMicId]       = useState("");
  const [vuLevel,             setVuLevel]             = useState(0);
  const [detectedLatencyMs,   setDetectedLatencyMs]   = useState<number | null>(null);
  const [audioPipelineActive, setAudioPipelineActive] = useState(false);

  // Desktop license gate
  const { isElectron, isLicensed, isLoading: licenseLoading, error: licenseError, activateLicense } = useLicense();


  // ── License renewal ─────────────────────────────────────────────────
  const [renewKey, setRenewKey] = useState<string>("");
  const [renewLoading, setRenewLoading] = useState<boolean>(false);
  const [renewMsg, setRenewMsg] = useState<string | null>(null);
  const [renewOk, setRenewOk] = useState<boolean>(false);

  const startSession = useStartSession({ mutation: {} });
  const stopSession  = useStopSession({ mutation: {} });
  // ── Live license status (polls /api/license/status every 5s) ─────────────
  // Source of truth for remaining time. Replaces the broken user-dashboard approach:
  // /api/users/dashboard uses requireAuth (JWT only) — license-key users always get 401.
  // /api/license/status uses requireLicense (X-License-Key) and already includes
  // unbilled active-session seconds so remainingSeconds is always real-time accurate.
  // Rate: 2 credits/sec = 120 credits/min = $0.01/credit → $0.02/sec → $72/hr
  const licKey = getLicenseKey() ?? "";
  const licenseStatus = useQuery({
    queryKey: ["license-status", licKey],
    queryFn: async (): Promise<{
      minutesAllocated: number; usedSeconds: number; remainingSeconds: number;
      minutesRemaining: number; minutesUsed: number; isActive: boolean;
    } | null> => {
      if (!licKey) return null;
      const res = await fetch("/api/license/status", { headers: { "X-License-Key": licKey } });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!licKey,
    refetchInterval: 5_000,          // poll every 5s — keeps balance in sync with server billing
    refetchIntervalInBackground: true, // keep polling even when tab is hidden (user in OBS)
    refetchOnWindowFocus: true,        // re-sync immediately when user tabs back in
    staleTime: 2_000,
  });

  const isAdminUser      = false;          // license-key users are never admins; admins use /admin
  const remainingSeconds = licenseStatus.data?.remainingSeconds ?? 0;
  const minutesAllocated = licenseStatus.data?.minutesAllocated ?? 0;
  const paidMinsRemaining  = remainingSeconds / 60;
  const totalAvailableSecs = remainingSeconds;
  const noAccess           = licenseStatus.isSuccess && totalAvailableSecs <= 0;

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
      await stopSession.mutateAsync({ sessionId, data: { creditsConsumed: tickCountRef.current * 2 } });
      queryClient.invalidateQueries({ queryKey: ["license-status", licKey] });
    } catch { /* best effort */ }

    setIsStreaming(false);
    setActiveSession(null);
    setElapsedSecs(0);
    setConnectionStatus("idle");

    if (!trialExpired) {
      toast({ title: "Session stopped", description: `Streamed for ${formatTime(secs)}` });
    }
  }, [stopSession, queryClient, licKey, toast]);

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

  // ── Audio sync functions ─────────────────────────────────────────────

  const enumerateMics = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === "audioinput");
      setMicrophones(mics);
      if (mics.length > 0) setSelectedMicId(prev => prev || mics[0]!.deviceId);
    } catch { /* ignore */ }
  }, []);

  const stopVuMeter = useCallback(() => {
    if (vuAnimFrameRef.current) {
      cancelAnimationFrame(vuAnimFrameRef.current);
      vuAnimFrameRef.current = null;
    }
    setVuLevel(0);
  }, []);

  const startVuMeter = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      setVuLevel(avg / 255);
      vuAnimFrameRef.current = requestAnimationFrame(tick);
    };
    vuAnimFrameRef.current = requestAnimationFrame(tick);
  }, []);

  const stopAudioPipeline = useCallback(() => {
    stopVuMeter();
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    audioDelayNodeRef.current = null;
    audioGainNodeRef.current  = null;
    audioAnalyserRef.current  = null;
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    setAudioPipelineActive(false);
  }, [stopVuMeter]);

  const startAudioPipeline = useCallback(async (micDeviceId?: string) => {
    stopAudioPipeline();
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: micDeviceId ? { deviceId: { exact: micDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      micStreamRef.current = micStream;

      const ctx = new AudioContext();
      await ctx.resume();
      audioContextRef.current = ctx;

      const source  = ctx.createMediaStreamSource(micStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      audioAnalyserRef.current = analyser;

      const delay = ctx.createDelay(2.0);
      delay.delayTime.value = audioDelayMsRef.current / 1000;
      audioDelayNodeRef.current = delay;

      const gain = ctx.createGain();
      gain.gain.value = audioMutedRef.current ? 0 : audioGainRef.current;
      audioGainNodeRef.current = gain;

      source.connect(analyser);
      analyser.connect(delay);
      delay.connect(gain);
      gain.connect(ctx.destination);

      startVuMeter(analyser);
      setAudioPipelineActive(true);
      await enumerateMics();
    } catch {
      toast({ title: "Microphone error", description: "Could not access microphone. Check your browser permissions.", variant: "destructive" });
      audioEnabledRef.current = false;
      setAudioEnabled(false);
    }
  }, [stopAudioPipeline, startVuMeter, enumerateMics, toast]);

  const handleAudioToggle = useCallback(async (enabled: boolean) => {
    audioEnabledRef.current = enabled;
    setAudioEnabled(enabled);
    if (enabled) {
      await startAudioPipeline(selectedMicId || undefined);
    } else {
      stopAudioPipeline();
    }
  }, [startAudioPipeline, stopAudioPipeline, selectedMicId]);

  const handleMicSwitch = useCallback(async (deviceId: string) => {
    setSelectedMicId(deviceId);
    if (audioEnabled) await startAudioPipeline(deviceId);
  }, [audioEnabled, startAudioPipeline]);

  const handleAudioDelayChange = useCallback((ms: number) => {
    audioDelayMsRef.current = ms;
    setAudioDelayMs(ms);
    if (audioDelayNodeRef.current && audioContextRef.current) {
      audioDelayNodeRef.current.delayTime.setTargetAtTime(ms / 1000, audioContextRef.current.currentTime, 0.05);
    }
  }, []);

  const handleAudioGainChange = useCallback((gain: number) => {
    audioGainRef.current = gain;
    setAudioGain(gain);
    if (audioGainNodeRef.current && !audioMutedRef.current) {
      audioGainNodeRef.current.gain.setTargetAtTime(gain, audioContextRef.current!.currentTime, 0.05);
    }
  }, []);

  const handleAudioMuteToggle = useCallback(() => {
    const next = !audioMutedRef.current;
    audioMutedRef.current = next;
    setAudioMuted(next);
    if (audioGainNodeRef.current && audioContextRef.current) {
      audioGainNodeRef.current.gain.setTargetAtTime(next ? 0 : audioGainRef.current, audioContextRef.current.currentTime, 0.05);
    }
  }, []);

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

      // Capture remaining seconds from license status at stream start for smooth countdown
      // and server-side kill threshold (2 credits/sec = 120/min → $0.02/sec → $72/hr)
      // Fall back to validatedRemainingRef when licenseStatus hasn't loaded yet for a
      // freshly-entered key (prevents countdown from immediately showing 0).
      const remainingAtStart     = licenseStatus.data?.remainingSeconds ?? validatedRemainingRef.current;
      streamStartRemRef.current  = remainingAtStart;
      trialLimitRef.current      = remainingAtStart > 0 ? remainingAtStart : Infinity;

      // Timer uses wall-clock time so it stays accurate even when the browser
      // throttles setInterval in background tabs (e.g. user is in OBS).
      timerStartMsRef.current = 0; // will be stamped when first frame arrives

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

      connectStartMsRef.current = performance.now();
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

          // ── Auto-sync audio delay to measured video latency ──────────
          const measured = Math.round(frameTs - connectStartMsRef.current);
          setDetectedLatencyMs(measured);
          // Clamp: subtract ~30ms steady-state buffer overhead, keep 50-800ms range
          const autoDelay = Math.min(Math.max(50, measured - 30), 800);
          if (audioEnabledRef.current && audioDelayNodeRef.current && audioContextRef.current) {
            audioDelayNodeRef.current.delayTime.setTargetAtTime(autoDelay / 1000, audioContextRef.current.currentTime, 0.1);
            audioDelayMsRef.current = autoDelay;
            setAudioDelayMs(autoDelay);
          }

          // Stamp wall-clock start so the elapsed timer is accurate even when the
          // browser throttles setInterval in background/hidden tabs.
          timerStartMsRef.current = performance.now();

          // Now start the visible timer — reads wall-clock elapsed each tick so
          // it never drifts behind when the tab is hidden (e.g. user switched to OBS).
          timerRef.current = setInterval(() => {
            if (connectionStatusRef.current !== "connected") return;
            const elapsed = Math.floor((performance.now() - timerStartMsRef.current) / 1000);
            setElapsedSecs(elapsed);
            elapsedSecsRef.current = elapsed;
            if (elapsed >= trialLimitRef.current) {
              // Bug #5: show splash screen when minutes reach zero
              setLicenseExhausted(true);
              stopStreamInternally(sessionId, elapsed, false);
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

      // Count every generationTick — Decart charges 2 credits per tick (1 tick = 1 billed second).
      // This gives us the exact credit count to pass to /stop for perfect billing reconciliation.
      tickCountRef.current = 0;
      realtimeClient.on("generationTick", () => {
        tickCountRef.current += 1;
      });

      // ── Loophole fix #3: bill from connect-resolved, not from first frame ──
      // Decart's WebRTC peer is now established and Lucy 2.1 is metering wall-clock
      // seconds against our API key. Stamp billingStartedAt server-side NOW so our
      // incremental debit covers the same window Decart bills us for.
      {
        const licKey = localStorage.getItem("fullswap_license_key") ?? "";
        fetch(`/api/sessions/${sessionId}/output-started`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-License-Key": licKey, "X-Device-ID": getDeviceId() },
        }).catch(() => {});
      }

      toast({ title: "Session started", description: "Stream is live — Real Time transformation active" });
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
          headers: { "Content-Type": "application/json", "X-License-Key": licKey, "X-Device-ID": getDeviceId() },
          body: JSON.stringify({}),
          keepalive: true,
        }).catch(() => {});
      }
      const errMsg = err instanceof Error ? err.message : "Could not connect";
      // Only clear key for genuinely invalid/revoked license (not streaming-disabled or out-of-time)
      const isInvalidKey = errMsg.includes("Invalid license key") || errMsg.includes("License key required") || errMsg.includes("has been revoked");
      if (isInvalidKey) {
        localStorage.removeItem("fullswap_license_key");
        toast({ title: "License invalid", description: "Your license key is no longer valid. Please contact admin.", variant: "destructive" });
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
      // Audio pipeline cleanup
      if (vuAnimFrameRef.current) cancelAnimationFrame(vuAnimFrameRef.current);
      if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      const sid = activeSessionRef.current;
      if (sid) {
        const licKey = localStorage.getItem("fullswap_license_key") ?? "";
        fetch(`/api/sessions/${sid}/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-License-Key": licKey, "X-Device-ID": getDeviceId() },
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
            headers: { "Content-Type": "application/json", "X-License-Key": licKey, "X-Device-ID": getDeviceId() },
            body: JSON.stringify({}),
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-License-Key": licKey, "X-Device-ID": getDeviceId() },
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
        // AbortSignal.timeout may be unsupported in some environments —
        // fall back gracefully so heartbeats always reach the server.
        let abortSignal: AbortSignal | undefined;
        try { abortSignal = AbortSignal.timeout(8_000); } catch { abortSignal = undefined; }
        const res = await fetch(`/api/sessions/${activeSession}/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-License-Key": (localStorage.getItem("fullswap_license_key") ?? ""),
            "X-Device-ID": getDeviceId(),
          },
          ...(abortSignal ? { signal: abortSignal } : {}),
        });

        if (res.ok) {
          consecutiveFailures = 0; // reset on success
          const data: { ok: boolean; reason?: string } = await res.json();
          if (data.ok === false && data.reason === "no_time") {
            toast({
              title: "Streaming time exhausted",
              description: "You have used all your streaming minutes. Contact admin to add more time to your license key.",
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

  // Recalibrate smooth countdown on each 5s server poll during streaming.
  // server.remainingSeconds = allocated - usedBefore - sessionElapsed
  // → effective start ref = remainingSeconds + currentElapsed (anchors smooth tick-down)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isStreaming && licenseStatus.data?.remainingSeconds !== undefined) {
      streamStartRemRef.current = licenseStatus.data.remainingSeconds + elapsedSecsRef.current;
    }
  }, [licenseStatus.data]); // re-run only when server data updates (every 5s)

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
        body: JSON.stringify({ key: trimmedKey, deviceId: getDeviceId() }),
      });
      const data = await res.json();
      if (data.valid) {
        localStorage.setItem("fullswap_license_key", trimmedKey);
        // Seed the remaining-seconds ref immediately so the countdown is correct
        // even before the new licenseStatus query finishes loading.
        validatedRemainingRef.current = data.remainingSeconds ?? 0;
        streamStartRemRef.current     = data.remainingSeconds ?? 0;
        setLicenseExhausted(false); // reset exhaustion state on new license
        setRenewOk(true);
        const remMins = Math.floor((data.remainingSeconds ?? 0) / 60);
        const allMins = data.minutesAllocated ?? 0;
        setRenewMsg(
          `License activated! ${remMins > 0 ? remMins + " minutes remaining" : allMins + " minutes allocated"}.`
        );
        setRenewKey("");
        // Invalidate + immediately refetch so the new key's status loads right away
        queryClient.invalidateQueries({ queryKey: ["license-status"] });
        queryClient.refetchQueries({ queryKey: ["license-status", trimmedKey] }).catch(() => {});
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

  // Smooth per-second countdown: streamStartRemRef anchors remaining secs at stream start.
  // elapsedSecs ticks every second (client timer). Server polls every 5s recalibrate the ref.
  // Formula: remaining = (remainingAtStart + elapsedAtLastPoll) - elapsedNow
  //        = initialRemaining - elapsedSecs  ← exact Decart billing: 1s = 2 credits = $0.02
  const paidSecsRemaining = isStreaming
    ? Math.max(0, streamStartRemRef.current - elapsedSecs)
    : remainingSeconds;

  // ── License deduction bar ────────────────────────────────────────────────
  // totalCapacitySecs = all minutes ever allocated on this key (1 min = 120 Decart credits)
  const totalCapacitySecs    = Math.max(1, minutesAllocated * 60);
  const liveRemainingBarSecs = Math.max(0, paidSecsRemaining);
  const barPct = Math.max(0, Math.min(1, liveRemainingBarSecs / totalCapacitySecs));

  return (
    <AppLayout>
      {isElectron && licenseLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "hsl(222 47% 4%)" }}>
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      )}
      {(isElectron && !licenseLoading && !isLicensed) && (
        <LicenseActivationModal onActivate={activateLicense} error={licenseError} mode="no-license" />
      )}

      <div className="p-6 lg:p-8 space-y-6" data-testid="stream-page">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-wide">Live Stream</h1>
            <p className="text-muted-foreground mt-1 text-sm">Real-time live video transformation</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
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
                <span className="text-red-400 font-mono font-bold text-sm">{isAdminUser ? formatTime(elapsedSecs) : formatTime(Math.max(0, paidSecsRemaining))}</span>
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
              <span className="flex items-center gap-2">
                <span>{Math.round(barPct * 100)}% remaining</span>
                <span className="text-slate-700">·</span>
                <span className="text-yellow-500/70 font-mono font-medium">⚡ 2 cr/s · $0.02/s · $72/hr</span>
              </span>
              {barPct <= 0.15 && liveRemainingBarSecs > 0 ? (
                <span className="text-red-400 font-medium">⚠ Running low — contact admin</span>
              ) : (
                <span>{Math.floor(liveRemainingBarSecs / 60)}m {liveRemainingBarSecs % 60}s left</span>
              )}
            </div>
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

            {/* ── Audio Sync ─────────────────────────────────────────── */}
            {!isFullscreen && (
            <div className="p-3 bg-card border border-border rounded-xl space-y-3">
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Mic className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground tracking-wide">Audio Sync</p>
                    <p className="text-[10px] text-muted-foreground">Delay mic to match face-swap video</p>
                  </div>
                </div>
                <button
                  onClick={() => handleAudioToggle(!audioEnabled)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${audioEnabled ? "bg-primary" : "bg-muted"}`}
                  role="switch"
                  aria-checked={audioEnabled}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${audioEnabled ? "translate-x-4" : "translate-x-0"}`} />
                </button>
              </div>

              {audioEnabled && (
                <div className="space-y-3 pt-1">
                  {/* Mic selector */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <select
                        value={selectedMicId}
                        onChange={e => handleMicSwitch(e.target.value)}
                        className="w-full appearance-none text-xs rounded-lg border border-border bg-background text-foreground pl-3 pr-7 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                      >
                        {microphones.length === 0 && <option value="">No microphones detected</option>}
                        {microphones.map((m, i) => (
                          <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    </div>
                    <button onClick={enumerateMics} title="Refresh mics" className="text-muted-foreground hover:text-primary transition-colors">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* VU meter */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Mic Level</span>
                      <span className={`text-[10px] font-medium ${audioPipelineActive ? "text-green-400" : "text-muted-foreground"}`}>
                        {audioPipelineActive ? "● Active" : "○ Inactive"}
                      </span>
                    </div>
                    <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-75"
                        style={{
                          width: `${Math.round(vuLevel * 100)}%`,
                          background: vuLevel > 0.8 ? "hsl(0 72% 55%)" : vuLevel > 0.5 ? "hsl(38 92% 55%)" : "hsl(187 100% 42%)",
                        }}
                      />
                    </div>
                  </div>

                  {/* Delay control */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Audio Delay</span>
                      <div className="flex items-center gap-2">
                        {detectedLatencyMs !== null && (
                          <span className="text-[10px] text-primary/80">
                            ⚡ auto-detected {detectedLatencyMs}ms
                          </span>
                        )}
                        <span className="text-[10px] font-mono font-bold text-foreground tabular-nums">{audioDelayMs}ms</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={800}
                      step={5}
                      value={audioDelayMs}
                      onChange={e => handleAudioDelayChange(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full accent-primary cursor-pointer"
                    />
                    <div className="flex justify-between text-[9px] text-muted-foreground">
                      <span>0ms</span>
                      <span className="text-muted-foreground/60">fine-tune until lips match video</span>
                      <span>800ms</span>
                    </div>
                  </div>

                  {/* Volume + Mute */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleAudioMuteToggle}
                      title={audioMuted ? "Unmute" : "Mute"}
                      className={`shrink-0 transition-colors ${audioMuted ? "text-destructive" : "text-muted-foreground hover:text-primary"}`}
                    >
                      {audioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={audioGain}
                      onChange={e => handleAudioGainChange(Number(e.target.value))}
                      className="flex-1 h-1.5 rounded-full accent-primary cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{Math.round(audioGain * 100)}%</span>
                  </div>

                  {/* OBS note */}
                  <div className="flex items-start gap-2 p-2 bg-primary/5 border border-primary/15 rounded-lg">
                    <Monitor className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <div className="text-[10px] text-muted-foreground leading-relaxed">
                      <span className="text-foreground font-medium">OBS Browser Source</span> — audio captures automatically.<br />
                      <span className="text-foreground font-medium">OBS Window Capture</span> — enable <span className="text-primary">Desktop Audio</span> or <span className="text-primary">Application Audio Capture</span> in OBS.
                    </div>
                  </div>
                </div>
              )}
            </div>)}

            {/* Start / Stop button */}
            <div className="flex items-center gap-3">
              {isStreaming ? (
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
              ) : (noAccess || licenseExhausted) ? (
                <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
                  <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-300">No streaming time remaining</p>
                    <p className="text-xs text-amber-400/70 truncate">Contact your admin to add more minutes — @rich_life2k15</p>
                  </div>
                </div>
              ) : (
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
