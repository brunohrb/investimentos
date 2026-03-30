// ============================================================
// PATCH DE SEGURANÇA — Bandeira's Gestão Financeira
//
// Substitua as funções abaixo no seu arquivo HTML principal.
// Proteções adicionadas:
//   1. Backup automático no localStorage a cada salvamento
//   2. Proteção contra sobrescrita acidental (confirmação digitada)
//   3. Função para recuperar do backup local em caso de emergência
// ============================================================


// ──────────────────────────────────────────────
// 1. SUBSTITUIR: salvarTudoNoSupabase()
//    Agora salva cópia no localStorage antes de enviar ao Supabase
// ──────────────────────────────────────────────

async function salvarTudoNoSupabase() {

  // ═══ PROTEÇÃO: Não sobrescreve se db está vazio mas Supabase tinha dados ═══
  const dbVazio = (!db.predios || db.predios.length === 0)
               && (!db.financeiro?.lancamentos || db.financeiro.lancamentos.length === 0);

  if (dbVazio) {
    // Verifica se o Supabase tinha dados antes
    const backupLocal = localStorage.getItem('bandeiras_backup_db');
    if (backupLocal) {
      const bkp = JSON.parse(backupLocal);
      const tinhaPrecios = bkp.predios && bkp.predios.length > 0;
      const tinhaLancamentos = bkp.financeiro?.lancamentos?.length > 0;

      if (tinhaPrecios || tinhaLancamentos) {
        console.error('⛔ BLOQUEADO: Tentativa de salvar db vazio quando havia dados anteriores.');
        alert('⚠️ PROTEÇÃO ATIVADA: O sistema detectou que você está prestes a salvar um banco VAZIO sobre dados existentes. Operação cancelada.\n\nSe você realmente quer limpar tudo, use a função zerarFinanceiroDemo().');
        return;
      }
    }
  }

  // ═══ BACKUP LOCAL: Salva cópia no navegador antes de enviar ═══
  try {
    const copia = JSON.stringify(db);
    localStorage.setItem('bandeiras_backup_db', copia);
    localStorage.setItem('bandeiras_backup_data', new Date().toISOString());
    console.log('✅ Backup local salvo:', (copia.length / 1024).toFixed(1), 'KB');
  } catch (e) {
    console.warn('⚠️ Não foi possível salvar backup local:', e.message);
  }

  // ═══ ENVIA PARA SUPABASE ═══
  const { error } = await supabaseClient
    .from('backup_sistema')
    .upsert({
      id: 'principal',
      dados: db,
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error('Erro ao salvar no Supabase:', error);
    alert('Erro ao salvar no banco. Seus dados foram salvos localmente como backup.');
  }
}


// ──────────────────────────────────────────────
// 2. SUBSTITUIR: importarExcel(input)
//    Agora exige confirmação digitada antes de sobrescrever
// ──────────────────────────────────────────────

function importarExcel(input) {
  const file = input.files[0];
  if (!file) return;

  // ═══ PROTEÇÃO: Confirmação digitada ═══
  const confirmacao = prompt(
    '⚠️ ATENÇÃO: Isso irá SUBSTITUIR TODOS os dados atuais pelo arquivo selecionado.\n\n' +
    'Esta ação NÃO pode ser desfeita.\n\n' +
    'Digite CONFIRMAR para prosseguir:'
  );

  if (!confirmacao || confirmacao.trim().toUpperCase() !== 'CONFIRMAR') {
    alert('Operação cancelada.');
    input.value = '';
    return;
  }

  const reader = new FileReader();

  reader.onload = function (e) {
    const data = new Uint8Array(e.target.result);
    const wb = XLSX.read(data, { type: 'array' });

    // ═══ VALIDAÇÃO: Verifica se o Excel tem as abas necessárias ═══
    const abasNecessarias = ['Predios', 'Unidades', 'Inquilinos', 'Pagamentos'];
    const abasFaltando = abasNecessarias.filter(a => !wb.Sheets[a]);

    if (abasFaltando.length > 0) {
      alert(
        '❌ Arquivo inválido!\n\n' +
        'Abas faltando: ' + abasFaltando.join(', ') + '\n\n' +
        'Use apenas arquivos exportados pelo botão "Exportar Excel (Backup)".'
      );
      input.value = '';
      return;
    }

    const predios = XLSX.utils.sheet_to_json(wb.Sheets['Predios']);
    const unidades = XLSX.utils.sheet_to_json(wb.Sheets['Unidades']);
    const inquilinos = XLSX.utils.sheet_to_json(wb.Sheets['Inquilinos']);
    const pagamentos = XLSX.utils.sheet_to_json(wb.Sheets['Pagamentos']);
    const financeiro = XLSX.utils.sheet_to_json(wb.Sheets['Financeiro']);

    // ═══ VALIDAÇÃO: Verifica se tem dados minimamente válidos ═══
    if (predios.length === 0) {
      alert('❌ O arquivo não contém nenhum prédio. Importação cancelada.');
      input.value = '';
      return;
    }

    // Preserva usuários atuais (não sobrescreve)
    const usuariosAtuais = db.usuarios || [];

    db = {
      predios: [],
      financeiro: { lancamentos: financeiro },
      usuarios: usuariosAtuais
    };

    predios.forEach(p => {
      const predio = {
        id: p.predio_id,
        nome: p.nome,
        unidades: []
      };

      unidades
        .filter(u => u.predio_id === p.predio_id)
        .forEach(u => {
          const inq = inquilinos.find(i => i.unidade_id === u.unidade_id);

          let inquilino = null;

          if (inq) {
            inquilino = {
              id: inq.inquilino_id,
              nome: inq.nome,
              telefone: inq.telefone,
              valor: inq.valor,
              venc: inq.venc,
              caucao: inq.caucao,
              arquivos: [],
              pagamentos: Array.from({ length: 12 }, (_, mes) => {
                const pg = pagamentos.find(
                  p => p.inquilino_id === inq.inquilino_id && p.mes === mes
                );
                return pg
                  ? { pago: pg.pago, aluguel: pg.aluguel, juros: pg.juros, data: pg.data }
                  : { pago: false };
              })
            };
          }

          predio.unidades.push({
            id: u.unidade_id,
            nome: u.nome,
            status: u.status,
            inquilino
          });
        });

      db.predios.push(predio);
    });

    save();
    alert('✅ Sistema restaurado com sucesso!\n\n' +
          `${db.predios.length} prédio(s) importado(s).`);
  };

  reader.readAsArrayBuffer(file);
}


// ──────────────────────────────────────────────
// 3. SUBSTITUIR: importarExcelConfiguracoes(input)
//    Agora usa a mesma proteção do importarExcel
// ──────────────────────────────────────────────

function importarExcelConfiguracoes(input) {
  // A confirmação agora é feita dentro do importarExcel()
  importarExcel(input);
  registrarLog('Backup restaurado via Excel');
}


// ──────────────────────────────────────────────
// 4. NOVA FUNÇÃO: recuperarBackupLocal()
//    Recupera dados do localStorage em caso de emergência
//    Para usar: abra o Console (F12) e execute recuperarBackupLocal()
// ──────────────────────────────────────────────

async function recuperarBackupLocal() {
  const backupStr = localStorage.getItem('bandeiras_backup_db');
  const backupData = localStorage.getItem('bandeiras_backup_data');

  if (!backupStr) {
    alert('❌ Nenhum backup local encontrado no navegador.');
    return;
  }

  const tamanhoKB = (backupStr.length / 1024).toFixed(1);

  const confirma = confirm(
    `🔄 RECUPERAR BACKUP LOCAL\n\n` +
    `Backup encontrado: ${backupData || 'data desconhecida'}\n` +
    `Tamanho: ${tamanhoKB} KB\n\n` +
    `Isso irá restaurar os dados salvos localmente no navegador ` +
    `e enviar para o Supabase.\n\n` +
    `Deseja continuar?`
  );

  if (!confirma) return;

  try {
    const backupDb = JSON.parse(backupStr);

    // Validação mínima
    if (!backupDb.predios) {
      alert('❌ Backup corrompido: não contém prédios.');
      return;
    }

    db = backupDb;

    // Salva no Supabase (bypass da proteção pois estamos restaurando)
    const { error } = await supabaseClient
      .from('backup_sistema')
      .upsert({
        id: 'principal',
        dados: db,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error('Erro ao restaurar:', error);
      alert('❌ Erro ao enviar para o Supabase: ' + error.message);
      return;
    }

    gerarContasReceber();
    render();

    alert(
      `✅ Backup restaurado com sucesso!\n\n` +
      `${db.predios.length} prédio(s)\n` +
      `${db.financeiro?.lancamentos?.length || 0} lançamento(s)`
    );

  } catch (e) {
    alert('❌ Erro ao processar backup: ' + e.message);
  }
}


// ──────────────────────────────────────────────
// 5. SUBSTITUIR: carregarSistema()
//    Agora tenta recuperar do localStorage se Supabase estiver vazio
// ──────────────────────────────────────────────

async function carregarSistema() {
  const { data, error } = await supabaseClient
    .from('backup_sistema')
    .select('dados')
    .eq('id', 'principal')
    .single();

  if (error) {
    console.error('Erro ao carregar do Supabase:', error);
  }

  if (data && data.dados) {
    db = data.dados;
  } else {
    db = {
      predios: [],
      financeiro: {
        contasReceber: [],
        contasPagar: [],
        caixa: [],
        lancamentos: []
      },
      despesas: [],
      usuarios: []
    };
  }

  // ═══ PROTEÇÃO: Se Supabase veio vazio, tenta recuperar do localStorage ═══
  const dbVazio = (!db.predios || db.predios.length === 0)
               && (!db.financeiro?.lancamentos || db.financeiro.lancamentos.length === 0);

  if (dbVazio) {
    const backupStr = localStorage.getItem('bandeiras_backup_db');
    if (backupStr) {
      try {
        const backupDb = JSON.parse(backupStr);
        const temDados = (backupDb.predios?.length > 0) ||
                         (backupDb.financeiro?.lancamentos?.length > 0);

        if (temDados) {
          const backupData = localStorage.getItem('bandeiras_backup_data') || 'desconhecida';
          const restaurar = confirm(
            `⚠️ ATENÇÃO: O banco de dados está vazio, mas existe um backup local ` +
            `no seu navegador (salvo em ${backupData}).\n\n` +
            `📦 ${backupDb.predios?.length || 0} prédio(s)\n` +
            `📊 ${backupDb.financeiro?.lancamentos?.length || 0} lançamento(s)\n\n` +
            `Deseja restaurar este backup?`
          );

          if (restaurar) {
            db = backupDb;
            await supabaseClient
              .from('backup_sistema')
              .upsert({
                id: 'principal',
                dados: db,
                updated_at: new Date().toISOString()
              });
            console.log('✅ Backup local restaurado automaticamente.');
          }
        }
      } catch (e) {
        console.warn('Erro ao tentar recuperar backup local:', e);
      }
    }
  }

  // Garante estrutura de usuários
  if (!db.usuarios) db.usuarios = [];

  // Se não há usuários, cria admin padrão (migração)
  if (db.usuarios.length === 0) {
    db.usuarios.push({
      id: 'usr_admin_1',
      nome: 'Administrador',
      login: 'admin',
      senha: 'bandeiras2026',
      role: 'admin'
    });
    await salvarTudoNoSupabase();
  }

  // Aplica modo somente leitura
  if (isReadOnly()) {
    document.body.classList.add('readonly');
  } else {
    document.body.classList.remove('readonly');
  }

  atualizarSidebarUsuario();
  gerarContasReceber();
  render();
  carregarFiltroAnos();
}
