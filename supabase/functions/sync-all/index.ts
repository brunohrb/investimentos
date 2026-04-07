/**
 * sync-all — Master orchestrator that calls all provider sync functions
 *
 * This is the single entry point called by:
 *   1. pg_cron scheduler (daily at 09:00 UTC / 06:00 BRT)
 *   2. The "Sync Now" button in investimentos.html
 *   3. Manual HTTP call during testing
 *
 * It fans out to all provider functions in parallel and returns
 * a consolidated summary.
 *
 * Required Supabase secrets:
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase
 *   SUPABASE_URL              — auto-injected by Supabase
 *   (Each provider also needs its own secrets — see individual functions)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Internal function URLs (same project, same region)
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`

const PROVIDERS = [
  'sync-pluggy',
  'sync-tastytrade',
  'sync-okx',
  'sync-plaid',
  'sync-avenue',
] as const

// ── Call a single provider function ──────────────────────────────────────────

async function callProvider(name: string): Promise<{ provider: string; results: any[]; error?: string }> {
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    const body = await res.json()
    if (!res.ok) return { provider: name, results: [], error: body.error ?? `HTTP ${res.status}` }
    return { provider: name, results: body.results ?? [], error: body.error }
  } catch (err: any) {
    return { provider: name, results: [], error: err.message }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Allow only POST or scheduled calls (GET from pg_cron)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Check which providers have active configurations
  const { data: activeProviders } = await sb
    .from('sync_providers')
    .select('provider')
    .eq('enabled', true)

  const activeSet = new Set(activeProviders?.map((p: any) => `sync-${p.provider}`) ?? [])
  const toRun = PROVIDERS.filter((p) => activeSet.has(p))

  if (!toRun.length) {
    return new Response(
      JSON.stringify({ message: 'No active providers configured. Set up connections in sync.html.' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Fan out all provider calls in parallel
  const providerResults = await Promise.all(toRun.map(callProvider))

  // Build summary
  const summary = {
    synced_at: new Date().toISOString(),
    providers_run: toRun.length,
    results: providerResults.map((r) => ({
      provider: r.provider.replace('sync-', ''),
      success: (r.results ?? []).filter((x: any) => x.status === 'success').length,
      error: (r.results ?? []).filter((x: any) => x.status === 'error').length,
      details: r.results,
      provider_error: r.error,
    })),
  }

  const totalSuccess = summary.results.reduce((n, r) => n + r.success, 0)
  const totalError = summary.results.reduce((n, r) => n + r.error, 0)

  // Write a master sync log entry
  await sb.from('sync_logs').insert([{
    provider: 'sync-all',
    status: totalError === 0 ? 'success' : totalSuccess > 0 ? 'partial' : 'error',
    message: `${totalSuccess} accounts synced, ${totalError} failed`,
    periodo: (() => {
      const now = new Date()
      return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
    })(),
  }])

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  })
})
