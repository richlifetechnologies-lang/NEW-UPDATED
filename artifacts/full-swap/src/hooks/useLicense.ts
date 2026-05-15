import { useState, useEffect, useCallback, useRef } from "react";
import { getLicenseKey, setLicenseKey, clearLicenseKey, getDeviceId } from "@/lib/auth";

type ElectronLicenseAPI = {
  check: () => Promise<{ licensed: boolean; key?: string; activatedAt?: string }>;
  activate: (key: string) => Promise<{ success: boolean; error?: string }>;
  getDeviceId: () => Promise<string>;
};

type ElectronAPI = {
  isElectron?: boolean;
  license?: ElectronLicenseAPI;
  openExternal?: (url: string) => void;
};

declare global {
  interface Window { electronAPI?: ElectronAPI; }
}

export type LicenseState = {
  isElectron: boolean;
  isLicensed: boolean;
  isLoading: boolean;
  error: string | null;
  activateLicense: (key: string) => Promise<{ success: boolean; error?: string }>;
  recheckLicense: () => Promise<void>;
  deactivateLicense: () => void;
};

export function useLicense(): LicenseState {
  const isElectron = Boolean(window.electronAPI?.isElectron);
  // For web: check localStorage immediately. For Electron: start as loading.
  const [isLicensed, setIsLicensed] = useState(() => !isElectron && !!getLicenseKey());
  const [isLoading, setIsLoading] = useState(isElectron);
  const [error, setError] = useState<string | null>(null);
  const checkedRef = useRef<boolean>(false);

  const recheckLicense = useCallback(async () => {
    if (isElectron) {
      if (!window.electronAPI?.license) return;
      try {
        setIsLoading(true);
        const result = await window.electronAPI.license.check();
        if (result.licensed && result.key) {
          // CRITICAL: Sync Electron license key to localStorage so web API calls work
          setLicenseKey(result.key);
        } else if (!result.licensed) {
          clearLicenseKey();
        }
        setIsLicensed(result.licensed);
      } catch {
        setIsLicensed(false);
      } finally {
        setIsLoading(false);
      }
    } else {
      const storedKey = getLicenseKey();
      if (!storedKey) { setIsLicensed(false); return; }
      try {
        setIsLoading(true);
        const res = await fetch("/api/license/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: storedKey, deviceId: getDeviceId() }),
        });
        const data = await res.json();
        if (data.valid) {
          setIsLicensed(true);
        } else {
          clearLicenseKey();
          setIsLicensed(false);
          setError(data.error ?? "License key is no longer valid");
        }
      } catch {
        setIsLicensed(true); // Network error — keep existing state for offline use
      } finally {
        setIsLoading(false);
      }
    }
  }, [isElectron]);

  useEffect(() => {
    if (!checkedRef.current) {
      checkedRef.current = true;
      recheckLicense();
    }
  }, [recheckLicense]);

  const activateLicense = useCallback(async (key: string) => {
    setError(null);
    if (isElectron) {
      if (!window.electronAPI?.license) return { success: false, error: "Not running in desktop app" };
      try {
        const result = await window.electronAPI.license.activate(key.trim());
        if (result.success) {
          // CRITICAL: Sync activated license key to localStorage so web API calls work
          setLicenseKey(key.trim().toUpperCase());
          setIsLicensed(true);
        } else {
          setError(result.error ?? "Activation failed");
        }
        return result;
      } catch {
        const msg = "Failed to activate license. Please check your connection.";
        setError(msg);
        return { success: false, error: msg };
      }
    } else {
      try {
        setIsLoading(true);
        const res = await fetch("/api/license/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: key.trim().toUpperCase(), deviceId: getDeviceId() }),
        });
        const data = await res.json();
        if (data.valid) {
          setLicenseKey(key.trim().toUpperCase());
          setIsLicensed(true);
          return { success: true };
        } else {
          const msg = data.error ?? "Invalid license key";
          setError(msg);
          return { success: false, error: msg };
        }
      } catch {
        const msg = "Failed to validate license. Please check your connection.";
        setError(msg);
        return { success: false, error: msg };
      } finally {
        setIsLoading(false);
      }
    }
  }, [isElectron]);

  const deactivateLicense = useCallback(() => {
    if (!isElectron) { clearLicenseKey(); setIsLicensed(false); }
  }, [isElectron]);

  return { isElectron, isLicensed, isLoading, error, activateLicense, recheckLicense, deactivateLicense };
}
