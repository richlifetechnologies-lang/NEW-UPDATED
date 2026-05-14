export function getLicenseKey(): string | null {
  return localStorage.getItem("fullswap_license_key");
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
