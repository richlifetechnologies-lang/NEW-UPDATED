import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setLicenseKeyGetter, setDeviceIdGetter } from "@workspace/api-client-react";
import { getLicenseKey, getDeviceId } from "@/lib/auth";

// Inject the license key into every generated API hook automatically.
// This ensures useStartSession, useStopSession, and any other generated
// hook that calls a license-gated endpoint sends X-License-Key without
// each call site having to add it manually.
setLicenseKeyGetter(() => getLicenseKey());

// Inject the device fingerprint into every generated API hook automatically.
// The server uses X-Device-ID to enforce the one-key-per-device rule:
// first request binds the key to this browser profile; subsequent requests
// from a different device ID are rejected until an admin unbinds from /admin/users.
setDeviceIdGetter(() => getDeviceId());

createRoot(document.getElementById("root")!).render(<App />);
