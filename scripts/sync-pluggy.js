#!/usr/bin/env node
/**
 * sync-pluggy.js
 * Busca posições e saldos de todas as corretoras conectadas no Pluggy
 * e salva no Supabase. Roda via GitHub Actions todo dia às 7h (BRT).
 */

const https = require('https');

const PLUGGY_CLIENT_ID     = process.env.PLUGGY_CLIENT_ID;
const PLUGGY_CLIENT_SECRET = process.env.PLUGGY_CLIENT_SECRET;
const SUPABASE_URL         = process.env.SUPABASE_URL || 'https://hisbbtddpoxufvghxqtm.supabase.co';
const SUPABASE_KEY         = process.env.SUPABASE_KEY;

if (!PLUGGY_CLIENT_ID || !PLUGGY_CLIENT_SECRET || !SUPABASE_KEY) {
  console.error('❌ Variáveis de ambiente faltando: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, SUPABASE_KEY');
  process.exit(1);
}

// ── Helpers HTTP ──────────────────────────────────────────────────────────────

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
          else resolve(json);
        } catch (e) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function pluggyGet(path, apiKey) {
  return request({
    hostname: 'api.pluggy.ai',
    path,
    method: 'GET',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }
  });
}

function pluggyAuth() {
  return request({
    hostname: 'api.pluggy.ai',
    path: '/auth',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { clientId: PLUGGY_CLIENT_ID, clientSecret: PLUGGY_CLIENT_SECRET });
}

function supabaseUpsert(table, rows, conflictCol) {
  const body = JSON.stringify(rows);
  return request({
    hostname: new URL(SUPABASE_URL).hostname,
    path: `/rest/v1/${table}?on_conflict=${conflictCol}`,
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
      'Content-Length': Buffer.byteLength(body)
    }
  }, null).catch(() => {
    // fallback sem Content-Length
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: new URL(SUPABASE_URL).hostname,
        path: `/rest/v1/${table}?on_conflict=${conflictCol}`,
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  });
}

// ── Lógica principal ──────────────────────────────────────────────────────────

async function main() {
  console.log('🔐 Autenticando no Pluggy...');
  const { apiKey } = await pluggyAuth();
  console.log('✅ Autenticado');

  // 1. Busca todos os itens (corretoras) conectados
  console.log('\n📋 Buscando corretoras conectadas...');
  const { results: itens } = await pluggyGet('/items', apiKey);

  if (!itens || itens.length === 0) {
    console.warn('⚠️  Nenhuma corretora conectada no Pluggy. Conecte uma em pluggy.ai/dashboard');
    process.exit(0);
  }

  const agora = new Date().toISOString();
  const rowsItens = [];
  const rowsContas = [];
  const rowsInvestimentos = [];
  const rowsSnapshot = [];

  for (const item of itens) {
    const nomeConector = item.connector?.name || item.connectorId;
    const status = item.status; // UPDATED | UPDATING | LOGIN_ERROR | etc.
    console.log(`\n🏦 ${nomeConector} (${item.id}) — status: ${status}`);

    rowsItens.push({
      item_id:        item.id,
      conector_nome:  nomeConector,
      conector_id:    item.connectorId,
      status,
      atualizado_em:  item.lastUpdatedAt || agora,
      sincronizado_em: agora
    });

    if (status === 'LOGIN_ERROR' || status === 'WAITING_USER_INPUT') {
      console.warn(`  ⚠️  Item precisa de reautenticação no Pluggy`);
      continue;
    }

    // 2. Contas (saldos)
    try {
      const { results: contas } = await pluggyGet(`/accounts?itemId=${item.id}`, apiKey);
      for (const conta of contas || []) {
        console.log(`  💰 Conta: ${conta.name} — R$ ${conta.balance?.toFixed(2)}`);
        rowsContas.push({
          account_id:    conta.id,
          item_id:       item.id,
          conector_nome: nomeConector,
          nome:          conta.name,
          tipo:          conta.type,       // BANK / CREDIT / INVESTMENT
          subtipo:       conta.subtype,
          saldo:         conta.balance || 0,
          moeda:         conta.currencyCode || 'BRL',
          atualizado_em: agora
        });

        rowsSnapshot.push({
          item_id:       item.id,
          account_id:    conta.id,
          conector_nome: nomeConector,
          nome:          conta.name,
          tipo:          conta.type,
          saldo:         conta.balance || 0,
          data:          agora.split('T')[0],
          criado_em:     agora
        });
      }
    } catch (e) {
      console.warn(`  ⚠️  Erro ao buscar contas: ${e.message}`);
    }

    // 3. Investimentos (posições)
    try {
      const { results: investimentos } = await pluggyGet(`/investments?itemId=${item.id}`, apiKey);
      for (const inv of investimentos || []) {
        console.log(`  📈 ${inv.name} — R$ ${inv.balance?.toFixed(2)}`);
        rowsInvestimentos.push({
          investment_id:     inv.id,
          item_id:           item.id,
          conector_nome:     nomeConector,
          nome:              inv.name,
          codigo:            inv.code || null,       // ticker (ex: PETR4)
          tipo:              inv.type,               // STOCK / FUND / FIXED_INCOME / etc.
          subtipo:           inv.subtype || null,
          saldo:             inv.balance || 0,
          quantidade:        inv.quantity || 0,
          valor_atual:       inv.value || 0,
          preco_unitario:    inv.lastMonthRate || null,
          rendimento_mes:    inv.lastMonthRate || null,
          rendimento_total:  inv.annualRate || null,
          vencimento:        inv.date || null,
          moeda:             inv.currencyCode || 'BRL',
          atualizado_em:     agora
        });
      }
    } catch (e) {
      console.warn(`  ⚠️  Erro ao buscar investimentos: ${e.message}`);
    }
  }

  // 4. Salva no Supabase
  console.log('\n💾 Salvando no Supabase...');

  if (rowsItens.length) {
    await supabaseUpsert('pluggy_itens', rowsItens, 'item_id');
    console.log(`  ✅ ${rowsItens.length} corretora(s) salva(s)`);
  }

  if (rowsContas.length) {
    await supabaseUpsert('pluggy_contas', rowsContas, 'account_id');
    console.log(`  ✅ ${rowsContas.length} conta(s) salva(s)`);
  }

  if (rowsInvestimentos.length) {
    await supabaseUpsert('pluggy_investimentos', rowsInvestimentos, 'investment_id');
    console.log(`  ✅ ${rowsInvestimentos.length} investimento(s) salvo(s)`);
  }

  if (rowsSnapshot.length) {
    // snapshot usa chave composta: account_id + data (um por dia)
    await supabaseUpsert('pluggy_snapshots', rowsSnapshot, 'account_id,data');
    console.log(`  ✅ ${rowsSnapshot.length} snapshot(s) do dia salvo(s)`);
  }

  console.log('\n🎉 Sync concluído!');
}

main().catch(err => {
  console.error('❌ Erro fatal:', err.message);
  process.exit(1);
});
