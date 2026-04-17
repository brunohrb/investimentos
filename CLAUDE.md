# Projeto Pessoal - Bruno Bandeira (BHR)

Plataforma web pessoal multifuncional com múltiplas aplicações independentes em um único repositório. Funciona como um ecossistema de apps web com suporte a PWA (offline, instalável em smartphone) e sincronização com Supabase.

> **Nota**: o sistema de Investimentos BEM (investimentos.html, sync.html, Edge Functions, scripts de sync, workflow Pluggy, etc.) foi movido para o repositório separado `brunohrb/investimentos`.

## Tecnologias

- **Frontend**: HTML5 + CSS3 + JavaScript vanilla (sem frameworks/build tools)
- **Backend**: Supabase (PostgreSQL + REST API + Auth)
- **Gráficos**: Chart.js
- **OCR**: Tesseract.js
- **PDF**: PDF.js
- **Planilhas**: XLSX
- **Criptografia**: Crypto-JS (cofre de senhas)
- **Pose detection**: MediaPipe Pose (treino)

## Estrutura do Projeto

### Páginas Principais (HTML monolítico com CSS+JS inline)

| Arquivo | Aplicação | Descrição |
|---------|-----------|-----------|
| `index.html` | Dashboard/Hub | Página inicial com links para todas as apps |
| `cofre.html` | Cofre de Senhas | Cofre criptografado (Crypto-JS) com sync Supabase |
| `jeanfit.html` | JeanFit Prime | App fitness premium com OCR, gráficos de progresso, painel do instrutor |
| `projetos.html` | DECOR.AI | Plataforma de redesign inteligente |
| `spottfi.html` | Spotyfi do Carnaval | App para acerto de contas |

### Arquivos Importantes

- `config.js` - Credenciais Supabase (chave pública)
- `manifest.json` - Manifesto PWA do hub
- `sw.js` - Service Worker do hub

## Convenções e Padrões

- **HTML monolítico**: cada página é um único arquivo HTML com CSS + JS inline (sem build tools)
- **Nomenclatura em português**: variáveis, comentários e UI em pt-BR
- **Supabase como backend**: autenticação, CRUD, realtime listeners
- **PWA-first**: manifesto + service worker, instalável, funciona offline
- **Segurança**: dados sensíveis em localStorage/IndexedDB, criptografia client-side no cofre, Supabase RLS
