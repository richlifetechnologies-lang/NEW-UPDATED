import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setLicenseKeyGetter } from "@workspace/api-client-react";
import { getLicenseKey } from "@/lib/auth";

// Inject the license key into every generated API hook automatically.
// This ensures useStartSession, useStopSession, and any other generated
// hook that calls a license-gated endpoint sends X-License-Key without
// each call site having to add it manually.
setLicenseKeyGetter(() => getLicenseKey());

createRoot(document.getElementById("root")!).render(<App />);
