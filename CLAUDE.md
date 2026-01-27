# CLAUDE.md — AI Assistant Guide for `pessoal`

## Project Overview

A **personal dashboard and finance platform** ("plataforma pessoal") built as a static HTML/CSS/JavaScript web application. The platform is in Brazilian Portuguese and designed for single-user operation. It consists of three standalone HTML pages with embedded styles and scripts — no build tools, no bundler, no package manager.

## Repository Structure

```
pessoal/
├── index.html            # Main dashboard & authentication gateway (509 lines)
├── cofre.html            # Encrypted digital vault for documents/passwords (1,185 lines)
├── investimentos.html    # Monthly investment tracking & reconciliation (1,822 lines)
├── README.md             # Minimal project description
└── CLAUDE.md             # This file
```

### File Descriptions

| File | Purpose | Key Features |
|------|---------|--------------|
| `index.html` | Entry point — login screen + dashboard with navigation cards | Password auth, sessionStorage, links to modules |
| `cofre.html` | Secure vault — stores sensitive data with client-side encryption | AES-256-GCM, PBKDF2, multi-person support, categories (documents, passwords, real estate) |
| `investimentos.html` | Investment tracker — monthly closing, bank accounts, charts | Chart.js, XLSX import/export, dark mode, multi-currency (BRL/USD), transaction history |

## Tech Stack

- **Languages**: HTML5, CSS3, Vanilla JavaScript (ES6+)
- **Build system**: None — static files served directly
- **Package manager**: None
- **External CDN dependencies**:
  - [Supabase JS v2](https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2) — backend integration
  - [Chart.js](https://cdn.jsdelivr.net/npm/chart.js) — data visualization (investimentos)
  - [XLSX / SheetJS](https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js) — Excel import/export (investimentos)
  - [Google Fonts](https://fonts.googleapis.com) — Poppins, Inter
- **Encryption**: Web Crypto API (AES-256-GCM + PBKDF2-SHA256)
- **Storage**: `localStorage` and `sessionStorage` (browser-only, no server)

## Architecture & Conventions

### Monolithic HTML Pattern

Each `.html` file is fully self-contained:
- `<style>` block at the top with all CSS
- HTML markup in the `<body>`
- `<script>` block at the bottom with all JavaScript

There is **no module system**, no imports between files, and no shared code. Each page is independent.

### Data Persistence

All data lives in the browser via `localStorage`:
- `cofre.html` stores encrypted blobs under keys like `cofre_*`
- `investimentos.html` stores financial data under keys like `investimentos_*`
- `index.html` uses `sessionStorage` for login state

No data is sent to external servers (encryption/decryption is entirely client-side).

### Authentication

- `index.html`: Password-based login (credentials in JS source)
- `investimentos.html`: Separate password-based login (credentials in JS source)
- `cofre.html`: Master password + 4-6 digit PIN (used for encryption key derivation)

### UI/UX Patterns

- Responsive design with CSS Grid and Flexbox
- Gradient backgrounds and card-based layouts
- Modal dialogs for data entry forms
- Sidebar navigation in `cofre.html`
- Dark/light theme toggle in `investimentos.html` (persisted in localStorage)
- CSS transitions and animations for smooth UX
- All user-facing text is in **Brazilian Portuguese**

### Cryptography (cofre.html)

- **Algorithm**: AES-256-GCM
- **Key derivation**: PBKDF2 with SHA-256, 100,000 iterations, random salt
- **IV**: Random 12-byte initialization vector per encryption operation
- **Implementation**: Native Web Crypto API (`crypto.subtle`)
- **XSS mitigation**: HTML escaping applied to decrypted content before rendering

## Development Workflow

### Running Locally

No build step required. Open any `.html` file directly in a browser or serve via any static HTTP server:

```bash
# Example using Python
python3 -m http.server 8000

# Example using Node.js (npx)
npx serve .
```

### Making Changes

1. Edit the relevant `.html` file directly — all CSS, HTML, and JS are inline
2. Refresh the browser to see changes
3. Test in multiple screen sizes (responsive design)
4. Verify `localStorage` data integrity after changes to data structures

### Testing

There are no automated tests. All testing is manual:
- Verify login flows work correctly
- Test encryption/decryption round-trips in cofre.html
- Validate Chart.js rendering and XLSX export in investimentos.html
- Check responsive layout on mobile and desktop viewports

## Guidelines for AI Assistants

### Do

- Keep all code within the existing monolithic HTML file structure (CSS + HTML + JS in one file)
- Maintain Brazilian Portuguese for all user-facing strings
- Preserve the existing visual style (gradients, cards, animations)
- Use vanilla JavaScript — no frameworks or transpilers
- Use `localStorage`/`sessionStorage` for persistence
- Escape user-generated content before inserting into the DOM
- Maintain the Web Crypto API patterns in cofre.html when handling encryption
- Load any new external libraries via CDN `<script>` tags

### Don't

- Don't introduce build tools, bundlers, or package managers
- Don't split files into separate JS/CSS modules (the project intentionally uses single-file architecture)
- Don't switch to English for UI text
- Don't add server-side dependencies or backend code
- Don't remove or weaken the existing encryption implementation
- Don't store sensitive data in plain text in `localStorage` (use the existing encryption patterns)
- Don't introduce TypeScript, React, or other frameworks

### Security Considerations

- The vault (`cofre.html`) uses strong client-side encryption — preserve this
- Authentication passwords are hardcoded in source — this is a known limitation of the static architecture
- Never log or expose decrypted vault contents to the console
- Always use `crypto.getRandomValues()` for cryptographic randomness
- Maintain PBKDF2 iteration count at 100,000 or higher

## Git Conventions

- **Commit messages**: Simple, descriptive (e.g., "Add files via upload", "Update index.html")
- **Branching**: Feature branches prefixed with `claude/` for AI-assisted development
- **No CI/CD pipeline**: Changes are deployed by serving updated static files
