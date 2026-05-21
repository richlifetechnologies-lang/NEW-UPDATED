/**
 * rate-limiter.ts — In-memory rate limiter for admin login.
 * H-03: max 10 failed attempts per IP per 15-minute window.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

const WINDOW_MS  = 15 * 60 * 1000; // 15 minutes
const MAX_FAILS  = 10;

/** Returns true if the IP is rate-limited (too many failures). */
export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = store.get(ip);
  if (!bucket || now > bucket.resetAt) return false;
  return bucket.count >= MAX_FAILS;
}

/** Call on every FAILED login attempt. Returns true if now rate-limited. */
export function recordFailedAttempt(ip: string): boolean {
  const now = Date.now();
  let bucket = store.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count >= MAX_FAILS;
}

/** Call on a SUCCESSFUL login — clears the failure counter for this IP. */
export function clearAttempts(ip: string): void {
  store.delete(ip);
}

/** Seconds until rate limit window resets for this IP (0 if not limited). */
export function retryAfterSeconds(ip: string): number {
  const now = Date.now();
  const bucket = store.get(ip);
  if (!bucket || now > bucket.resetAt) return 0;
  return Math.ceil((bucket.resetAt - now) / 1000);
}

// Clean up expired buckets every 30 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of store.entries()) {
    if (now > b.resetAt) store.delete(ip);
  }
}, 30 * 60 * 1000).unref?.();
