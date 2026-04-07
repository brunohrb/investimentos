/**
 * sync-tastytrade — Syncs account balance + positions from Tastytrade
 *
 * Tastytrade API docs: https://developer.tastytrade.com
 * Base URL: https://api.tastytrade.com
 *
 * Required Supabase secrets:
 *   TASTYTRADE_USERNAME — your Tastytrade login
 *   TASTYTRADE_PASSWORD — your Tastytrade password
 *
 * Required sync_providers row:
 *   provider = 'tastytrade'
 *   provider_account_id = your account number (e.g. '5WX12345')
 *   banco_id = UUID of the corresponding banco in your DB
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TT_BASE = 'https://api.tastytrade.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TT_USERNAME = Deno.env.get('TASTYTRADE_USERNAME')!
const TT_PASSWORD = Deno.env.get('TASTYTRADE_PASSWORD')!

// ── Auth ─────────────────────────────────────────────────────────────────────

async function getSessionToken(): Promise<string> {
  const res = await fetch(`${TT_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ login: TT_USERNAME, password: TT_PASSWORD, 'remember-me': false }),
  })
  if (!res.ok) throw new Error(`Tastytrade login failed: ${await res.text()}`)
  const { data } = await res.json()
  return data['session-token']
}

// ── Balance ───────────────────────────────────────────────────────────────────

interface TastyBalance {
  netLiquidatingValue: number    // total account value in USD
  cashBalance: number
  longEquityValue: number
  shortEquityValue: number
  longDerivativeValue: number
  shortDerivativeValue: number
}

async function getBalance(token: string, accountNumber: string): Promise<TastyBalance> {
  const res = await fetch(`${TT_BASE}/accounts/${accountNumber}/balances`, {
    headers: { 'Authorization': token, 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Failed to fetch balances for ${accountNumber}: ${await res.text()}`)
  const { data } = await res.json()
  return {
    netLiquidatingValue: parseFloat(data['net-liquidating-value'] ?? '0'),
    cashBalance: parseFloat(data['cash-balance'] ?? '0'),
    longEquityValue: parseFloat(data['long-equity-value'] ?? '0'),
    shortEquityValue: parseFloat(data['short-equity-value'] ?? '0'),
    longDerivativeValue: parseFloat(data['long-derivative-value'] ?? '0'),
    shortDerivativeValue: parseFloat(data['short-derivative-value'] ?? '0'),
  }
}

// ── Transactions (for aporte calculation) ────────────────────────────────────

async function getMonthDeposits(token: string, accountNumber: string): Promise<number> {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const res = await fetch(
    `${TT_BASE}/accounts/${accountNumber}/transactions?type=Money+Movement&start-date=${startOfMonth}&per-page=100`,
    { headers: { 'Authorization': token, 'Accept': 'application/json' } },
  )
  if (!res.ok) return 0
  const { data } = await res.json()
  const items = (data?.items ?? []) as any[]
  // Sum ACH/wire deposits; exclude withdrawals (negative values)
  return items
    .filter((t: any) => parseFloat(t['net-value']) > 0)
    .reduce((sum: number, t: any) => sum + parseFloat(t['net-value']), 0)
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
  aporteUsd: number,
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
      aportes_usd: aporteUsd,
      data_fechamento: dataFechamento,
    }).eq('id', existing.id)
  } else {
    await sb.from('registros').insert([{
      banco_id: bancoId,
      periodo,
      data_fechamento: dataFechamento,
      aportes: 0,
      patrimonio: 0,
      aportes_usd: aporteUsd,
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
    .eq('provider', 'tastytrade')
    .eq('enabled', true)

  if (provErr) throw provErr
  if (!providers?.length) {
    return new Response(JSON.stringify({ message: 'No Tastytrade providers configured' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let token: string
  try {
    token = await getSessionToken()
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }

  const results = []

  for (const p of providers) {
    const bancoNome = (p.bancos as any)?.nome ?? 'Tastytrade'
    const accountNumber = p.provider_account_id

    try {
      if (!accountNumber) throw new Error('provider_account_id (account number) not configured')

      const [balance, deposits] = await Promise.all([
        getBalance(token, accountNumber),
        getMonthDeposits(token, accountNumber),
      ])

      const balanceUsd = balance.netLiquidatingValue
      await upsertRegistro(sb, p.banco_id, balanceUsd, deposits, periodo, dataFechamento)

      await sb.from('sync_providers').update({ last_synced_at: new Date().toISOString() }).eq('id', p.id)
      await sb.from('sync_logs').insert([{
        provider: 'tastytrade',
        banco_id: p.banco_id,
        banco_nome: bancoNome,
        status: 'success',
        balance_usd: balanceUsd,
        periodo,
        message: `NLV: $${balanceUsd.toFixed(2)} | Deposits this month: $${deposits.toFixed(2)}`,
      }])

      results.push({ bank: bancoNome, account: accountNumber, status: 'success', balance_usd: balanceUsd })
    } catch (err: any) {
      await sb.from('sync_logs').insert([{
        provider: 'tastytrade',
        banco_id: p.banco_id,
        banco_nome: bancoNome,
        status: 'error',
        message: err.message,
        periodo,
      }])
      results.push({ bank: bancoNome, status: 'error', error: err.message })
    }
  }

  return new Response(JSON.stringify({ provider: 'tastytrade', results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
