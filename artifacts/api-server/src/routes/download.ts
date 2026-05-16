import { Router } from "express";

const router = Router();

const GITHUB_OWNER = "richlifetechnologies-lang";
const GITHUB_REPO = "NEW-UPDATED";

// ─── In-memory cache for signed S3 URLs ──────────────────────────────────────
// GitHub signed URLs last ~1 hour; we cache for 45 min to be safe.
// On page load, /download/availability pre-warms this cache so that
// download button clicks are instant (no 3-5 s GitHub API round-trip).
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

// ─── GitHub helpers ────────────────────────────────────────────────────────────

function buildAuthHeader(pat: string): string {
  return pat.startsWith("github_pat_") ? `Bearer ${pat}` : `token ${pat}`;
}

async function fetchLatestReleaseAssets(): Promise<Array<{ name: string; url: string }>> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT environment variable is not set");

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    {
      headers: {
        Authorization: buildAuthHeader(pat),
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "FULLSWAPBYRICH-Server/1.0",
      },
    }
  );

  if (res.status === 401) throw new Error("GitHub PAT authentication failed");
  if (res.status === 404) throw new Error("No releases found in the repository");
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

  const release = await res.json() as { assets: Array<{ name: string; url: string }> };
  return release.assets ?? [];
}

/**
 * Follow GitHub's redirect for a release asset and return the final signed S3 URL.
 * Uses fetch with redirect:"follow"; response.url is the last URL after all hops.
 * The body is cancelled immediately — we only need the URL, not the file content.
 */
async function getSignedAssetUrl(assetApiUrl: string): Promise<string> {
  const pat = process.env.GITHUB_PAT!;

  const response = await fetch(assetApiUrl, {
    headers: {
      Authorization: buildAuthHeader(pat),
      Accept: "application/octet-stream",
      "User-Agent": "FULLSWAPBYRICH-Server/1.0",
    },
    // redirect:"follow" (default) — response.url is the final S3 URL
  });

  const signedUrl = response.url;
  if (response.body) {
    response.body.cancel().catch(() => { /* ignore cleanup errors */ });
  }

  if (!signedUrl || signedUrl === assetApiUrl) {
    throw new Error(`No redirect resolved for asset: ${assetApiUrl}`);
  }
  return signedUrl;
}

/**
 * Return a cached signed URL if fresh, otherwise fetch a new one and cache it.
 * This ensures download button clicks are near-instant after the first page load.
 */
async function getCachedSignedAssetUrl(assetApiUrl: string): Promise<string> {
  const cached = signedUrlCache.get(assetApiUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }
  const url = await getSignedAssetUrl(assetApiUrl);
  signedUrlCache.set(assetApiUrl, { url, expiresAt: Date.now() + 45 * 60 * 1000 });
  return url;
}

/**
 * Fire-and-forget: pre-fetch signed URLs for all assets so that download
 * button clicks are instant after the availability check completes.
 */
function prewarmUrlCache(assets: Array<{ url: string }>): void {
  for (const asset of assets) {
    const cached = signedUrlCache.get(asset.url);
    if (!cached || cached.expiresAt <= Date.now()) {
      getCachedSignedAssetUrl(asset.url).catch(() => { /* ignore pre-warm errors */ });
    }
  }
}

function pickMacAsset(
  assets: Array<{ name: string; url: string }>,
  arch: string
): { name: string; url: string } | undefined {
  const dmg = assets.filter(a => a.name.toLowerCase().endsWith(".dmg"));
  const arm64Keywords = ["arm64", "applesil", "apple-sil"];

  if (arch === "arm64") {
    return dmg.find(a => arm64Keywords.some(k => a.name.toLowerCase().includes(k))) ?? dmg[0];
  }
  // Intel / x64: explicit keywords first, then first non-arm64 .dmg
  const x64Keywords = ["x64", "intel", "x86_64"];
  return (
    dmg.find(a => x64Keywords.some(k => a.name.toLowerCase().includes(k))) ??
    dmg.find(a => !arm64Keywords.some(k => a.name.toLowerCase().includes(k))) ??
    dmg[0]
  );
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/download/availability", async (_req, res) => {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    res.json({ windows: false, macosArm64: false, macosX64: false });
    return;
  }
  try {
    const assets = await fetchLatestReleaseAssets();
    const names = assets.map(a => a.name.toLowerCase());
    const arm64Keywords = ["arm64", "applesil", "apple-sil"];

    const hasWindows = names.some(n => n.endsWith(".exe"));
    const hasArm64   = names.some(n => n.endsWith(".dmg") && arm64Keywords.some(k => n.includes(k)));
    // Intel: any .dmg WITHOUT an arm64 keyword counts as the Intel build
    const hasX64     = names.some(n => n.endsWith(".dmg") && !arm64Keywords.some(k => n.includes(k)));

    // Pre-warm signed URL cache in the background — makes download clicks instant
    prewarmUrlCache(assets);

    res.json({ windows: hasWindows, macosArm64: hasArm64, macosX64: hasX64 });
  } catch {
    res.json({ windows: false, macosArm64: false, macosX64: false });
  }
});

router.get("/download/windows", async (_req, res) => {
  if (!process.env.GITHUB_PAT) {
    res.status(503).json({ error: "Windows download not available yet" });
    return;
  }
  try {
    const assets = await fetchLatestReleaseAssets();
    const asset = assets.find(a => a.name.toLowerCase().endsWith(".exe"));
    if (!asset) {
      res.status(404).json({ error: "Windows installer not found in latest release" });
      return;
    }
    const s3Url = await getCachedSignedAssetUrl(asset.url);
    res.redirect(302, s3Url);
  } catch (err) {
    console.error("Windows download error:", err);
    res.status(500).json({ error: "Failed to retrieve Windows download URL" });
  }
});

router.get("/download/macos", async (req, res) => {
  const arch = req.query.arch === "arm64" ? "arm64" : "x64";
  if (!process.env.GITHUB_PAT) {
    res.status(503).json({ error: `macOS (${arch}) download not available yet` });
    return;
  }
  try {
    const assets = await fetchLatestReleaseAssets();
    const asset = pickMacAsset(assets, arch);
    if (!asset) {
      res.status(404).json({ error: `macOS (${arch}) installer not found in latest release` });
      return;
    }
    const s3Url = await getCachedSignedAssetUrl(asset.url);
    res.redirect(302, s3Url);
  } catch (err) {
    console.error("macOS download error:", err);
    res.status(500).json({ error: "Failed to retrieve macOS download URL" });
  }
});

export default router;
