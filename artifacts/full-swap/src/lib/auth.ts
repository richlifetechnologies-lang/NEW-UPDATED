export function getLicenseKey(): string | null {
  return localStorage.getItem("fullswap_license_key");
}

/**
 * Returns a stable device fingerprint for this browser profile.
 * Generated once and stored in localStorage; survives page reloads and
 * browser restarts within the same profile. Clearing localStorage (or
 * using a private/incognito window) produces a fresh ID — intentional,
 * as the admin can always unbind from the dashboard.
 */
export function getDeviceId(): string {
  const STORAGE_KEY = "fullswap_device_id";
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    // crypto.randomUUID is available in all modern browsers (Chrome 92+, Firefox 95+, Safari 15.4+)
    id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

export function setLicenseKey(key: string): void {
  localStorage.setItem("fullswap_license_key", key.trim().toUpperCase());
}

export function clearLicenseKey(): void {
  localStorage.removeItem("fullswap_license_key");
  localStorage.removeItem("fullswap_license_status");
}

export function isLicenseActivated(): boolean {
  return !!getLicenseKey();
}

export function getAdminToken(): string | null {
  return localStorage.getItem("fullswap_admin_token");
}

export function setAdminToken(token: string): void {
  localStorage.setItem("fullswap_admin_token", token);
}

export function clearAdminToken(): void {
  localStorage.removeItem("fullswap_admin_token");
}

export function isAdminLoggedIn(): boolean {
  return !!getAdminToken();
}

export interface AdminProfile {
  username: string;
  email: string;
  avatarUrl?: string | null;
}

export function setAdminProfile(profile: AdminProfile): void {
  localStorage.setItem("fullswap_admin_profile", JSON.stringify(profile));
}

export function getAdminProfile(): AdminProfile | null {
  const raw = localStorage.getItem("fullswap_admin_profile");
  if (!raw) return null;
  try { return JSON.parse(raw) as AdminProfile; } catch { return null; }
}

export function clearAdminProfile(): void {
  localStorage.removeItem("fullswap_admin_profile");
}

export function getToken(): string | null { return getLicenseKey(); }
export function setToken(_token: string): void {}
export function isLoggedIn(): boolean { return isLicenseActivated(); }
export function clearToken(): void { clearLicenseKey(); }
export interface UserProfile { username: string; email: string; }
export function setUserProfile(_p: UserProfile): void {}
export function getUserProfile(): UserProfile | null { return null; }
