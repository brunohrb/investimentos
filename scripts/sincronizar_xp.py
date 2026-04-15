#!/usr/bin/env python3
"""
InvestFlow - Sincronizador XP Investimentos
Automatiza o download e importação da posição XP para o Supabase.

Como usar:
  1. Execute instalar.bat (apenas na primeira vez)
  2. Execute sincronizar_xp.bat (sempre que quiser sincronizar)
"""

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

# ── Configurações ────────────────────────────────────────────────────────────

SUPABASE_URL = "https://hisbbtddpoxufvghxqtm.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpc2JidGRkcG94dWZ2Z2h4cXRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDM0OTgsImV4cCI6MjA4Nzc3OTQ5OH0.r3VkLkBxeorkCYjB-y6WOchePdfRKsm5lWE1iSSYlrw"

CPF        = "01126685348"
BANCO_NOME = "XP Investimentos"
XP_URL     = "https://portal.xpi.com.br/"
DOWNLOADS  = Path.home() / "Downloads"

# ── Funções auxiliares ───────────────────────────────────────────────────────

def parse_brl(v):
    """Converte valor monetário brasileiro (R$ 1.234,56) para float."""
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v) if v == v else 0.0
    s = re.sub(r"[R$\s]", "", str(v)).replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def liquidez_por_venc(venc_str):
    """Calcula liquidez baseado na data de vencimento (DD/MM/AAAA)."""
    if not venc_str:
        return "D+30"
    partes = str(venc_str).split("/")
    if len(partes) != 3:
        return "D+30"
    try:
        venc = date(int(partes[2]), int(partes[1]), int(partes[0]))
        dias = (venc - date.today()).days
        if dias <= 0:  return "D0"
        if dias <= 1:  return "D1"
        if dias <= 2:  return "D2"
        if dias <= 5:  return "D5"
        if dias <= 30: return "D30"
        return "D+30"
    except (ValueError, IndexError):
        return "D+30"


def parse_date_br(venc_str):
    """Converte DD/MM/AAAA → YYYY-MM-DD para o Supabase."""
    if not venc_str or venc_str == "N/A":
        return None
    partes = str(venc_str).split("/")
    if len(partes) != 3:
        return None
    try:
        return f"{partes[2]}-{partes[1].zfill(2)}-{partes[0].zfill(2)}"
    except (IndexError, ValueError):
        return None


# ── Parser XP (porta fiel do JavaScript cartParsearXP) ───────────────────────

def parse_xp(rows):
    """
    Parseia o Excel da XP Investimentos.
    rows: lista de listas (linhas do Excel, índice 0).
    Retorna dict compatível com o formato do app HTML.
    """
    SECOES_RF_FUND  = ["pós-fixado", "prefixado", "inflação", "crédito privado", "renda fixa"]
    SECOES_RV_FUND  = ["renda variável", "multimercado", "ações globais", "exterior",
                       "long short", "macro", "quantitativo"]
    SECOES_AC_FUND  = ["ações"]
    SECOES_FII_FUND = ["fundo imobiliário", "fundos imobiliários", "fii"]

    result = {
        "totalCarteira": 0, "saldoDisponivel": 0,
        "rendaFixa":     {"total": 0, "percentual": 0, "ativos": []},
        "rendaVariavel": {"total": 0, "percentual": 0, "ativos": []},
        "acoes":         {"total": 0, "percentual": 0, "ativos": []},
        "fiis":          {"total": 0, "percentual": 0, "ativos": []},
        "liquidezAte5Dias":  {"total": 0, "percentual": 0, "ativos": []},
        "liquidezAte30Dias": {"total": 0, "percentual": 0, "ativos": []},
        "liquidezAte45Dias": {"total": 0, "percentual": 0, "ativos": []},
        "outros":        {"total": 0, "percentual": 0, "ativos": []},
        "observacoes":   "",
        "proprietarioDetectado": ""
    }

    def get(row, idx, default=""):
        try:
            v = row[idx]
            return v if v is not None else default
        except (IndexError, TypeError):
            return default

    # Linha 3 (índice 2): proprietário — "Maria Clara De Souza, este é o seu patrimônio"
    linha_nome = str(get(rows[2] if len(rows) > 2 else [], 0, ""))
    m = re.match(r"^([^,]+),", linha_nome)
    result["proprietarioDetectado"] = m.group(1).strip() if m else ""

    # Linha 4 (índice 3): totais
    resumo = rows[3] if len(rows) > 3 else []
    result["totalCarteira"]   = parse_brl(get(resumo, 0))
    result["saldoDisponivel"] = parse_brl(get(resumo, 2))

    # Saldo disponível → liquidez D0
    if result["saldoDisponivel"] > 0:
        sd = {"nome": "Saldo Disponível", "valor": result["saldoDisponivel"],
              "percentual": 0, "tipoDias": "D0"}
        for k in ["liquidezAte5Dias", "liquidezAte30Dias", "liquidezAte45Dias"]:
            result[k]["ativos"].append(sd)
            result[k]["total"] += result["saldoDisponivel"]

    secao_atual     = ""
    sub_secao_atual = ""
    cols_header     = []

    for i in range(5, len(rows)):
        row = rows[i]
        if not row:
            continue
        col0 = str(get(row, 0, "")).strip()
        if not col0 or col0 == " ":
            continue

        col0_lower = col0.lower()
        col1_raw   = get(row, 1, "")
        col1       = str(col1_raw)
        col1_lower = col1.lower()

        # Cabeçalho de seção principal (linha sem col[1])
        eh_secao = any([
            "fundos de invest" in col0_lower,
            col0_lower == "renda fixa",
            col0_lower == "ações",
            col0_lower == "fundos imobiliários",
            col0_lower == "tesouro direto",
            col0_lower == "renda variável",
            col0_lower == "previdência",
        ])
        if eh_secao and not col1_raw:
            secao_atual     = col0_lower
            sub_secao_atual = ""
            cols_header     = []
            continue

        # Cabeçalho de sub-seção — "8,5% | Pós-Fixado" com "Posição" na col[1]
        m_sub = re.match(r"^[\d,\.]+%\s*\|\s*(.+)$", col0)
        if m_sub and "posição" in col1_lower:
            sub_secao_atual = m_sub.group(1).lower().strip()
            cols_header     = [str(c or "").lower() for c in row]
            continue
        if col1_raw and "posição" in col1_lower and not re.match(r"^R\$", col0):
            sub_secao_atual = col0_lower.strip()
            cols_header     = [str(c or "").lower() for c in row]
            continue

        # Linha de ativo — col[1] deve ter valor monetário
        valor = parse_brl(col1_raw)
        if valor <= 0:
            continue

        nome  = col0
        pct   = 0.0
        try:
            pct = float(str(get(row, 2, "0")).replace(",", ".")) or 0.0
        except ValueError:
            pass

        # Vencimento e liquidez
        vencimento = None
        liquidez   = "D+30"

        idx_venc = next((j for j, c in enumerate(cols_header)
                         if "vencimento" in c or "data venc" in c), -1)
        if idx_venc > 0:
            v_raw = get(row, idx_venc, "")
            if v_raw:
                vencimento = str(v_raw).strip()
                liquidez   = liquidez_por_venc(vencimento)

        if not vencimento and "fundos de invest" in secao_atual:
            liquidez = "D30"

        idx_taxa = next((j for j, c in enumerate(cols_header)
                         if "taxa" in c or "rentab" in c), -1)
        taxa = str(get(row, idx_taxa, "")) if idx_taxa > 0 else ""

        ativo = {
            "nome": nome, "valor": valor, "percentual": pct,
            "vencimento": vencimento or "N/A", "liquidez": liquidez, "taxa": taxa
        }

        sec = secao_atual
        sub = sub_secao_atual

        # Classificação por seção/sub-seção
        if "fundo imobili" in sec or any(k in sub for k in SECOES_FII_FUND):
            result["fiis"]["ativos"].append({**ativo, "liquidez": "D2"})
            result["fiis"]["total"] += valor
        elif sec == "ações" and "fund" not in sub:
            result["acoes"]["ativos"].append({**ativo, "liquidez": "D2"})
            result["acoes"]["total"] += valor
        elif any(k in sub for k in SECOES_RV_FUND) or (sec.startswith("renda variável") and not sub):
            result["rendaVariavel"]["ativos"].append({**ativo, "liquidez": "D2"})
            result["rendaVariavel"]["total"] += valor
        elif "fundos" in sec and any(k == sub for k in SECOES_AC_FUND):
            result["rendaVariavel"]["ativos"].append({**ativo, "liquidez": "D2"})
            result["rendaVariavel"]["total"] += valor
        elif sec in ("renda fixa", "tesouro direto") or \
             ("fundos" in sec and any(k in sub for k in SECOES_RF_FUND)):
            result["rendaFixa"]["ativos"].append(ativo)
            result["rendaFixa"]["total"] += valor
        elif "previdência" in sec:
            result["outros"]["ativos"].append({**ativo, "liquidez": "D+30"})
            result["outros"]["total"] += valor
        else:
            result["outros"]["ativos"].append(ativo)
            result["outros"]["total"] += valor

        # Buckets de liquidez
        liq_real = "D2" if any(k in sub for k in SECOES_FII_FUND) or \
                   (sec == "ações" and "fund" not in sub) or \
                   any(k in sub for k in SECOES_RV_FUND) else liquidez

        if liq_real in ("D0", "D1", "D2", "D3", "D4", "D5"):
            result["liquidezAte5Dias"]["ativos"].append(
                {"nome": nome, "valor": valor, "percentual": pct,
                 "tipoDias": liq_real, "vencimento": vencimento})
            result["liquidezAte5Dias"]["total"] += valor

        if liq_real in ("D0", "D1", "D2", "D3", "D4", "D5", "D30"):
            result["liquidezAte30Dias"]["ativos"].append(
                {"nome": nome, "valor": valor, "percentual": pct,
                 "tipoDias": liq_real, "vencimento": vencimento})
            result["liquidezAte30Dias"]["total"] += valor

        if vencimento and vencimento != "N/A":
            partes_v = vencimento.split("/")
            if len(partes_v) == 3:
                try:
                    dv = date(int(partes_v[2]), int(partes_v[1]), int(partes_v[0]))
                    if (dv - date.today()).days <= 45:
                        result["liquidezAte45Dias"]["ativos"].append(
                            {"nome": nome, "valor": valor, "percentual": pct,
                             "tipoDias": liq_real, "vencimento": vencimento})
                        result["liquidezAte45Dias"]["total"] += valor
                except (ValueError, IndexError):
                    pass
        elif liq_real in ("D0", "D1", "D2", "D3", "D4", "D5", "D30"):
            result["liquidezAte45Dias"]["ativos"].append(
                {"nome": nome, "valor": valor, "percentual": pct, "tipoDias": liq_real})
            result["liquidezAte45Dias"]["total"] += valor

    # Recalcula total se não veio do cabeçalho
    if not result["totalCarteira"]:
        result["totalCarteira"] = (
            result["rendaFixa"]["total"] + result["rendaVariavel"]["total"] +
            result["acoes"]["total"] + result["fiis"]["total"] +
            result["outros"]["total"] + result["saldoDisponivel"]
        )

    T = result["totalCarteira"] or 1
    for k in ["rendaFixa", "rendaVariavel", "acoes", "fiis", "outros"]:
        result[k]["percentual"] = round(result[k]["total"] / T * 100, 1)

    return result


def ler_excel(path):
    """Lê Excel e retorna lista de listas (0-indexed, igual ao SheetJS)."""
    import openpyxl
    wb = openpyxl.load_workbook(str(path), data_only=True)
    ws = wb.active
    return [list(row) for row in ws.iter_rows(values_only=True)]


def salvar_supabase(result, mes_ref, proprietario=None):
    """Upsert no Supabase: carteiras_analise + carteira_ativos."""
    from supabase import create_client

    sb   = create_client(SUPABASE_URL, SUPABASE_KEY)
    prop = proprietario or result.get("proprietarioDetectado") or ""
    mes  = mes_ref

    cart_row = {
        "proprietario":        prop,
        "banco":               BANCO_NOME,
        "mes":                 mes,
        "arquivo":             result.get("arquivo", "auto-xp"),
        "formato":             "XP",
        "total_carteira":      result.get("totalCarteira", 0),
        "saldo_disponivel":    result.get("saldoDisponivel", 0),
        "renda_fixa_total":    result.get("rendaFixa", {}).get("total", 0),
        "renda_variavel_total":result.get("rendaVariavel", {}).get("total", 0),
        "acoes_total":         result.get("acoes", {}).get("total", 0),
        "fiis_total":          result.get("fiis", {}).get("total", 0),
        "outros_total":        result.get("outros", {}).get("total", 0),
        "observacoes":         "",
        "dados_completos":     result,
        "updated_at":          datetime.utcnow().isoformat()
    }

    # Verifica se já existe
    existing = (
        sb.table("carteiras_analise")
        .select("id")
        .eq("proprietario", prop)
        .eq("banco", BANCO_NOME)
        .eq("mes", mes)
        .execute()
    )

    if existing.data:
        carteira_id = existing.data[0]["id"]
        sb.table("carteiras_analise").update(cart_row).eq("id", carteira_id).execute()
        sb.table("carteira_ativos").delete().eq("carteira_id", carteira_id).execute()
    else:
        ins = sb.table("carteiras_analise").insert(cart_row).execute()
        carteira_id = ins.data[0]["id"]

    # Salva ativos individuais
    ativos = []
    for cat in ["rendaFixa", "rendaVariavel", "acoes", "fiis", "outros"]:
        for a in result.get(cat, {}).get("ativos", []):
            ativos.append({
                "carteira_id":   carteira_id,
                "proprietario":  prop,
                "banco":         BANCO_NOME,
                "mes":           mes,
                "categoria":     cat,
                "nome":          a.get("nome", ""),
                "valor":         a.get("valor", 0),
                "percentual":    a.get("percentual", 0),
                "vencimento_str":a.get("vencimento", "N/A"),
                "vencimento_data":parse_date_br(a.get("vencimento")),
                "liquidez":      a.get("liquidez", "D+30"),
                "taxa":          a.get("taxa", "")
            })

    if ativos:
        sb.table("carteira_ativos").insert(ativos).execute()

    return carteira_id, prop


# ── Helpers de navegação ─────────────────────────────────────────────────────

async def _clicar_texto(page, texto, timeout_ms=4000):
    """
    Clica no primeiro elemento VISÍVEL que contenha o texto.
    Tenta Playwright locator primeiro, depois JS walker como fallback.
    Retorna True se clicou.
    """
    # 1) Playwright get_by_text (exact)
    try:
        loc = page.get_by_text(texto, exact=True).first
        await loc.wait_for(state="visible", timeout=timeout_ms)
        await loc.click()
        return True
    except Exception:
        pass

    # 2) Playwright get_by_text (parcial)
    try:
        loc = page.get_by_text(texto, exact=False).first
        await loc.wait_for(state="visible", timeout=timeout_ms)
        await loc.click()
        return True
    except Exception:
        pass

    # 3) JS TreeWalker — percorre TODOS os nós, ignora o painel _investflow
    try:
        clicou = await page.evaluate(f"""
        (function() {{
            var alvo = {json.dumps(texto)};
            var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            while (walker.nextNode()) {{
                var el = walker.currentNode;
                if (el.id === '_investflow' || el.closest('#_investflow')) continue;
                var t = (el.innerText || el.textContent || '').trim();
                if (t === alvo || t.startsWith(alvo)) {{
                    var r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {{
                        el.dispatchEvent(new MouseEvent('click', {{bubbles:true}}));
                        return true;
                    }}
                }}
            }}
            return false;
        }})()
        """)
        if clicou:
            return True
    except Exception:
        pass

    return False


# ── Guias visuais (injetadas no Edge via Playwright) ─────────────────────────

async def _guia(page, titulo, linhas, cor="#a855f7"):
    """Injeta ou atualiza o painel InvestFlow na página."""
    corpo = "<br>".join(linhas)
    js = f"""
(function() {{
    let d = document.getElementById('_investflow');
    if (!d) {{
        d = document.createElement('div');
        d.id = '_investflow';
        d.style.cssText = [
            'position:fixed','bottom:24px','right:24px','z-index:2147483647',
            'background:#0f1520','border:2px solid {cor}','border-radius:14px',
            'padding:18px 22px','color:#fff','font-family:sans-serif',
            'width:290px','box-shadow:0 8px 40px rgba(0,0,0,.7)',
            'font-size:13px','line-height:1.8'
        ].join(';');
        document.body.appendChild(d);
    }}
    d.style.borderColor = '{cor}';
    d.innerHTML = `
        <div style="font-weight:800;font-size:14px;margin-bottom:10px;color:{cor}">
            🤖 InvestFlow — {titulo}
        </div>
        <div style="color:rgba(255,255,255,0.85);">{corpo}</div>
        <div style="margin-top:10px;font-size:11px;color:rgba(255,255,255,0.4);">
            Este painel é do InvestFlow. Pode minimizá-lo.
        </div>`;
}})();
"""
    try:
        await page.evaluate(js)
    except Exception:
        pass


# ── Fluxo principal ──────────────────────────────────────────────────────────

async def main():
    sep = "=" * 55

    # ── Argumentos CLI ────────────────────────────────────────────────────
    parser = argparse.ArgumentParser(description="InvestFlow - Sync XP")
    parser.add_argument("--mes",          default="", help="Mês YYYY-MM")
    parser.add_argument("--proprietario", default="", help="Nome do proprietário")
    parser.add_argument("--auto",         action="store_true")
    args_cli, _ = parser.parse_known_args()

    mes_input  = args_cli.mes  or datetime.now().strftime("%Y-%m")
    prop_input = args_cli.proprietario

    print(f"\n{sep}")
    print("  InvestFlow — Sincronizar XP Investimentos")
    print(sep)
    print(f"  Mês: {mes_input}")
    print(sep + "\n")

    from playwright.async_api import async_playwright

    excel_path = None

    async with async_playwright() as p:

        # ── Abre Edge (não é bloqueado pela XP) ──────────────────────────
        print("  Abrindo Microsoft Edge...")
        try:
            browser = await p.chromium.launch(
                channel="msedge",
                headless=False,
                args=[
                    "--start-maximized",
                    "--disable-blink-features=AutomationControlled",
                ]
            )
        except Exception as e:
            print(f"\n❌ Não foi possível abrir o Edge: {e}")
            print("  Verifique se o Microsoft Edge está instalado.")
            input("\nPressione ENTER para sair...")
            sys.exit(1)

        context = await browser.new_context(
            viewport=None,
            accept_downloads=True,
        )
        page = await context.new_page()

        # Snapshot dos xlsx antes de baixar
        arquivos_antes = set(str(f) for f in DOWNLOADS.glob("*.xls*"))

        # ── Navegação para XP ─────────────────────────────────────────────
        print("  Acessando portal XP...")
        try:
            await page.goto(XP_URL, wait_until="domcontentloaded", timeout=30000)
        except Exception:
            pass
        await asyncio.sleep(2)

        # ── Preenche CPF ──────────────────────────────────────────────────
        cpf_sel = (
            "input[placeholder*='CPF'], input[placeholder*='cpf'], "
            "input[name*='cpf'], input[id*='cpf'], "
            "input[data-testid*='cpf'], input[autocomplete='username']"
        )
        try:
            await page.wait_for_selector(cpf_sel, timeout=10000)
            campo = await page.query_selector(cpf_sel)
            if campo:
                await campo.fill(CPF)
                await asyncio.sleep(0.5)
                await campo.press("Enter")
                print(f"  ✅ CPF {CPF} preenchido.")
        except Exception:
            print("  Campo CPF não encontrado — preencha manualmente.")

        await asyncio.sleep(1)
        await _guia(page, "Aguardando login",
                    ["① Digite sua <b>senha</b>",
                     "② Digite o <b>token/código</b>",
                     "③ O script continuará <b>sozinho</b> após o login ✅"])

        print("\n" + "─"*55)
        print("  ⏳  Digite senha + token no Edge.")
        print("      O script segue automaticamente após o login.")
        print("─"*55)

        # ── Aguarda login completar ───────────────────────────────────────
        logado = False
        for _ in range(300):               # até 10 min
            await asyncio.sleep(2)
            url = page.url.lower()
            if any(s in url for s in ["/home", "/dashboard", "/carteira",
                                       "/patrimonio", "/investimentos",
                                       "/minha-carteira"]):
                logado = True
                break
            # XP redireciona para fora do /login após autenticar
            if ("portal.xpi.com.br" in url and
                    "login" not in url and
                    url.rstrip("/") != XP_URL.rstrip("/")):
                logado = True
                break

        if not logado:
            print("\n  ⚠️  Tempo esgotado. Continuando mesmo assim...")
        else:
            print("\n  ✅ Login detectado!")

        await asyncio.sleep(2)

        # ── Navega até Carteira → Posição Detalhada ───────────────────────
        await _guia(page, "Navegando automaticamente",
                    ["Abrindo <b>Carteira</b>...", "Aguarde ⏳"])
        print("  Clicando em Carteira...")

        # Tenta várias variações do texto do menu Carteira
        clicou = False
        for txt in ["Carteira", "Minha Carteira", "Patrimônio", "Posição"]:
            if await _clicar_texto(page, txt):
                print(f"  ✅ Clicou em '{txt}'")
                clicou = True
                break
        if not clicou:
            print("  ⚠️  Menu Carteira não encontrado — tentando URL direta...")
            for url_path in ["/carteira", "/minha-carteira", "/patrimonio",
                             "/carteira/posicao-detalhada"]:
                try:
                    await page.goto(f"https://portal.xpi.com.br{url_path}",
                                    wait_until="domcontentloaded", timeout=10000)
                    await asyncio.sleep(2)
                    break
                except Exception:
                    continue

        await asyncio.sleep(2)

        # Tenta clicar em "Posição Detalhada"
        await _guia(page, "Navegando automaticamente",
                    ["Abrindo <b>Posição Detalhada</b>...", "Aguarde ⏳"])
        print("  Clicando em Posição Detalhada...")
        for txt in ["Posição Detalhada", "Posição", "Detalhada"]:
            if await _clicar_texto(page, txt):
                print(f"  ✅ Clicou em '{txt}'")
                break
        await asyncio.sleep(2)

        # ── Clica Exportar e depois Excel ─────────────────────────────────
        await _guia(page, "Exportando Excel",
                    ["Clicando em <b>Exportar</b>...", "Aguarde ⏳"])
        print("  Clicando em Exportar...")

        clicou_export = False
        for txt in ["Exportar", "Export", "Baixar", "Download"]:
            if await _clicar_texto(page, txt):
                print(f"  ✅ Clicou em '{txt}'")
                clicou_export = True
                break
        await asyncio.sleep(1)

        # Captura o download ao clicar em Excel
        if clicou_export:
            print("  Clicando em Excel...")
            try:
                async with page.expect_download(timeout=15000) as dl_info:
                    for txt in ["Excel", ".xlsx", "XLS"]:
                        if await _clicar_texto(page, txt, timeout_ms=3000):
                            print(f"  ✅ Clicou em '{txt}'")
                            break
                download = await dl_info.value
                dest = DOWNLOADS / download.suggested_filename
                await download.save_as(str(dest))
                excel_path = dest
                print(f"  ✅ Excel baixado automaticamente: {dest.name}")
            except Exception as e:
                print(f"  ⚠️  Download via Playwright falhou ({e})")
                print("      Monitorando pasta Downloads...")

        # ── Fallback: monitora pasta Downloads ────────────────────────────
        if not excel_path:
            await _guia(page, "Aguardando download",
                        ["Clique em <b>Exportar → Excel</b> se ainda não clicou",
                         "O script detectará o arquivo <b>automaticamente</b> ✅"],
                        cor="#22c55e")
            print("\n  Monitorando Downloads... (até 5 minutos)\n")
            for i in range(150):
                await asyncio.sleep(2)
                agora = set(str(f) for f in DOWNLOADS.glob("*.xls*"))
                novos = agora - arquivos_antes
                if novos:
                    excel_path = Path(max(novos, key=os.path.getmtime))
                    print(f"  ✅ Arquivo detectado: {excel_path.name}")
                    break
                if i % 15 == 14:
                    print("  Ainda aguardando Excel...")

        await browser.close()

    # ── Localiza arquivo Excel ────────────────────────────────────────────
    if not excel_path or not excel_path.exists():
        candidatos = sorted(DOWNLOADS.glob("*.xls*"), key=os.path.getmtime, reverse=True)
        if candidatos:
            excel_path = candidatos[0]
            print(f"\n  Usando arquivo mais recente: {excel_path.name}")

    if not excel_path or not excel_path.exists():
        print("\nERRO: Nenhum arquivo Excel encontrado.")
        print("  Certifique-se de baixar o Excel em: Carteira → Posição Detalhada → Exportar")
        input("\nPressione ENTER para sair...")
        sys.exit(1)

    # ── Parseia Excel ─────────────────────────────────────────────────────
    print(f"\nProcessando arquivo: {excel_path.name}...")
    rows      = ler_excel(excel_path)
    resultado = parse_xp(rows)
    resultado["arquivo"]     = excel_path.name
    resultado["banco"]       = BANCO_NOME
    resultado["mes"]         = mes_input
    resultado["dataAnalise"] = datetime.now().isoformat()

    prop_final = prop_input or resultado.get("proprietarioDetectado", "")
    resultado["proprietario"] = prop_final

    print()
    print(sep)
    print("  RESULTADO DA ANÁLISE")
    print(sep)
    print(f"  Proprietário  : {prop_final or '(não detectado)'}")
    print(f"  Mês           : {mes_input}")
    print(f"  Total Carteira: R$ {resultado['totalCarteira']:>14,.2f}")
    print(f"  Renda Fixa    : R$ {resultado['rendaFixa']['total']:>14,.2f}")
    print(f"  Renda Variável: R$ {resultado['rendaVariavel']['total']:>14,.2f}")
    print(f"  Ações         : R$ {resultado['acoes']['total']:>14,.2f}")
    print(f"  FIIs          : R$ {resultado['fiis']['total']:>14,.2f}")
    print(f"  Outros        : R$ {resultado['outros']['total']:>14,.2f}")
    print(sep)
    print()

    # ── Salva no Supabase ─────────────────────────────────────────────────
    print("Salvando no Supabase...")
    try:
        cid, p = salvar_supabase(resultado, mes_input, prop_input)
        print(f"\n✅ Carteira salva com sucesso!")
        print(f"   Proprietário : {p}")
        print(f"   Mês          : {mes_input}")
        print(f"   ID           : {cid}")
    except Exception as e:
        print(f"\n❌ Erro ao salvar: {e}")

    print()
    print(sep)
    print("  Concluído! O app atualizará os dados automaticamente.")
    print(sep)
    print()
    if not args_cli.auto:
        input("Pressione ENTER para sair...")
    else:
        import time; time.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
