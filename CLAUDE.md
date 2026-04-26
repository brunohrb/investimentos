# Projeto Pessoal - Bruno Bandeira (BHR)

Plataforma web pessoal multifuncional com múltiplas aplicações independentes em um único repositório. Funciona como um ecossistema de apps web com suporte a PWA (offline, instalável em smartphone) e sincronização com Supabase.

## Tecnologias

- **Frontend**: HTML5 + CSS3 + JavaScript vanilla (sem frameworks/build tools)
- **Backend**: Supabase (PostgreSQL + REST API + Auth + Edge Functions)
- **Gráficos**: Chart.js
- **OCR**: Tesseract.js
- **PDF**: PDF.js
- **Planilhas**: XLSX
- **Criptografia**: Crypto-JS (cofre de senhas)
- **Pose detection**: MediaPipe Pose (treino)
- **APIs externas**: Pluggy (corretoras BR), brapi.dev (cotações), TastyTrade, OKX, Plaid, Avenue
- **CI/CD**: GitHub Actions (sync diário seg-sex 7h BRT)
- **IA**: Claude API para análise de investimentos

## Estrutura do Projeto

### Páginas Principais (HTML monolítico com CSS+JS inline)

| Arquivo | Aplicação | Descrição |
|---------|-----------|-----------|
| `index.html` | **Investimentos BEM** (app principal) | Painel de fechamento mensal, sync, gráficos, análise patrimonial, IA Claude. **Atenção**: o arquivo se chama `index.html` (foi renomeado de `investimentos.html`). Não procure por `investimentos.html`, ele não existe mais. |
| `cofre.html` | Cofre de Senhas | Cofre criptografado (Crypto-JS) com sync Supabase |
| `treino.html` | App de Treino | Registro de exercícios com reconhecimento de pose via MediaPipe |
| `jeanfit.html` | JeanFit Prime | App fitness premium com OCR, gráficos de progresso, painel do instrutor |
| `sync.html` | Painel de Sync | UI para configurar/monitorar integrações (Pluggy, TastyTrade, OKX, etc.) |
| `projetos.html` | DECOR.AI | Plataforma de redesign inteligente |
| `qpastel.html` | QPastel | Site de bolos, doces e salgados |
| `spottfi.html` | Spotyfi do Carnaval | App para acerto de contas |

### Pastas e Arquivos Importantes

- `config.js` - Credenciais Supabase (chave pública)
- `manifest-invest.json` - Manifesto PWA para "Investimentos BEM"
- `sw-invest.js` - Service Worker v11 (HTML: network-only; assets: network-first com fallback cache)
- `scripts/sync-pluggy.js` - Script Node.js rodado via GitHub Actions para sync diário com Pluggy
- `supabase/functions/` - Edge Functions (Deno/TypeScript):
  - `sync-all/` - Orquestrador que chama todas as funções de sync em paralelo
  - `sync-pluggy/` - Sync com Pluggy (bancos/corretoras BR)
  - `sync-tastytrade/` - Sync com TastyTrade
  - `sync-okx/` - Sync com OKX (cripto)
  - `sync-plaid/` - Sync com Plaid
  - `sync-avenue/` - Sync com Avenue
- `supabase/migrations/` - SQL com schema (sync_providers, sync_logs, pg_cron)
- `.github/workflows/sync-investments.yml` - GitHub Action (seg-sex 7h BRT)

## Convenções e Padrões

- **HTML monolítico**: cada página é um único arquivo HTML com CSS + JS inline (sem build tools)
- **Nomenclatura em português**: variáveis, comentários e UI em pt-BR
- **Supabase como backend**: autenticação, CRUD, realtime listeners
- **PWA-first**: manifesto + service worker, instalável, funciona offline
- **Segurança**: dados sensíveis em localStorage/IndexedDB, criptografia client-side no cofre, Supabase RLS
- **Sincronização assíncrona**: GitHub Actions -> Node.js script -> APIs -> Supabase -> UI em tempo real

## Fluxo de Dados (Investimentos)

```
Automático (seg-sex 7h):
  GitHub Actions -> scripts/sync-pluggy.js -> Pluggy API -> Supabase (4 tabelas) -> UI

Manual:
  investimentos.html "Sincronizar" -> supabase/functions/sync-all -> sync-pluggy, sync-tastytrade, sync-okx, etc. -> Supabase -> UI atualiza em tempo real
```

## Secrets necessários (GitHub Actions)

- `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`
- `SUPABASE_URL`, `SUPABASE_KEY`

## Armadilhas comuns (LEIA antes de mexer no `index.html`)

### 1) Múltiplas telas/dashboards independentes — adicione features em TODAS

O `index.html` tem 5 lugares distintos com cards/tabelas que precisam ser atualizados em conjunto quando se adiciona uma feature global (ex: nova coluna, novo indicador):

| Tela | Como abrir | Cards container | Tabela render | Selo |
|------|------------|------------------|----------------|------|
| Dashboard normal (banco individual / Consolidado BRL ou USD) | Padrão após login | `#dashboardNormal` | `atualizarTabela()` (`#tabelaCorpo`) | header principal |
| Dashboard Consolidado Total | Dropdown bancoSelector → "🌍 Consolidado Total" | `#dashboardConsolidadoTotal` | `atualizarTabela()` ramo `consolidado_total` | header principal |
| Brasil (Banco) | Card "🇧🇷 Brasil (Banco)" no Dashboard Completo | `#bb-cards` | `bb_renderTabela()` (`#bb-tbody-vis`) | `db-header-actions` (próprio) |
| Estrangeiro (USD) | Card USD no Dashboard Completo | `#usd-cards` | `usd_renderTabela()` (`#usd-tbody-vis`) | header próprio |
| Dashboard Completo (modal) | Botão 📊 do header | cards `db-card` (linha ~8200) | n/a | `.db-header-actions` |

**Cabeçalhos com botões também são duplicados**: o header principal (`.header-actions`, linha ~2467) e o header do Dashboard Completo (`.db-header-actions`, linha ~10642) têm conjuntos diferentes de botões. Ao adicionar um botão "global" (ex: 📦 Outros), adicione nos DOIS lugares.

### 2) Mobile: media query `@media (max-width: 900px)` compacta os botões customizados

Botões com classe `.btn-carteiras`, `.btn-outros`, etc. ficam com gradiente e padding grande no desktop, e são compactados pra ícone 32x32 no mobile via regras CSS específicas (linha ~2042–2075). Ao adicionar um botão novo do mesmo estilo, replique a regra mobile dele, senão estoura o header.

### 3) Cache do Service Worker antigo (`sw.js`) cacheia o `index.html`

Existem **dois service workers** no projeto:
- `sw-invest.js` v11: HTML é network-only ✓
- `sw.js`: cacheia `index.html` no `caches.open(...)` — versões antigas instaladas em devices ficam servindo HTML velho

**Sintoma**: mudanças não aparecem mesmo após hard reload e aba anônima.
**Diagnóstico**: rodar no Console `document.querySelector('NOVO_SELETOR')` — se vier null mas o HTML do servidor (Ctrl+U) mostra o elemento, é cache local.
**Fix**:
```js
(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  const keys = await caches.keys();
  for (const k of keys) await caches.delete(k);
  location.replace(location.pathname + '?_v=' + Date.now());
})();
```

### 4) Projeto Supabase

- **Projeto ativo**: `hisbbtddpoxufvghxqtm` (URL hardcoded em `index.html` linha ~2666 e em `scripts/sync-pluggy.js`)
- **`config.js`**: aponta para outro projeto antigo (`fwhsjzkmnfxnlrvspkyr`) — desatualizado mas não atrapalha porque o `index.html` usa as credenciais inline
- Schema: tudo em `public` (padrão)
- Dashboard: https://supabase.com/dashboard/project/hisbbtddpoxufvghxqtm
- SQL Editor: https://supabase.com/dashboard/project/hisbbtddpoxufvghxqtm/sql/new

### 5) Deploy é direto na `main` (não abrir PR)

Site é servido pelo GitHub Pages a partir da `main`. Workflow padrão para mudanças solicitadas:
1. Trabalhar na branch de feature já criada (`claude/<slug>`)
2. Commit + push na branch
3. Checkout `main` → `merge --no-ff` da branch → push origin main
4. Voltar pra branch de feature

Não abrir PR a menos que o usuário peça explicitamente.

### 6) Tabela `inflacao_mensal` é populada automaticamente

A função `carregarIpcaAutomatico()` (em `index.html`) busca o IPCA mensal da **API pública do BCB** (série SGS-433, sem token) e cacheia em `inflacao_mensal` + em `window._ipcaCache`. É chamada na inicialização. Não pedir ao usuário para cadastrar IPCA manualmente.

Tabelas de suporte do feature "📦 Outros":
- `notas_outros` — bloco de anotações (chave/conteúdo)
- `inflacao_mensal` — cache do IPCA do BCB (periodo `YYYY/MM`, ipca_mes)
