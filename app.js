// ══════════════════════════════════════════════════════════════
//  ESTOQUE DIGITAL — app.js v4.2
//  Grupo Carlos Vaz — CRV/LAS
//  Login · Painel · Entrada · Saída Rápida · Editar · Excluir
//  + Relatório para Impressão
// ══════════════════════════════════════════════════════════════

// ── Config ───────────────────────────────────────────────────
var API_URL = 'https://script.google.com/macros/s/AKfycbyvw-6uBYct475K2nv5J-U2z39KHxbNOCqkVMaPl6MiFGnd3zTMiLPr5ivMfKNDZ55B/exec';
var SESSION_KEY = 'cv_estoque_sessao';

var CREDS_OFFLINE = {
  'LUCAS':  'lucas2026',
  'TASSIO': 'tassio2026',
  'AMARAL': 'amaral2026',
  'ALEX':   'alex2026',
  'ALEF':   'GP.Carlos2026'
};

// ── State ────────────────────────────────────────────────────
var sessao = null;
var dadosEstoque = null;
var fotoData = '';
var fotoStream = null;
var refreshInterval = null;
var relatorioAtivo = false;

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
(function () {
  var s = localStorage.getItem(SESSION_KEY);
  if (s) {
    try {
      sessao = JSON.parse(s);
      if (sessao && sessao.nome) {
        esconderLogin();
        iniciarApp();
        return;
      }
    } catch (e) { /* ignora */ }
  }
})();

// ══════════════════════════════════════════════════════════════
//  TOGGLE SENHA
// ══════════════════════════════════════════════════════════════
function toggleSenha() {
  var input = document.getElementById('loginPass');
  var icon = document.getElementById('eyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = '🙈';
  } else {
    input.type = 'password';
    icon.textContent = '👁️';
  }
}

// ══════════════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════════════
function fazerLogin() {
  var user = document.getElementById('loginUser').value.trim();
  var pass = document.getElementById('loginPass').value.trim();
  var err = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');

  err.textContent = '';
  if (!user || !pass) { err.textContent = 'Preencha todos os campos'; shakeLogin(); return; }

  btn.disabled = true;
  btn.textContent = 'Verificando...';

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ acao: 'login', usuario: user, senha: pass }),
    redirect: 'follow'
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') {
        sessao = { nome: d.nome, nivel: d.nivel, senha: pass };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
        esconderLogin();
        iniciarApp();
      } else {
        err.textContent = d.msg || 'Credenciais inválidas';
        shakeLogin();
      }
    })
    .catch(function () {
      if (CREDS_OFFLINE[user] && CREDS_OFFLINE[user] === pass) {
        sessao = { nome: user, nivel: user === 'ALEF' ? 'gestor' : 'funcionario', senha: pass };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
        esconderLogin();
        iniciarApp();
      } else {
        err.textContent = 'Sem conexão e credenciais inválidas';
        shakeLogin();
      }
    })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    });
}

function shakeLogin() {
  var c = document.querySelector('.login-card');
  c.classList.add('shake');
  setTimeout(function () { c.classList.remove('shake'); }, 500);
}

function esconderLogin() {
  document.getElementById('loginScreen').classList.add('hidden');
}

function logout() {
  sessao = null;
  dadosEstoque = null;
  localStorage.removeItem(SESSION_KEY);
  if (refreshInterval) clearInterval(refreshInterval);
  stopFotoCamera();
  fecharRelatorio();

  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('badgeGestor').style.display = 'none';
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginPass').type = 'password';
  document.getElementById('eyeIcon').textContent = '👁️';
  document.getElementById('loginError').textContent = '';

  switchTab('painel');
}

document.addEventListener('DOMContentLoaded', function () {
  var passField = document.getElementById('loginPass');
  if (passField) {
    passField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') fazerLogin();
    });
  }
});

// ══════════════════════════════════════════════════════════════
//  APP INIT
// ══════════════════════════════════════════════════════════════
function iniciarApp() {
  document.getElementById('ldScreen').classList.remove('hidden');
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('userBadge').textContent = sessao.nome;

  if (sessao.nivel === 'gestor') {
    document.getElementById('badgeGestor').style.display = '';
  }

  loadSequence([
    { t: 'Autenticando...', p: 25 },
    { t: 'Carregando estoque...', p: 60 },
    { t: 'Preparando painel...', p: 90 },
    { t: 'Pronto!', p: 100 }
  ], function () {
    document.getElementById('ldScreen').classList.add('hidden');
    syncDados();
    refreshInterval = setInterval(syncDados, 300000);
  });
}

function loadSequence(steps, cb) {
  var i = 0;
  function next() {
    if (i >= steps.length) { setTimeout(cb, 400); return; }
    document.getElementById('ldText').textContent = steps[i].t;
    document.getElementById('ldBarTop').style.width = steps[i].p + '%';
    i++;
    setTimeout(next, 500);
  }
  next();
}

// ══════════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ══════════════════════════════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
  document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');

  document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
  document.getElementById('content' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');

  if (tab === 'entrada') {
    initFotoCamera();
  } else {
    stopFotoCamera();
  }

  if (tab === 'saida' && dadosEstoque) {
    renderSaidaList(dadosEstoque.produtos);
  }
}

// ══════════════════════════════════════════════════════════════
//  SYNC
// ══════════════════════════════════════════════════════════════
function syncDados() {
  fetch(API_URL + '?sync=1')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      dadosEstoque = d;
      renderPainel(d);
      setBadge(true);
      localStorage.setItem('cv_estoque_cache', JSON.stringify(d));
    })
    .catch(function () {
      setBadge(false);
      var cache = localStorage.getItem('cv_estoque_cache');
      if (cache && !dadosEstoque) {
        dadosEstoque = JSON.parse(cache);
        renderPainel(dadosEstoque);
      }
    });
}

function setBadge(on) {
  var b = document.getElementById('badgeStatus');
  b.textContent = on ? 'Online' : 'Offline';
  b.className = 'badge ' + (on ? 'badge-online' : 'badge-offline');
}

// ══════════════════════════════════════════════════════════════
//  RENDER PAINEL
// ══════════════════════════════════════════════════════════════
function renderPainel(d) {
  if (!d) return;

  var totalProd = d.totalProdutos || 0;
  var alertas = d.alertas || [];
  var produtos = d.produtos || [];

  var okCount = 0;
  var zeroCount = 0;

  produtos.forEach(function (p) {
    if (p.quantidade === 0) zeroCount++;
    else if (p.status === 'OK' || p.status === 'MONITORAR') okCount++;
  });

  document.getElementById('statTotal').textContent = totalProd;
  document.getElementById('statOk').textContent = okCount;
  document.getElementById('statAlertas').textContent = alertas.length;
  document.getElementById('statZero').textContent = zeroCount;

  var alertSection = document.getElementById('alertasSection');
  var alertList = document.getElementById('alertasList');

  if (alertas.length > 0) {
    alertSection.style.display = 'block';
    var ah = '';
    alertas.forEach(function (a) {
      var cls = 'critical';
      var icon = '⚠️';
      var badgeCls = 'vencido';

      if (a.tipo === 'ESTOQUE ZERO') { cls = 'estoque-zero'; icon = '🚫'; badgeCls = 'zero'; }
      else if (a.status === 'CRÍTICO') { cls = 'critical'; icon = '🔴'; badgeCls = 'critico'; }
      else if (a.status === 'ATENÇÃO') { cls = 'warning'; icon = '🟡'; badgeCls = 'atencao'; }
      else if (a.status === 'VENCIDO') { cls = 'critical'; icon = '❌'; badgeCls = 'vencido'; }

      ah += '<div class="alerta-card ' + cls + '">';
      ah += '<div class="alerta-icon">' + icon + '</div>';
      ah += '<div class="alerta-info">';
      ah += '<div class="alerta-nome">' + a.produto + '</div>';
      ah += '<div class="alerta-detail">' + a.marca + ' • ' + a.setor + ' • Qtd: ' + a.quantidade + '</div>';
      ah += '</div>';
      ah += '<span class="alerta-badge ' + badgeCls + '">' + a.tipo + '</span>';
      ah += '</div>';
    });
    alertList.innerHTML = ah;
  } else {
    alertSection.style.display = 'none';
  }

  renderProdutos(produtos);

  document.getElementById('syncTime').textContent = d.timestamp ? 'Atualizado: ' + d.timestamp : '';
}

// ══════════════════════════════════════════════════════════════
//  RENDER PRODUTOS
// ══════════════════════════════════════════════════════════════
function renderProdutos(produtos) {
  var el = document.getElementById('produtosList');

  if (!produtos || produtos.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">Nenhum produto cadastrado</div></div>';
    return;
  }

  var html = '';
  produtos.forEach(function (p) {
    var statusCls = getStatusClass(p.status, p.quantidade);
    var icon = getStatusIcon(p.status, p.quantidade);
    var qtdCls = p.quantidade === 0 ? 'zero' : p.quantidade <= 5 ? 'low' : 'ok';
    var statusLabel = p.quantidade === 0 ? 'SEM ESTOQUE' : p.status;

    html += '<div class="produto-card" onclick="abrirDetalhe(' + p.linha + ')">';
    html += '<div class="prod-icon ' + statusCls + '">' + icon + '</div>';
    html += '<div class="prod-info">';
    html += '<div class="prod-nome">' + p.nome + '</div>';
    html += '<div class="prod-meta">' + p.marca + ' • ' + p.setor + (p.lote ? ' • Lote: ' + p.lote : '') + '</div>';
    html += '</div>';
    html += '<div class="prod-right">';
    html += '<div class="prod-qtd ' + qtdCls + '">' + p.quantidade + ' ' + p.unidade + '</div>';
    html += '<span class="prod-status ' + statusCls + '">' + statusLabel + '</span>';
    html += '</div>';
    html += '</div>';
  });

  el.innerHTML = html;
}

function getStatusClass(status, qtd) {
  if (qtd === 0) return 'zero';
  switch (status) {
    case 'VENCIDO': return 'vencido';
    case 'CRÍTICO': return 'critico';
    case 'ATENÇÃO': return 'atencao';
    case 'MONITORAR': return 'monitorar';
    default: return 'ok';
  }
}

function getStatusIcon(status, qtd) {
  if (qtd === 0) return '🚫';
  switch (status) {
    case 'VENCIDO': return '❌';
    case 'CRÍTICO': return '🔴';
    case 'ATENÇÃO': return '🟡';
    case 'MONITORAR': return '🔵';
    default: return '✅';
  }
}

// ══════════════════════════════════════════════════════════════
//  FILTRAR PRODUTOS (painel)
// ══════════════════════════════════════════════════════════════
function filtrarProdutos() {
  if (!dadosEstoque) return;
  var termo = document.getElementById('searchInput').value.toLowerCase().trim();
  if (!termo) {
    renderProdutos(dadosEstoque.produtos);
    return;
  }
  var filtrados = dadosEstoque.produtos.filter(function (p) {
    return p.nome.toLowerCase().indexOf(termo) > -1 ||
      p.marca.toLowerCase().indexOf(termo) > -1 ||
      p.setor.toLowerCase().indexOf(termo) > -1 ||
      p.lote.toLowerCase().indexOf(termo) > -1;
  });
  renderProdutos(filtrados);
}

// ══════════════════════════════════════════════════════════════
//  DETALHE DO PRODUTO
// ══════════════════════════════════════════════════════════════
function abrirDetalhe(linha) {
  if (!dadosEstoque) return;
  var p = dadosEstoque.produtos.find(function (x) { return x.linha === linha; });
  if (!p) { toast('Produto não encontrado'); return; }

  var statusCls = getStatusClass(p.status, p.quantidade);
  var icon = getStatusIcon(p.status, p.quantidade);
  var isGestor = sessao && sessao.nivel === 'gestor';

  var h = '';
  h += '<div class="detalhe-header">';
  h += '<span class="d-icon">' + icon + '</span>';
  h += '<div class="d-nome">' + p.nome + '</div>';
  h += '<div class="d-marca">' + p.marca + (p.lote ? ' • Lote: ' + p.lote : '') + '</div>';
  h += '</div>';

  h += '<div class="detalhe-grid">';
  h += '<div class="detalhe-item"><div class="d-val" style="color:var(--blue);">' + p.quantidade + ' ' + p.unidade + '</div><div class="d-lbl">Estoque</div></div>';
  h += '<div class="detalhe-item"><div class="d-val"><span class="prod-status ' + statusCls + '" style="font-size:.7rem;">' + p.status + '</span></div><div class="d-lbl">Status</div></div>';
  h += '<div class="detalhe-item"><div class="d-val" style="font-size:.9rem;">' + p.setor + '</div><div class="d-lbl">Setor</div></div>';
  h += '<div class="detalhe-item"><div class="d-val" style="font-size:.9rem;">' + (p.validade || '—') + '</div><div class="d-lbl">Validade</div></div>';

  var diasTxt = '—';
  var diasColor = 'var(--green)';
  if (p.diasVencer !== '' && p.diasVencer !== null && p.diasVencer !== undefined) {
    diasTxt = p.diasVencer + ' dias';
    if (p.diasVencer < 0) diasColor = 'var(--red)';
    else if (p.diasVencer <= 7) diasColor = 'var(--orange)';
    else if (p.diasVencer <= 30) diasColor = 'var(--yellow)';
  }
  h += '<div class="detalhe-item"><div class="d-val" style="color:' + diasColor + ';">' + diasTxt + '</div><div class="d-lbl">Dias p/ Vencer</div></div>';
  h += '<div class="detalhe-item"><div class="d-val" style="font-size:.9rem;">' + (p.data || '—') + '</div><div class="d-lbl">Data Cadastro</div></div>';
  h += '</div>';

  h += '<div class="detalhe-actions">';
  if (p.quantidade > 0) {
    h += '<button class="btn-saida-det" onclick="abrirSaidaModal(' + p.linha + ')">📤 Saída</button>';
  }
  if (isGestor) {
    h += '<button class="btn-edit" onclick="abrirEditar(' + p.linha + ')">✏️ Editar</button>';
    h += '<button class="btn-delete" onclick="confirmarExcluir(' + p.linha + ')">🗑️ Excluir</button>';
  }
  h += '</div>';

  document.getElementById('detalheBody').innerHTML = h;
  document.getElementById('detalheModal').classList.add('show');
}

function fecharDetalhe() {
  document.getElementById('detalheModal').classList.remove('show');
}

// ══════════════════════════════════════════════════════════════
//  EDITAR PRODUTO
// ══════════════════════════════════════════════════════════════
function abrirEditar(linha) {
  if (!dadosEstoque) return;
  var p = dadosEstoque.produtos.find(function (x) { return x.linha === linha; });
  if (!p) return;

  fecharDetalhe();

  var h = '<div class="form-card">';
  h += '<input type="hidden" id="editLinha" value="' + linha + '">';

  h += '<div class="form-group"><label class="form-label">Produto</label>';
  h += '<input type="text" id="editProduto" class="form-field" value="' + escapeHtml(p.nome) + '"></div>';

  h += '<div class="form-group"><label class="form-label">Marca</label>';
  h += '<input type="text" id="editMarca" class="form-field" value="' + escapeHtml(p.marca) + '"></div>';

  h += '<div class="form-group"><label class="form-label">Setor</label>';
  h += '<select id="editSetor" class="form-field">';
  var setores = ['EDUCAÇÃO', 'SAÚDE', 'ASSISTÊNCIA SOCIAL', 'ADMINISTRAÇÃO', 'INFRAESTRUTURA', 'LIMPEZA', 'ALIMENTAÇÃO', 'ESCRITÓRIO'];
  setores.forEach(function (s) {
    h += '<option value="' + s + '"' + (s === p.setor ? ' selected' : '') + '>' + s + '</option>';
  });
  h += '</select></div>';

  h += '<div class="form-row">';
  h += '<div class="form-group"><label class="form-label">Quantidade</label>';
  h += '<input type="number" id="editQtd" class="form-field" value="' + p.quantidade + '" min="0" step="0.01"></div>';
  h += '<div class="form-group"><label class="form-label">Unidade</label>';
  h += '<select id="editUnidade" class="form-field">';
  ['UN', 'KG', 'L', 'CX', 'PCT', 'RL', 'FD', 'GL'].forEach(function (u) {
    h += '<option value="' + u + '"' + (u === p.unidade ? ' selected' : '') + '>' + u + '</option>';
  });
  h += '</select></div></div>';

  h += '<div class="form-row">';
  h += '<div class="form-group"><label class="form-label">Validade</label>';
  h += '<input type="date" id="editValidade" class="form-field" value="' + (p.validade || '') + '"></div>';
  h += '<div class="form-group"><label class="form-label">Lote</label>';
  h += '<input type="text" id="editLote" class="form-field" value="' + escapeHtml(p.lote) + '"></div></div>';

  h += '<div class="form-group"><label class="form-label">Observações</label>';
  h += '<input type="text" id="editObs" class="form-field" value=""></div>';

  h += '<button class="submit-btn" id="btnSalvarEdit" onclick="salvarEdicao()" style="background:var(--blue);">Salvar Alterações</button>';
  h += '</div>';

  document.getElementById('editBody').innerHTML = h;
  document.getElementById('editModal').classList.add('show');
}

function fecharEditar() {
  document.getElementById('editModal').classList.remove('show');
}

function salvarEdicao() {
  var btn = document.getElementById('btnSalvarEdit');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  var payload = {
    acao: 'editar',
    senha: sessao.senha,
    linha: parseInt(document.getElementById('editLinha').value),
    produto: document.getElementById('editProduto').value.trim(),
    marca: document.getElementById('editMarca').value.trim(),
    setor: document.getElementById('editSetor').value,
    quantidade: document.getElementById('editQtd').value,
    unidade: document.getElementById('editUnidade').value,
    validade: document.getElementById('editValidade').value,
    lote: document.getElementById('editLote').value.trim(),
    observacoes: document.getElementById('editObs').value.trim()
  };

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') {
        fecharEditar();
        showSuccess('✅', d.mensagem, '');
        syncDados();
      } else {
        toast(d.msg || 'Erro ao editar');
      }
    })
    .catch(function () { toast('Sem conexão'); })
    .finally(function () { btn.disabled = false; btn.textContent = 'Salvar Alterações'; });
}

// ══════════════════════════════════════════════════════════════
//  EXCLUIR PRODUTO
// ══════════════════════════════════════════════════════════════
function confirmarExcluir(linha) {
  if (!confirm('Tem certeza que deseja excluir este produto?')) return;

  fecharDetalhe();

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ acao: 'excluir', senha: sessao.senha, linha: linha }),
    redirect: 'follow'
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') {
        showSuccess('🗑️', d.mensagem, '');
        syncDados();
      } else {
        toast(d.msg || 'Erro ao excluir');
      }
    })
    .catch(function () { toast('Sem conexão'); });
}

// ══════════════════════════════════════════════════════════════
//  SAÍDA RÁPIDA — LISTA
// ══════════════════════════════════════════════════════════════
function renderSaidaList(produtos) {
  var el = document.getElementById('saidaList');
  if (!produtos || produtos.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📤</div><div class="empty-text">Nenhum produto disponível</div></div>';
    return;
  }

  var comEstoque = produtos.filter(function (p) { return p.quantidade > 0; });

  if (comEstoque.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🚫</div><div class="empty-text">Todos os produtos estão com estoque zerado</div></div>';
    return;
  }

  var html = '';
  comEstoque.forEach(function (p) {
    html += '<div class="saida-card">';
    html += '<div class="saida-icon">📦</div>';
    html += '<div class="saida-info">';
    html += '<div class="saida-nome">' + p.nome + '</div>';
    html += '<div class="saida-meta">' + p.marca + ' • ' + p.setor + '</div>';
    html += '</div>';
    html += '<div class="saida-qtd">' + p.quantidade + ' ' + p.unidade + '</div>';
    html += '<button class="saida-btn" onclick="event.stopPropagation();abrirSaidaModal(' + p.linha + ')">Saída</button>';
    html += '</div>';
  });

  el.innerHTML = html;
}

function filtrarSaida() {
  if (!dadosEstoque) return;
  var termo = document.getElementById('saidaSearch').value.toLowerCase().trim();
  if (!termo) {
    renderSaidaList(dadosEstoque.produtos);
    return;
  }
  var filtrados = dadosEstoque.produtos.filter(function (p) {
    return (p.nome.toLowerCase().indexOf(termo) > -1 ||
      p.marca.toLowerCase().indexOf(termo) > -1 ||
      p.setor.toLowerCase().indexOf(termo) > -1) && p.quantidade > 0;
  });
  renderSaidaList(filtrados);
}

// ══════════════════════════════════════════════════════════════
//  SAÍDA MODAL
// ══════════════════════════════════════════════════════════════
function abrirSaidaModal(linha) {
  if (!dadosEstoque) return;
  var p = dadosEstoque.produtos.find(function (x) { return x.linha === linha; });
  if (!p) { toast('Produto não encontrado'); return; }

  fecharDetalhe();

  document.getElementById('saidaProdNome').textContent = p.nome;
  document.getElementById('saidaProdInfo').textContent = p.marca + ' • ' + p.setor + ' • Estoque: ' + p.quantidade + ' ' + p.unidade;
  document.getElementById('saidaProdLinha').value = linha;
  document.getElementById('saidaQtd').value = '';
  document.getElementById('saidaQtd').max = p.quantidade;
  document.getElementById('saidaQtd').placeholder = 'Máx: ' + p.quantidade;
  document.getElementById('saidaMotivo').value = '';

  document.getElementById('saidaModal').classList.add('show');
}

function fecharSaidaModal() {
  document.getElementById('saidaModal').classList.remove('show');
}

function confirmarSaida() {
  var btn = document.getElementById('btnConfirmarSaida');
  var qtd = parseFloat(document.getElementById('saidaQtd').value);
  var motivo = document.getElementById('saidaMotivo').value.trim();
  var linha = parseInt(document.getElementById('saidaProdLinha').value);

  if (!qtd || qtd <= 0) { toast('Informe a quantidade'); return; }

  btn.disabled = true;
  btn.textContent = 'Processando...';

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      acao: 'saida',
      linha: linha,
      quantidade: qtd,
      motivo: motivo,
      colaborador: sessao.nome,
      nome: sessao.nome
    }),
    redirect: 'follow'
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') {
        fecharSaidaModal();
        showSuccess('📤', d.mensagem, d.produto + ': ' + d.qtdAnterior + ' → ' + d.qtdNova);
        syncDados();
      } else {
        toast(d.msg || 'Erro na saída');
      }
    })
    .catch(function () { toast('Sem conexão'); })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = 'Confirmar Saída';
    });
}

// ══════════════════════════════════════════════════════════════
//  ENTRADA — FORMULÁRIO
// ══════════════════════════════════════════════════════════════
function enviarEntrada() {
  var produto = document.getElementById('entProduto').value.trim();
  var qtd = document.getElementById('entQtd').value;

  if (!produto) { toast('Informe o nome do produto'); return; }
  if (!qtd || parseFloat(qtd) <= 0) { toast('Informe a quantidade'); return; }

  var btn = document.getElementById('btnEntrada');
  btn.disabled = true;
  btn.textContent = 'Registrando...';

  var payload = {
    acao: 'entrada',
    colaborador: sessao.nome,
    nome: sessao.nome,
    setor: document.getElementById('entSetor').value,
    produto: produto,
    marca: document.getElementById('entMarca').value.trim(),
    quantidade: qtd,
    unidade: document.getElementById('entUnidade').value,
    validade: document.getElementById('entValidade').value,
    lote: document.getElementById('entLote').value.trim(),
    observacoes: document.getElementById('entObs').value.trim(),
    foto: fotoData
  };

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') {
        showSuccess('📦', d.mensagem, d.produto + ' — ' + d.quantidade + ' un — ' + d.statusValidade);
        limparFormEntrada();
        syncDados();
      } else {
        toast(d.msg || 'Erro ao registrar');
      }
    })
    .catch(function () { toast('Sem conexão'); })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = 'Registrar Entrada';
    });
}

function limparFormEntrada() {
  document.getElementById('entSetor').value = '';
  document.getElementById('entProduto').value = '';
  document.getElementById('entMarca').value = '';
  document.getElementById('entQtd').value = '';
  document.getElementById('entUnidade').value = 'UN';
  document.getElementById('entValidade').value = '';
  document.getElementById('entLote').value = '';
  document.getElementById('entObs').value = '';
  resetarFoto();
}

// ══════════════════════════════════════════════════════════════
//  CÂMERA (Foto do Produto)
// ══════════════════════════════════════════════════════════════
function initFotoCamera() {
  if (fotoStream) return;
  var video = document.getElementById('fotoVideo');
  if (!video) return;

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: 480, height: 480 }
  })
    .then(function (s) {
      fotoStream = s;
      video.srcObject = s;
    })
    .catch(function () { /* silencioso */ });
}

function capturarFoto() {
  var v = document.getElementById('fotoVideo');
  var c = document.getElementById('fotoCanvas');
  c.width = 480;
  c.height = 480;
  c.getContext('2d').drawImage(v, 0, 0, 480, 480);
  fotoData = c.toDataURL('image/jpeg', 0.5);
  v.style.display = 'none';
  c.style.display = 'block';
  document.getElementById('btnFotoCapture').style.display = 'none';
  document.getElementById('btnFotoReset').style.display = '';
  document.getElementById('fotoOk').style.display = 'block';
}

function resetarFoto() {
  var v = document.getElementById('fotoVideo');
  var c = document.getElementById('fotoCanvas');
  if (v) v.style.display = 'block';
  if (c) c.style.display = 'none';
  var btnCap = document.getElementById('btnFotoCapture');
  var btnRst = document.getElementById('btnFotoReset');
  var okEl = document.getElementById('fotoOk');
  if (btnCap) btnCap.style.display = '';
  if (btnRst) btnRst.style.display = 'none';
  if (okEl) okEl.style.display = 'none';
  fotoData = '';
}

function stopFotoCamera() {
  if (fotoStream) {
    fotoStream.getTracks().forEach(function (t) { t.stop(); });
    fotoStream = null;
  }
}

// ══════════════════════════════════════════════════════════════
//  RELATÓRIO PARA IMPRESSÃO
// ══════════════════════════════════════════════════════════════

function toggleRelatorio() {
  if (relatorioAtivo) {
    fecharRelatorio();
    return;
  }

  // Se dados já carregaram, gera direto
  if (dadosEstoque && dadosEstoque.produtos) {
    gerarRelatorio();
    return;
  }

  // Se não carregou, força sync e depois gera
  toast('Carregando dados...');
  var sw = document.getElementById('switchRelatorio');
  if (sw) sw.classList.add('loading');

  fetch(API_URL + '?sync=1')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      dadosEstoque = d;
      renderPainel(d);
      setBadge(true);
      localStorage.setItem('cv_estoque_cache', JSON.stringify(d));

      if (d && d.produtos && d.produtos.length > 0) {
        gerarRelatorio();
      } else {
        mostrarRelatorioVazio();
      }
    })
    .catch(function () {
      var cache = localStorage.getItem('cv_estoque_cache');
      if (cache) {
        dadosEstoque = JSON.parse(cache);
        if (dadosEstoque && dadosEstoque.produtos && dadosEstoque.produtos.length > 0) {
          gerarRelatorio();
        } else {
          mostrarRelatorioVazio();
        }
      } else {
        mostrarRelatorioVazio();
      }
    })
    .finally(function () {
      if (sw) sw.classList.remove('loading');
    });
}

function mostrarRelatorioVazio() {
  relatorioAtivo = true;
  var sw = document.getElementById('switchRelatorio');
  if (sw) sw.classList.add('on');

  var overlay = document.getElementById('relatorioOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'relatorioOverlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML =
    '<div class="rel-toolbar no-print">' +
    '<button class="rel-toolbar-btn close" onclick="fecharRelatorio()"><i class="fas fa-times"></i> Fechar</button>' +
    '</div>' +
    '<div class="rel-container">' +
    '<div class="rel-header">' +
    '<div class="rel-logo">ESTOQUE DIGITAL</div>' +
    '<div class="rel-empresa">Grupo Carlos Vaz — CRV/LAS</div>' +
    '</div>' +
    '<div class="rel-empty">' +
    '<div class="rel-empty-icon">📋</div>' +
    '<div class="rel-empty-title">Sem dados na planilha</div>' +
    '<div class="rel-empty-desc">Nenhum produto foi encontrado no estoque. Cadastre produtos na aba Entrada e tente novamente.</div>' +
    '</div>' +
    '</div>';

  overlay.classList.add('show');
}

function gerarRelatorio() {
  relatorioAtivo = true;
  var sw = document.getElementById('switchRelatorio');
  if (sw) sw.classList.add('on');

  var produtos = dadosEstoque.produtos;
  var hoje = new Date();
  var dataStr = String(hoje.getDate()).padStart(2, '0') + '/' +
    String(hoje.getMonth() + 1).padStart(2, '0') + '/' +
    hoje.getFullYear();
  var horaStr = String(hoje.getHours()).padStart(2, '0') + ':' +
    String(hoje.getMinutes()).padStart(2, '0');

  // ── Classify products ──
  var vencidos = [];
  var criticos = [];
  var atencao = [];
  var monitorar = [];
  var zerados = [];
  var todos = [];
  var porSetor = {};

  produtos.forEach(function (p) {
    todos.push(p);

    var setor = p.setor || 'SEM SETOR';
    if (!porSetor[setor]) porSetor[setor] = [];
    porSetor[setor].push(p);

    if (p.quantidade === 0) {
      zerados.push(p);
    }

    if (p.status === 'VENCIDO') {
      vencidos.push(p);
    } else if (p.status === 'CRÍTICO') {
      criticos.push(p);
    } else if (p.status === 'ATENÇÃO') {
      atencao.push(p);
    } else if (p.status === 'MONITORAR') {
      monitorar.push(p);
    }
  });

  function sortByDias(a, b) {
    var da = (a.diasVencer !== '' && a.diasVencer !== null && a.diasVencer !== undefined) ? a.diasVencer : 9999;
    var db = (b.diasVencer !== '' && b.diasVencer !== null && b.diasVencer !== undefined) ? b.diasVencer : 9999;
    return da - db;
  }

  vencidos.sort(sortByDias);
  criticos.sort(sortByDias);
  atencao.sort(sortByDias);
  monitorar.sort(sortByDias);

  // ── Build HTML ──
  var html = '';

  html += '<div class="rel-container">';
  html += '<div class="rel-header">';
  html += '<div class="rel-logo">ESTOQUE DIGITAL</div>';
  html += '<div class="rel-empresa">Grupo Carlos Vaz — CRV/LAS</div>';
  html += '<div class="rel-data">Relatório gerado em ' + dataStr + ' às ' + horaStr + ' por ' + (sessao ? sessao.nome : '—') + '</div>';
  html += '</div>';

  html += '<div class="rel-summary">';
  html += buildRelSummaryCard('Total de Produtos', todos.length, 'blue');
  html += buildRelSummaryCard('Estoque Zerado', zerados.length, 'red');
  html += buildRelSummaryCard('Vencidos', vencidos.length, 'red');
  html += buildRelSummaryCard('Críticos (≤7d)', criticos.length, 'orange');
  html += buildRelSummaryCard('Atenção (≤30d)', atencao.length, 'yellow');
  html += buildRelSummaryCard('Monitorar (≤60d)', monitorar.length, 'blue');
  html += '</div>';

  if (vencidos.length > 0) {
    html += buildRelSection('❌ Produtos Vencidos', vencidos, 'vencido');
  }

  if (criticos.length > 0) {
    html += buildRelSection('🔴 Produtos Críticos — Vencem em até 7 dias', criticos, 'critico');
  }

  if (atencao.length > 0) {
    html += buildRelSection('🟡 Produtos em Atenção — Vencem em até 30 dias', atencao, 'atencao');
  }

  if (monitorar.length > 0) {
    html += buildRelSection('🔵 Produtos para Monitorar — Vencem em até 60 dias', monitorar, 'monitorar');
  }

  if (zerados.length > 0) {
    html += '<div class="rel-section">';
    html += '<div class="rel-section-title zero">🚫 Estoque Zerado</div>';

    var zeradosPorSetor = {};
    zerados.forEach(function (p) {
      var s = p.setor || 'SEM SETOR';
      if (!zeradosPorSetor[s]) zeradosPorSetor[s] = [];
      zeradosPorSetor[s].push(p);
    });

    var setoresZ = Object.keys(zeradosPorSetor).sort();
    setoresZ.forEach(function (setor) {
      html += '<div class="rel-setor-group">';
      html += '<div class="rel-setor-name">' + escapeHtml(setor) + '</div>';
      html += buildRelTable(zeradosPorSetor[setor], false);
      html += '</div>';
    });

    html += '</div>';
  }

  html += '<div class="rel-section">';
  html += '<div class="rel-section-title all">📦 Inventário Completo por Setor</div>';

  var setoresOrdenados = Object.keys(porSetor).sort();
  setoresOrdenados.forEach(function (setor) {
    var prods = porSetor[setor];
    var subtotal = prods.length;

    html += '<div class="rel-setor-group">';
    html += '<div class="rel-setor-name">' + escapeHtml(setor) + ' <span class="rel-setor-count">(' + subtotal + ' produtos)</span></div>';
    html += buildRelTable(prods, true);
    html += '</div>';
  });

  html += '</div>';

  html += '<div class="rel-footer">';
  html += 'Estoque Digital — Grupo Carlos Vaz · Documento gerado automaticamente · ' + dataStr;
  html += '</div>';

  html += '</div>';

  // ── Insert into DOM ──
  var overlay = document.getElementById('relatorioOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'relatorioOverlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML =
    '<div class="rel-toolbar no-print">' +
    '<button class="rel-toolbar-btn" onclick="imprimirRelatorio()"><i class="fas fa-print"></i> Imprimir</button>' +
    '<button class="rel-toolbar-btn close" onclick="fecharRelatorio()"><i class="fas fa-times"></i> Fechar</button>' +
    '</div>' +
    html;

  overlay.classList.add('show');
  overlay.scrollTop = 0;
}

function buildRelSection(title, items, cls) {
  var html = '<div class="rel-section">';
  html += '<div class="rel-section-title ' + cls + '">' + title + '</div>';

  var grouped = {};
  items.forEach(function (p) {
    var s = p.setor || 'SEM SETOR';
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(p);
  });

  var setores = Object.keys(grouped).sort();
  setores.forEach(function (setor) {
    html += '<div class="rel-setor-group">';
    html += '<div class="rel-setor-name">' + escapeHtml(setor) + '</div>';
    html += buildRelTable(grouped[setor], true);
    html += '</div>';
  });

  html += '</div>';
  return html;
}

function buildRelTable(items, showDias) {
  var html = '<table class="rel-table">';
  html += '<thead><tr>';
  html += '<th>Produto</th>';
  html += '<th>Marca</th>';
  html += '<th>Qtd</th>';
  html += '<th>Un</th>';
  html += '<th>Validade</th>';
  if (showDias) html += '<th>Dias</th>';
  html += '<th>Status</th>';
  html += '<th>Lote</th>';
  html += '</tr></thead>';
  html += '<tbody>';

  items.forEach(function (p) {
    var statusCls = getStatusClass(p.status, p.quantidade);
    var diasTxt = '—';
    if (p.diasVencer !== '' && p.diasVencer !== null && p.diasVencer !== undefined) {
      diasTxt = p.diasVencer + 'd';
    }
    var qtdCls = p.quantidade === 0 ? 'zero' : '';
    var statusLabel = p.quantidade === 0 ? 'SEM ESTOQUE' : (p.status || 'OK');

    html += '<tr>';
    html += '<td class="rel-td-nome">' + escapeHtml(p.nome) + '</td>';
    html += '<td>' + escapeHtml(p.marca) + '</td>';
    html += '<td class="rel-td-num ' + qtdCls + '">' + p.quantidade + '</td>';
    html += '<td>' + escapeHtml(p.unidade) + '</td>';
    html += '<td>' + escapeHtml(p.validade || '—') + '</td>';
    if (showDias) html += '<td class="rel-td-num rel-dias-' + statusCls + '">' + diasTxt + '</td>';
    html += '<td><span class="rel-status-badge ' + statusCls + '">' + statusLabel + '</span></td>';
    html += '<td>' + escapeHtml(p.lote || '—') + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

function buildRelSummaryCard(label, value, color) {
  return '<div class="rel-stat-card ' + color + '">' +
    '<div class="rel-stat-val">' + value + '</div>' +
    '<div class="rel-stat-lbl">' + label + '</div>' +
    '</div>';
}

function imprimirRelatorio() {
  setTimeout(function () {
    window.print();
  }, 300);
}

function fecharRelatorio() {
  relatorioAtivo = false;
  var sw = document.getElementById('switchRelatorio');
  if (sw) sw.classList.remove('on');

  var overlay = document.getElementById('relatorioOverlay');
  if (overlay) overlay.classList.remove('show');
}

// ══════════════════════════════════════════════════════════════
//  SUCCESS OVERLAY
// ══════════════════════════════════════════════════════════════
function showSuccess(icon, msg, detail) {
  document.getElementById('successIcon').textContent = icon;
  document.getElementById('successMsg').textContent = msg;
  document.getElementById('successDetail').textContent = detail || '';
  var ov = document.getElementById('successOverlay');
  ov.classList.add('show');
  setTimeout(function () { ov.classList.remove('show'); }, 3000);
}

// ══════════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════════
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 3500);
}

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
