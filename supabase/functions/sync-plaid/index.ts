/**
 * sync-plaid — Syncs account balances from US banks via Plaid
 * Covers: PNC Bank (and any other US bank you link)
 *
 * Plaid docs: https://plaid.com/docs
 * Sign up at: https://dashboard.plaid.com
 *
 * Required Supabase secrets:
 *   PLAID_CLIENT_ID  — from Plaid dashboard
 *   PLAID_SECRET     — from Plaid dashboard (use Production secret)
 *   PLAID_ENV        — 'sandbox' | 'production' (default: production)
 *
 * Required sync_providers row:
 *   provider         = 'plaid'
 *   provider_item_id = Plaid access_token (from Link flow — see sync.html)
 *   banco_id         = UUID of the corresponding banco (is_usd = true)
 *
 * One-time setup: Use Plaid Link (embedded in sync.html) to connect each bank.
 * After linking, save the returned access_token as provider_item_id.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PLAID_CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID')!
const PLAID_SECRET = Deno.env.get('PLAID_SECRET')!
const PLAID_ENV = Deno.env.get('PLAID_ENV') ?? 'production'

const PLAID_BASE = PLAID_ENV === 'sandbox'
  ? 'https://sandbox.plaid.com'
  : 'https://production.plaid.com'

// ── Fetch balances ────────────────────────────────────────────────────────────

interface PlaidAccount {
  account_id: string
  name: string
  type: string
  subtype: string
  balances: {
    current: number | null
    available: number | null
    iso_currency_code: string | null
  }
}

async function getBalances(accessToken: string): Promise<PlaidAccount[]> {
  const res = await fetch(`${PLAID_BASE}/accounts/balance/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      access_token: accessToken,
    }),
  })
  if (!res.ok) throw new Error(`Plaid balance fetch failed: ${await res.text()}`)
  const { accounts } = await res.json()
  return accounts
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
    .select('*, bancos(nome, is_usd)')
    .eq('provider', 'plaid')
    .eq('enabled', true)

  if (provErr) throw provErr
  if (!providers?.length) {
    return new Response(JSON.stringify({ message: 'No Plaid providers configured' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const results = []

  for (const p of providers) {
    const banco = p.bancos as { nome: string; is_usd: boolean }
    const accessToken = p.provider_item_id // Plaid stores access_token here

    try {
      if (!accessToken) throw new Error('provider_item_id (Plaid access_token) not configured')

      const accounts = await getBalances(accessToken)

      // If a specific account is configured, use it; otherwise sum all accounts
      let totalUsd = 0
      if (p.provider_account_id) {
        const account = accounts.find((a) => a.account_id === p.provider_account_id)
        if (!account) throw new Error(`Account ${p.provider_account_id} not found in Plaid response`)
        totalUsd = account.balances.current ?? account.balances.available ?? 0
      } else {
        totalUsd = accounts.reduce((sum, a) => sum + (a.balances.current ?? 0), 0)
      }

      await upsertRegistro(sb, p.banco_id, totalUsd, periodo, dataFechamento)

      await sb.from('sync_providers').update({ last_synced_at: new Date().toISOString() }).eq('id', p.id)
      await sb.from('sync_logs').insert([{
        provider: 'plaid',
        banco_id: p.banco_id,
        banco_nome: banco.nome,
        status: 'success',
        balance_usd: totalUsd,
        periodo,
        message: `${accounts.length} account(s) found`,
      }])

      results.push({ bank: banco.nome, status: 'success', balance_usd: totalUsd })
    } catch (err: any) {
      await sb.from('sync_logs').insert([{
        provider: 'plaid',
        banco_id: p.banco_id,
        banco_nome: banco.nome,
        status: 'error',
        message: err.message,
        periodo,
      }])
      results.push({ bank: banco.nome, status: 'error', error: err.message })
    }
  }

  return new Response(JSON.stringify({ provider: 'plaid', results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
