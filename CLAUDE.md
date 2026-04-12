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
| `index.html` | Dashboard/Hub | Página inicial com links para todas as apps |
| `investimentos.html` | Investimentos BEM | App principal - painel de fechamento mensal com sync automático, gráficos, análise patrimonial, IA Claude |
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
