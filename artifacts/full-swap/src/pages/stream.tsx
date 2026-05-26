import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useStartSession, useStopSession } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, Camera, Zap, Monitor, Loader2, ImagePlus, X, CreditCard, Lock, Maximize2, RefreshCw, ChevronDown, Key, AlertCircle, CheckCircle, Timer, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
// @decartai/sdk is loaded dynamically to prevent a TDZ crash caused by a
// circular initialisation order in the bundled chunk.  A static import would
// cause `ReferenceError: Cannot access 'he' before initialization` on load.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { createDecartClient as _CreateDecartClient, models as _Models } from "@decartai/sdk";
type _SdkModule = { createDecartClient: typeof _CreateDecartClient; models: typeof _Models };
let _sdkCache: _SdkModule | null = null;
async function getDecartSdk(): Promise<_SdkModule> {
  if (!_sdkCache) {
    _sdkCache = (await import("@decartai/sdk")) as unknown as _SdkModule;
  }
  return _sdkCache;
}
import { Link } from "wouter";
import { useLicense } from "@/hooks/useLicense";
import { getLicenseKey, getDeviceId } from "@/lib/auth";
import { LicenseActivationModal } from "@/components/license-modal";

const LUCY_MODEL = "lucy-2.1" as const;

// Client-side pre-exhaustion safety threshold.
// When wallet drops to this many seconds, the frontend stops the stream slightly
// early — BEFORE the server-side heartbeat catch-up fires — to eliminate UI drift.
// Backend (heartbeat + /stop) remains the authoritative enforcement layer.
// This is ONLY a UX smoothness layer. Billing is unaffected.
const PRE_EXHAUSTION_THRESHOLD_SECS = 5;

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

type DecartClient = Awaited<ReturnType<ReturnType<typeof _CreateDecartClient>["realtime"]["connect"]>>;


// ─── Electron Update Banner ───────────────────────────────────────────────────

declare global {
  interface Window {
    isElectron?: boolean;
    electronAPI?: {
      forceRefresh: () => void;
      installUpdate: () => void;
      checkForUpdates: () => void;
      markLaunched: () => void;
      getTheme: () => Promise<string>;
      onUpdateAvailable: (cb: (info: unknown) => void) => void;
      onUpdateDownloaded: (cb: (info: unknown) => void) => void;
      onThemeChanged: (cb: (theme: string) => void) => void;
    };
  }
}

function useElectronUpdateBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.isElectron) return;

    let initialEtag: string | null = null;
    let dismissed = false;

    const checkVersion = async () => {
      if (dismissed) return;
      try {
        const res = await fetch('/', { method: 'HEAD', cache: 'no-store' });
        const tag =
          res.headers.get('etag') ||
          res.headers.get('last-modified') ||
          res.headers.get('x-deployment-id');
        if (initialEtag === null) {
          initialEtag = tag;
        } else if (tag && tag !== initialEtag) {
          setShowBanner(true);
        }
      } catch {
        // network error — ignore, retry next interval
      }
    };

    checkVersion();
    const id = setInterval(checkVersion, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const dismiss = useCallback(() => setShowBanner(false), []);
  const refresh = useCallback(() => {
    window.electronAPI?.forceRefresh();
  }, []);

  return { showBanner, dismiss, refresh };
}

function ElectronRefreshBanner({ onRefresh, onDismiss }: { onRefresh: () => void; onDismiss: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 20px',
        background: 'linear-gradient(90deg, hsl(222 44% 8%) 0%, hsl(222 44% 10%) 100%)',
        borderBottom: '1px solid hsl(187 100% 52% / 0.3)',
        boxShadow: '0 2px 16px rgba(0,229,255,0.08)',
        fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <span style={{ fontSize: '15px', flexShrink: 0 }}>⚡</span>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
            New version available —{' '}
          </span>
          <span style={{ fontSize: '13px', color: '#64748b' }}>
            your site has been updated. Refresh to get the latest.
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={onRefresh}
          style={{
            background: 'linear-gradient(135deg, #00e5ff, #0098b3)',
            color: '#0a0f1a',
            border: 'none',
            borderRadius: '8px',
            padding: '7px 16px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Refresh Now
        </button>
        <button
          onClick={onDismiss}
          title='Dismiss'
          style={{
            background: 'none',
            border: 'none',
            color: '#475569',
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: 1,
            padding: '4px 6px',
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

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
  const { showBanner, dismiss: dismissBanner, refresh: refreshElectron } = useElectronUpdateBanner();

  const [, setLocation] = useLocation();
    const { data: _brData } = useQuery<{ rate: number } | null>({
      queryKey: ["/api/admin/billing-rate"],
      queryFn: () => fetch("/api/admin/billing-rate").then(r => r.ok ? r.json() : null),
      staleTime: 60_000,
      retry: false,
    });
    const liveRate: number | null = _brData?.rate ?? null;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const localVideoRef      = useRef<HTMLVideoElement>(null);
  const remoteVideoRef     = useRef<HTMLVideoElement>(null);
  const popoutWindowRef    = useRef<Window | null>(null);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  const timerRef              = useRef<NodeJS.Timeout | null>(null);
  // FIX: Ref mirror for elapsedSecs so heartbeat can read latest value
  // without adding elapsedSecs to the heartbeat useEffect dependency array.
  const elapsedSecsRef        = useRef<number>(0);
  const tokenRefreshRef       = useRef<NodeJS.Timeout | null>(null);
  const decartClientRef       = useRef<DecartClient | null>(null);
  const prewarmedTokenRef     = useRef<string | null>(null);   // pre-fetched before click
  const prewarmedTokenExpiry  = useRef<number>(0);             // expiry timestamp (ms)
  const userStoppedRef        = useRef<boolean>(false);   // true when user explicitly stops
  const cameraStreamRef       = useRef<MediaStream | null>(null);
  const refImageInputRef      = useRef<HTMLInputElement>(null);
  const trialLimitRef         = useRef<number>(Infinity);
  const streamStartRemRef     = useRef<number>(0);   // remaining secs captured at stream start for smooth countdown
  const displayStartRemRef    = useRef<number>(0);   // display display secs at stream start (UI timer only — never billing)
    // FIX: Tracks last reconnect timestamp to enforce 12s cooldown between Decart reconnects.
    const reconnectCooldownRef  = useRef<number>(0);
  const activeSessionRef      = useRef<string | null>(null);
  const connectionStatusRef   = useRef<"idle"|"connecting"|"connected"|"error"|"dropped">("idle");
  // Wall-clock start for elapsed timer (avoids setInterval drift when tab is hidden/throttled)
  const timerStartMsRef       = useRef<number>(0);
  // Remaining seconds from the most recent validate call — used as fallback when
  // licenseStatus query hasn't loaded yet for a freshly-entered key.
  const validatedRemainingRef = useRef<number>(0);
  // Pre-exhaustion guard — ensures the early-stop fires at most once per session.
  // Reset to false at the start of every new session in handleStartStream.
  const hasTriggeredPreStopRef = useRef<boolean>(false);
  // Tracks current displayFactor so resync effect can read it without stale closure.
  const displayFactorRef        = useRef<number>(1);
    // SAFETY: Synchronous re-entry guard — prevents duplicate sessions from rapid
    // double-clicks before React's async isStreamStarting state reaches the DOM.
    const isStartingRef = useRef<boolean>(false);
  // Auto-retry: counts how many automatic retries have fired for the current
  // manual click. Reset to 0 on every user-initiated click. Capped at 1 so
  // a single transient failure auto-recovers without looping indefinitely.
  const autoRetryAttemptsRef = useRef<number>(0);
  // CREDITS GUARD: set to true just before client.realtime.connect() is called.
  // Auto-retry is blocked when this is true — Decart has already been contacted
  // and retrying would reserve another window of credits for the failed attempt.
  const decartConnectAttemptedRef = useRef<boolean>(false);

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
  const [isPopoutOpen,      setIsPopoutOpen]      = useState(false);
  const [isObsModeActive,   setIsObsModeActive]   = useState(false);
  const [obsInstructions,   setObsInstructions]   = useState(false);
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
  const [isAutoRetrying,    setIsAutoRetrying]      = useState(false);
  const [connectionStep,    setConnectionStep]      = useState<"token"|"session"|"decart"|null>(null);
  const [styleCollapsed,    setStyleCollapsed]      = useState(false);
  // Retry-After state for 503 NO_KEYS_AVAILABLE responses
  const [noKeysRetryAt,          setNoKeysRetryAt]          = useState<number | null>(null);
  const [noKeysRetryCountdown,   setNoKeysRetryCountdown]   = useState<number>(0);

  // Countdown timer: ticks every second while noKeysRetryAt is set (503 NO_KEYS_AVAILABLE)
  useEffect(() => {
    if (noKeysRetryAt === null) return;
    const tick = setInterval(() => {
      const remaining = Math.ceil((noKeysRetryAt - Date.now()) / 1000);
      if (remaining <= 0) {
        setNoKeysRetryAt(null);
        setNoKeysRetryCountdown(0);
        clearInterval(tick);
      } else {
        setNoKeysRetryCountdown(remaining);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [noKeysRetryAt]);

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
  // Rate: 5 credits/sec = 300 credits/min = $0.01/credit → $0.05/sec → $180/hr
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
  // Access gating uses realRemainingSeconds ONLY (server truth).
  // licenseStatus.data.licenseStatus === "exhausted" is the authoritative check.
  // Fall back to totalAvailableSecs <= 0 if server hasn't returned the new field yet.
  const noAccess           = licenseStatus.isSuccess && (
    (licenseStatus.data as any)?.licenseStatus === "exhausted"
    || ((licenseStatus.data as any)?.licenseStatus == null && totalAvailableSecs <= 0)
  );

  // Keep connectionStatusRef in sync so interval callbacks always read the latest value
  useEffect(() => { connectionStatusRef.current = connectionStatus; }, [connectionStatus]);

  const selectedStyleData = STYLES.find(s => s.id === selectedStyle);

  // ── Centralized stream teardown ───────────────────────────────────────────
  // ALL disconnect paths funnel through here. Reads from refs so it is safe to
  // call from async contexts, closures, and unload handlers without stale state.
  //
  // reason values:
  //   undefined         — normal user stop (shows "Session stopped" toast)
  //   "license_exhausted" — wallet empty (no toast — caller shows its own)
  //   "dropped"         — Decart WebRTC drop (no toast — caller already toasted)
  //   "unload"          — page close / beforeunload (no toast, fire-and-forget)
  const teardownStream = useCallback(async (reason?: string, sessionIdOverride?: string) => {
    // RC#4 FIX: Capture and null both critical refs SYNCHRONOUSLY at the very top,
    // before any await. Without this, a rapid reconnect can write a new client/session
    // into decartClientRef/activeSessionRef while this teardown is still awaiting
    // disconnect() — and then the null below would wipe the NEW session's ref,
    // leaving its Decart WebRTC runtime alive with no handle to ever disconnect it.
    const clientToClose = decartClientRef.current;
    decartClientRef.current = null;
    // FIX (Bug #3 — orphan kill): When called from heartbeat no_time / freeze paths,
    // activeSessionRef is already null (cleared before stopStreamInternally was called).
    // Accept an explicit override so the /stop call always fires with the real session ID.
    const sid  = sessionIdOverride ?? activeSessionRef.current;
    activeSessionRef.current = null;
    const secs = elapsedSecsRef.current;

    // 0. Immediately invalidate license cache so UI stops showing a draining wallet
    // the moment teardown begins — not after /stop retries complete (which can take
    // several seconds of retry delay). Without this, the licenseStatus poll kept
    // returning the active session's decreasing balance even after video had stopped.
    if (reason !== "unload") {
      queryClient.invalidateQueries({ queryKey: ["license-status", licKey] });
    }

    // 1. Clear timers immediately
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (tokenRefreshRef.current) { clearInterval(tokenRefreshRef.current); tokenRefreshRef.current = null; }

    // 2. Stop microphone tracks only — intentionally leave camera tracks running.
    // Camera tracks are stopped in teardownStream via cameraStreamRef ONLY when the
    // user navigates away (beforeunload). During a stream failure or normal stop the
    // camera preview must stay alive so the user can click Stream Now again without
    // having to re-enable the camera. Stopping camera tracks here caused the local
    // PiP to go black every time Decart disconnected or errored.
    micStreamRef.current?.getTracks().forEach(t => t.stop());

    // 3. Audio pipeline cleanup
    if (vuAnimFrameRef.current) { cancelAnimationFrame(vuAnimFrameRef.current); vuAnimFrameRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
    audioDelayNodeRef.current = null;
    audioGainNodeRef.current  = null;
    audioAnalyserRef.current  = null;
    micStreamRef.current = null;

    // 4. Disconnect using the CAPTURED ref snapshot (clientToClose).
    // decartClientRef.current is already null (cleared above) so if a new session
    // starts concurrently it writes its own client without interference from here.
    try { await clientToClose?.disconnect(); } catch { /* best effort */ }

    // 5. Clear video UI
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
      try {
        const v = popoutWindowRef.current.document.getElementById("v") as HTMLVideoElement | null;
        if (v) v.srcObject = null;
      } catch { /* cross-origin guard */ }
    }

    // 6. Reset state
    setIsStreaming(false);
    setAudioPipelineActive(false);
    setConnectionStatus("idle");
    // Reset audio toggle so it auto-starts fresh on the next session
    setAudioEnabled(false);
    audioEnabledRef.current = false;

    // 7. Call backend /stop with exponential-backoff retry.
    //
    // DESIGN (safe-stop guarantee):
    //   • Attempt 1 — awaited immediately so the caller can proceed once the
    //     first try lands. keepalive:true survives page-hide / tab close.
    //   • Attempts 2 & 3 — fire-and-forget background retries (500 ms / 1 500 ms).
    //     They run AFTER teardownStream returns so they NEVER delay the UI.
    //   • 404 / 409 are treated as success — session already stopped (idempotent).
    //   • Retries are skipped on the "unload" path; keepalive on attempt 1 is
    //     the only reliable mechanism during page teardown.
    //   • The backend settleSession() is fully idempotent — calling /stop twice
    //     on the same session is completely safe and has no billing side-effects.
    if (sid) {
      const lk = localStorage.getItem("fullswap_license_key") ?? "";
      const stopOpts = {
        method: "POST" as const,
        headers: { "Content-Type": "application/json", "X-License-Key": lk, "X-Device-ID": getDeviceId() },
        body: JSON.stringify({}),
        keepalive: true,
      };

      // Attempt 1 — awaited, keepalive so it survives unload
      let stopSucceeded = false;
      try {
        const r1 = await fetch(`/api/sessions/${sid}/stop`, stopOpts);
        // 200/201 = clean stop; 404 = already settled by sweeper; 409 = race (idempotent)
        stopSucceeded = r1.ok || r1.status === 404 || r1.status === 409;
      } catch { /* network error — fall through to background retries */ }

      // Attempts 2 & 3 — background retries, only when first attempt failed
      // and we are NOT in the unload path (keepalive on attempt 1 already covers that).
      if (!stopSucceeded && reason !== "unload") {
        (async () => {
          const backoffMs = [500, 1_500];
          for (const delay of backoffMs) {
            await new Promise<void>(res => setTimeout(res, delay));
            try {
              const rN = await fetch(`/api/sessions/${sid}/stop`, {
                ...stopOpts,
                keepalive: false, // keepalive not needed — page is still alive here
              });
              if (rN.ok || rN.status === 404 || rN.status === 409) return; // done
            } catch { /* continue to next retry */ }
          }
          // All retries exhausted — orphan sweeper will settle within 15 s (ORPHAN_GRACE_MS)
        })().catch(() => {});
      }
    }
    // Always invalidate license cache after any teardown (except page unload where
    // React state/query-client may already be destroyed). This covers the no_time
    // path where activeSessionRef was pre-cleared by the heartbeat handler before
    // teardownStream ran — without this, the exhausted wallet stayed stale until
    // the next 5s poll tick.
    if (reason !== "unload") {
      queryClient.invalidateQueries({ queryKey: ["license-status", licKey] });
    }

    setActiveSession(null);
    setElapsedSecs(0);

    if (!reason || (reason !== "license_exhausted" && reason !== "dropped" && reason !== "unload")) {
      toast({ title: "Session stopped", description: `Streamed for ${formatTime(secs)}` });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, licKey, toast]);

  // ══════════════════════════════════════════════════════════════════════
  // THREE-LAYER ARCHITECTURE (HOTFIX — FINAL CORRECT MODEL)
  //
  //  LAYER 1 — BILLING (real seconds, backend-only):
  //    paidSecsRemaining = streamStartRemRef - elapsedSecs
  //    → used ONLY for cost / Decart burn tracking — NEVER displayed
  //
  //  LAYER 2 — LICENSE CONTROL (server authority):
  //    realRemainingSeconds + licenseStatus from /api/license/status
  //    → access gating ONLY (noAccess, licenseExhausted) — NEVER for UI timer
  //
  //  LAYER 3 — DISPLAY (UX experience — what users see):
  //    displayPaidSecsRemaining = displayStartRemRef - elapsedSecs
  //    Seeded from server's displayRemainingSeconds at stream start.
  //    Resyncs from server every 5s heartbeat.
  //    Counts down 1 display-second per real second.
  //    NEVER used for stream termination, billing, or license checks.
  //
  // NOTE: These computations are declared HERE (before the exhaustion useEffects)
  // to prevent a TDZ crash. displayPaidSecsRemaining is referenced in the
  // useEffect deps array below — it must be initialized before that line executes.
  // ══════════════════════════════════════════════════════════════════════

  // LAYER 1: Real seconds — for billing tracking only, not rendered
  const paidSecsRemaining = isStreaming
    ? Math.max(0, streamStartRemRef.current - elapsedSecs)
    : remainingSeconds;
  const totalCapacitySecs    = Math.max(1, minutesAllocated * 60);
  const liveRemainingBarSecs = Math.max(0, paidSecsRemaining);

  // Display factor (billing_rate / 2.3 base rate)
  const TCE_BASE_RATE = 2.3;
  const displayFactor = liveRate != null && liveRate > 0
    ? Math.round((liveRate / TCE_BASE_RATE) * 1000) / 1000
    : 1;

  // LAYER 3: Display countdown — advances at displayFactor speed per real second
  // Matches server-side deduction rate: wallet drains at (billingRate/2.3) × real speed
  // At billingRate = 3 → factor ≈ 1.304 → 60-min key shows 0 at ~46 real minutes
  const displayPaidSecsRemaining: number = isStreaming
    ? Math.max(0, displayStartRemRef.current - Math.round(elapsedSecs * displayFactor))
    : Math.max(0, (licenseStatus.data as any)?.remainingSeconds ?? remainingSeconds);

  // Bar and label all derive from the display layer.
  const displayTotalCapacitySecs = Math.max(1, minutesAllocated * 60);
  const displayRemainingBarSecs  = displayPaidSecsRemaining;
  const barPct = Math.max(0, Math.min(1, displayPaidSecsRemaining / displayTotalCapacitySecs));

  // ── Pre-exhaustion client-side safety stop ──────────────────────────────────
  // Fires teardownStream slightly before wallet hits 0 to prevent UI/stream drift.
  // GUARD CONDITIONS (all must be true before triggering):
  //   • stream is actively running
  //   • pre-stop has NOT already been triggered this session
  //   • display remaining seconds has fallen to or below the threshold
  // Uses displayPaidSecsRemaining (not raw remainingSeconds) so the stop fires
  // when the USER'S visible countdown is near zero — not when the raw wallet
  // seconds hit 5 (which with billing-rate compression can show as 38s+ on screen).
  // Billing, compression factor, and pacing are completely unaffected — this is
  // a UX-only guard. Backend remains the authoritative enforcement layer.
  useEffect(() => {
    if (
      !isStreaming ||
      hasTriggeredPreStopRef.current ||
      displayPaidSecsRemaining == null ||
      displayPaidSecsRemaining > PRE_EXHAUSTION_THRESHOLD_SECS
    ) return;
    hasTriggeredPreStopRef.current = true;
    console.info(
      `[Stream] pre_exhaustion_warning: ${displayPaidSecsRemaining}s display remaining — stopping stream early (threshold=${PRE_EXHAUSTION_THRESHOLD_SECS}s)`
    );
    setLicenseExhausted(true);
    teardownStream("pre_exhaustion_warning");
  }, [displayPaidSecsRemaining, isStreaming, teardownStream]);

  // ── Display-exhaustion kill — stops stream the moment the UI timer hits 0:00 ──
  // ROOT CAUSE FIX: When displayPaidSecsRemaining reaches 0, the user's allocated
  // streaming time (as shown on screen) is fully consumed. Without this effect,
  // the stream continues running for up to 10+ seconds after the display shows
  // 0:00 — waiting for either the 5s poll pre-exhaustion or the 10s heartbeat
  // to fire. This closes that gap: the stream stops the instant the clock hits 0.
  //
  // The display timer uses the same billing-rate compression factor as server
  // billing, so display=0 is equivalent to wallet=0 from the user's perspective.
  // The backend heartbeat remains the authoritative kill for any edge cases
  // (e.g. disconnected tab where the display timer cannot run).
  useEffect(() => {
    if (!isStreaming || hasTriggeredPreStopRef.current || displayPaidSecsRemaining > 0) return;
    hasTriggeredPreStopRef.current = true;
    console.info("[Stream] display_exhaustion: displayPaidSecsRemaining=0 — stopping stream now");
    setLicenseExhausted(true);
    teardownStream("license_exhausted");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPaidSecsRemaining, isStreaming, teardownStream]);

  useEffect(() => {
    if (!localStorage.getItem("fullswap_license_key")) setLocation("/");
  }, [setLocation]);

  useEffect(() => {
    return () => { if (referenceImageUrl) URL.revokeObjectURL(referenceImageUrl); };
  }, [referenceImageUrl]);

  // Thin wrapper preserving the legacy call signature used across the component.
  // Delegates entirely to teardownStream so all paths share a single code path.
  const stopStreamInternally = useCallback(async (sessionId: string, secs: number, trialExpired = false) => {
    // FIX (Bug #3): Pass sessionId explicitly so teardownStream can call /stop even
    // when activeSessionRef has already been cleared by the caller (heartbeat no_time
    // and freeze paths both null the ref before calling this function).
    await teardownStream(trialExpired ? "license_exhausted" : undefined, sessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teardownStream]);

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
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    const { models: sdk } = await getDecartSdk();
    const model = sdk.realtime(LUCY_MODEL);
    const baseConstraints: MediaTrackConstraints = {
      frameRate: model.fps,
      width: model.width,
      height: model.height,
    };
    const resolvedId = deviceId || selectedCameraId;

    // FIX (BUG-004): Try with exact deviceId first; fall back to ideal if the device
    // is momentarily unavailable (OverconstrainedError / NotReadableError).
    // Without the fallback, switching cameras while one briefly initialises leaves
    // the camera feed permanently black with a misleading "access denied" toast.
    const attempts: MediaTrackConstraints[] = resolvedId
      ? [
          { ...baseConstraints, deviceId: { exact: resolvedId } },
          { ...baseConstraints, deviceId: { ideal: resolvedId } },
          baseConstraints,
        ]
      : [baseConstraints];

    let stream: MediaStream | null = null;
    let lastErr: unknown;
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
        break;
      } catch (err) {
        lastErr = err;
        const name = (err as DOMException)?.name ?? "";
        // Only retry on device/constraint errors — stop immediately on permission denial
        if (name === "NotAllowedError" || name === "PermissionDeniedError") break;
      }
    }

    if (!stream) {
      const name = (lastErr as DOMException)?.name ?? "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        toast({ title: "Camera permission denied", description: "Allow camera access in your browser settings, then try again.", variant: "destructive" });
      } else if (name === "OverconstrainedError") {
        toast({ title: "Camera not available", description: "The selected camera is unavailable. Try choosing a different one.", variant: "destructive" });
      } else if (name === "NotReadableError") {
        toast({ title: "Camera in use", description: "Another application is using this camera. Close it and try again.", variant: "destructive" });
      } else {
        toast({ title: "Camera error", description: (lastErr as DOMException)?.message || "Could not access camera.", variant: "destructive" });
      }
      return;
    }

    // FIX: audio: false — audio is captured separately by the audio pipeline.
    cameraStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    setCameraReady(true);
    await enumerateCameras();
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

  // Open a floating popout window for OBS capture.
  const openPopout = useCallback(() => {
    // If already open, just focus it
    if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
      popoutWindowRef.current.focus();
      return;
    }
    const popWin = window.open(
      "/popout",
      "fullswap-popout",
      "width=1280,height=720,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no",
    );
    if (!popWin) {
      toast({ title: "Popup blocked", description: "Allow popups for this site in your browser, then try again.", variant: "destructive" });
      return;
    }
    popoutWindowRef.current = popWin;
    setIsPopoutOpen(true);

    // Pipe the video stream once the popout DOM is ready
    const pipe = () => {
      if (!popWin || popWin.closed) return;
      try {
        const v = popWin.document.getElementById("v") as HTMLVideoElement | null;
        if (!v) { setTimeout(pipe, 100); return; }
        const stream = remoteVideoRef.current?.srcObject as MediaStream | null;
        if (stream) { v.srcObject = stream; v.play().catch(() => {}); }
      } catch { /* cross-origin guard */ }
    };
    if (popWin.document.readyState === "complete") { pipe(); }
    else { popWin.addEventListener("load", pipe, { once: true }); }

    // Detect when the user closes the popout via the OS close button
    const poll = setInterval(() => {
      if (popWin.closed) { clearInterval(poll); popoutWindowRef.current = null; setIsPopoutOpen(false); }
    }, 500);
  }, [toast]);

  const closePopout = useCallback(() => {
    if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
      popoutWindowRef.current.close();
    }
    popoutWindowRef.current = null;
    setIsPopoutOpen(false);
    setIsObsModeActive(false);
    setObsInstructions(false);
  }, []);

  // Opens a clean popout with all UI hidden — designed to be captured by OBS
  const openObsMode = useCallback(() => {
    if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
      popoutWindowRef.current.focus();
      setObsInstructions(true);
      return;
    }
    const popWin = window.open(
      "/popout?obs=1",
      "fullswap-popout",
      "width=1280,height=720,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no",
    );
    if (!popWin) {
      toast({ title: "Popup blocked", description: "Allow popups for this site in your browser, then try again.", variant: "destructive" });
      return;
    }
    popoutWindowRef.current = popWin;
    setIsPopoutOpen(true);
    setIsObsModeActive(true);
    setObsInstructions(true);

    const pipe = () => {
      if (!popWin || popWin.closed) return;
      try {
        const v = popWin.document.getElementById("v") as HTMLVideoElement | null;
        if (!v) { setTimeout(pipe, 100); return; }
        const stream = remoteVideoRef.current?.srcObject as MediaStream | null;
        if (stream) { v.srcObject = stream; v.play().catch(() => {}); }
      } catch { /* cross-origin guard */ }
    };
    if (popWin.document.readyState === "complete") { pipe(); }
    else { popWin.addEventListener("load", pipe, { once: true }); }

    const poll = setInterval(() => {
      if (popWin.closed) {
        clearInterval(poll);
        popoutWindowRef.current = null;
        setIsPopoutOpen(false);
        setIsObsModeActive(false);
        setObsInstructions(false);
      }
    }, 500);
  }, [toast]);

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

  const handleStartStream = async (isRetry = false, isTokenReconnect = false) => {
    // FIX #3: Synchronous ref guard + state guard to prevent duplicate sessions.
    // isStartingRef blocks the gap before React re-renders isStreamStarting=true.
    if (isStartingRef.current || isStreamStarting) return;
    isStartingRef.current = true;
    if (!isRetry) {
      // Fresh manual click — reset retry counter and clear any auto-retry UI
      autoRetryAttemptsRef.current = 0;
      setIsAutoRetrying(false);
    }
    decartConnectAttemptedRef.current = false; // reset credits guard for this attempt
    userStoppedRef.current = false; // clear for new session
    setIsStreamStarting(true);
    setConnectionStep("token"); // Step 1: fetch token

    // Desktop license guard
    if (typeof window !== "undefined" && (window as any).electronAPI?.isElectron) {
      const licCheck = await (window as any).electronAPI.license.check().catch(() => ({ licensed: false }));
      if (!licCheck.licensed) {
        isStartingRef.current = false;
        setIsStreamStarting(false);
        return;
      }
    }

    if (!cameraReady || !cameraStreamRef.current) {
      toast({ title: "Camera not ready", description: "Please enable your camera first", variant: "destructive" });
      isStartingRef.current = false;
      setIsStreamStarting(false);
      return;
    }

    // Guard: if camera tracks were externally stopped (e.g. OS revoked permission),
    // restart the camera now before attempting to connect. This keeps the flow
    // self-healing without requiring the user to manually re-enable the camera.
    const liveTracks = cameraStreamRef.current.getVideoTracks().filter(t => t.readyState === "live");
    if (liveTracks.length === 0) {
      await startCamera(selectedCameraId || undefined);
      if (!cameraStreamRef.current || cameraStreamRef.current.getVideoTracks().filter(t => t.readyState === "live").length === 0) {
        toast({ title: "Camera not ready", description: "Camera could not be restarted. Please enable it manually.", variant: "destructive" });
        isStartingRef.current = false;
        setIsStreamStarting(false);
        return;
      }
    }

    // Start audio pipeline immediately while still inside the user-gesture context
    // (the button click). Browsers block getUserMedia calls that originate outside
    // a direct user gesture — starting it here, before any await, guarantees the
    // permission prompt is allowed and the mic is ready by the time the first frame arrives.
    if (!audioEnabledRef.current) {
      audioEnabledRef.current = true;
      setAudioEnabled(true);
      startAudioPipeline(selectedMicId || undefined);
    }

    // Guard: verify WebRTC is available before attempting to use the Decart SDK
    if (typeof RTCPeerConnection === "undefined" || !RTCPeerConnection) {
      toast({
        title: "WebRTC not supported",
        description: "Your browser doesn't support WebRTC. Please use Chrome, Firefox, Safari, or Edge.",
        variant: "destructive",
      });
      isStartingRef.current = false;
      setIsStreamStarting(false);
      return;
    }

    // Guard: verify the Decart SDK exported correctly (loaded dynamically to avoid TDZ)
    let _sdk: _SdkModule;
    try {
      _sdk = await getDecartSdk();
    } catch {
      toast({ title: "SDK error", description: "Streaming SDK failed to load. Please refresh the page.", variant: "destructive" });
      isStartingRef.current = false;
      setIsStreamStarting(false);
      return;
    }
    const { createDecartClient, models } = _sdk;
    if (typeof createDecartClient !== "function") {
      console.error("[Decart] createDecartClient is not available:", createDecartClient);
      toast({ title: "SDK error", description: "Streaming SDK failed to load. Please refresh the page.", variant: "destructive" });
      isStartingRef.current = false;
      setIsStreamStarting(false);
      return;
    }

    try {
      // Fire session creation and token fetch in parallel — they are independent
      isStartingRef.current = false; // isStreaming=true + Stop Stream button covers guard from here
      setIsStreaming(true);
      setElapsedSecs(0);
      setConnectionStatus("connecting");

      // Use pre-warmed token if fresh (saves ~1-2s), otherwise fetch now
      const cachedToken = prewarmedTokenRef.current;
      const tokenIsFresh = !!cachedToken && prewarmedTokenExpiry.current > Date.now() + 30_000;
      if (tokenIsFresh) prewarmedTokenRef.current = null; // consume once
      const tokenPromise = tokenIsFresh ? Promise.resolve(cachedToken!) : fetchDecartToken();

      // Step 1+2 run in parallel: token fetch + session creation
      setConnectionStep("session"); // show "Creating session" while both are in-flight

      // PATCH-02: 409 auto-recovery — if SESSION_ALREADY_ACTIVE, auto-stop the
      // orphan and retry once so the user never has to wait 2 minutes manually.
      const [session, shortLivedKey] = await Promise.all([
        (async () => {
          try {
            return await startSession.mutateAsync({ data: { style: selectedStyle, ...(isTokenReconnect ? { tokenReconnect: true } : {}) } });
          } catch (startErr: unknown) {
            const errAny = startErr as any;
            const statusCode = errAny?.response?.status ?? errAny?.status ?? 0;
            const body: any = errAny?.response?.data ?? errAny?.data ?? (() => {
              try { return JSON.parse(errAny?.message ?? "{}"); } catch { return {}; }
            })();

            // ── 503 NO_KEYS_AVAILABLE — all Decart keys in cooldown ──────────
            if (statusCode === 503 || body?.error === "NO_KEYS_AVAILABLE") {
              const retryAfter = body?.retryAfterSeconds ?? body?.retryAfterSec ?? 60;
              setNoKeysRetryAt(Date.now() + retryAfter * 1000);
              setNoKeysRetryCountdown(retryAfter);
              setIsStreamStarting(false);
              toast({
                title: "Streaming slots temporarily full",
                description: `All connection slots are busy right now. Try again in ${retryAfter}s.`,
                variant: "destructive",
              });
              return;
            }
            // ─────────────────────────────────────────────────────────────────

            if (body?.code === "SESSION_ALREADY_ACTIVE" && body?.existingSessionId) {
              const orphanId = String(body.existingSessionId);
              const licKey = localStorage.getItem("fullswap_license_key") ?? "";
              console.info(`[Stream] orphan_auto_recovering orphanId=${orphanId}`);
              await fetch(`/api/sessions/${orphanId}/stop`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-License-Key": licKey, "X-Device-ID": getDeviceId() },
                body: JSON.stringify({}),
                keepalive: true,
              }).catch(() => {});
              await new Promise(r => setTimeout(r, 1500));
              return startSession.mutateAsync({ data: { style: selectedStyle } });
            }
            throw startErr; // not a 409 — re-throw for outer catch
          }
        })(),
        tokenPromise,
      ]);

      const sessionId = session.id;
      setActiveSession(sessionId);
      activeSessionRef.current = sessionId;
      hasTriggeredPreStopRef.current = false; // reset pre-exhaustion guard for this new session
      setIsStreamStarting(false);

      // Capture remaining seconds from license status at stream start for smooth countdown
      // and server-side kill threshold (5 credits/sec = 300/min → $0.05/sec → $180/hr)
      // Fall back to validatedRemainingRef when licenseStatus hasn't loaded yet for a
      // freshly-entered key (prevents countdown from immediately showing 0).
      const remainingAtStart     = licenseStatus.data?.remainingSeconds ?? validatedRemainingRef.current;
      streamStartRemRef.current  = remainingAtStart;
      // Seed display countdown from server's displayRemainingSeconds.
      // Falls back to compressed real seconds if field not yet available.
      // displayStartRemRef seeds from server remainingSeconds directly.
      // usedSeconds already drains at billingRate compression speed — no extra multiplication.
      displayStartRemRef.current = remainingAtStart;
      // trialLimitRef intentionally not set: exhaustion is determined ONLY
      // by the server heartbeat returning { ok: false, reason: "no_time" }.
      // DO NOT kill the stream from the client-side elapsed timer — that would
      // cause admin/user inconsistency when heartbeat billing lags the timer.

      // Timer uses wall-clock time so it stays accurate even when the browser
      // throttles setInterval in background tabs (e.g. user is in OBS).
      timerStartMsRef.current = 0; // will be stamped when first frame arrives

      const model = models.realtime(LUCY_MODEL);

      console.info("[Decart] Initialising SDK client with model:", LUCY_MODEL, "| enhance: true (quality mode)");
      let client;
      try {
        client = createDecartClient({ apiKey: shortLivedKey });
      } catch (sdkErr) {
        console.error("[Decart] SDK createDecartClient failed:", sdkErr);
        throw new Error("Streaming SDK failed to initialise. Please refresh and try again.");
      }
      const prompt = customPrompt || selectedStyleData?.prompt || "A person with a natural, realistic face";

      // CREDITS GUARD: mark that we are about to call Decart so the auto-retry
      // in the catch block knows NOT to retry — Decart has already reserved credits.
      decartConnectAttemptedRef.current = true;
      setConnectionStep("decart"); // Step 3: connecting to Decart

      connectStartMsRef.current = performance.now();
      // FIX: Clone each video track before handing to Decart.
      // MediaStreamTrack objects are shared by reference — if Decart internally calls
      // track.stop(), it would stop the track inside cameraStreamRef too, killing
      // the local camera preview. Cloning gives Decart fully independent tracks so
      // cameraStreamRef.current (and the local PiP) are never affected.
      const videoOnlyStream = new MediaStream(cameraStreamRef.current.getVideoTracks().map(t => t.clone()));
      const realtimeClient = await client.realtime.connect(videoOnlyStream, {
        model,
        initialState: {
          prompt: { text: prompt, enhance: true },
        },
        onRemoteStream: (editedStream) => {
          // Update video element on every frame (lightweight, no React state)
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = editedStream;
          // Pipe video stream to the popout (OBS source) if open
          if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
            try {
              const v = popoutWindowRef.current.document.getElementById("v") as HTMLVideoElement | null;
              if (v && !v.srcObject) { v.srcObject = editedStream; v.play().catch(() => {}); }
            } catch { /* cross-origin guard */ }
          }

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
            // EXHAUSTION RULE (patch §CRITICAL):
            // Do NOT terminate the session here. The client-side elapsed timer
            // may reach zero before the server does (heartbeat lag, display drift).
            // The ONLY valid exhaustion signal is the server heartbeat returning
            // { ok: false, reason: "no_time" } (line ~904). Killing here would cause
            // admin (real_used_seconds) and user (display) to disagree on license status.
          }, 1000);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(({ onStatus: (status: string) => {
          // Backup: transition to connected when SDK signals ready
          // (fires before first remote frame, ensures overlay hides promptly)
          if (status === "connected") setConnectionStatus("connected");
        } }) as any),
        onConnectionStateChange: (state: string) => {
          console.info("[Decart] Connection state →", state);
          if (state === "disconnected" || state === "failed") {
            // FIX (ROOT-CAUSE): The old code gated reconnect on a pre-warmed token
            // being "fresh" by a 29-second client-side timer. But the server token cache
            // returns the SAME token used to connect — which Decart already considers
            // expired at t=15 (TOKEN_WINDOW_HARD_CAP_SEC). So tokenFresh was always
            // false at the moment of reconnect, causing the stream to die at ~33s
            // remaining on every 1-minute key (27 real seconds × billingRate ≈ 33s).
            //
            // New approach: ALWAYS attempt reconnect if session is alive and user
            // didn't stop. A 12-second cooldown prevents reconnect storms.
            // handleStartStream fetches a guaranteed-fresh token from the server.
            // Guards still in place:
            //   • !userStoppedRef.current  — never reconnect on user-initiated stop
            //   • !!activeSessionRef.current — hard-kill / exhaustion-kill null this
            //     ref before disconnect, so reconnect never fires on those paths
            //   • reconnectCooldownRef — 12s minimum between reconnect attempts
            const now = Date.now();
            const cooldownOk = now - reconnectCooldownRef.current > 12_000;
            if (!userStoppedRef.current && !!activeSessionRef.current && cooldownOk) {
              reconnectCooldownRef.current = now;
              prewarmedTokenRef.current = null;
              prewarmedTokenExpiry.current = 0;
              connectionStatusRef.current = "connecting";
              setConnectionStatus("connecting");
              teardownStream("dropped").then(() => {
                // Double-check: bail if user stopped while teardown was in-flight
                if (!userStoppedRef.current) handleStartStream(false, true);
              }).catch(() => {});
              return;
            }
            // Stop display timer immediately so countdown doesn't freeze at last value
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            connectionStatusRef.current = "dropped";
            setConnectionStatus("dropped");
            toast({
              title: "Stream disconnected",
              description: "Connection lost — click Stream Now to reconnect.",
              variant: "destructive",
            });
            teardownStream("dropped").catch(() => {});
          }
        },
        onError: (err: unknown) => {
          const msg = (err as any)?.message ?? "Stream error — please try again.";
          console.error("[Decart] Stream error:", msg);
          setConnectionStatus("error");
          toast({ title: "Stream error", description: msg, variant: "destructive" });
        },
      });

      decartClientRef.current = realtimeClient;
      console.info("[Decart] SDK client connected successfully. Waiting for first remote frame...");

      // ── Token pre-warm: fire IMMEDIATELY then every 10s ───────────────────
      // ROOT-CAUSE FIX: TOKEN_WINDOW_HARD_CAP_SEC=15 means Decart drops the
      // connection after 15 seconds. The old loop fired every 25s — always too
      // late. When the drop came at t=15s, prewarmedTokenRef was still null so
      // the auto-reconnect guard failed and the stream broke (user saw "Stream
      // disconnected" at ~32s remaining = the 15s that had just been consumed).
      //
      // Fix: fire immediately on connect so a fresh token is ready well before
      // the 15s window expires, then keep refreshing every 10s so there is
      // always a valid token available for any reconnect that follows.
      // Safety: the interval is cleared by teardownStream on any disconnect path.
      if (tokenRefreshRef.current) clearInterval(tokenRefreshRef.current);
      const doTokenPrewarm = async () => {
        if (!decartClientRef.current) return;
        try {
          const freshToken = await fetchDecartToken();
          prewarmedTokenRef.current    = freshToken;
          prewarmedTokenExpiry.current = Date.now() + 29_000; // client-side staleness guard (not Decart token lifetime)
          console.info("[Decart] token_prewarm: fresh token ready for next reconnect");
        } catch (refreshErr) {
          console.warn("[Decart] token_prewarm: failed (non-fatal):", refreshErr);
        }
      };
      // Fire immediately so a token is ready before the 15s window expires
      doTokenPrewarm();
      // Then keep refreshing every 10s to stay ahead of every subsequent window
      tokenRefreshRef.current = setInterval(doTokenPrewarm, 10_000);

      // Attach Decart's session ID for cross-reference tracking.
      // Fire-and-forget — never blocks streaming, never throws.
      // Always fires: retries after 500 ms in case the SDK populates IDs
      // asynchronously, then falls back to a generated connection marker so
      // the /attach-decart-session call is NEVER skipped.
      {
        const _lk  = localStorage.getItem("fullswap_license_key") ?? "";
        const _did = getDeviceId();
        const extractDecartSid = (client: unknown): string | null => {
          const c = client as any;
          return c?.sessionId
            ?? c?.connectionId
            ?? c?.id
            ?? c?.session?.id
            ?? c?.connection?.id
            ?? c?.peer?.id
            ?? null;
        };
        const doAttach = (sid: string) => {
          fetch(`/api/sessions/${sessionId}/attach-decart-session`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-License-Key": _lk, "X-Device-ID": _did },
            body: JSON.stringify({ decartSessionId: sid }),
          }).catch(() => {});
          console.info("[Decart] attach-decart-session →", sid);
        };
        const immediateSid = extractDecartSid(realtimeClient);
        if (immediateSid) {
          doAttach(immediateSid);
        } else {
          setTimeout(() => {
            const delaySid = extractDecartSid(realtimeClient)
              ?? `decart-conn-${sessionId.slice(0, 8)}-${Date.now()}`;
            doAttach(delaySid);
          }, 500);
        }
      }

      // Apply reference image after connect — setImage() is the correct post-connect API.
      // We intentionally do NOT pass image in initialState: passing a File there causes
      // the SDK's imageToBase64() to run before WebRTC is established, and any failure
      // (size, format, server rejection) kills the entire connection.  Calling setImage()
      // here is non-fatal: if it fails the stream still works, just without the reference.
      if (referenceImage) {
        try {
          await realtimeClient.setImage(referenceImage, { prompt });
          console.info("[Decart] Reference image applied after connect");
        } catch (imgErr) {
          console.warn("[Decart] setImage after connect failed (non-fatal):", imgErr);
        }
      }

      // ── Stamp billingStartedAt server-side at the moment Decart starts metering ──
      // BUG #3 FIX: was fire-and-forget (.catch(() => {})) — if this request failed,
      // billingStartedAt was never set and the heartbeat anchored billing up to 30s
      // early. Now retried up to 3 times with 1s backoff so the anchor is reliable.
      {
        const licKey = localStorage.getItem("fullswap_license_key") ?? "";
        const anchorHeaders = { "Content-Type": "application/json", "X-License-Key": licKey, "X-Device-ID": getDeviceId() };
        const anchorUrl = `/api/sessions/${sessionId}/output-started`;
        (async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const r = await fetch(anchorUrl, { method: "POST", headers: anchorHeaders });
              if (r.ok) return; // success — billing anchor is set
            } catch { /* network error — retry */ }
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          }
          console.warn("[Stream] output-started failed after 3 attempts — heartbeat will anchor billing");
        })();
      }

      setConnectionStep(null); // clear step indicator — stream is live
      toast({ title: "Session started", description: "Stream is live — Real Time transformation active" });
    } catch (err: unknown) {
      setConnectionStatus("idle");
      setIsStreaming(false);
      setActiveSession(null);
      setConnectionStep(null); // clear step indicator on failure
      isStartingRef.current = false;
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

      // ── Auto-retry once on transient errors ───────────────────────────────
      // Skip retry for: invalid key (handled above), wallet empty (402),
      // rate limit (429/503), user-stopped, OR if Decart was already contacted
      // (decartConnectAttemptedRef=true) — retrying after Decart's realtime.connect()
      // was called would burn another window of credits for the failed attempt.
      // Only retries errors that happened BEFORE reaching Decart (token fetch /
      // session creation) which are genuinely free to retry.
      const isExhausted   = errMsg.includes("No streaming time") || errMsg.includes("LICENSE_EXHAUSTED");
      const isRateLimited = errMsg.includes("rate limit") || errMsg.includes("Too many") || errMsg.includes("cooldown");
      const canRetry = !isExhausted && !isRateLimited && !userStoppedRef.current
        && !decartConnectAttemptedRef.current  // CREDITS GUARD — never retry after Decart was called
        && autoRetryAttemptsRef.current < 1;
      if (canRetry) {
        autoRetryAttemptsRef.current += 1;
        setIsAutoRetrying(true);
        setIsStreamStarting(false);
        console.info(`[Stream] auto_retry attempt=${autoRetryAttemptsRef.current} reason="${errMsg}"`);
        setTimeout(() => {
          setIsAutoRetrying(false);
          handleStartStream(true);
        }, 2500);
        return;
      }

      setIsAutoRetrying(false);
      toast({ title: "Cannot start session", description: errMsg, variant: "destructive" });
    }
  };

  const handleStopStream = async () => {
    userStoppedRef.current = true; // mark as user-initiated stop
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
    try { await decartClientRef.current.set({ prompt: customPrompt || style?.prompt || "", enhance: true }); } catch { /* non-fatal */ }
  };

  const handlePromptChange = async (prompt: string) => {
    setCustomPrompt(prompt);
    if (!decartClientRef.current || !isStreaming) return;
    try { await decartClientRef.current.setPrompt(prompt || selectedStyleData?.prompt || "", { enhance: true }); } catch { /* non-fatal */ }
  };

  useEffect(() => {
    return () => {
      // Route through centralized teardown so all media/audio/billing cleanup
      // is handled in one place. teardownStream uses fetch+keepalive internally
      // so the /stop call flushes even after the component unmounts.
      // Popout window is still closed explicitly here since teardownStream
      // leaves it open (OBS users may want the window to persist between streams).
      if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
        popoutWindowRef.current.close();
        popoutWindowRef.current = null;
      }
      teardownStream("unload").catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleUnload() {
      // LEAK-04: Fire sendBeacon to /client-disconnect FIRST so the server
      // settles the session immediately — before the /stop keepalive request
      // even queues. sendBeacon is guaranteed to complete after page destroy;
      // the endpoint responds 200 instantly and settles asynchronously.
      const sid = activeSessionRef.current;
      if (sid) {
        try { navigator.sendBeacon(`/api/sessions/${sid}/client-disconnect`); } catch { /* non-fatal */ }
      }
      // Cannot await in synchronous unload handlers.
      // teardownStream("unload") uses fetch+keepalive internally so the /stop
      // request flushes even after the page is destroyed.
      // Also stop camera tracks here (only place we do it) so the OS camera
      // indicator light turns off when the user closes the tab/app.
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
      teardownStream("unload").catch(() => {});
    }
    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("beforeunload", handleUnload);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Heartbeat — ticks every 3s but fires at variable intervals.
  // RC#2: Normal mode fires every 10s. Low-wallet mode (<=30s remaining) fires
  // every 3s to tighten the detection gap and reduce post-expiry Decart billing.
  // FREEZE DETECTION: 3 consecutive fired heartbeats that all fail = frozen →
  // auto-kill immediately. In low-wallet mode this is 9s; normal mode is 30s.
  useEffect(() => {
    if (!isStreaming || !activeSession) return;
    let consecutiveFailures = 0;
    const MAX_FAILURES = 3;
    // RC#2: gate controls actual heartbeat fire frequency
    let lastHbFiredMs = 0;
    const NORMAL_HB_MS         = 5_000;  // fire every 5s (was 10s) — ensures heartbeat reaches server within 15s orphan window
    const LOW_WALLET_HB_MS     = 3_000;  // fire every 3s when wallet is nearly empty
    const LOW_WALLET_THRESH_SEC = 30;     // threshold to switch to fast mode

    const id = setInterval(async () => {
      // RC#2: compute wallet remaining from refs (no React state read in interval)
      const walletSec = Math.max(0, streamStartRemRef.current - elapsedSecsRef.current);
      const minGapMs  = walletSec <= LOW_WALLET_THRESH_SEC ? LOW_WALLET_HB_MS : NORMAL_HB_MS;
      if (Date.now() - lastHbFiredMs < minGapMs) return; // too soon — skip this tick
      lastHbFiredMs = Date.now();

      try {
        // AbortSignal.timeout may be unsupported in some environments —
        // fall back gracefully so heartbeats always reach the server.
        let abortSignal: AbortSignal | undefined;
        try { abortSignal = AbortSignal.timeout(8_000); } catch { abortSignal = undefined; }
        // PATCH-01: read session ID from ref (not closure) so a reconnect cycle
        // cannot fire a stale heartbeat against an already-stopped session.
        const currentSid = activeSessionRef.current;
        if (!currentSid) return; // session cleared between ticks — skip
        const res = await fetch(`/api/sessions/${currentSid}/heartbeat`, {
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
            // Kill the Decart WebRTC stream IMMEDIATELY — before any async work.
            // The server has already marked the session stopped. Disconnecting now
            // ensures the live video feed ends right away, not after the async
            // stopStreamInternally chain resolves.
            decartClientRef.current?.disconnect();
            decartClientRef.current = null;
            // Clear the popout video immediately so OBS shows a black/idle frame
            if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
              try {
                const v = popoutWindowRef.current.document.getElementById("v") as HTMLVideoElement | null;
                if (v) v.srcObject = null;
              } catch { /* cross-origin guard */ }
            }
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            // Stop timers immediately
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            if (tokenRefreshRef.current) { clearInterval(tokenRefreshRef.current); tokenRefreshRef.current = null; }

            toast({
              title: "Streaming time exhausted",
              description: "You have used all your streaming minutes. Contact admin to add more time to your license key.",
              variant: "destructive",
            });
            setLicenseExhausted(true);
            const sid = activeSessionRef.current;
            activeSessionRef.current = null; // clear immediately to prevent re-entry
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
        // FIX (BUG-007): clear ref BEFORE calling stopStreamInternally to prevent
        // a second interval tick from firing another /stop call for the same session.
        const sid = activeSessionRef.current;
        activeSessionRef.current = null;
        console.warn(`[Stream] freeze_detected sessionId=${sid} — killing stream after ${consecutiveFailures} failed heartbeats`);
        toast({
          title: "Stream connection lost",
          description: "The streaming connection froze. Your session has been stopped to protect your credits.",
          variant: "destructive",
        });
        if (sid) stopStreamInternally(sid, elapsedSecsRef.current, false);
      }
    }, 3_000); // RC#2: tick every 3s; gate above controls actual fire at 10s or 3s

    return () => clearInterval(id);
  // elapsedSecs removed from deps — read via elapsedSecsRef.current instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, activeSession, stopStreamInternally]);

  // Keep displayFactorRef in sync with the latest computed displayFactor so the
  // resync effect below can read a fresh value without a stale closure.
  useEffect(() => { displayFactorRef.current = displayFactor; }, [displayFactor]);

  // Recalibrate smooth countdown on each 5s server poll during streaming.
  // server.remainingSeconds = allocated - usedBefore - sessionElapsed
  // → effective start ref = remainingSeconds + currentElapsed (anchors smooth tick-down)
  //
  // FIX (Bug #2 — display drain): The display anchor must be:
  //   displayStartRef = serverRem + elapsed * displayFactor
  // NOT:
  //   displayStartRef = serverRem + elapsed          ← wrong for factor > 1
  //
  // Proof: display(t) = displayStartRef - t * F
  //   We want display(T) = serverRem (server truth at resync moment T).
  //   => serverRem = displayStartRef - T * F
  //   => displayStartRef = serverRem + T * F
  //
  // Using the wrong formula (serverRem + T) causes the display to lose
  // T*(F-1) extra display-seconds on every resync, making it hit the
  // pre-exhaustion threshold (≤5s) far too early and killing the stream.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isStreaming && licenseStatus.data?.remainingSeconds !== undefined) {
      const serverRem = licenseStatus.data.remainingSeconds;
      const F = displayFactorRef.current;
      // Real-seconds anchor: unchanged — paidSecsRemaining drains 1:1 per real second.
      streamStartRemRef.current  = serverRem + elapsedSecsRef.current;
      // Display anchor: multiply elapsed by F so display drains at the correct compressed rate.
      displayStartRemRef.current = serverRem + elapsedSecsRef.current * F;
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
        // Seed display ref immediately on key renewal (pre-load before status poll lands)
        // Seed display ref from server remaining directly (already reflects compression)
        displayStartRemRef.current = data.remainingSeconds ?? 0;
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
  // Listen for stop/reconnect signals from the popout window
  // "fullswap-stop"      — user clicked Stop Stream or closed the popout
  // "fullswap-reconnect" — user clicked Reconnect Stream after the feed dropped
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data === "fullswap-stop") {
        const sid = activeSessionRef.current;
        if (sid) {
          // LEAK-04: fire sendBeacon before async teardown so the server
          // settles the session immediately when the OBS popout window is closed.
          try { navigator.sendBeacon(`/api/sessions/${sid}/client-disconnect`); } catch { /* non-fatal */ }
          stopStreamInternally(sid, elapsedSecsRef.current, false);
        }
      } else if (e.data === "fullswap-reconnect") {
        // Only reconnect if we are not already streaming
        if (!activeSessionRef.current && cameraReady) {
          handleStartStream();
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopStreamInternally, cameraReady]);

  // NOTE: Pre-warming the token on camera-ready was removed.
  // The server hard-caps tokens at TOKEN_WINDOW_HARD_CAP_SEC (15s). A token
  // fetched when the camera becomes ready expires at Decart's end within 15s,
  // long before the user clicks "Stream Now". Passing that expired token to
  // createDecartClient() caused Decart to reject it with "invalid API key",
  // wasting credits on a failed session start. Tokens are now always fetched
  // fresh at click-time so they are guaranteed to be valid.


  // CSS-based fullscreen — works in all contexts including sandboxed iframes
  const handleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Keyboard shortcuts:
  //   F          — open OBS popout (or focus if already open); also toggles fullscreen
  //   Escape     — close OBS popout if open; stop active stream; exit fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Close popout first if it is open
        if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
          popoutWindowRef.current.close();
          popoutWindowRef.current = null;
          setIsPopoutOpen(false);
        }
        // Stop the active stream
        const sid = activeSessionRef.current;
        if (sid) {
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
        // Open / focus the OBS popout
        openPopout();
        // Also toggle fullscreen so the AI output fills the screen on this side
        setIsFullscreen(prev => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stopStreamInternally, openPopout]);

  return (
    <AppLayout>
      {showBanner && (
        <ElectronRefreshBanner onRefresh={refreshElectron} onDismiss={dismissBanner} />
      )}
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
                  {isStreaming ? formatTime(displayPaidSecsRemaining) : `${Math.floor(displayPaidSecsRemaining / 60).toFixed(0)}m ${displayPaidSecsRemaining % 60}s`}
                </span>
                <span className="text-muted-foreground text-xs">{isStreaming ? "time left" : "time"}</span>
              </div>
            )}
            {/* Live session timer */}
            {isStreaming && (
              <div className="flex items-center gap-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg" data-testid="status-live">
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                <span className="text-red-400 font-mono font-bold text-sm">{isAdminUser ? formatTime(elapsedSecs) : formatTime(displayPaidSecsRemaining)}</span>
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
                  {formatTime(displayRemainingBarSecs)}
                </span>
                <span className="text-xs text-muted-foreground">/ {formatTime(displayTotalCapacitySecs)}</span>
              </div>
            </div>

            {/* The bar itself — shrinks left-to-right as minutes are consumed */}
            {/* barPct is always based on REAL wallet seconds — billing truth */}
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
                {liveRate != null && (
                  <span className="text-yellow-500/70 font-mono font-medium">⚡ Live billing active</span>
                )}
              </span>
              {barPct <= 0.15 && displayRemainingBarSecs > 0 ? (
                <span className="text-red-400 font-medium">⚠ Running low — contact admin</span>
              ) : (
                <span>{Math.floor(displayRemainingBarSecs / 60)}m {displayRemainingBarSecs % 60}s left</span>
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
              {/* AI output — scaleX(-1) mirrors the output to selfie-view orientation.
              The raw camera is sent to Decart unmirrored; Lucy 2.1 outputs in the same
              orientation (physical left hand appears on right side of frame). Applying
              scaleX(-1) here matches the local webcam PiP selfie view so hand movements
              appear on the correct side as the user expects. */}
              <video ref={remoteVideoRef} autoPlay playsInline
                className="w-full h-full"
                style={{ display: "block", objectFit: "cover", backfaceVisibility: "hidden", willChange: "transform", transform: "scaleX(-1)" }} />

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
                  <button
                    onClick={() => handleStartStream(false)}
                    disabled={isStreamStarting || isAutoRetrying || startSession.isPending || noKeysRetryAt !== null}
                    className="mt-1 flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
                  >
                    {(isStreamStarting || isAutoRetrying || startSession.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {isAutoRetrying
                      ? "Retrying..."
                      : isStreamStarting
                        ? "Preparing..."
                        : startSession.isPending
                          ? "Starting..."
                          : noKeysRetryAt !== null
                            ? `Retry in ${noKeysRetryCountdown}s`
                            : "Stream Now"}
                  </button>
                  {(isStreamStarting || isAutoRetrying) && (
                    <p className="text-xs text-primary/70 font-mono mt-1 animate-pulse">
                      {isAutoRetrying
                        ? "↻ Connection failed — retrying safely..."
                        : connectionStep === "decart"
                          ? "3/3 · Connecting to Decart..."
                          : connectionStep === "session"
                            ? "2/3 · Creating session..."
                            : "1/3 · Fetching stream token..."}
                    </p>
                  )}
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

              {/* Top-left group: close button — z-index 20 */}
              <div className="absolute top-3 left-3 flex flex-col items-start gap-2" style={{ zIndex: 20 }}>
                {/* X close button — only visible in fullscreen */}
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


              {/* Top-right controls — OBS popout + fullscreen (hidden in fullscreen) */}
              {!isFullscreen && (
                <div className="absolute top-3 right-3 flex gap-2" style={{ zIndex: 20 }}>
                  {/* OBS MODE button — opens clean popout designed for OBS capture */}
                  <button
                    onClick={isObsModeActive ? closePopout : openObsMode}
                    title={isObsModeActive ? "Close OBS Mode" : "Open OBS Mode — clean window for OBS capture"}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-full transition-all hover:brightness-125 cursor-pointer"
                    style={{
                      background: isObsModeActive ? "rgba(0,210,211,0.9)" : "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: isObsModeActive ? "1px solid rgba(0,210,211,0.6)" : "1px solid rgba(255,255,255,0.2)",
                      fontSize: 11, fontWeight: 700, fontFamily: "monospace", letterSpacing: 1,
                      boxShadow: isObsModeActive ? "0 0 12px rgba(0,210,211,0.4)" : "none",
                    }}
                  >
                    <Monitor className="w-3 h-3" />
                    OBS
                  </button>
                  {/* OBS instructions panel — shown when OBS mode is active */}
                  {obsInstructions && (
                    <div
                      className="absolute top-10 right-0 rounded-xl p-3 text-left"
                      style={{
                        width: 260, background: "hsl(222 44% 7%)", border: "1px solid rgba(0,210,211,0.3)",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.6)", zIndex: 30,
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(0,210,211,1)", fontFamily: "monospace", letterSpacing: 1 }}>
                          ● OBS CONNECTED
                        </span>
                        <button onClick={() => setObsInstructions(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
                      </div>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 8, lineHeight: 1.5 }}>
                        A clean output window is open with all controls hidden.
                      </p>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", lineHeight: 1.6 }}>
                        <p style={{ fontWeight: 700, marginBottom: 4, color: "rgba(0,210,211,0.9)" }}>Option A — Window Capture:</p>
                        <p style={{ marginBottom: 8, color: "rgba(255,255,255,0.55)" }}>In OBS → Sources → + → Window Capture → select the AI Output window</p>
                        <p style={{ fontWeight: 700, marginBottom: 4, color: "rgba(0,210,211,0.9)" }}>Option B — Browser Source:</p>
                        <p style={{ color: "rgba(255,255,255,0.55)" }}>In OBS → + → Browser Source → paste your app URL + <code style={{ color: "rgba(0,210,211,0.9)" }}>/popout?obs=1</code></p>
                      </div>
                    </div>
                  )}
                  {/* Regular popout button */}
                  <button
                    onClick={isPopoutOpen && !isObsModeActive ? closePopout : openPopout}
                    title={isPopoutOpen && !isObsModeActive ? "Close popout" : "Float output in a separate window"}
                    className="flex items-center justify-center w-8 h-8 rounded-full transition-all hover:brightness-125 cursor-pointer"
                    style={{
                      background: isPopoutOpen && !isObsModeActive ? "rgba(0,210,211,0.85)" : "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: isPopoutOpen && !isObsModeActive ? "1px solid rgba(0,210,211,0.5)" : "1px solid rgba(255,255,255,0.2)",
                    }}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </button>
                  {/* Fullscreen */}
                  <button
                    onClick={handleFullscreen}
                    title="Fullscreen"
                    className="flex items-center justify-center w-8 h-8 rounded-full transition-all hover:bg-white/20 cursor-pointer"
                    style={{ background: "rgba(0,0,0,0.55)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Webcam PiP — hidden in fullscreen so only AI output shows */}
              {!isFullscreen && (
                <div
                  className="absolute bottom-3 left-3 rounded-xl overflow-hidden border border-white/20 bg-black"
                  style={{ width: "22%", aspectRatio: "16/9", boxShadow: "0 4px 20px rgba(0,0,0,0.6)", zIndex: 10 }}
                >
                  <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" style={{ transform: "scaleX(-1) translateZ(0)", backfaceVisibility: "hidden", willChange: "transform" }} />
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

            {/* Start / Stop button — always shown below camera source */}
            <div className="flex items-center gap-3">
              {isStreaming || connectionStatus === "connecting" ? (
                <Button
                  data-testid="button-stop-stream"
                  onClick={handleStopStream}
                  variant="destructive"
                  disabled={stopSession.isPending}
                  className="gap-2 flex-1 h-14 text-base font-bold"
                >
                  <Square className="w-5 h-5" />
                  {stopSession.isPending ? "Stopping..." : "Stop Stream"}
                </Button>
              ) : (
                <Button
                  data-testid="button-start-stream"
                  onClick={() => handleStartStream(false)}
                  disabled={isStreamStarting || isAutoRetrying || startSession.isPending || !cameraReady || noAccess || licenseExhausted || noKeysRetryAt !== null}
                  className="gap-2 flex-1 h-14 text-base font-bold tracking-wide"
                  style={{ boxShadow: "0 0 28px hsl(187 100% 52% / 0.30)" }}
                >
                  {(isStreamStarting || isAutoRetrying || startSession.isPending)
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <Play className="w-5 h-5" />}
                  {isAutoRetrying
                    ? "Retrying..."
                    : isStreamStarting
                      ? "Preparing..."
                      : startSession.isPending
                        ? "Starting..."
                        : noKeysRetryAt !== null
                          ? `Retry in ${noKeysRetryCountdown}s`
                          : "Stream Now"}
                </Button>
              )}
            </div>

            {/* Step indicator — shows exactly which startup stage is in progress */}
            {(isStreamStarting || isAutoRetrying) && (
              <div className="flex items-center justify-center gap-2 mt-1">
                <Loader2 className="w-3 h-3 text-primary/60 animate-spin flex-shrink-0" />
                <p className="text-xs text-primary/70 font-mono animate-pulse">
                  {isAutoRetrying
                    ? "↻ Retrying safely — no credits used yet..."
                    : connectionStep === "decart"
                      ? "3/3 · Connecting to Decart..."
                      : connectionStep === "session"
                        ? "2/3 · Creating session..."
                        : "1/3 · Fetching stream token..."}
                </p>
              </div>
            )}

            {/* No streaming time remaining — shown below button when applicable */}
            {(noAccess || licenseExhausted) && !isStreaming && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
                <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-300">No streaming time remaining</p>
                  <p className="text-xs text-amber-400/70 truncate">Contact your admin to add more minutes — @rich_life2k15</p>
                </div>
              </div>
            )}

            {/* OBS Instructions — below wallet message */}
            <div className="p-4 bg-card border border-border rounded-xl space-y-4">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">OBS Setup Guide</span>
              </div>

              {/* Step 1 */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-primary uppercase tracking-wider">Step 1 — Start your stream first</p>
                <ol className="space-y-1 text-xs text-muted-foreground list-none">
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">1</span>
                    Open the <span className="text-foreground font-medium">Full Swap Desktop App</span> — everything is built in, no browser needed.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">2</span>
                    Enable your camera, click <span className="text-foreground font-medium">Stream Now</span>, and wait for AI output to appear.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">3</span>
                    Toggle <span className="text-foreground font-medium">Audio Sync ON</span> — this delays your mic to match the AI video processing lag.
                  </li>
                </ol>
              </div>

              <div className="border-t border-border" />

              {/* Step 2 */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-primary uppercase tracking-wider">Step 2 — Capture output in OBS</p>
                <div className="space-y-2">
                  <div className="rounded-lg px-3 py-2 text-xs space-y-1" style={{ background: "hsl(187 100% 52% / 0.06)", border: "1px solid hsl(187 100% 52% / 0.18)" }}>
                    <p className="text-foreground font-semibold">Option A — Window Capture (recommended)</p>
                    <ol className="space-y-0.5 text-muted-foreground list-none">
                      <li>1. OBS → <span className="text-foreground">+</span> → <span className="text-foreground font-medium">Window Capture</span></li>
                      <li>2. Select <span className="text-foreground font-medium">Full Swap</span> from the window list</li>
                      <li>3. Capture Method: <span className="text-foreground font-medium">Windows Graphics Capture</span></li>
                      <li>4. Resize/crop to fit your scene → OK</li>
                    </ol>
                  </div>
                  <div className="rounded-lg px-3 py-2 text-xs space-y-1" style={{ background: "hsl(0 0% 100% / 0.03)", border: "1px solid hsl(0 0% 100% / 0.08)" }}>
                    <p className="text-foreground font-semibold">Option B — Display Capture (fullscreen mode)</p>
                    <ol className="space-y-0.5 text-muted-foreground list-none">
                      <li>1. Click <span className="text-foreground font-medium">Fullscreen</span> on the AI output in the app</li>
                      <li>2. OBS → <span className="text-foreground">+</span> → <span className="text-foreground font-medium">Display Capture</span></li>
                      <li>3. Select the monitor the app is fullscreened on → OK</li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Step 3 */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-primary uppercase tracking-wider">Step 3 — Audio routing (no setup needed)</p>
                <div className="rounded-lg px-3 py-2.5 text-xs space-y-2" style={{ background: "hsl(187 100% 52% / 0.06)", border: "1px solid hsl(187 100% 52% / 0.18)" }}>
                  <p className="text-foreground font-semibold">The app handles your mic — do not add a mic in OBS.</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Full Swap captures your microphone directly and applies the <span className="text-foreground font-medium">Audio Sync</span> delay automatically. OBS simply receives the app's audio output through the window or display capture — no extra mic source required.
                  </p>
                </div>
                <ol className="space-y-1 text-xs text-muted-foreground list-none">
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">1</span>
                    In OBS <span className="text-foreground font-medium">Audio Mixer</span>, make sure <span className="text-foreground font-medium">no separate Mic/Aux source</span> is added — adding one causes double audio and echo.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">2</span>
                    OBS Settings → Audio → set <span className="text-foreground font-medium">Desktop Audio to Disabled</span> and <span className="text-foreground font-medium">Mic/Auxiliary to Disabled</span> — the app's capture already carries the synced audio.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">3</span>
                    The audio you hear in OBS preview should come only from the <span className="text-foreground font-medium">Window/Display Capture</span> source — that's the correctly synced output.
                  </li>
                </ol>
              </div>

              <div className="border-t border-border" />

              {/* Step 4 */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-primary uppercase tracking-wider">Step 4 — Audio capture in Full Swap</p>
                <ol className="space-y-1 text-xs text-muted-foreground list-none">
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">1</span>
                    When the app asks for microphone access, click <span className="text-foreground font-medium">Allow</span> — this lets Full Swap capture your voice directly.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">2</span>
                    If you have multiple microphones, select the correct one from the <span className="text-foreground font-medium">Input Camera Source</span> area before starting your stream.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">3</span>
                    Toggle <span className="text-foreground font-medium">Audio Sync ON</span> in the right panel — this delays your mic output to stay in perfect sync with the AI face-swap video.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">4</span>
                    Speak a few words after starting the stream and watch the AI output — your voice and the transformed face should be in sync. If not, toggle Audio Sync off and on again to re-calibrate.
                  </li>
                </ol>
              </div>

              {/* Checklist */}
              <div className="rounded-lg px-3 py-2.5 space-y-1.5" style={{ background: "hsl(143 72% 42% / 0.06)", border: "1px solid hsl(143 72% 42% / 0.20)" }}>
                <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Pre-stream checklist</p>
                <ul className="space-y-1 text-xs text-muted-foreground list-none">
                  {[
                    "Full Swap app open with AI output visible",
                    "Microphone access allowed in the app",
                    "Audio Sync toggled ON",
                    "OBS capturing the Full Swap app window",
                    "No separate mic or desktop audio source added in OBS",
                    "Test recording confirms lips and voice are in sync",
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="text-emerald-400 text-base leading-none">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Renew / Top Up License Key — below OBS instructions */}
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
                  style={{ background: "hsl(222 47% 4%)", border: "1px solid hsl(187 100% 52% / 0.3)", color: "hsl(187 100% 90%)" }}
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
                  renewOk ? "text-emerald-400" : "text-red-400"
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

          {/* ── RIGHT-SIDE CONTROL PANEL ─────────────────────────────── */}
          <div className="space-y-4">

            {/* 1. Audio Sync — fast access at top */}
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

            {/* 2. Upload Picture / Reference Image */}
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

            {/* 3. Live Prompt / Comment input */}
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

            {/* 4. Transformation Style — collapsible */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setStyleCollapsed(prev => !prev)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground tracking-wide">Transformation Style</h3>
                  {styleCollapsed && (
                    <span className="text-xs text-primary font-medium font-mono px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                      {STYLES.find(s => s.id === selectedStyle)?.name ?? "Natural"}
                    </span>
                  )}
                </div>
                <ChevronDown
                  className="w-4 h-4 text-muted-foreground transition-transform duration-200"
                  style={{ transform: styleCollapsed ? "rotate(0deg)" : "rotate(180deg)" }}
                />
              </button>
              {!styleCollapsed && (
                <div className="px-5 pb-5 space-y-2">
                  <p className="text-xs text-muted-foreground mb-3">Pick a style to apply</p>
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
              )}
            </div>

          </div>

        </div>
      </div>
    </AppLayout>
  );
}
