/**
 * sync-avenue — Syncs portfolio balance from Avenue Securities
 *
 * Avenue does not have a public API or Open Finance integration.
 * This function uses their internal mobile/web API endpoints.
 *
 * Required Supabase secrets:
 *   AVENUE_EMAIL    — your Avenue login email
 *   AVENUE_PASSWORD — your Avenue password
 *
 * Required sync_providers row:
 *   provider = 'avenue'
 *   banco_id = UUID of the Avenue banco (is_usd = true)
 *
 * NOTE: Avenue may update their API at any time. If this breaks,
 *       check the Network tab in your browser while logging into
 *       app.avenue.us and update the endpoints below accordingly.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AVENUE_BASE = 'https://api.avenue.us'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AVENUE_EMAIL = Deno.env.get('AVENUE_EMAIL')!
const AVENUE_PASSWORD = Deno.env.get('AVENUE_PASSWORD')!

// ── Auth ─────────────────────────────────────────────────────────────────────

interface AvenueSession {
  access_token: string
  account_id: string
}

async function login(): Promise<AvenueSession> {
  const res = await fetch(`${AVENUE_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AVENUE_EMAIL, password: AVENUE_PASSWORD }),
  })
  if (!res.ok) throw new Error(`Avenue login failed (${res.status}): ${await res.text()}`)
  const body = await res.json()
  const access_token = body.access_token ?? body.token ?? body.data?.access_token
  const account_id = body.account_id ?? body.data?.account_id ?? body.accountId
  if (!access_token) throw new Error('Could not extract access_token from Avenue login response')
  return { access_token, account_id }
}

// ── Portfolio balance ─────────────────────────────────────────────────────────

async function getPortfolioBalance(session: AvenueSession): Promise<number> {
  const accountId = session.account_id
  const res = await fetch(`${AVENUE_BASE}/v1/accounts/${accountId}/portfolio`, {
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Avenue portfolio fetch failed (${res.status}): ${await res.text()}`)
  const body = await res.json()
  // Try common response shapes
  const balance =
    body.net_account_value ??
    body.portfolio_value ??
    body.total_value ??
    body.data?.net_account_value ??
    body.data?.portfolio_value ??
    0
  return parseFloat(String(balance))
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
    .eq('provider', 'avenue')
    .eq('enabled', true)

  if (provErr) throw provErr
  if (!providers?.length) {
    return new Response(JSON.stringify({ message: 'No Avenue providers configured' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const results = []

  for (const p of providers) {
    const bancoNome = (p.bancos as any)?.nome ?? 'Avenue'

    try {
      const session = await login()
      const balanceUsd = await getPortfolioBalance(session)

      await upsertRegistro(sb, p.banco_id, balanceUsd, periodo, dataFechamento)

      await sb.from('sync_providers').update({ last_synced_at: new Date().toISOString() }).eq('id', p.id)
      await sb.from('sync_logs').insert([{
        provider: 'avenue',
        banco_id: p.banco_id,
        banco_nome: bancoNome,
        status: 'success',
        balance_usd: balanceUsd,
        periodo,
      }])

      results.push({ bank: bancoNome, status: 'success', balance_usd: balanceUsd })
    } catch (err: any) {
      await sb.from('sync_logs').insert([{
        provider: 'avenue',
        banco_id: p.banco_id,
        banco_nome: bancoNome,
        status: 'error',
        message: err.message,
        periodo,
      }])
      results.push({ bank: bancoNome, status: 'error', error: err.message })
    }
  }

  return new Response(JSON.stringify({ provider: 'avenue', results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
