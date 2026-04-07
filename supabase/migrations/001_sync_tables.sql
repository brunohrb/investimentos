-- ============================================================
-- Automation: Investment Sync Infrastructure
-- ============================================================

-- Table: sync_providers
-- Maps each banco to its external API connection
CREATE TABLE IF NOT EXISTS sync_providers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  banco_id            UUID        NOT NULL REFERENCES bancos(id) ON DELETE CASCADE,
  provider            VARCHAR(50) NOT NULL,  -- 'pluggy' | 'tastytrade' | 'okx' | 'plaid' | 'avenue'
  provider_item_id    TEXT,                  -- Pluggy item_id / Plaid item_id
  provider_account_id TEXT,                  -- Specific account id within provider
  credentials         JSONB,                 -- API keys / tokens (non-OAuth providers)
  enabled             BOOLEAN     NOT NULL DEFAULT true,
  last_synced_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table: sync_logs
-- Audit trail of every sync attempt
CREATE TABLE IF NOT EXISTS sync_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      VARCHAR(50),
  banco_id      UUID        REFERENCES bancos(id) ON DELETE SET NULL,
  banco_nome    TEXT,
  status        VARCHAR(20) NOT NULL,   -- 'success' | 'error' | 'skipped'
  message       TEXT,
  balance_brl   NUMERIC,
  balance_usd   NUMERIC,
  periodo       VARCHAR(10),            -- 'YYYY/MM'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup of recent logs per banco
CREATE INDEX IF NOT EXISTS idx_sync_logs_banco_created ON sync_logs (banco_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_providers_banco    ON sync_providers (banco_id);

-- ============================================================
-- pg_cron: Schedule daily sync at 06:00 BRT (09:00 UTC)
-- Run this manually once after deploying Edge Functions:
-- ============================================================
-- SELECT cron.schedule(
--   'daily-investment-sync',
--   '0 9 * * *',
--   $$
--     SELECT net.http_post(
--       url := 'https://fwhsjzkmnfxnlrvspkyr.supabase.co/functions/v1/sync-all',
--       headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>", "Content-Type": "application/json"}'::jsonb,
--       body := '{}'::jsonb
--     );
--   $$
-- );
