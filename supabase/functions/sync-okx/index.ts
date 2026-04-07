/**
 * sync-okx — Syncs crypto balances from OKX exchange
 *
 * OKX API docs: https://www.okx.com/docs-v5/en/
 * Create API key at: OKX > Assets > API Management
 *   Permissions needed: Read-only (Accounts + Assets)
 *
 * Required Supabase secrets:
 *   OKX_API_KEY        — API key
 *   OKX_API_SECRET     — Secret key
 *   OKX_API_PASSPHRASE — Passphrase set when creating the key
 *
 * Required sync_providers row:
 *   provider = 'okx'
 *   banco_id = UUID of the corresponding banco in your DB (is_usd = true)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OKX_BASE = 'https://www.okx.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OKX_API_KEY = Deno.env.get('OKX_API_KEY')!
const OKX_API_SECRET = Deno.env.get('OKX_API_SECRET')!
const OKX_PASSPHRASE = Deno.env.get('OKX_API_PASSPHRASE')!

// ── HMAC-SHA256 signature ─────────────────────────────────────────────────────

async function sign(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function okxHeaders(method: string, path: string, body = ''): Promise<HeadersInit> {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z')  // OKX requires ms
  const preHash = `${timestamp}${method.toUpperCase()}${path}${body}`
  const signature = await sign(preHash, OKX_API_SECRET)
  return {
    'OK-ACCESS-KEY': OKX_API_KEY,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': OKX_PASSPHRASE,
    'Content-Type': 'application/json',
  }
}

// ── Fetch balances ────────────────────────────────────────────────────────────

interface OkxAccountBalance {
  totalEq: string   // total equity in USD
  details: Array<{ ccy: string; eqUsd: string }>
}

async function getTradingBalance(): Promise<number> {
  const path = '/api/v5/account/balance'
  const headers = await okxHeaders('GET', path)
  const res = await fetch(`${OKX_BASE}${path}`, { headers })
  if (!res.ok) throw new Error(`OKX trading balance failed: ${await res.text()}`)
  const { data } = await res.json()
  const account: OkxAccountBalance = data?.[0]
  return parseFloat(account?.totalEq ?? '0')
}

async function getFundingBalance(): Promise<number> {
  const path = '/api/v5/asset/balances'
  const headers = await okxHeaders('GET', path)
  const res = await fetch(`${OKX_BASE}${path}`, { headers })
  if (!res.ok) throw new Error(`OKX funding balance failed: ${await res.text()}`)
  const { data } = await res.json()
  // Sum all asset USD values
  return (data as any[]).reduce((sum: number, asset: any) => {
    return sum + parseFloat(asset.eqUsd ?? asset.bal ?? '0')
  }, 0)
}

// ── Period helpers ────────────────────────────────────────────────────────────

function currentPeriod() {
  const now = new Date()
  return {
    periodo: `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`,
    dataFechamento: now.toISOString().split('T')[0],
  }
}

// ── Upsert registro ───────────────────────────────────────────────────────────

async function upsertRegistro(
  sb: ReturnType<typeof createClient>,
  bancoId: string,
  balanceUsd: number,
  periodo: string,
  dataFechamento: string,
) {
  const { data: existing } = await sb
    .from('registros')
    .select('id')
    .eq('banco_id', bancoId)
    .eq('periodo', periodo)
    .maybeSingle()

  if (existing) {
    await sb.from('registros').update({
      patrimonio_usd: balanceUsd,
      data_fechamento: dataFechamento,
    }).eq('id', existing.id)
  } else {
    await sb.from('registros').insert([{
      banco_id: bancoId,
      periodo,
      data_fechamento: dataFechamento,
      aportes: 0,
      patrimonio: 0,
      aportes_usd: 0,
      patrimonio_usd: balanceUsd,
      is_usd: true,
    }])
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { periodo, dataFechamento } = currentPeriod()

  const { data: providers, error: provErr } = await sb
    .from('sync_providers')
    .select('*, bancos(nome)')
    .eq('provider', 'okx')
    .eq('enabled', true)

  if (provErr) throw provErr
  if (!providers?.length) {
    return new Response(JSON.stringify({ message: 'No OKX providers configured' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const results = []

  for (const p of providers) {
    const bancoNome = (p.bancos as any)?.nome ?? 'OKX'

    try {
      // Fetch both trading and funding account balances in parallel
      const [tradingUsd, fundingUsd] = await Promise.all([
        getTradingBalance(),
        getFundingBalance(),
      ])

      const totalUsd = tradingUsd + fundingUsd
      await upsertRegistro(sb, p.banco_id, totalUsd, periodo, dataFechamento)

      await sb.from('sync_providers').update({ last_synced_at: new Date().toISOString() }).eq('id', p.id)
      await sb.from('sync_logs').insert([{
        provider: 'okx',
        banco_id: p.banco_id,
        banco_nome: bancoNome,
        status: 'success',
        balance_usd: totalUsd,
        periodo,
        message: `Trading: $${tradingUsd.toFixed(2)} | Funding: $${fundingUsd.toFixed(2)}`,
      }])

      results.push({ bank: bancoNome, status: 'success', balance_usd: totalUsd })
    } catch (err: any) {
      await sb.from('sync_logs').insert([{
        provider: 'okx',
        banco_id: p.banco_id,
        banco_nome: bancoNome,
        status: 'error',
        message: err.message,
        periodo,
      }])
      results.push({ bank: bancoNome, status: 'error', error: err.message })
    }
  }

  return new Response(JSON.stringify({ provider: 'okx', results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
