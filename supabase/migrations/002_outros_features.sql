-- ============================================================
-- Outros: Bloco de Anotações + Inflação Mensal (IPCA)
-- ============================================================

-- Bloco de anotações (uma linha por chave; usamos 'principal' por padrão)
CREATE TABLE IF NOT EXISTS notas_outros (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chave           TEXT        NOT NULL UNIQUE,
  conteudo        TEXT        NOT NULL DEFAULT '',
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inflação mensal (IPCA) usada para cálculo de rentabilidade real
CREATE TABLE IF NOT EXISTS inflacao_mensal (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo     VARCHAR(7)  NOT NULL UNIQUE,   -- 'YYYY/MM'
  ipca_mes    NUMERIC     NOT NULL,          -- ex: 0.45 = 0,45% no mês
  incc_mes    NUMERIC,                       -- opcional, para uso futuro
  cdi_mes     NUMERIC,                       -- opcional, para uso futuro
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inflacao_periodo ON inflacao_mensal (periodo DESC);

-- RLS desativado (segue o padrão das demais tabelas do projeto, acesso via anon key)
ALTER TABLE notas_outros     DISABLE ROW LEVEL SECURITY;
ALTER TABLE inflacao_mensal  DISABLE ROW LEVEL SECURITY;
