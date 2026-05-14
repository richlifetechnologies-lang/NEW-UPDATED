import { Router } from "express";

const router = Router();

// User account endpoints have been removed.
// Access is now entirely license-key-based.
// Admin login is handled by /api/admin/login.

const REMOVED_RESPONSE = {
  error: "User accounts have been removed. Please use a license key to access the system.",
  code: "ACCOUNTS_REMOVED",
};

router.post("/register", (_req, res) => res.status(410).json(REMOVED_RESPONSE));
router.post("/login", (_req, res) => res.status(410).json(REMOVED_RESPONSE));
router.post("/verify-email", (_req, res) => res.status(410).json(REMOVED_RESPONSE));
router.post("/resend-verification", (_req, res) => res.status(410).json(REMOVED_RESPONSE));
router.post("/reset-password", (_req, res) => res.status(410).json(REMOVED_RESPONSE));
router.post("/logout", (_req, res) => res.json({ message: "Logged out" }));
router.get("/me", (_req, res) => res.status(410).json(REMOVED_RESPONSE));

export default router;
