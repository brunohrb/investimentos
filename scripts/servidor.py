"""
InvestFlow — Servidor local
Roda em background e recebe comandos do app HTML via HTTP.
Inicia automaticamente com o Windows após rodar instalar.bat.
"""

import json
import subprocess
import sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

PORT       = 8765
SCRIPTS    = Path(__file__).parent


class Handler(BaseHTTPRequestHandler):

    # ── CORS preflight ───────────────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    # ── GET /status ──────────────────────────────────────────────────────
    def do_GET(self):
        if self.path == "/status":
            self._json({"ok": True, "version": "1.0"})
        else:
            self._json({"error": "not found"}, 404)

    # ── POST /sync-xp ────────────────────────────────────────────────────
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(body)
        except Exception:
            data = {}

        if self.path == "/sync-xp":
            mes   = data.get("mes", "")
            prop  = data.get("proprietario", "")
            script = SCRIPTS / "sincronizar_xp.py"

            args = [sys.executable, str(script), "--auto"]
            if mes:
                args += ["--mes", mes]
            if prop:
                args += ["--proprietario", prop]

            # Abre o Playwright em uma nova janela de terminal visível
            subprocess.Popen(
                args,
                creationflags=subprocess.CREATE_NEW_CONSOLE
            )
            self._json({"ok": True,
                        "msg": "Automação iniciada! Conclua o login na janela que abriu."})
        else:
            self._json({"error": "not found"}, 404)

    # ── Helpers ──────────────────────────────────────────────────────────
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type",   "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass  # silencia logs do console


if __name__ == "__main__":
    server = ThreadingHTTPServer(("localhost", PORT), Handler)
    print(f"InvestFlow rodando em localhost:{PORT} — pode minimizar esta janela.")
    server.serve_forever()
