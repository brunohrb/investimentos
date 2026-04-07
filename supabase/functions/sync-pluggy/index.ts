/**
 * sync-pluggy — Syncs balances from Brazilian banks via Pluggy Open Finance
 * Covers: XP Investimentos, Inter, Bradesco, C6 Bank, Avenue (if supported)
 *
 * Pluggy docs: https://docs.pluggy.ai
 * Sign up at: https://dashboard.pluggy.ai
 *
 * Required Supabase secrets:
 *   PLUGGY_CLIENT_ID     — from Pluggy dashboard
 *   PLUGGY_CLIENT_SECRET — from Pluggy dashboard
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PLUGGY_BASE = 'https://api.pluggy.ai'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PLUGGY_CLIENT_ID = Deno.env.get('PLUGGY_CLIENT_ID')!
const PLUGGY_CLIENT_SECRET = Deno.env.get('PLUGGY_CLIENT_SECRET')!

// ── Auth ─────────────────────────────────────────────────────────────────────

async function getApiKey(): Promise<string> {
  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: PLUGGY_CLIENT_ID, clientSecret: PLUGGY_CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`Pluggy auth failed: ${await res.text()}`)
  const { apiKey } = await res.json()
  return apiKey
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function getAccount(apiKey: string, accountId: string) {
  const res = await fetch(`${PLUGGY_BASE}/accounts/${accountId}`, {
    headers: { 'X-API-KEY': apiKey },
  })
  if (!res.ok) throw new Error(`Failed to fetch account ${accountId}: ${await res.text()}`)
  return res.json()
}

async function getInvestments(apiKey: string, itemId: string): Promise<number> {
  const res = await fetch(`${PLUGGY_BASE}/investments?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey },
  })
  if (!res.ok) return 0
  const { results } = await res.json()
  // Sum all investment balances for this item
  return (results as any[]).reduce((sum: number, inv: any) => sum + (inv.balance ?? 0), 0)
}

// ── Period helpers ────────────────────────────────────────────────────────────

function currentPeriod(): { periodo: string; dataFechamento: string } {
  const now = new Date()
  const periodo = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
  const dataFechamento = now.toISOString().split('T')[0]
  return { periodo, dataFechamento }
}

// ── Upsert registro ───────────────────────────────────────────────────────────

async function upsertRegistro(
  sb: ReturnType<typeof createClient>,
  bancoId: string,
  isUsd: boolean,
  balance: number,
  periodo: string,
  dataFechamento: string,
) {
  const { data: existing } = await sb
    .from('registros')
    .select('id, aportes, aportes_usd')
    .eq('banco_id', bancoId)
    .eq('periodo', periodo)
    .maybeSingle()

  if (existing) {
    const update = isUsd
      ? { patrimonio_usd: balance, data_fechamento: dataFechamento }
      : { patrimonio: balance, data_fechamento: dataFechamento }
    await sb.from('registros').update(update).eq('id', existing.id)
  } else {
    await sb.from('registros').insert([{
      banco_id: bancoId,
      periodo,
      data_fechamento: dataFechamento,
      aportes: 0,
      patrimonio: isUsd ? 0 : balance,
      aportes_usd: 0,
      patrimonio_usd: isUsd ? balance : 0,
      is_usd: isUsd,
    }])
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { periodo, dataFechamento } = currentPeriod()

  // Load all active Pluggy providers
  const { data: providers, error: provErr } = await sb
    .from('sync_providers')
    .select('*, bancos(nome, is_usd)')
    .eq('provider', 'pluggy')
    .eq('enabled', true)

  if (provErr) throw provErr
  if (!providers?.length) {
    return new Response(JSON.stringify({ message: 'No Pluggy providers configured' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let apiKey: string
  try {
    apiKey = await getApiKey()
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }

  const results = []

  for (const p of providers) {
    const banco = p.bancos as { nome: string; is_usd: boolean }

    try {
      let balance = 0

      if (p.provider_account_id) {
        // Specific account — use account endpoint (checking, savings, etc.)
        const account = await getAccount(apiKey, p.provider_account_id)
        balance = account.balance ?? 0
      } else if (p.provider_item_id) {
        // No specific account — sum all investments for this item
        balance = await getInvestments(apiKey, p.provider_item_id)
      } else {
        throw new Error('No provider_item_id or provider_account_id configured')
      }

      await upsertRegistro(sb, p.banco_id, banco.is_usd, balance, periodo, dataFechamento)

      await sb.from('sync_providers').update({ last_synced_at: new Date().toISOString() }).eq('id', p.id)
      await sb.from('sync_logs').insert([{
        provider: 'pluggy',
        banco_id: p.banco_id,
        banco_nome: banco.nome,
        status: 'success',
        balance_brl: banco.is_usd ? null : balance,
        balance_usd: banco.is_usd ? balance : null,
        periodo,
      }])

      results.push({ bank: banco.nome, status: 'success', balance })
    } catch (err: any) {
      await sb.from('sync_logs').insert([{
        provider: 'pluggy',
        banco_id: p.banco_id,
        banco_nome: banco.nome,
        status: 'error',
        message: err.message,
        periodo,
      }])
      results.push({ bank: banco.nome, status: 'error', error: err.message })
    }
  }

  return new Response(JSON.stringify({ provider: 'pluggy', results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
