-- H-02: Add billing_rate_snapshot to sessions for immutable history
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS billing_rate_snapshot real;

-- H-03: Admin login rate limit tracking table
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id SERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  email TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_login_ip_time ON admin_login_attempts(ip, attempted_at);

-- Admin action audit log
CREATE TABLE IF NOT EXISTS admin_action_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER,
  admin_email TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  details JSONB,
  ip TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_action_log_created ON admin_action_log(created_at DESC);
