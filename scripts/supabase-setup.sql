-- ══════════════════════════════════════════════════════════════════════
-- SETUP: Tabelas para integração Pluggy → Supabase
-- Execute este SQL no Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════

-- 1. Corretoras conectadas no Pluggy
CREATE TABLE IF NOT EXISTS pluggy_itens (
  item_id         TEXT PRIMARY KEY,
  conector_nome   TEXT NOT NULL,
  conector_id     INTEGER,
  status          TEXT,
  atualizado_em   TIMESTAMPTZ,
  sincronizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Contas e saldos (corrente, poupança, investimento)
CREATE TABLE IF NOT EXISTS pluggy_contas (
  account_id    TEXT PRIMARY KEY,
  item_id       TEXT REFERENCES pluggy_itens(item_id) ON DELETE CASCADE,
  conector_nome TEXT,
  nome          TEXT,
  tipo          TEXT,     -- BANK | CREDIT | INVESTMENT
  subtipo       TEXT,
  saldo         NUMERIC(15,2) DEFAULT 0,
  moeda         TEXT DEFAULT 'BRL',
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Posições de investimentos (ações, FIIs, renda fixa, fundos)
CREATE TABLE IF NOT EXISTS pluggy_investimentos (
  investment_id    TEXT PRIMARY KEY,
  item_id          TEXT REFERENCES pluggy_itens(item_id) ON DELETE CASCADE,
  conector_nome    TEXT,
  nome             TEXT,
  codigo           TEXT,     -- ticker: PETR4, MXRF11, etc.
  tipo             TEXT,     -- STOCK | FUND | FIXED_INCOME | TREASURE | etc.
  subtipo          TEXT,
  saldo            NUMERIC(15,2) DEFAULT 0,
  quantidade       NUMERIC(20,8) DEFAULT 0,
  valor_atual      NUMERIC(15,2) DEFAULT 0,
  preco_unitario   NUMERIC(15,6),
  rendimento_mes   NUMERIC(10,4),
  rendimento_total NUMERIC(10,4),
  vencimento       DATE,
  moeda            TEXT DEFAULT 'BRL',
  atualizado_em    TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Histórico diário de saldos (para gráfico de evolução)
CREATE TABLE IF NOT EXISTS pluggy_snapshots (
  id            BIGSERIAL,
  account_id    TEXT,
  item_id       TEXT,
  conector_nome TEXT,
  nome          TEXT,
  tipo          TEXT,
  saldo         NUMERIC(15,2) DEFAULT 0,
  data          DATE NOT NULL,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (account_id, data)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_pluggy_contas_item    ON pluggy_contas(item_id);
CREATE INDEX IF NOT EXISTS idx_pluggy_inv_item       ON pluggy_investimentos(item_id);
CREATE INDEX IF NOT EXISTS idx_pluggy_inv_codigo     ON pluggy_investimentos(codigo);
CREATE INDEX IF NOT EXISTS idx_pluggy_snap_data      ON pluggy_snapshots(data DESC);
CREATE INDEX IF NOT EXISTS idx_pluggy_snap_item      ON pluggy_snapshots(item_id);

-- ══════════════════════════════════════════════════════════════════════
-- OPCIONAL: política de acesso (se RLS estiver ativo no seu Supabase)
-- ══════════════════════════════════════════════════════════════════════
-- ALTER TABLE pluggy_itens          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pluggy_contas         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pluggy_investimentos  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pluggy_snapshots      ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "acesso_total" ON pluggy_itens         FOR ALL USING (true);
-- CREATE POLICY "acesso_total" ON pluggy_contas        FOR ALL USING (true);
-- CREATE POLICY "acesso_total" ON pluggy_investimentos FOR ALL USING (true);
-- CREATE POLICY "acesso_total" ON pluggy_snapshots     FOR ALL USING (true);
