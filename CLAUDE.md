# Investimentos BEM — Bruno Bandeira (BHR)

App web pessoal de **Fechamento Mensal de Investimentos**. PWA instalável (iOS/Android), funciona offline, sincroniza com Supabase.

## Tecnologias

- **Frontend**: HTML5 + CSS3 + JavaScript vanilla (sem frameworks/build tools)
- **Backend**: Supabase (PostgreSQL + REST API + Auth)
- **Gráficos**: Chart.js
- **Planilhas**: XLSX (import/export Excel)
- **PDF**: PDF.js
- **IA**: Claude API (análise de carteira/fechamento/riscos/patrimônio)
- **Cotações**: brapi.dev (ações BR)

## Estrutura do Projeto

HTML monolítico — tudo (CSS + JS + markup) vive em `index.html`.

| Arquivo | Descrição |
|---------|-----------|
| `index.html` | App completo: painel de fechamento mensal, gráficos, patrimônio, IA, dashboard, carteiras, mensalidades, portabilidade BRL/USD |
| `config.js` | Credenciais Supabase (anon key, pública) |
| `manifest-invest.json` | Manifesto PWA |
| `sw-invest.js` | Service Worker v11 — HTML sempre da rede, assets com fallback cache |
| `logo.png` / `logo_bem_preview.svg` | Ícones |
| `README.md` | Readme |

## Convenções

- **HTML monolítico**: tudo num arquivo só, sem build
- **pt-BR**: variáveis, comentários e UI em português
- **PWA-first**: instalável via `manifest-invest.json` + `sw-invest.js`
- **Supabase como backend**: auth + CRUD + realtime
- **Chave Supabase anon** hardcoded em `index.html` (linhas 2658–2659) — é chave pública, protegida por RLS do Supabase
