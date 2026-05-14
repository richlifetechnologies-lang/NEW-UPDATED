import { useEffect, useRef, useState } from "react";

export default function PopoutPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reconnectVisible, setReconnectVisible] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [muted, setMuted] = useState(false);

  // Detect video drop
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded  = () => setReconnectVisible(true);
    const onEmptied = () => setReconnectVisible(true);
    v.addEventListener("ended",   onEnded);
    v.addEventListener("emptied", onEmptied);
    return () => {
      v.removeEventListener("ended",   onEnded);
      v.removeEventListener("emptied", onEmptied);
    };
  }, []);

  // Listen for reconnecting state from parent
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data === "fullswap-reconnecting") {
        setReconnecting(true);
        setReconnectVisible(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Track fullscreen state
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Notify parent stream page when this popout is closed via the OS X button
  // This fires before the window closes, giving the parent time to stop the stream.
  useEffect(() => {
    const handleUnload = () => {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage("fullswap-stop", "*");
      }
    };
    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setMuted(videoRef.current.muted);
    }
  };

  const handleReconnect = () => {
    setReconnecting(true);
    setReconnectVisible(false);
    if (window.opener) {
      window.opener.postMessage("fullswap-reconnect", "*");
    }
  };

  // Stop button: signals parent to end the stream then closes this popout
  const handleStopStream = () => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage("fullswap-stop", "*");
    }
    window.close();
  };

  return (
    <div style={{ margin: 0, padding: 0, width: "100vw", height: "100vh", background: "#000", overflow: "hidden", position: "relative" }}>
      {/* FIX: scaleX(-1) mirrors AI output to match webcam preview orientation.
          Right-hand movements in the webcam preview should appear as right-hand
          in the AI output — without this transform they appear reversed. */}
      <video
        id="v"
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", transform: "scaleX(-1)" }}
      />

      {/* Badge */}
      <div style={{
        position: "fixed", top: 12, left: 12,
        background: "rgba(0,210,211,0.85)", color: "#fff",
        fontFamily: "monospace", fontSize: 11, fontWeight: 700,
        padding: "4px 10px", borderRadius: 20, letterSpacing: 1,
        pointerEvents: "none",
      }}>
        ● FULL SWAP BY RICH · AI OUTPUT
      </div>

      {/* Top-right controls */}
      <div style={{ position: "fixed", top: 10, right: 12, display: "flex", gap: 6 }}>
        <button
          onClick={toggleMute}
          title={muted ? "Unmute" : "Mute"}
          style={{
            background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.2)",
            color: "#fff", fontSize: 13, padding: "5px 11px", borderRadius: 8,
            cursor: "pointer", fontFamily: "sans-serif", userSelect: "none",
          }}
        >
          {muted ? "🔇 Unmute" : "🔊 Mute"}
        </button>
        <button
          onClick={toggleFullscreen}
          title="Toggle fullscreen"
          style={{
            background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.2)",
            color: "#fff", fontSize: 13, padding: "5px 11px", borderRadius: 8,
            cursor: "pointer", fontFamily: "sans-serif", userSelect: "none",
          }}
        >
          {isFullscreen ? "✕ Exit Fullscreen" : "⛶ Fullscreen"}
        </button>
        {/* Stop Stream — ends the session in the parent window and closes popout */}
        <button
          onClick={handleStopStream}
          title="Stop streaming and close this window"
          style={{
            background: "rgba(200,30,30,0.85)", border: "1px solid rgba(255,80,80,0.4)",
            color: "#fff", fontSize: 13, padding: "5px 11px", borderRadius: 8,
            cursor: "pointer", fontFamily: "sans-serif", userSelect: "none",
            fontWeight: 700,
          }}
        >
          ■ Stop Stream
        </button>
      </div>

      {/* Reconnecting indicator */}
      {reconnecting && !reconnectVisible && (
        <div style={{
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          color: "rgba(255,255,255,0.5)", fontFamily: "sans-serif", fontSize: 13,
        }}>
          Reconnecting...
        </div>
      )}

      {/* Reconnect button — shown when stream drops */}
      {reconnectVisible && (
        <div style={{
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        }}>
          <p style={{ color: "rgba(255,255,255,0.5)", fontFamily: "sans-serif", fontSize: 12, margin: 0 }}>
            Stream connection lost
          </p>
          <button
            onClick={handleReconnect}
            style={{
              background: "rgba(0,210,211,0.9)", border: "none", color: "#000",
              fontFamily: "sans-serif", fontSize: 14, fontWeight: 700,
              padding: "10px 24px", borderRadius: 10, cursor: "pointer",
            }}
          >
            ↺ Reconnect Stream
          </button>
        </div>
      )}

    </div>
  );
}
