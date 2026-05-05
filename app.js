// ══════════════════════════════════════════════════════════════
//  ESTOQUE DIGITAL — app.js v15.0
//  Grupo Carlos Vaz — CRV/LAS
//  Mudanças v15.0:
//   1. Mini-modal qtd + unidade (Híbrido) com fator de conversão
//   2. Editar item do carrinho com 1 toque
//   3. Alerta de Auditoria Pendente (over-stock) + beep + banner
//   4. Histórico por Movimento (M1) com cards e impressão
//   5. Remover OBRAS do destino padrão
//   6. Ordenação: VENCIDO→CRÍTICO→ATENÇÃO→MONITORAR→OK→ZERADO
//   7. Pull-to-refresh Apple-style
//   8. Saída Rápida (M6) com cadastro rápido
//   9. Must-fixes: double-click guard, destino obrigatório, carrinho persistido
// ══════════════════════════════════════════════════════════════

var API_URL = 'https://script.google.com/macros/s/AKfycbyvw-6uBYct475K2nv5J-U2z39KHxbNOCqkVMaPl6MiFGnd3zTMiLPr5ivMfKNDZ55B/exec';
var SESSION_KEY = 'cv_estoque_sessao';
var CART_KEY = 'cv_estoque_carrinho';
var AUDIT_PENDING_KEY = 'cv_auditoria_pendente';

var CREDS_OFFLINE = {
  'LUIZ':   '4e94d7cf6a395fd8e12ad235143b25e60de3a9ac18a5cb6d090325138d22a7a1',
  'LUCAS':  '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157',
  'TASSIO': '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157',
  'AMARAL': '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157',
  'ALEX':   '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157',
  'GESTOR': '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157'
};

// 🔴 v15.0 — Unidades disponíveis no mini-modal
var UNIDADES_DISPONIVEIS = ['UN','KG','L','CX','PCT','FARDO','RL','FD','GL'];

// 🔴 v15.0 — Ordem de prioridade dos status (m4)
var STATUS_ORDEM = { 'VENCIDO':0, 'CRÍTICO':1, 'ATENÇÃO':2, 'MONITORAR':3, 'OK':4, 'ZERADO':5 };

// 🔴 v15.0 — Destinos padrão (sem OBRAS — m2)
var DESTINOS_PADRAO = [
  'IBÍCUI','NOVA CANAÃ','BOA NOVA','DARIO MEIRA','OUTRO…'
];

// 🔴 v15.1 — Setores de Requisição (padrão da prefeitura/órgão)
var SETORES_REQ_KEY = 'cv_estoque_setores_req';
var SETORES_REQ_PADRAO = [
  'EDUCAÇÃO','SAÚDE','ASSISTÊNCIA SOCIAL','ADMINISTRAÇÃO','INFRAESTRUTURA'
];


var sessao = null;
var dadosEstoque = null;
var fotoData = '';
var fotoStream = null;
var refreshInterval = null;
var relatorioAtivo = false;
var flashLigado = false;
var html5QrcodeScannerEntrada = null;
var html5QrcodeScannerSaida = null;
var carrinhoSaida = [];
var auditoriasPendentes = []; // 🔴 v15.0
var miniModalContext = null;  // 🔴 v15.0 — contexto do mini-modal aberto
var ptrState = { startY:0, currentY:0, pulling:false, ready:false }; // 🔴 v15.0
var audioCtx = null;          // 🔴 v15.0 — Web Audio API singleton

// ── Restaura sessão se já estava logado ──
(function () {
  var s = localStorage.getItem(SESSION_KEY);
  if (s) {
    try {
      sessao = JSON.parse(s);
      if (sessao && sessao.nome) {
        document.addEventListener('DOMContentLoaded', function () {
          esconderLogin();
          iniciarApp();
        });
        return;
      }
    } catch (e) { }
  }
})();

// ── Inicializa telemetria God Mode ──
document.addEventListener('DOMContentLoaded', function () {
  if (window.GodModeTracker) {
    GodModeTracker.init({ idCliente: 'crv', aplicativo: 'Estoque' });
  }
  // 🔴 v15.0 — Restaura carrinho e auditorias pendentes do localStorage
  restaurarCarrinho();
  restaurarAuditoriasPendentes();
});

function toggleSenha() {
  var input = document.getElementById('loginPass');
  var icon = document.getElementById('eyeIcon');
  if (input.type === 'password') { input.type = 'text'; icon.textContent = '🙈'; }
  else { input.type = 'password'; icon.textContent = '👁️'; }
}

async function fazerLogin() {
  var user = document.getElementById('loginUser').value.trim().toUpperCase();
  var pass = document.getElementById('loginPass').value.trim();
  var err = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');
  var lgpd = document.getElementById('lgpdCheck');
  err.textContent = '';
  if (!user || !pass) { err.textContent = 'Preencha todos os campos'; shakeLogin(); return; }
  if (lgpd && !lgpd.checked) { err.textContent = 'Aceite os termos da LGPD'; shakeLogin(); return; }
  btn.disabled = true; btn.textContent = 'Autenticando...';

  try {
    var senhaHash = await gerarHash(pass);
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ acao: 'login', usuario: user, senha: senhaHash }),
      redirect: 'follow'
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') {
        sessao = { nome: d.nome, nivel: d.nivel, senha: senhaHash };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
        esconderLogin();
        iniciarApp();
      } else {
        err.textContent = d.msg || 'Credenciais inválidas';
        shakeLogin();
        if (window.GodModeTracker) {
          GodModeTracker.loginFailure({ usuario: user, motivo: d.msg || 'Credenciais inválidas' });
        }
      }
    })
    .catch(function () {
      if (CREDS_OFFLINE[user] && CREDS_OFFLINE[user] === senhaHash) {
        sessao = { nome: user, nivel: user === 'GESTOR' ? 'gestor' : 'funcionario', senha: senhaHash };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
        esconderLogin();
        iniciarApp();
      } else {
        err.textContent = 'Sem conexão e credenciais inválidas';
        shakeLogin();
        if (window.GodModeTracker) {
          GodModeTracker.loginFailure({ usuario: user, motivo: 'Sem conexão e credenciais inválidas' });
        }
      }
    })
    .finally(function () { btn.disabled = false; btn.textContent = 'Entrar'; });
  } catch (e) {
    err.textContent = 'Erro no sistema'; shakeLogin();
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

async function gerarHash(texto) {
  const msgBuffer = new TextEncoder().encode(texto);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function shakeLogin() {
  var c = document.querySelector('.login-card');
  c.classList.add('shake');
  setTimeout(function () { c.classList.remove('shake'); }, 500);
}
function esconderLogin() { document.getElementById('loginScreen').classList.add('hidden'); }

function logout() {
  if (window.GodModeTracker) GodModeTracker.logout();
  sessao = null;
  dadosEstoque = null;
  carrinhoSaida = [];
  persistirCarrinho();
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem('cv_estoque_cache');
  if (refreshInterval) clearInterval(refreshInterval);
  stopFotoCamera();
  pararScannerEntrada();
  pararScannerSaida();
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

// ══════════════════════════════════════════════════════════════
// 🔴 v15.0 — PERSISTÊNCIA DO CARRINHO
// ══════════════════════════════════════════════════════════════
function persistirCarrinho(){
  try { localStorage.setItem(CART_KEY, JSON.stringify(carrinhoSaida)); }
  catch(e){}
}
function restaurarCarrinho(){
  try {
    var raw = localStorage.getItem(CART_KEY);
    if (raw) {
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) carrinhoSaida = arr;
    }
  } catch(e){ carrinhoSaida = []; }
}

// ══════════════════════════════════════════════════════════════
// 🔴 v15.0 — AUDITORIA PENDENTE (over-stock)
// ══════════════════════════════════════════════════════════════
function persistirAuditoriasPendentes(){
  try { localStorage.setItem(AUDIT_PENDING_KEY, JSON.stringify(auditoriasPendentes)); }
  catch(e){}
}
function restaurarAuditoriasPendentes(){
  try {
    var raw = localStorage.getItem(AUDIT_PENDING_KEY);
    if (raw) {
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) auditoriasPendentes = arr;
    }
  } catch(e){ auditoriasPendentes = []; }
}
function adicionarAuditoriaPendente(linha, nome, qtdSolicitada, qtdEstoque){
  var existe = auditoriasPendentes.find(function(a){ return a.linha === linha; });
  if(existe){
    existe.qtdSolicitada = qtdSolicitada;
    existe.qtdEstoque = qtdEstoque;
    existe.timestamp = Date.now();
  } else {
    auditoriasPendentes.push({
      linha: linha, nome: nome,
      qtdSolicitada: qtdSolicitada, qtdEstoque: qtdEstoque,
      timestamp: Date.now()
    });
  }
  persistirAuditoriasPendentes();
  renderBannerAuditoria();
  tocarBeep();
}
function removerAuditoriaPendente(linha){
  auditoriasPendentes = auditoriasPendentes.filter(function(a){ return a.linha !== linha; });
  persistirAuditoriasPendentes();
  renderBannerAuditoria();
}
function renderBannerAuditoria(){
  var banner = document.getElementById('auditoriaBanner');
  if(!banner){
    banner = document.createElement('div');
    banner.id = 'auditoriaBanner';
    banner.className = 'auditoria-banner';
    banner.onclick = abrirListaAuditoriasPendentes;
    document.body.appendChild(banner);
  }
  if(auditoriasPendentes.length === 0){
    banner.style.display = 'none';
    document.body.classList.remove('com-banner-auditoria');
    return;
  }
  banner.style.display = 'flex';
  banner.innerHTML = '<span class="ab-icon">⚠️</span><span class="ab-text">AUDITORIA PENDENTE — <b>' + auditoriasPendentes.length + '</b> ' + (auditoriasPendentes.length===1?'item':'itens') + ' com divergência</span><span class="ab-cta">Resolver →</span>';
  document.body.classList.add('com-banner-auditoria');
}
function abrirListaAuditoriasPendentes(){
  if(auditoriasPendentes.length === 0) return;
  var isGestor = sessao && sessao.nivel === 'gestor';
  if(!isGestor){
    toast('Apenas o Gestor pode resolver divergências.');
    return;
  }
  var h = '<div class="ios-card" style="padding:16px;"><div class="section-label" style="margin:0 0 12px 0;">Itens com Divergência</div>';
  auditoriasPendentes.forEach(function(a){
    var dataStr = new Date(a.timestamp).toLocaleString('pt-BR');
    h += '<div class="aud-pend-item" onclick="resolverAuditoriaPendente('+a.linha+')">'
      + '<div class="apnd-info"><strong>'+escapeHtml(a.nome)+'</strong>'
      + '<small>Saída: '+a.qtdSolicitada+' • Estoque era: '+a.qtdEstoque+' • '+dataStr+'</small></div>'
      + '<span class="apnd-cta">Auditar →</span></div>';
  });
  h += '</div>';
  document.getElementById('detalheBody').innerHTML = h;
  var modal = document.getElementById('detalheModal');
  modal.querySelector('.modal-bar h2').textContent = '⚠️ Auditorias Pendentes';
  modal.classList.add('show');
}
function resolverAuditoriaPendente(linha){
  fecharDetalhe();
  // Restaura título original
  document.getElementById('detalheModal').querySelector('.modal-bar h2').textContent = '📋 Detalhes';
  abrirAuditoriaModal(linha);
}

// 🔴 v15.0 — Beep Web Audio
function tocarBeep(){
  try {
    if(!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 800;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    setTimeout(function(){ try{ osc.stop(); }catch(e){} }, 200);
  } catch(e){}
}

// 🔴 v15.0 — Inteligência de agrupamento (mantida)
function limparDuplicatasZeradas(d) {
  if (!d || !d.produtos) return d;
  var temSaldo = function (nome, marca) {
    return d.produtos.some(function (p) {
      return p.quantidade > 0 && p.nome === nome && p.marca === marca;
    });
  };
  var produtosFinais = [];
  var zerosVistos = {};
  d.produtos.forEach(function (p) {
    if (p.quantidade > 0) {
      produtosFinais.push(p);
    } else {
      if (!temSaldo(p.nome, p.marca)) {
        var chave = p.nome + "_" + p.marca;
        if (!zerosVistos[chave]) {
          zerosVistos[chave] = true;
          produtosFinais.push(p);
        }
      }
    }
  });
  d.produtos = produtosFinais;

  if (d.alertas) {
    var alertasFinais = [];
    var alertasZerosVistos = {};
    d.alertas.forEach(function (a) {
      if (a.quantidade > 0) {
        alertasFinais.push(a);
      } else {
        if (!temSaldo(a.produto, a.marca)) {
          var chave = a.produto + "_" + a.marca;
          if (!alertasZerosVistos[chave]) {
            alertasZerosVistos[chave] = true;
            alertasFinais.push(a);
          }
        }
      }
    });
    d.alertas = alertasFinais;
  }
  return d;
}

function iniciarApp() {
  if (window.GodModeTracker && sessao && sessao.nome) {
    GodModeTracker.loginSuccess({ usuario: sessao.nome, dispositivo: navigator.userAgent });
  }
  document.getElementById('ldScreen').classList.remove('hidden');
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('userBadge').textContent = sessao.nome;
  if (sessao.nivel === 'gestor') document.getElementById('badgeGestor').style.display = '';
  var cache = localStorage.getItem('cv_estoque_cache');
  if (cache) { dadosEstoque = limparDuplicatasZeradas(JSON.parse(cache)); renderPainel(dadosEstoque); }
  document.getElementById('ldScreen').classList.add('hidden');
  syncDados();
  refreshInterval = setInterval(syncDados, 300000);
  // 🔴 v15.0
  renderBannerAuditoria();
  inicializarPullToRefresh();
  popularDestinosSelect();
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
  var btn = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if(btn) btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
  var ct = document.getElementById('content' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if(ct) ct.classList.add('active');
  if (tab === 'entrada') { if (document.getElementById('areaCameraEntrada').style.display === 'block') initFotoCamera(); }
  else { stopFotoCamera(); }
  if (tab !== 'entrada') pararScannerEntrada();
  if (tab !== 'saida') pararScannerSaida();
  if (tab === 'saida' && dadosEstoque) { renderSaidaList(dadosEstoque.produtos); renderCarrinho(); }
  if (tab === 'auditoria' && dadosEstoque) { renderAuditoriaList(dadosEstoque.produtos); }
  if (tab === 'rapida' && dadosEstoque) { renderSaidaRapidaList(dadosEstoque.produtos); }
  if (tab === 'historico' && dadosEstoque) { renderHistoricoCards(); }
}

function syncDados() {
  fetch(API_URL + '?sync=1')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      d = limparDuplicatasZeradas(d);
      dadosEstoque = d; setBadge(true);
      localStorage.setItem('cv_estoque_cache', JSON.stringify(d));
      // 🔴 v15.0 — Atualiza max do carrinho com base no estoque atual
      sincronizarCarrinhoComEstoque();
      renderPainel(d);
      if (document.getElementById('tabSaida') && document.getElementById('tabSaida').classList.contains('active')) {
        renderSaidaList(d.produtos); renderCarrinho();
      }
      if (document.getElementById('tabAuditoria') && document.getElementById('tabAuditoria').classList.contains('active')) {
        renderAuditoriaList(d.produtos);
      }
      if (document.getElementById('tabRapida') && document.getElementById('tabRapida').classList.contains('active')) {
        renderSaidaRapidaList(d.produtos);
      }
      if (document.getElementById('tabHistorico') && document.getElementById('tabHistorico').classList.contains('active')) {
        renderHistoricoCards();
      }
    })
    .catch(function (err) {
      setBadge(false);
      if (window.GodModeTracker) {
        GodModeTracker.log({ tipo: 'ALERTA', mensagem: 'Falha ao sincronizar estoque: ' + (err && err.message ? err.message : 'rede') });
      }
    });
}

function sincronizarCarrinhoComEstoque(){
  if(!dadosEstoque || !dadosEstoque.produtos) return;
  carrinhoSaida.forEach(function(item){
    var p = dadosEstoque.produtos.find(function(x){ return x.linha === item.linha; });
    if(p){ item.max = p.quantidade; item.unidadeBase = p.unidade; }
  });
  persistirCarrinho();
}

function setBadge(on) {
  var b = document.getElementById('badgeStatus');
  b.textContent = on ? 'Online' : 'Offline';
  b.className = 'badge ' + (on ? 'badge-online' : 'badge-offline');
}

function renderPainel(d) {
  if (!d) return;
  var alertas = d.alertas || [];
  var produtos = d.produtos || [];
  var okCount = 0; var zeroCount = 0;
  var produtosUnicos = new Set();

  produtos.forEach(function (p) {
    produtosUnicos.add(p.nome + '_' + p.marca);
    if (p.quantidade <= 0) zeroCount++;
    else if (p.status === 'OK' || p.status === 'MONITORAR') okCount++;
  });

  document.getElementById('statTotal').textContent = produtosUnicos.size;
  document.getElementById('statOk').textContent = okCount;
  document.getElementById('statAlertas').textContent = alertas.length;
  document.getElementById('statZero').textContent = zeroCount;

  var alertSection = document.getElementById('alertasSection');
  var alertList = document.getElementById('alertasList');
  if (alertas.length > 0) {
    alertSection.style.display = 'block'; var ah = '';
    alertas.forEach(function (a) {
      var cls = 'critical'; var icon = '⚠️'; var badgeCls = 'vencido';
      if (a.tipo === 'ESTOQUE ZERO') { cls = 'estoque-zero'; icon = '🚫'; badgeCls = 'zero'; }
      else if (a.status === 'CRÍTICO') { cls = 'critical'; icon = '🔴'; badgeCls = 'critico'; }
      else if (a.status === 'ATENÇÃO') { cls = 'warning'; icon = '🟡'; badgeCls = 'atencao'; }
      else if (a.status === 'VENCIDO') { cls = 'critical'; icon = '❌'; badgeCls = 'vencido'; }
      ah += '<div class="alerta-card ' + cls + '"><div class="alerta-icon">' + icon + '</div><div class="alerta-info"><div class="alerta-nome">' + a.produto + '</div><div class="alerta-detail">' + a.marca + ' • ' + a.setor + ' • Qtd: ' + a.quantidade + '</div></div><span class="alerta-badge ' + badgeCls + '">' + a.tipo + '</span></div>';
    });
    alertList.innerHTML = ah;
  } else { alertSection.style.display = 'none'; }
  renderProdutos(produtos);
  document.getElementById('syncTime').textContent = d.timestamp ? 'Atualizado: ' + d.timestamp : '';
}

// 🔴 v15.0 — Helper de prioridade de status (m4)
function statusPrioridade(status, qtd){
  if(qtd <= 0) return STATUS_ORDEM['ZERADO'];
  return STATUS_ORDEM[status] !== undefined ? STATUS_ORDEM[status] : STATUS_ORDEM['OK'];
}

function renderProdutos(produtos) {
  var el = document.getElementById('produtosList');
  if (!produtos || produtos.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">Nenhum produto cadastrado</div></div>';
    return;
  }

  // Agrupa por nome+marca
  var grupos = {};
  produtos.forEach(function (p) {
    var chave = (p.nome + '_' + p.marca).toUpperCase();
    if (!grupos[chave]) {
      grupos[chave] = {
        nome: p.nome, marca: p.marca, setor: p.setor, unidade: p.unidade,
        quantidadeTotal: 0, melhorStatus: 'OK',
        lotes: [], linhas: []
      };
    }
    var g = grupos[chave];
    g.quantidadeTotal += parseFloat(p.quantidade) || 0;
    g.lotes.push(p);
    g.linhas.push(p.linha);
    var statusAtual = p.quantidade <= 0 ? 'OK' : (p.status || 'OK');
    if (statusPrioridade(statusAtual, p.quantidade) < statusPrioridade(g.melhorStatus, g.quantidadeTotal||1)) {
      g.melhorStatus = statusAtual;
    }
  });

  // 🔴 v15.0 — Ordenação m4: status prioritário, depois alfabético
  var arr = Object.keys(grupos).map(function(k){ return grupos[k]; });
  arr.sort(function(a, b){
    var pa = statusPrioridade(a.melhorStatus, a.quantidadeTotal);
    var pb = statusPrioridade(b.melhorStatus, b.quantidadeTotal);
    if(pa !== pb) return pa - pb;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  var html = '';
  arr.forEach(function (g) {
    var statusFinal = g.quantidadeTotal <= 0 ? 'SEM ESTOQUE' : g.melhorStatus;
    var statusCls = g.quantidadeTotal <= 0 ? 'zero' : getStatusClass(g.melhorStatus, g.quantidadeTotal);
    var icon = g.quantidadeTotal <= 0 ? '🚫' : getStatusIcon(g.melhorStatus, g.quantidadeTotal);
    var qtdCls = g.quantidadeTotal <= 0 ? 'zero' : g.quantidadeTotal <= 5 ? 'low' : 'ok';

    var loteInfo = '';
    if (g.lotes.length > 1) {
      loteInfo = ' <span style="color:var(--text-tertiary); font-size:0.7rem;">(' + g.lotes.length + ' lotes)</span>';
    }

    var linhaPrincipal = g.linhas[0];
    var maiorQtd = 0;
    g.lotes.forEach(function (l) {
      if (l.quantidade > maiorQtd) { maiorQtd = l.quantidade; linhaPrincipal = l.linha; }
    });

    html += '<div class="produto-card" onclick="abrirDetalhe(' + linhaPrincipal + ')">' +
      '<div class="prod-icon ' + statusCls + '">' + icon + '</div>' +
      '<div class="prod-info">' +
      '<div class="prod-nome">' + escapeHtml(g.nome) + loteInfo + '</div>' +
      '<div class="prod-meta">' + escapeHtml(g.marca) + ' • ' + escapeHtml(g.setor) + '</div>' +
      '</div>' +
      '<div class="prod-right">' +
      '<div class="prod-qtd ' + qtdCls + '">' + g.quantidadeTotal + ' ' + escapeHtml(g.unidade) + '</div>' +
      '<span class="prod-status ' + statusCls + '">' + statusFinal + '</span>' +
      '</div>' +
      '</div>';
  });

  el.innerHTML = html;
}

function getStatusClass(status, qtd) {
  if (qtd <= 0) return 'zero';
  switch (status) {
    case 'VENCIDO': return 'vencido';
    case 'CRÍTICO': return 'critico';
    case 'ATENÇÃO': return 'atencao';
    case 'MONITORAR': return 'monitorar';
    default: return 'ok';
  }
}
function getStatusIcon(status, qtd) {
  if (qtd <= 0) return '🚫';
  switch (status) {
    case 'VENCIDO': return '❌';
    case 'CRÍTICO': return '🔴';
    case 'ATENÇÃO': return '🟡';
    case 'MONITORAR': return '🔵';
    default: return '✅';
  }
}

function filtrarProdutos() {
  if (!dadosEstoque) return;
  var termo = document.getElementById('searchInput').value.toLowerCase().trim();
  if (!termo) { renderProdutos(dadosEstoque.produtos); return; }
  var filtrados = dadosEstoque.produtos.filter(function (p) {
    return p.nome.toLowerCase().indexOf(termo) > -1 ||
      p.marca.toLowerCase().indexOf(termo) > -1 ||
      p.setor.toLowerCase().indexOf(termo) > -1 ||
      (p.lote && p.lote.toLowerCase().indexOf(termo) > -1) ||
      (p.codigoBarras && p.codigoBarras.indexOf(termo) > -1);
  });
  renderProdutos(filtrados);
}

function toggleFlash() {
  var leitor = null;
  if (html5QrcodeScannerEntrada && html5QrcodeScannerEntrada.getState() === 2) leitor = html5QrcodeScannerEntrada;
  else if (html5QrcodeScannerSaida && html5QrcodeScannerSaida.getState() === 2) leitor = html5QrcodeScannerSaida;
  if (!leitor) { toast("Abra a câmera primeiro para ligar o flash."); return; }
  flashLigado = !flashLigado;
  leitor.applyVideoConstraints({ advanced: [{ torch: flashLigado }] }).then(function () {
    toast(flashLigado ? "🔦 Flash Ligado" : "🔦 Flash Desligado");
  }).catch(function () { toast("⚠️ Seu aparelho bloqueou o uso do flash pelo navegador."); flashLigado = false; });
}

function iniciarScannerEntrada() {
  document.getElementById('scannerEntradaArea').style.display = 'block';
  html5QrcodeScannerEntrada = new Html5Qrcode("readerEntrada");
  html5QrcodeScannerEntrada.start({ facingMode: "environment" }, { fps: 15, qrbox: { width: 280, height: 120 }, aspectRatio: 1.0, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
    function (decodedText) { pararScannerEntrada(); document.getElementById('entCodigoBarras').value = decodedText; buscarProdutoPorCodigo(decodedText); if (navigator.vibrate) navigator.vibrate(100); },
    function (err) { }
  ).catch(function (err) { toast("Erro na câmara."); pararScannerEntrada(); });
}
function pararScannerEntrada() {
  flashLigado = false;
  if (html5QrcodeScannerEntrada) {
    html5QrcodeScannerEntrada.stop().then(function () { html5QrcodeScannerEntrada.clear(); html5QrcodeScannerEntrada = null; }).catch(function () { });
  }
  document.getElementById('scannerEntradaArea').style.display = 'none';
}
function buscarProdutoPorCodigo(codigo) {
  if (!dadosEstoque || !codigo) return;
  var p = dadosEstoque.produtos.find(function (x) { return x.codigoBarras === codigo; });
  if (p) {
    document.getElementById('entSetor').value = p.setor;
    document.getElementById('entProduto').value = p.nome;
    document.getElementById('entUnidade').value = p.unidade;
    document.getElementById('entMarca').value = p.marca;
    toast("📦 Produto reconhecido!");
  }
}

function iniciarScannerSaida() {
  document.getElementById('scannerSaidaArea').style.display = 'block';
  html5QrcodeScannerSaida = new Html5Qrcode("readerSaida");
  html5QrcodeScannerSaida.start({ facingMode: "environment" }, { fps: 15, qrbox: { width: 280, height: 120 }, aspectRatio: 1.0, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
    function (decodedText) {
      pararScannerSaida();
      var p = dadosEstoque.produtos.find(function (x) { return x.codigoBarras === decodedText; });
      if (p) { adicionarAoCarrinho(p.linha); } else { toast("Código não encontrado no estoque."); }
      if (navigator.vibrate) navigator.vibrate(100);
    },
    function (err) { }
  ).catch(function (err) { toast("Erro na câmara."); pararScannerSaida(); });
}
function pararScannerSaida() {
  flashLigado = false;
  if (html5QrcodeScannerSaida) {
    html5QrcodeScannerSaida.stop().then(function () { html5QrcodeScannerSaida.clear(); html5QrcodeScannerSaida = null; }).catch(function () { });
  }
  document.getElementById('scannerSaidaArea').style.display = 'none';
}

function abrirDetalhe(linha) {
  if (!dadosEstoque) return;
  var p = dadosEstoque.produtos.find(function (x) { return x.linha === linha; });
  if (!p) { toast('Produto não encontrado'); return; }
  var statusCls = getStatusClass(p.status, p.quantidade);
  var icon = getStatusIcon(p.status, p.quantidade);
  var isGestor = sessao && sessao.nivel === 'gestor';
  var h = '<div class="detalhe-header"><span class="d-icon">' + icon + '</span><div class="d-nome">' + p.nome + '</div><div class="d-marca">' + p.marca + (p.lote ? ' • Lote: ' + p.lote : '') + '</div></div><div class="detalhe-grid"><div class="detalhe-item"><div class="d-val" style="color:var(--blue);">' + p.quantidade + ' ' + p.unidade + '</div><div class="d-lbl">Estoque</div></div><div class="detalhe-item"><div class="d-val"><span class="prod-status ' + statusCls + '" style="font-size:.7rem;">' + p.status + '</span></div><div class="d-lbl">Status</div></div><div class="detalhe-item"><div class="d-val" style="font-size:.9rem;">' + p.setor + '</div><div class="d-lbl">Setor</div></div><div class="detalhe-item"><div class="d-val" style="font-size:.9rem;">' + (p.validade || '—') + '</div><div class="d-lbl">Validade</div></div>';
  var diasTxt = '—'; var diasColor = 'var(--green)';
  if (p.diasVencer !== '' && p.diasVencer !== null && p.diasVencer !== undefined) {
    diasTxt = p.diasVencer + ' dias';
    if (p.diasVencer < 0) diasColor = 'var(--red)';
    else if (p.diasVencer <= 7) diasColor = 'var(--orange)';
    else if (p.diasVencer <= 30) diasColor = 'var(--yellow)';
  }
  h += '<div class="detalhe-item"><div class="d-val" style="color:' + diasColor + ';">' + diasTxt + '</div><div class="d-lbl">Dias p/ Vencer</div></div><div class="detalhe-item"><div class="d-val" style="font-size:.9rem;">' + (p.data || '—') + '</div><div class="d-lbl">Data Cadastro</div></div></div>';
  h += '<div class="detalhe-actions">';
  if (p.quantidade > 0) { h += '<button class="btn-saida-det" onclick="adicionarAoCarrinhoDetalhe(' + p.linha + ')">🛒 Adicionar ao Carrinho</button>'; }
  if (isGestor) { h += '<button class="btn-edit" onclick="abrirEditar(' + p.linha + ')">✏️ Editar</button><button class="btn-delete" onclick="confirmarExcluir(' + p.linha + ')">🗑️ Excluir</button>'; }
  h += '</div>';
  document.getElementById('detalheBody').innerHTML = h;
  document.getElementById('detalheModal').querySelector('.modal-bar h2').textContent = '📋 Detalhes';
  document.getElementById('detalheModal').classList.add('show');
}
function fecharDetalhe() { document.getElementById('detalheModal').classList.remove('show'); }
function adicionarAoCarrinhoDetalhe(linha) { fecharDetalhe(); adicionarAoCarrinho(linha); switchTab('saida'); }

function abrirEditar(linha) {
  if (!dadosEstoque) return;
  var p = dadosEstoque.produtos.find(function (x) { return x.linha === linha; });
  if (!p) return; fecharDetalhe();
  var h = '<div class="form-card"><input type="hidden" id="editLinha" value="' + linha + '"><div class="form-group"><label class="form-label">Produto</label><input type="text" id="editProduto" class="form-field" value="' + escapeHtml(p.nome) + '"></div><div class="form-group"><label class="form-label">Marca</label><input type="text" id="editMarca" class="form-field" value="' + escapeHtml(p.marca) + '"></div><div class="form-group"><label class="form-label">Código de Barras</label><input type="text" id="editCodigoBarras" class="form-field" value="' + escapeHtml(p.codigoBarras || '') + '"></div><div class="form-group"><label class="form-label">Setor</label><select id="editSetor" class="form-field">';
  var setores = ['MERCEARIA', 'AÇOUGUE', 'LATICÍNIOS', 'CONGELADOS', 'HORTIFRUTI', 'BEBIDAS', 'LIMPEZA', 'HIGIENE', 'UTILIDADES', 'OUTROS'];
  setores.forEach(function (s) { h += '<option value="' + s + '"' + (s === p.setor ? ' selected' : '') + '>' + s + '</option>'; });
  h += '</select></div><div class="form-row"><div class="form-group"><label class="form-label">Quantidade</label><input type="number" id="editQtd" class="form-field" value="' + p.quantidade + '" min="0" step="0.01"></div><div class="form-group"><label class="form-label">Unidade</label><select id="editUnidade" class="form-field">';
  UNIDADES_DISPONIVEIS.forEach(function (u) { h += '<option value="' + u + '"' + (u === p.unidade ? ' selected' : '') + '>' + u + '</option>'; });
  h += '</select></div></div><div class="form-row"><div class="form-group"><label class="form-label">Validade</label><input type="date" id="editValidade" class="form-field" value="' + (p.validade || '') + '"></div><div class="form-group"><label class="form-label">Lote</label><input type="text" id="editLote" class="form-field" value="' + escapeHtml(p.lote) + '"></div></div><div class="form-group"><label class="form-label">Observações</label><input type="text" id="editObs" class="form-field" value="' + escapeHtml(p.observacoes || '') + '"></div><button class="submit-btn" id="btnSalvarEdit" onclick="salvarEdicao()" style="background:var(--blue);">Salvar Alterações</button></div>';
  document.getElementById('editBody').innerHTML = h;
  document.getElementById('editModal').classList.add('show');
}
function fecharEditar() { document.getElementById('editModal').classList.remove('show'); }

function salvarEdicao() {
  var btn = document.getElementById('btnSalvarEdit');
  btn.disabled = true; btn.textContent = 'Salvando...';
  var payload = {
    acao: 'editar', senha: sessao.senha,
    linha: parseInt(document.getElementById('editLinha').value),
    produto: document.getElementById('editProduto').value.trim(),
    marca: document.getElementById('editMarca').value.trim(),
    setor: document.getElementById('editSetor').value,
    quantidade: document.getElementById('editQtd').value,
    unidade: document.getElementById('editUnidade').value,
    validade: document.getElementById('editValidade').value,
    lote: document.getElementById('editLote').value.trim(),
    observacoes: document.getElementById('editObs').value.trim(),
    codigoBarras: document.getElementById('editCodigoBarras').value.trim()
  };
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') { fecharEditar(); showSuccess('✅', d.mensagem, ''); syncDados(); }
      else { toast(d.msg || 'Erro'); }
    })
    .catch(function (err) {
      toast('Sem conexão');
      if (window.GodModeTracker) {
        GodModeTracker.log({ tipo: 'ERRO', mensagem: 'Falha ao editar produto: ' + (err && err.message ? err.message : 'rede') });
      }
    })
    .finally(function () { btn.disabled = false; btn.textContent = 'Salvar Alterações'; });
}

function confirmarExcluir(linha) {
  if (!confirm('Tem certeza que deseja excluir?')) return;
  fecharDetalhe();
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'excluir', senha: sessao.senha, linha: linha }), redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') { showSuccess('🗑️', d.mensagem, ''); syncDados(); }
      else { toast('Erro ao excluir'); }
    })
    .catch(function () { toast('Sem conexão'); });
}

// ══════════════════════════════════════════════════════════════
// SAÍDA — LISTA E CARRINHO
// ══════════════════════════════════════════════════════════════
function renderSaidaList(produtos) {
  var el = document.getElementById('saidaList');
  if (!produtos || produtos.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📤</div><div class="empty-text">Nenhum produto disponível</div></div>';
    return;
  }

  var grupos = {};
  produtos.forEach(function (p) {
    if (p.quantidade <= 0) return;
    var chave = (p.nome + '_' + p.marca).toUpperCase();
    if (!grupos[chave]) {
      grupos[chave] = { nome: p.nome, marca: p.marca, setor: p.setor, unidade: p.unidade, quantidadeTotal: 0, linhaMaior: p.linha, maiorQtd: 0, melhorStatus: 'OK' };
    }
    var g = grupos[chave];
    g.quantidadeTotal += parseFloat(p.quantidade) || 0;
    if (p.quantidade > g.maiorQtd) { g.maiorQtd = p.quantidade; g.linhaMaior = p.linha; }
    var st = p.status || 'OK';
    if (statusPrioridade(st, p.quantidade) < statusPrioridade(g.melhorStatus, g.quantidadeTotal)) {
      g.melhorStatus = st;
    }
  });

  var arr = Object.keys(grupos).map(function(k){ return grupos[k]; });
  if (arr.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🚫</div><div class="empty-text">Estoque zerado</div></div>';
    return;
  }
  // m4
  arr.sort(function(a, b){
    var pa = statusPrioridade(a.melhorStatus, a.quantidadeTotal);
    var pb = statusPrioridade(b.melhorStatus, b.quantidadeTotal);
    if(pa !== pb) return pa - pb;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  var html = '';
  arr.forEach(function (g) {
    html += '<div class="saida-card" onclick="adicionarAoCarrinho(' + g.linhaMaior + ')"><div class="saida-icon">📦</div><div class="saida-info"><div class="saida-nome">' + escapeHtml(g.nome) + '</div><div class="saida-meta">' + escapeHtml(g.marca) + ' • ' + escapeHtml(g.setor) + '</div></div><div class="saida-qtd">' + g.quantidadeTotal + ' ' + escapeHtml(g.unidade) + '</div><button class="saida-btn">+ Add</button></div>';
  });
  el.innerHTML = html;
}

function filtrarSaida() {
  if (!dadosEstoque) return;
  var termo = document.getElementById('saidaSearch').value.toLowerCase().trim();
  if (!termo) { renderSaidaList(dadosEstoque.produtos); return; }
  var filtrados = dadosEstoque.produtos.filter(function (p) {
    return (p.nome.toLowerCase().indexOf(termo) > -1 ||
      p.marca.toLowerCase().indexOf(termo) > -1 ||
      p.setor.toLowerCase().indexOf(termo) > -1 ||
      (p.codigoBarras && p.codigoBarras.indexOf(termo) > -1)) && p.quantidade > 0;
  });
  renderSaidaList(filtrados);
}

// 🔴 v15.0 — Adicionar ao carrinho agora abre o mini-modal
function adicionarAoCarrinho(linha) {
  if (!dadosEstoque) return;
  var p = dadosEstoque.produtos.find(function (x) { return x.linha === linha; });
  if (!p) return;
  var existente = carrinhoSaida.find(function (x) { return x.linha === linha; });
  abrirMiniModal({
    linha: p.linha,
    nome: p.nome,
    unidadeBase: p.unidade,
    estoqueAtual: p.quantidade,
    fatoresConversao: p.fatoresConversao || {},
    quantidadePre: existente ? existente.quantidade : 1,
    unidadePre: existente ? existente.unidadeDigitada : p.unidade,
    fatorPre: existente ? existente.fator : 1,
    edicao: !!existente
  });
}

// ══════════════════════════════════════════════════════════════
// 🔴 v15.0 — MINI-MODAL (Quantidade + Unidade + Fator)
// ══════════════════════════════════════════════════════════════
function abrirMiniModal(ctx){
  miniModalContext = ctx;
  var modal = document.getElementById('miniModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'miniModal';
    modal.className = 'mini-modal';
    document.body.appendChild(modal);
  }
  var fatoresKnown = ctx.fatoresConversao || {};
  var unidadesHtml = UNIDADES_DISPONIVEIS.map(function(u){
    var ativa = (u === ctx.unidadePre) ? ' active' : '';
    var base = (u === ctx.unidadeBase) ? ' is-base' : '';
    return '<button type="button" class="mm-un-btn'+ativa+base+'" data-un="'+u+'" onclick="miniModalSelectUn(\''+u+'\')">'+u+'</button>';
  }).join('');

  var precisaFator = (ctx.unidadePre !== ctx.unidadeBase);
  var fatorAtual = ctx.fatorPre || (fatoresKnown[ctx.unidadePre] || 1);

  modal.innerHTML =
    '<div class="mm-backdrop" onclick="fecharMiniModal()"></div>' +
    '<div class="mm-card">' +
      '<div class="mm-header">'+
        '<div class="mm-title">'+escapeHtml(ctx.nome)+'</div>'+
        '<div class="mm-sub">Estoque: <b>'+ctx.estoqueAtual+' '+escapeHtml(ctx.unidadeBase)+'</b></div>'+
      '</div>' +
      '<div class="mm-body">'+
        '<label class="mm-label">Quantidade</label>'+
        '<input type="number" inputmode="decimal" id="mmQtd" class="mm-input-qtd" value="'+ctx.quantidadePre+'" min="0.01" step="0.01" autofocus>'+
        '<label class="mm-label">Unidade</label>'+
        '<div class="mm-units">'+unidadesHtml+'</div>'+
        '<div id="mmFatorBox" class="mm-fator-box" style="display:'+(precisaFator?'block':'none')+';">'+
          '<label class="mm-label">1 <span id="mmFatorUn">'+escapeHtml(ctx.unidadePre)+'</span> = quantas <b>'+escapeHtml(ctx.unidadeBase)+'</b>?</label>'+
          '<input type="number" inputmode="decimal" id="mmFator" class="mm-input-fator" value="'+fatorAtual+'" min="0.01" step="0.01">'+
          '<small class="mm-hint">Esse fator será salvo no produto pra próxima vez.</small>'+
        '</div>'+
      '</div>' +
      '<div class="mm-actions">'+
        '<button class="mm-btn mm-cancel" onclick="fecharMiniModal()">Cancelar</button>'+
        (ctx.edicao ? '<button class="mm-btn mm-remove" onclick="miniModalRemover()">Remover</button>' : '')+
        '<button class="mm-btn mm-confirm" onclick="miniModalConfirmar()">Confirmar</button>'+
      '</div>' +
    '</div>';
  modal.classList.add('show');
  setTimeout(function(){
    var inp = document.getElementById('mmQtd');
    if(inp){ inp.focus(); inp.select(); }
  }, 100);
}
function fecharMiniModal(){
  var modal = document.getElementById('miniModal');
  if(modal) modal.classList.remove('show');
  miniModalContext = null;
}
function miniModalSelectUn(un){
  if(!miniModalContext) return;
  miniModalContext.unidadePre = un;
  document.querySelectorAll('.mm-un-btn').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-un') === un);
  });
  var fatorBox = document.getElementById('mmFatorBox');
  var fatorUnLabel = document.getElementById('mmFatorUn');
  var fatorInput = document.getElementById('mmFator');
  if(un === miniModalContext.unidadeBase){
    fatorBox.style.display = 'none';
  } else {
    fatorBox.style.display = 'block';
    if(fatorUnLabel) fatorUnLabel.textContent = un;
    var conhecido = (miniModalContext.fatoresConversao||{})[un];
    if(fatorInput){
      fatorInput.value = conhecido ? conhecido : (miniModalContext.fatorPre && miniModalContext.unidadePre === un ? miniModalContext.fatorPre : 1);
    }
  }
}
function miniModalRemover(){
  if(!miniModalContext) return;
  var linha = miniModalContext.linha;
  carrinhoSaida = carrinhoSaida.filter(function(x){ return x.linha !== linha; });
  persistirCarrinho();
  fecharMiniModal();
  renderCarrinho();
  toast('Item removido do carrinho.');
}
function miniModalConfirmar(){
  if(!miniModalContext) return;
  var ctx = miniModalContext;
  var qtdEl = document.getElementById('mmQtd');
  var qtdDigitada = parseFloat(qtdEl.value);
  if(!qtdDigitada || qtdDigitada <= 0){ toast('Informe uma quantidade válida.'); return; }
  var unidade = ctx.unidadePre;
  var fator = 1;
  if(unidade !== ctx.unidadeBase){
    var fEl = document.getElementById('mmFator');
    fator = parseFloat(fEl.value);
    if(!fator || fator <= 0){ toast('Informe o fator de conversão.'); return; }
  }
  var qtdBase = qtdDigitada * fator;
  var overStock = qtdBase > ctx.estoqueAtual;

  // Salva fator no servidor (e local) se diferente da base
  if(unidade !== ctx.unidadeBase && fator !== 1){
    var conhecido = (ctx.fatoresConversao||{})[unidade];
    if(conhecido !== fator){
      salvarFatorNoServidor(ctx.linha, unidade, fator);
      // Atualiza cache local
      if(dadosEstoque && dadosEstoque.produtos){
        var prod = dadosEstoque.produtos.find(function(x){ return x.linha === ctx.linha; });
        if(prod){
          prod.fatoresConversao = prod.fatoresConversao || {};
          prod.fatoresConversao[unidade] = fator;
          localStorage.setItem('cv_estoque_cache', JSON.stringify(dadosEstoque));
        }
      }
    }
  }

  var existente = carrinhoSaida.find(function(x){ return x.linha === ctx.linha; });
  if(existente){
    existente.quantidade = qtdDigitada;
    existente.unidadeDigitada = unidade;
    existente.fator = fator;
    existente.quantidadeBase = qtdBase;
    existente.overStock = overStock;
  } else {
    carrinhoSaida.push({
      linha: ctx.linha,
      nome: ctx.nome,
      quantidade: qtdDigitada,
      unidadeDigitada: unidade,
      fator: fator,
      quantidadeBase: qtdBase,
      max: ctx.estoqueAtual,
      unidade: ctx.unidadeBase,
      unidadeBase: ctx.unidadeBase,
      overStock: overStock
    });
  }
  persistirCarrinho();

  if(overStock){
    adicionarAuditoriaPendente(ctx.linha, ctx.nome, qtdBase, ctx.estoqueAtual);
    toast('⚠️ Saída maior que estoque — auditoria pendente!');
  } else {
    toast(ctx.nome + ' adicionado!');
  }

  fecharMiniModal();
  renderCarrinho();
}

function salvarFatorNoServidor(linha, unidade, fator){
  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ acao:'salvarFatorConversao', linha:linha, unidade:unidade, fator:fator }),
    redirect: 'follow'
  }).catch(function(){});
}

function renderCarrinho() {
  var area = document.getElementById('carrinhoArea');
  var list = document.getElementById('cartList');
  var count = document.getElementById('cartCount');
  if (!area) return;
  if (carrinhoSaida.length === 0) { area.style.display = 'none'; return; }
  area.style.display = 'block';
  count.textContent = carrinhoSaida.length;
  var h = '';
  carrinhoSaida.forEach(function (item) {
    var unTxt = item.unidadeDigitada || item.unidade || '';
    var overCls = item.overStock ? ' over-stock' : '';
    var overTag = item.overStock ? '<span class="cart-over-tag">⚠️ Over</span>' : '';
    h += '<div class="cart-item'+overCls+'" onclick="abrirMiniModalEdicao('+item.linha+')">' +
         '<div class="cart-info"><strong>' + escapeHtml(item.nome) + '</strong>' +
         '<small>'+item.quantidade+' '+escapeHtml(unTxt)+
           (item.unidadeDigitada && item.unidadeDigitada !== item.unidadeBase ? ' (= '+item.quantidadeBase+' '+escapeHtml(item.unidadeBase)+')' : '')+
           ' • Estoque: ' + item.max + ' ' + escapeHtml(item.unidadeBase || item.unidade) + '</small></div>' +
         '<div class="cart-tap-hint">'+overTag+'<span class="cart-edit-icon">✏️</span></div>' +
         '</div>';
  });
  list.innerHTML = h;
}

function abrirMiniModalEdicao(linha){
  if(!dadosEstoque) return;
  var p = dadosEstoque.produtos.find(function(x){ return x.linha === linha; });
  if(!p){ toast('Produto não encontrado'); return; }
  var item = carrinhoSaida.find(function(x){ return x.linha === linha; });
  if(!item) return;
  abrirMiniModal({
    linha: p.linha,
    nome: p.nome,
    unidadeBase: p.unidade,
    estoqueAtual: p.quantidade,
    fatoresConversao: p.fatoresConversao || {},
    quantidadePre: item.quantidade,
    unidadePre: item.unidadeDigitada || p.unidade,
    fatorPre: item.fator || 1,
    edicao: true
  });
}

// ══════════════════════════════════════════════════════════════
// CONFIRMAR SAÍDA EM LOTE
// ══════════════════════════════════════════════════════════════
function confirmarSaidaLote() {
  if (carrinhoSaida.length === 0) return;
  var btn = document.getElementById('btnConfirmarLote');

  // Double-click guard
  if(btn && btn.disabled) return;

  var motivoInput = document.getElementById('loteMotivoSelect') || document.getElementById('loteMotivo');
  var setorSelect = document.getElementById('loteSetorSelect');
  var destinoSelect = document.getElementById('loteDestinoSelect');
  var destinoInput = document.getElementById('loteMotivoObs');
  var motivoValue = motivoInput ? motivoInput.value : 'SAÍDA';

  // Resolve destino
  var destinoFinal = '';
  if(destinoSelect){
    var sel = destinoSelect.value;
    if(sel === 'OUTRO…' || sel === 'OUTRO...' || sel === '__custom__'){
      destinoFinal = destinoInput && destinoInput.value.trim() ? destinoInput.value.trim() : '';
    } else if(sel){
      destinoFinal = sel;
    } else if(destinoInput && destinoInput.value.trim()){
      destinoFinal = destinoInput.value.trim();
    }
  } else if(destinoInput){
    destinoFinal = destinoInput.value.trim();
  }

  // 🔴 v15.1 — Resolve setor solicitante
  var setorFinal = '';
  if(setorSelect){
    if(setorSelect.value === '__novo__'){
      toast('⚠️ Confirme o novo setor antes de prosseguir.');
      return;
    }
    setorFinal = setorSelect.value || '';
  }

  // 🔴 v15.1 — Validações para SAÍDA DE PEDIDO
  if(motivoValue === 'SAÍDA DE PEDIDO'){
    if(!setorFinal){
      toast('⚠️ Selecione o setor solicitante!');
      if(setorSelect){ setorSelect.focus(); }
      return;
    }
    if(!destinoFinal){
      toast('⚠️ Informe o destino do pedido!');
      if(destinoInput){ destinoInput.focus(); }
      return;
    }
  }
  if(!destinoFinal) destinoFinal = 'Não informado';

  // 🔴 v15.1 — Motivo final concatenado: SAÍDA DE PEDIDO - [SETOR] - [DESTINO]
  var motivoFinal = motivoValue;
  if(setorFinal) motivoFinal += ' - ' + setorFinal;
  if (destinoFinal !== 'Não informado') { motivoFinal += ' - ' + destinoFinal; }

  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

  var itensParaRomaneio = JSON.parse(JSON.stringify(carrinhoSaida));
  var itensPayload = carrinhoSaida.map(function (i) {
    return {
      linha: i.linha,
      quantidade: i.quantidade,
      unidadeDigitada: i.unidadeDigitada || i.unidadeBase,
      fator: i.fator || 1,
      motivo: motivoFinal
    };
  });

  carrinhoSaida.forEach(function (item) {
    var p = dadosEstoque.produtos.find(function (x) { return x.linha === item.linha; });
    if (p) p.quantidade -= (item.quantidadeBase || (item.quantidade * (item.fator||1)));
  });

  carrinhoSaida = [];
  persistirCarrinho();
  if (motivoInput) motivoInput.value = 'SAÍDA DE PEDIDO';
  if (setorSelect) setorSelect.value = '';
  if (destinoSelect) destinoSelect.value = '';
  if (destinoInput) destinoInput.value = '';
  toggleDestinoOutro();
  toggleNovoSetorBox();
  renderCarrinho(); renderSaidaList(dadosEstoque.produtos); renderPainel(dadosEstoque);

  if (motivoValue === 'SAÍDA DE PEDIDO') {
    showSuccess('🖨️', 'Pedido Separado!', 'Gerando comprovante de entrega...');
    gerarComprovantePedido(itensParaRomaneio, destinoFinal, setorFinal);
  } else {
    showSuccess('📤', 'Baixa Concluída!', 'Estoque atualizado.');
  }

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ acao: 'saidaLote', colaborador: sessao.nome, nome: sessao.nome, itens: itensPayload }),
    redirect: 'follow'
  })
    .then(function (r) { return r.json(); })
    .then(function (d) { syncDados(); })
    .catch(function (err) {
      toast('Sincronizando em 2º plano...');
      if (window.GodModeTracker) {
        GodModeTracker.log({ tipo: 'ERRO', mensagem: 'Falha ao confirmar saída em lote: ' + (err && err.message ? err.message : 'rede') });
      }
    })
    .finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar Baixa Total'; }
    });
}


// 🔴 v15.0 — Popular select de destinos sem OBRAS
// 🔴 v15.1 — Popula destinos E setores de requisição
function popularDestinosSelect(){
  var sel = document.getElementById('loteDestinoSelect');
  if(sel && sel.options.length <= 1){
    sel.innerHTML = '<option value="">Selecione o destino…</option>';
    DESTINOS_PADRAO.forEach(function(d){
      var opt = document.createElement('option');
      opt.value = d; opt.textContent = d;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', toggleDestinoOutro);
  }

  // 🔴 v15.1 — Setores
  popularSetoresReqSelect();

  var motivoSel = document.getElementById('loteMotivoSelect');
  if(motivoSel){
    motivoSel.addEventListener('change', toggleDestinoVisibilidade);
    toggleDestinoVisibilidade();
  }
}

// 🔴 v15.1 — Setores de Requisição
function getSetoresReq(){
  try {
    var custom = JSON.parse(localStorage.getItem(SETORES_REQ_KEY) || '[]');
    if(!Array.isArray(custom)) custom = [];
    // mescla e tira duplicatas
    var todos = SETORES_REQ_PADRAO.concat(custom);
    var unicos = [];
    todos.forEach(function(s){
      var up = (s||'').toString().trim().toUpperCase();
      if(up && unicos.indexOf(up) === -1) unicos.push(up);
    });
    return unicos;
  } catch(e){ return SETORES_REQ_PADRAO.slice(); }
}
function salvarSetorCustom(nome){
  var up = (nome||'').toString().trim().toUpperCase();
  if(!up) return false;
  if(SETORES_REQ_PADRAO.indexOf(up) >= 0) return false; // já é padrão
  try {
    var custom = JSON.parse(localStorage.getItem(SETORES_REQ_KEY) || '[]');
    if(!Array.isArray(custom)) custom = [];
    if(custom.indexOf(up) === -1){
      custom.push(up);
      localStorage.setItem(SETORES_REQ_KEY, JSON.stringify(custom));
    }
    return true;
  } catch(e){ return false; }
}
function popularSetoresReqSelect(){
  var sel = document.getElementById('loteSetorSelect');
  if(!sel) return;
  var atual = sel.value;
  sel.innerHTML = '<option value="">Selecione o setor…</option>';
  getSetoresReq().forEach(function(s){
    var opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  });
  var optAdd = document.createElement('option');
  optAdd.value = '__novo__';
  optAdd.textContent = '➕ Adicionar novo setor…';
  sel.appendChild(optAdd);
  if(atual && atual !== '__novo__') sel.value = atual;

  // bind change só uma vez
  if(!sel.dataset.bound){
    sel.addEventListener('change', toggleNovoSetorBox);
    sel.dataset.bound = '1';
  }
}
function toggleNovoSetorBox(){
  var sel = document.getElementById('loteSetorSelect');
  var inp = document.getElementById('loteSetorNovo');
  var btn = document.getElementById('btnConfirmarNovoSetor');
  if(!sel || !inp || !btn) return;
  if(sel.value === '__novo__'){
    inp.style.display = 'block';
    btn.style.display = 'block';
    inp.value = '';
    setTimeout(function(){ inp.focus(); }, 50);
  } else {
    inp.style.display = 'none';
    btn.style.display = 'none';
  }
}
function confirmarNovoSetor(){
  var inp = document.getElementById('loteSetorNovo');
  var sel = document.getElementById('loteSetorSelect');
  if(!inp || !sel) return;
  var nome = (inp.value||'').trim().toUpperCase();
  if(!nome){ toast('Digite o nome do setor.'); inp.focus(); return; }
  if(nome.length < 2){ toast('Nome muito curto.'); return; }
  salvarSetorCustom(nome);
  popularSetoresReqSelect();
  sel.value = nome;
  inp.style.display = 'none';
  document.getElementById('btnConfirmarNovoSetor').style.display = 'none';
  toast('✅ Setor "' + nome + '" adicionado.');
}


// ══════════════════════════════════════════════════════════════
// AUDITORIA
// ══════════════════════════════════════════════════════════════
function renderAuditoriaList(produtos) {
  var el = document.getElementById('auditoriaList');
  if (!produtos || produtos.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🕵️</div><div class="empty-text">Nenhum produto disponível</div></div>';
    return;
  }
  var grupos = {};
  produtos.forEach(function (p) {
    var chave = (p.nome + '_' + p.marca).toUpperCase();
    if (!grupos[chave]) {
      grupos[chave] = { nome: p.nome, marca: p.marca, setor: p.setor, linhas: [], status:p.status, quantidadeTotal:0 };
    }
    grupos[chave].linhas.push(p.linha);
    grupos[chave].quantidadeTotal += parseFloat(p.quantidade)||0;
    if(statusPrioridade(p.status, p.quantidade) < statusPrioridade(grupos[chave].status, grupos[chave].quantidadeTotal)){
      grupos[chave].status = p.status;
    }
  });
  var arr = Object.keys(grupos).map(function(k){ return grupos[k]; });
  arr.sort(function(a,b){
    var pa = statusPrioridade(a.status, a.quantidadeTotal);
    var pb = statusPrioridade(b.status, b.quantidadeTotal);
    if(pa !== pb) return pa - pb;
    return a.nome.localeCompare(b.nome,'pt-BR');
  });
  var html = '';
  arr.forEach(function (g) {
    var linhaPrincipal = g.linhas[0];
    var pendFlag = auditoriasPendentes.find(function(a){ return a.linha === linhaPrincipal; });
    var tag = pendFlag ? '<span class="aud-pendente-tag">⚠️ PENDENTE</span>' : '';
    html += '<div class="saida-card" onclick="abrirAuditoriaModal(' + linhaPrincipal + ')"><div class="saida-icon" style="background:var(--purple); color:#fff;">🕵️</div><div class="saida-info"><div class="saida-nome">' + escapeHtml(g.nome) + ' '+tag+'</div><div class="saida-meta">' + escapeHtml(g.marca) + ' • ' + escapeHtml(g.setor) + '</div></div><button class="saida-btn" style="background:var(--purple-soft); color:var(--purple);">Auditar</button></div>';
  });
  el.innerHTML = html;
}

function filtrarAuditoria() {
  if (!dadosEstoque) return;
  var termo = document.getElementById('auditoriaSearch').value.toLowerCase().trim();
  if (!termo) { renderAuditoriaList(dadosEstoque.produtos); return; }
  var filtrados = dadosEstoque.produtos.filter(function (p) {
    return p.nome.toLowerCase().indexOf(termo) > -1 ||
      p.marca.toLowerCase().indexOf(termo) > -1 ||
      p.setor.toLowerCase().indexOf(termo) > -1 ||
      (p.codigoBarras && p.codigoBarras.indexOf(termo) > -1);
  });
  renderAuditoriaList(filtrados);
}

function abrirAuditoriaModal(linha) {
  if (!dadosEstoque) return;
  var p = dadosEstoque.produtos.find(function (x) { return x.linha === linha; });
  if (!p) return;
  document.getElementById('auditoriaProdNome').textContent = p.nome;
  document.getElementById('auditoriaProdSetor').textContent = p.marca + ' • ' + p.setor + ' • Sistema: ' + p.quantidade + ' ' + p.unidade;
  document.getElementById('auditoriaProdLinha').value = linha;
  document.getElementById('auditoriaQtdFisica').value = '';
  document.getElementById('auditoriaModal').classList.add('show');
}
function fecharAuditoria() { document.getElementById('auditoriaModal').classList.remove('show'); }

function enviarAuditoria() {
  var btn = document.getElementById('btnSalvarAuditoria');
  var qtdStr = document.getElementById('auditoriaQtdFisica').value;
  if (qtdStr === '') { toast('Informe a quantidade'); return; }
  var qtd = parseFloat(qtdStr);
  var linha = parseInt(document.getElementById('auditoriaProdLinha').value);
  btn.disabled = true; btn.textContent = 'Verificando...';

  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'auditoria', linha: linha, qtdFisica: qtd, nome: sessao.nome }), redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') {
        fecharAuditoria();
        if (d.match) {
          // 🔴 v15.0 — Bateu: remove da lista de pendentes
          removerAuditoriaPendente(linha);
          showSuccess('✅', 'Tudo Certo!', d.msg);
        } else {
          if (window.GodModeTracker) {
            GodModeTracker.log({ tipo: 'ALERTA', mensagem: 'Divergência de auditoria — Linha ' + linha + ': físico=' + qtd + ', sistema=' + (qtd - d.diferenca) });
          }
          var resp = confirm('⚠️ Divergência Detectada!\n\nA prateleira tem ' + qtd + ' itens, mas o sistema esperava ' + (qtd - d.diferenca) + '.\n\nDeseja que o App AJUSTE O SALDO da planilha agora?');
          if (resp) {
            var prod = dadosEstoque.produtos.find(function (x) { return x.linha === linha; });
            if (prod) prod.quantidade = qtd;
            renderPainel(dadosEstoque);
            // 🔴 v15.0 — Ajuste resolve a auditoria pendente
            removerAuditoriaPendente(linha);
            showSuccess('🔄', 'Estoque Ajustado!', 'O saldo corrigido para ' + qtd + '.');
            fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'ajusteAuditoria', linha: linha, quantidade: qtd, nome: sessao.nome, motivo:'Auditoria' }), redirect: 'follow' }).then(syncDados);
          } else {
            // Aceita a divergência sem ajustar — também tira da fila (gestor já viu)
            removerAuditoriaPendente(linha);
            showSuccess('⚠️', 'Apenas Registrado', 'A diferença foi enviada ao Gestor.');
          }
        }
      } else { toast(d.msg || 'Erro'); }
    })
    .catch(function () { toast('Sem conexão'); })
    .finally(function () { btn.disabled = false; btn.textContent = 'Verificar Divergência'; });
}

// ══════════════════════════════════════════════════════════════
// ENTRADA
// ══════════════════════════════════════════════════════════════
function enviarEntrada() {
  var produto = document.getElementById('entProduto').value.trim();
  var qtd = document.getElementById('entQtd').value;
  if (!produto) { toast('Informe o nome do produto'); return; }
  if (!qtd || parseFloat(qtd) <= 0) { toast('Informe a quantidade'); return; }
  var btn = document.getElementById('btnEntrada');
  btn.disabled = true; btn.textContent = 'Registando...';

  var payload = {
    acao: 'entrada', colaborador: sessao.nome, nome: sessao.nome,
    setor: document.getElementById('entSetor').value, produto: produto,
    marca: document.getElementById('entMarca').value.trim(),
    quantidade: qtd, unidade: document.getElementById('entUnidade').value,
    validade: document.getElementById('entValidade').value,
    lote: document.getElementById('entLote').value.trim(),
    observacoes: document.getElementById('entObs').value.trim(),
    codigoBarras: document.getElementById('entCodigoBarras').value.trim(),
    foto: fotoData
  };

  if (!dadosEstoque.produtos) dadosEstoque.produtos = [];
  dadosEstoque.produtos.unshift({
    linha: Date.now(),
    nome: produto, marca: payload.marca, setor: payload.setor,
    quantidade: parseFloat(qtd), unidade: payload.unidade,
    status: 'OK', validade: payload.validade, lote: payload.lote, codigoBarras: payload.codigoBarras,
    fatoresConversao: {}
  });
  dadosEstoque = limparDuplicatasZeradas(dadosEstoque);
  renderPainel(dadosEstoque);

  showSuccess('📦', 'Produto Registrado!', produto + ' adicionado.');
  limparFormEntrada();
  switchTab('painel');

  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .then(function (d) { syncDados(); })
    .catch(function (err) {
      toast('Sincronizando no servidor...');
      if (window.GodModeTracker) {
        GodModeTracker.log({ tipo: 'ERRO', mensagem: 'Falha ao salvar entrada: ' + (err && err.message ? err.message : 'rede') });
      }
    })
    .finally(function () { btn.disabled = false; btn.textContent = 'Salvar Entrada'; });
}

function limparFormEntrada() {
  document.getElementById('entCodigoBarras').value = '';
  document.getElementById('entSetor').value = '';
  document.getElementById('entProduto').value = '';
  document.getElementById('entMarca').value = '';
  document.getElementById('entQtd').value = '';
  document.getElementById('entUnidade').value = 'UN';
  document.getElementById('entValidade').value = '';
  document.getElementById('entLote').value = '';
  document.getElementById('entObs').value = '';
  resetarFoto();
  document.getElementById('areaCameraEntrada').style.display = 'none';
  document.getElementById('btnRevelarCamera').style.display = 'flex';
}
function mostrarCameraEntrada() {
  document.getElementById('btnRevelarCamera').style.display = 'none';
  document.getElementById('areaCameraEntrada').style.display = 'block';
  initFotoCamera();
}
function initFotoCamera() {
  if (fotoStream) return;
  var video = document.getElementById('fotoVideo');
  if (!video) return;
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 480, height: 480 } })
    .then(function (s) { fotoStream = s; video.srcObject = s; })
    .catch(function () { });
}
function capturarFoto() {
  var v = document.getElementById('fotoVideo');
  var c = document.getElementById('fotoCanvas');
  c.width = 480; c.height = 480;
  c.getContext('2d').drawImage(v, 0, 0, 480, 480);
  fotoData = c.toDataURL('image/jpeg', 0.5);
  v.style.display = 'none'; c.style.display = 'block';
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
  if (fotoStream) { fotoStream.getTracks().forEach(function (t) { t.stop(); }); fotoStream = null; }
}

// ══════════════════════════════════════════════════════════════
// 🔴 v15.0 — SAÍDA RÁPIDA (M6)
// ══════════════════════════════════════════════════════════════
function renderSaidaRapidaList(produtos){
  var el = document.getElementById('rapidaList');
  if(!el) return;
  if(!produtos || produtos.length === 0){
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚡</div><div class="empty-text">Nenhum produto cadastrado</div></div>';
    return;
  }

  // Agrupa por nome+marca pra evitar duplicatas
  var grupos = {};
  produtos.forEach(function(p){
    var chave = (p.nome + '_' + p.marca).toUpperCase();
    if(!grupos[chave]){
      grupos[chave] = {
        nome: p.nome, marca: p.marca, setor: p.setor, unidade: p.unidade,
        quantidadeTotal: 0, melhorStatus: 'OK',
        linhaPrincipal: p.linha, maiorQtd: 0,
        fatoresConversao: p.fatoresConversao || {}
      };
    }
    var g = grupos[chave];
    g.quantidadeTotal += parseFloat(p.quantidade)||0;
    if(p.quantidade > g.maiorQtd){ g.maiorQtd = p.quantidade; g.linhaPrincipal = p.linha; }
    if(statusPrioridade(p.status, p.quantidade) < statusPrioridade(g.melhorStatus, g.quantidadeTotal)){
      g.melhorStatus = p.status;
    }
  });

  var arr = Object.keys(grupos).map(function(k){ return grupos[k]; });
  arr.sort(function(a,b){
    var pa = statusPrioridade(a.melhorStatus, a.quantidadeTotal);
    var pb = statusPrioridade(b.melhorStatus, b.quantidadeTotal);
    if(pa !== pb) return pa - pb;
    return a.nome.localeCompare(b.nome,'pt-BR');
  });

  var html = '';
  arr.forEach(function(g){
    var qtdCls = g.quantidadeTotal <= 0 ? 'zero' : (g.quantidadeTotal <= 5 ? 'low' : 'ok');
    html += '<div class="rapida-card" onclick="adicionarAoCarrinho('+g.linhaPrincipal+')">'+
      '<div class="saida-icon">⚡</div>'+
      '<div class="saida-info">'+
        '<div class="saida-nome">'+escapeHtml(g.nome)+'</div>'+
        '<div class="saida-meta">'+escapeHtml(g.marca||'—')+' • '+escapeHtml(g.setor)+'</div>'+
      '</div>'+
      '<div class="saida-qtd '+qtdCls+'">'+g.quantidadeTotal+' '+escapeHtml(g.unidade)+'</div>'+
      '<button class="saida-btn">+ Saída</button>'+
    '</div>';
  });
  el.innerHTML = html;
}

function filtrarSaidaRapida(){
  if(!dadosEstoque) return;
  var termoEl = document.getElementById('rapidaSearch');
  var termo = termoEl ? termoEl.value.toLowerCase().trim() : '';
  var btnCadastro = document.getElementById('btnCadastroRapidoBox');

  if(!termo){
    if(btnCadastro) btnCadastro.style.display = 'none';
    renderSaidaRapidaList(dadosEstoque.produtos);
    return;
  }
  var filtrados = dadosEstoque.produtos.filter(function(p){
    return p.nome.toLowerCase().indexOf(termo) > -1 ||
           (p.marca && p.marca.toLowerCase().indexOf(termo) > -1) ||
           p.setor.toLowerCase().indexOf(termo) > -1 ||
           (p.codigoBarras && p.codigoBarras.indexOf(termo) > -1);
  });

  // 🔴 Se nada encontrado, mostra botão "Cadastrar e dar saída"
  if(filtrados.length === 0){
    var el = document.getElementById('rapidaList');
    if(el){
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">Nada encontrado para "'+escapeHtml(termo)+'"</div></div>';
    }
    if(btnCadastro){
      btnCadastro.style.display = 'block';
      var btn = document.getElementById('btnCadastroRapidoAcao');
      if(btn){
        btn.onclick = function(){ abrirModalCadastroRapido(termo); };
        btn.textContent = '➕ Cadastrar "'+termo.toUpperCase()+'" e dar saída';
      }
    }
  } else {
    if(btnCadastro) btnCadastro.style.display = 'none';
    renderSaidaRapidaList(filtrados);
  }
}

function abrirModalCadastroRapido(nomeSugerido){
  var modal = document.getElementById('cadRapidoModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'cadRapidoModal';
    modal.className = 'mini-modal';
    document.body.appendChild(modal);
  }
  var setoresOpts = ['MERCEARIA','AÇOUGUE','LATICÍNIOS','CONGELADOS','HORTIFRUTI','BEBIDAS','LIMPEZA','HIGIENE','UTILIDADES','OUTROS']
    .map(function(s){ return '<option value="'+s+'">'+s+'</option>'; }).join('');
  var unidadesOpts = UNIDADES_DISPONIVEIS
    .map(function(u){ return '<option value="'+u+'"'+(u==='UN'?' selected':'')+'>'+u+'</option>'; }).join('');

  modal.innerHTML =
    '<div class="mm-backdrop" onclick="fecharCadRapido()"></div>'+
    '<div class="mm-card">'+
      '<div class="mm-header"><div class="mm-title">⚡ Cadastro Rápido</div>'+
      '<div class="mm-sub">Produto será criado com qtd 0 e ficará pendente de auditoria</div></div>'+
      '<div class="mm-body">'+
        '<label class="mm-label">Nome do Produto</label>'+
        '<input type="text" id="cadRapNome" class="mm-input-qtd" style="font-size:1rem; text-align:left;" value="'+escapeHtml((nomeSugerido||'').toUpperCase())+'">'+
        '<label class="mm-label">Setor</label>'+
        '<select id="cadRapSetor" class="form-field" style="margin-bottom:14px;"><option value="">Selecione…</option>'+setoresOpts+'</select>'+
        '<label class="mm-label">Unidade Base</label>'+
        '<select id="cadRapUnidade" class="form-field" style="margin-bottom:14px;">'+unidadesOpts+'</select>'+
        '<label class="mm-label">Quantidade da Saída</label>'+
        '<input type="number" inputmode="decimal" id="cadRapQtd" class="mm-input-qtd" value="1" min="0.01" step="0.01">'+
      '</div>'+
      '<div class="mm-actions">'+
        '<button class="mm-btn mm-cancel" onclick="fecharCadRapido()">Cancelar</button>'+
        '<button class="mm-btn mm-confirm" id="btnCadRapConfirmar" onclick="confirmarCadastroRapido()">Cadastrar e dar Saída</button>'+
      '</div>'+
    '</div>';
  modal.classList.add('show');
  setTimeout(function(){
    var el = document.getElementById('cadRapNome');
    if(el){ el.focus(); el.select(); }
  }, 100);
}
function fecharCadRapido(){
  var modal = document.getElementById('cadRapidoModal');
  if(modal) modal.classList.remove('show');
}
function confirmarCadastroRapido(){
  var nome = document.getElementById('cadRapNome').value.trim();
  var setor = document.getElementById('cadRapSetor').value;
  var unidade = document.getElementById('cadRapUnidade').value;
  var qtdStr = document.getElementById('cadRapQtd').value;
  var qtd = parseFloat(qtdStr);

  if(!nome){ toast('Informe o nome do produto'); return; }
  if(!setor){ toast('Selecione o setor'); return; }
  if(!unidade){ toast('Selecione a unidade'); return; }
  if(!qtd || qtd <= 0){ toast('Quantidade inválida'); return; }

  var btn = document.getElementById('btnCadRapConfirmar');
  if(btn){ btn.disabled = true; btn.textContent = 'Cadastrando…'; }

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      acao: 'cadastroRapido',
      colaborador: sessao.nome, nome: sessao.nome,
      produto: nome, setor: setor, unidade: unidade
    }),
    redirect: 'follow'
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if(d.status === 'ok' && d.produto){
      // Adiciona ao cache local
      if(!dadosEstoque.produtos) dadosEstoque.produtos = [];
      dadosEstoque.produtos.unshift(d.produto);
      localStorage.setItem('cv_estoque_cache', JSON.stringify(dadosEstoque));
      // Joga direto no carrinho (vai virar over-stock automaticamente)
      var item = {
        linha: d.produto.linha,
        nome: d.produto.nome,
        quantidade: qtd,
        unidadeDigitada: unidade,
        fator: 1,
        quantidadeBase: qtd,
        max: 0,
        unidade: unidade,
        unidadeBase: unidade,
        overStock: true
      };
      carrinhoSaida.push(item);
      persistirCarrinho();
      adicionarAuditoriaPendente(d.produto.linha, d.produto.nome, qtd, 0);
      fecharCadRapido();
      // Limpa busca da Saída Rápida
      var rs = document.getElementById('rapidaSearch');
      if(rs) rs.value = '';
      var btnBox = document.getElementById('btnCadastroRapidoBox');
      if(btnBox) btnBox.style.display = 'none';
      renderSaidaRapidaList(dadosEstoque.produtos);
      renderCarrinho();
      switchTab('saida');
      showSuccess('⚡', 'Produto Cadastrado!', nome + ' já está no carrinho.');
      syncDados();
    } else {
      toast(d.msg || 'Erro no cadastro');
    }
  })
  .catch(function(){ toast('Sem conexão. Tente novamente.'); })
  .finally(function(){
    if(btn){ btn.disabled = false; btn.textContent = 'Cadastrar e dar Saída'; }
  });
}

// ══════════════════════════════════════════════════════════════
// 🔴 v15.0 — HISTÓRICO POR MOVIMENTO (M1)
// ══════════════════════════════════════════════════════════════
var TIPOS_HISTORICO = [
  { id:'REQUISIÇÃO',     icon:'📦', label:'Requisição',       cor:'var(--blue)' },
  { id:'AVARIA',         icon:'⚠️', label:'Avaria / Vencido', cor:'var(--red)' },
  { id:'CONSUMO',        icon:'🏢', label:'Consumo Interno',  cor:'var(--green)' },
  { id:'AJUSTE AUDITORIA', icon:'🕵️', label:'Ajuste Auditoria', cor:'var(--purple)' },
  { id:'SAÍDA LOTE',     icon:'📤', label:'Saída em Lote',     cor:'var(--orange)' }
];

function renderHistoricoCards(){
  var el = document.getElementById('historicoContent');
  if(!el) return;
  var movs = (dadosEstoque && dadosEstoque.movimentacoes) ? dadosEstoque.movimentacoes : {};
  var html = '<div class="section-label">Histórico por Tipo de Movimento</div><div class="hist-cards-grid">';
  TIPOS_HISTORICO.forEach(function(t){
    var qtd = (movs[t.id] || []).length;
    html += '<div class="hist-card" onclick="abrirHistoricoTipo(\''+t.id+'\')">'+
      '<div class="hist-card-icon">'+t.icon+'</div>'+
      '<div class="hist-card-label">'+t.label+'</div>'+
      '<div class="hist-card-count" style="color:'+t.cor+'">'+qtd+'</div>'+
    '</div>';
  });
  html += '</div><p style="color:var(--text-tertiary); font-size:0.75rem; text-align:center; margin-top:16px;">Toque em um card para ver os movimentos</p>';
  el.innerHTML = html;
}

function abrirHistoricoTipo(tipoId){
  var movs = (dadosEstoque && dadosEstoque.movimentacoes) ? dadosEstoque.movimentacoes : {};
  var lista = movs[tipoId] || [];
  var tipoMeta = TIPOS_HISTORICO.find(function(t){ return t.id === tipoId; }) || { icon:'📋', label:tipoId };

  var el = document.getElementById('historicoContent');
  var html = '<button class="cam-btn" onclick="renderHistoricoCards()" style="margin-bottom:14px; background:rgba(118,118,128,.15);">← Voltar aos tipos</button>';
  html += '<div class="section-label">'+tipoMeta.icon+' '+tipoMeta.label+' ('+lista.length+')</div>';

  if(lista.length === 0){
    html += '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">Nenhum movimento registrado</div></div>';
    el.innerHTML = html;
    return;
  }

  lista.forEach(function(m, idx){
    var unidade = m.unidadeDigitada || '';
    var qtdMostrar = m.qtdDigitada || m.qtdSaida;
    var detBase = '';
    if(unidade && unidade !== '' && parseFloat(m.fator||1) !== 1){
      detBase = ' (= '+m.qtdSaida+' base)';
    }
    html += '<div class="hist-mov-card">'+
      '<div class="hmov-header">'+
        '<div class="hmov-prod">'+escapeHtml(m.produto)+'</div>'+
        '<button class="hmov-print-btn" onclick="imprimirMovimento(\''+tipoId+'\','+idx+')">🖨️</button>'+
      '</div>'+
      '<div class="hmov-meta">'+escapeHtml(m.marca||'—')+' • '+escapeHtml(m.setor||'—')+'</div>'+
      '<div class="hmov-row"><span>Qtd:</span><b>'+qtdMostrar+' '+escapeHtml(unidade||'')+detBase+'</b></div>'+
      '<div class="hmov-row"><span>Anterior → Novo:</span><b>'+m.qtdAnterior+' → '+m.qtdNova+'</b></div>'+
      '<div class="hmov-row"><span>Por:</span><b>'+escapeHtml(m.colaborador)+'</b></div>'+
      '<div class="hmov-row"><span>Data:</span><b>'+escapeHtml(m.dataHora)+'</b></div>'+
      (m.motivo ? '<div class="hmov-motivo">'+escapeHtml(m.motivo)+'</div>' : '')+
    '</div>';
  });
  el.innerHTML = html;
}

function imprimirMovimento(tipoId, idx){
  var movs = (dadosEstoque && dadosEstoque.movimentacoes) ? dadosEstoque.movimentacoes : {};
  var lista = movs[tipoId] || [];
  var m = lista[idx];
  if(!m){ toast('Movimento não encontrado'); return; }
  var tipoMeta = TIPOS_HISTORICO.find(function(t){ return t.id === tipoId; }) || { icon:'📋', label:tipoId };

  var w = window.open('', '_blank', 'width=800,height=600');
  if(!w){ toast('Pop-up bloqueado. Permita pop-ups para imprimir.'); return; }

  var unidade = m.unidadeDigitada || '';
  var qtdMostrar = m.qtdDigitada || m.qtdSaida;
  var detBase = '';
  if(unidade && unidade !== '' && parseFloat(m.fator||1) !== 1){
    detBase = ' (equivale a '+m.qtdSaida+' na unidade base)';
  }

  var doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Comprovante de Movimento</title>'+
    '<style>body{font-family:-apple-system,Arial,sans-serif; color:#000; background:#fff; padding:24px; max-width:700px; margin:0 auto;}'+
    'h1{font-size:18px; margin:0 0 6px 0; text-transform:uppercase;}'+
    'h2{font-size:14px; margin:0 0 24px 0; color:#666; font-weight:500;}'+
    '.box{border:1px solid #000; padding:16px; margin-bottom:16px;}'+
    '.row{display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #ddd;}'+
    '.row:last-child{border-bottom:none;}'+
    '.lbl{color:#666; font-size:13px;}'+
    '.val{font-weight:700; font-size:13px; text-align:right;}'+
    '.head{text-align:center; border-bottom:2px solid #000; padding-bottom:12px; margin-bottom:20px;}'+
    '.tag{display:inline-block; padding:4px 10px; border:1px solid #000; border-radius:4px; font-size:12px; font-weight:700; text-transform:uppercase;}'+
    '.foot{margin-top:30px; font-size:11px; color:#666; text-align:center;}'+
    '@media print{body{padding:0;}}'+
    '</style></head><body>'+
    '<div class="head"><h1>ESTOQUE DIGITAL — CRV/LAS</h1><h2>Comprovante de '+tipoMeta.label+'</h2><span class="tag">'+tipoMeta.icon+' '+tipoMeta.label+'</span></div>'+
    '<div class="box">'+
      '<div class="row"><span class="lbl">Produto</span><span class="val">'+escapeHtml(m.produto)+'</span></div>'+
      '<div class="row"><span class="lbl">Marca</span><span class="val">'+escapeHtml(m.marca||'—')+'</span></div>'+
      '<div class="row"><span class="lbl">Setor</span><span class="val">'+escapeHtml(m.setor||'—')+'</span></div>'+
      '<div class="row"><span class="lbl">Quantidade</span><span class="val">'+qtdMostrar+' '+escapeHtml(unidade)+detBase+'</span></div>'+
      '<div class="row"><span class="lbl">Estoque Anterior</span><span class="val">'+m.qtdAnterior+'</span></div>'+
      '<div class="row"><span class="lbl">Estoque Novo</span><span class="val">'+m.qtdNova+'</span></div>'+
      (m.motivo ? '<div class="row"><span class="lbl">Motivo / Destino</span><span class="val">'+escapeHtml(m.motivo)+'</span></div>' : '')+
      '<div class="row"><span class="lbl">Operador</span><span class="val">'+escapeHtml(m.colaborador)+'</span></div>'+
      '<div class="row"><span class="lbl">Data / Hora</span><span class="val">'+escapeHtml(m.dataHora)+'</span></div>'+
    '</div>'+
    '<div style="margin-top:50px; display:flex; justify-content:space-between;">'+
      '<div style="width:45%; text-align:center; border-top:1px solid #000; padding-top:6px; font-size:12px;">Assinatura do Operador</div>'+
      '<div style="width:45%; text-align:center; border-top:1px solid #000; padding-top:6px; font-size:12px;">Assinatura do Conferente</div>'+
    '</div>'+
    '<div class="foot">Estoque Digital — Grupo Carlos Vaz · Comprovante gerado em '+new Date().toLocaleString('pt-BR')+'</div>'+
    '</body></html>';

  w.document.open();
  w.document.write(doc);
  w.document.close();
  setTimeout(function(){ try{ w.focus(); w.print(); }catch(e){} }, 300);
}

// ══════════════════════════════════════════════════════════════
// 🔴 v15.0 — PULL-TO-REFRESH (Apple style)
// ══════════════════════════════════════════════════════════════
function inicializarPullToRefresh(){
  var indicator = document.getElementById('ptrIndicator');
  if(!indicator){
    indicator = document.createElement('div');
    indicator.id = 'ptrIndicator';
    indicator.className = 'ptr-indicator';
    indicator.innerHTML = '<div class="ptr-spinner"></div>';
    document.body.appendChild(indicator);
  }

  var threshold = 80;
  var maxPull = 140;

  document.addEventListener('touchstart', function(e){
    if(window.scrollY > 0) return;
    if(!estaNaTabPainel()) return;
    if(!sessao) return;
    ptrState.startY = e.touches[0].clientY;
    ptrState.pulling = true;
    ptrState.ready = false;
  }, { passive: true });

  document.addEventListener('touchmove', function(e){
    if(!ptrState.pulling) return;
    if(window.scrollY > 0){ ptrState.pulling = false; resetPtrIndicator(); return; }
    var diff = e.touches[0].clientY - ptrState.startY;
    if(diff <= 0) return;
    var pull = Math.min(diff, maxPull);
    ptrState.currentY = pull;
    indicator.style.transform = 'translateX(-50%) translateY('+pull+'px)';
    indicator.style.opacity = Math.min(pull / threshold, 1);
    if(pull >= threshold){
      ptrState.ready = true;
      indicator.classList.add('ptr-ready');
    } else {
      ptrState.ready = false;
      indicator.classList.remove('ptr-ready');
    }
  }, { passive: true });

  document.addEventListener('touchend', function(){
    if(!ptrState.pulling) return;
    if(ptrState.ready){
      indicator.classList.add('ptr-loading');
      indicator.style.transform = 'translateX(-50%) translateY(60px)';
      toast('🔄 Sincronizando…');
      syncDados();
      setTimeout(function(){
        resetPtrIndicator();
      }, 1200);
    } else {
      resetPtrIndicator();
    }
    ptrState.pulling = false;
    ptrState.ready = false;
    ptrState.currentY = 0;
  });
}
function resetPtrIndicator(){
  var ind = document.getElementById('ptrIndicator');
  if(!ind) return;
  ind.style.transform = 'translateX(-50%) translateY(-60px)';
  ind.style.opacity = '0';
  ind.classList.remove('ptr-ready','ptr-loading');
}
function estaNaTabPainel(){
  var t = document.getElementById('contentPainel');
  return t && t.classList.contains('active');
}

// ══════════════════════════════════════════════════════════════
// RELATÓRIO (mantido da v14.0)
// ══════════════════════════════════════════════════════════════
function toggleRelatorio() {
  if (relatorioAtivo) { fecharRelatorio(); return; }
  toast('Carregando dados...');
  if (dadosEstoque && dadosEstoque.produtos && dadosEstoque.produtos.length > 0) gerarRelatorio();
  else mostrarRelatorioVazio();
}
function mostrarRelatorioVazio() {
  relatorioAtivo = true;
  var sw = document.getElementById('switchRelatorio'); if (sw) sw.classList.add('on');
  var overlay = document.getElementById('relatorioOverlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'relatorioOverlay'; document.body.appendChild(overlay); }
  overlay.innerHTML = '<div class="rel-toolbar no-print"><button class="rel-toolbar-btn close" onclick="fecharRelatorio()">Fechar</button></div><div class="rel-container"><div class="rel-header"><div class="rel-logo">ESTOQUE DIGITAL</div><div class="rel-empresa">Grupo Carlos Vaz — CRV/LAS</div></div><div class="rel-empty"><div class="rel-empty-icon">📋</div><div class="rel-empty-title">Sem dados na planilha</div></div></div>';
  overlay.classList.add('show');
}
function gerarRelatorio() {
  relatorioAtivo = true;
  var sw = document.getElementById('switchRelatorio'); if (sw) sw.classList.add('on');
  var produtos = dadosEstoque.produtos;
  var hoje = new Date();
  var dataStr = String(hoje.getDate()).padStart(2, '0') + '/' + String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
  var horaStr = String(hoje.getHours()).padStart(2, '0') + ':' + String(hoje.getMinutes()).padStart(2, '0');
  var vencidos = []; var criticos = []; var atencao = []; var monitorar = []; var zerados = []; var todos = []; var porSetor = {};
  produtos.forEach(function (p) {
    todos.push(p);
    var setor = p.setor || 'SEM SETOR';
    if (!porSetor[setor]) porSetor[setor] = [];
    porSetor[setor].push(p);
    if (p.quantidade <= 0) zerados.push(p);
    if (p.status === 'VENCIDO') vencidos.push(p);
    else if (p.status === 'CRÍTICO') criticos.push(p);
    else if (p.status === 'ATENÇÃO') atencao.push(p);
    else if (p.status === 'MONITORAR') monitorar.push(p);
  });
  function sortByDias(a, b) {
    var da = (a.diasVencer !== '' && a.diasVencer !== null && a.diasVencer !== undefined) ? a.diasVencer : 9999;
    var db = (b.diasVencer !== '' && b.diasVencer !== null && b.diasVencer !== undefined) ? b.diasVencer : 9999;
    return da - db;
  }
  vencidos.sort(sortByDias); criticos.sort(sortByDias); atencao.sort(sortByDias); monitorar.sort(sortByDias);

  var html = '<div class="rel-container"><div class="rel-header"><div class="rel-logo">ESTOQUE DIGITAL</div><div class="rel-empresa">Grupo Carlos Vaz — CRV/LAS</div><div class="rel-data">Relatório gerado em ' + dataStr + ' às ' + horaStr + ' por ' + (sessao ? sessao.nome : '—') + '</div></div><div class="rel-summary">';
  html += buildRelSummaryCard('Total de Produtos', todos.length, 'blue') + buildRelSummaryCard('Estoque Zerado', zerados.length, 'red') + buildRelSummaryCard('Vencidos', vencidos.length, 'red') + buildRelSummaryCard('Críticos (≤7d)', criticos.length, 'orange') + buildRelSummaryCard('Atenção (≤30d)', atencao.length, 'yellow') + buildRelSummaryCard('Monitorar (≤60d)', monitorar.length, 'blue') + '</div>';
  if (vencidos.length > 0) html += buildRelSection('❌ Produtos Vencidos', vencidos, 'vencido');
  if (criticos.length > 0) html += buildRelSection('🔴 Produtos Críticos — Vencem em até 7 dias', criticos, 'critico');
  if (atencao.length > 0) html += buildRelSection('🟡 Produtos em Atenção — Vencem em até 30 dias', atencao, 'atencao');
  if (monitorar.length > 0) html += buildRelSection('🔵 Produtos para Monitorar — Vencem em até 60 dias', monitorar, 'monitorar');
  if (zerados.length > 0) {
    html += '<div class="rel-section"><div class="rel-section-title zero">🚫 Estoque Zerado</div>';
    var zeradosPorSetor = {};
    zerados.forEach(function (p) { var s = p.setor || 'SEM SETOR'; if (!zeradosPorSetor[s]) zeradosPorSetor[s] = []; zeradosPorSetor[s].push(p); });
    Object.keys(zeradosPorSetor).sort().forEach(function (setor) { html += '<div class="rel-setor-group"><div class="rel-setor-name">' + escapeHtml(setor) + '</div>' + buildRelTable(zeradosPorSetor[setor], false) + '</div>'; });
    html += '</div>';
  }
  html += '<div class="rel-section"><div class="rel-section-title all">📦 Inventário Completo por Setor</div>';
  Object.keys(porSetor).sort().forEach(function (setor) { html += '<div class="rel-setor-group"><div class="rel-setor-name">' + escapeHtml(setor) + ' <span class="rel-setor-count">(' + porSetor[setor].length + ' produtos)</span></div>' + buildRelTable(porSetor[setor], true) + '</div>'; });
  html += '</div><div class="rel-footer">Estoque Digital — Grupo Carlos Vaz · ' + dataStr + '</div></div>';

  var overlay = document.getElementById('relatorioOverlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'relatorioOverlay'; document.body.appendChild(overlay); }
  overlay.innerHTML = '<div class="rel-toolbar no-print"><button class="rel-toolbar-btn" onclick="imprimirRelatorio()">🖨️ Imprimir</button><button class="rel-toolbar-btn close" onclick="fecharRelatorio()">✕ Fechar</button></div>' + html;
  overlay.classList.add('show'); overlay.scrollTop = 0;
}
function buildRelSection(title, items, cls) {
  var html = '<div class="rel-section"><div class="rel-section-title ' + cls + '">' + title + '</div>';
  var grouped = {};
  items.forEach(function (p) { var s = p.setor || 'SEM SETOR'; if (!grouped[s]) grouped[s] = []; grouped[s].push(p); });
  Object.keys(grouped).sort().forEach(function (setor) { html += '<div class="rel-setor-group"><div class="rel-setor-name">' + escapeHtml(setor) + '</div>' + buildRelTable(grouped[setor], true) + '</div>'; });
  return html + '</div>';
}
function buildRelTable(items, showDias) {
  var html = '<table class="rel-table"><thead><tr><th>Produto</th><th>Marca</th><th>Qtd</th><th>Un</th><th>Validade</th>' + (showDias ? '<th>Dias</th>' : '') + '<th>Status</th><th>Lote</th></tr></thead><tbody>';
  items.forEach(function (p) {
    var statusCls = getStatusClass(p.status, p.quantidade);
    var diasTxt = '—';
    if (p.diasVencer !== '' && p.diasVencer !== null && p.diasVencer !== undefined) diasTxt = p.diasVencer + 'd';
    html += '<tr><td class="rel-td-nome">' + escapeHtml(p.nome) + '</td><td>' + escapeHtml(p.marca) + '</td><td class="rel-td-num ' + (p.quantidade <= 0 ? 'zero' : '') + '">' + p.quantidade + '</td><td>' + escapeHtml(p.unidade) + '</td><td>' + escapeHtml(p.validade || '—') + '</td>' + (showDias ? '<td class="rel-td-num rel-dias-' + statusCls + '">' + diasTxt + '</td>' : '') + '<td><span class="rel-status-badge ' + statusCls + '">' + (p.quantidade <= 0 ? 'SEM ESTOQUE' : (p.status || 'OK')) + '</span></td><td>' + escapeHtml(p.lote || '—') + '</td></tr>';
  });
  return html + '</tbody></table>';
}
function buildRelSummaryCard(label, value, color) {
  return '<div class="rel-stat-card ' + color + '"><div class="rel-stat-val">' + value + '</div><div class="rel-stat-lbl">' + label + '</div></div>';
}
function imprimirRelatorio() { window.print(); }
function fecharRelatorio() {
  relatorioAtivo = false;
  var sw = document.getElementById('switchRelatorio'); if (sw) sw.classList.remove('on');
  var overlay = document.getElementById('relatorioOverlay'); if (overlay) overlay.classList.remove('show');
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════
function showSuccess(icon, msg, detail) {
  document.getElementById('successIcon').textContent = icon;
  document.getElementById('successMsg').textContent = msg;
  document.getElementById('successDetail').textContent = detail || '';
  var ov = document.getElementById('successOverlay');
  ov.classList.add('show');
  setTimeout(function () { ov.classList.remove('show'); }, 3000);
}
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 3500);
}
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function gerarComprovantePedido(itens, destino, setor) {
  var hoje = new Date();
  var dataStr = String(hoje.getDate()).padStart(2, '0') + '/' + String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
  var horaStr = String(hoje.getHours()).padStart(2, '0') + ':' + String(hoje.getMinutes()).padStart(2, '0');

  var html = '<div class="rel-container" style="background: #fff; color: #000; font-family: \'Inter\', sans-serif; padding: 20px; max-width: 800px; margin: 0 auto;">';
  html += '<div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px;">';
  html += '<h1 style="margin: 0; font-size: 22px; font-weight: 800; text-transform: uppercase;">Comprovante de Entrega</h1>';
  html += '<p style="margin: 5px 0 0 0; font-size: 14px; font-weight: 600; color: #444;">Grupo Carlos Vaz — CRV/LAS</p></div>';
  html += '<div style="background: #f9f9f9; border: 1px solid #ddd; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; line-height: 1.6;">';
  html += '<strong>Data de Separação:</strong> ' + dataStr + ' às ' + horaStr + '<br>';
  html += '<strong>Separador Responsável:</strong> ' + (sessao ? sessao.nome : '—') + '<br>';
  if(setor){
    html += '<strong>Setor Solicitante:</strong> <span style="font-size: 16px; font-weight: 700; text-transform: uppercase; color:#0a84ff;">' + escapeHtml(setor) + '</span><br>';
  }
  html += '<strong>Destino / Obra:</strong> <span style="font-size: 16px; font-weight: 700; text-transform: uppercase;">' + escapeHtml(destino) + '</span><br></div>';
  html += '<table style="width: 100%; border-collapse: collapse; margin-bottom: 40px; font-size: 14px;">';
  html += '<thead><tr style="background: #eee; border-bottom: 2px solid #000;"><th style="padding: 12px 8px; text-align: left;">Qtd</th><th style="padding: 12px 8px; text-align: left;">Un</th><th style="padding: 12px 8px; text-align: left;">Produto</th><th style="padding: 12px 8px; text-align: center;">Conferido</th></tr></thead><tbody>';

  itens.forEach(function (item) {
    var unMostrar = item.unidadeDigitada || item.unidade || item.unidadeBase || '';
    var qtdMostrar = item.quantidade;
    html += '<tr style="border-bottom: 1px solid #ddd;">';
    html += '<td style="padding: 12px 8px; font-weight: 800; font-size: 16px;">' + qtdMostrar + '</td>';
    html += '<td style="padding: 12px 8px; color: #555;">' + escapeHtml(unMostrar) + '</td>';
    html += '<td style="padding: 12px 8px; font-weight: 500;">' + escapeHtml(item.nome) + '</td>';
    html += '<td style="padding: 12px 8px; text-align: center;"><div style="width: 20px; height: 20px; border: 1px solid #999; border-radius: 4px; margin: 0 auto;"></div></td></tr>';
  });

  html += '</tbody></table><div style="margin-top: 40px; font-size: 13px; color: #333;">';
  html += '<p style="text-align: center; margin-bottom: 50px; font-style: italic;">Declaro ter recebido os itens acima descritos em perfeitas condições.</p>';
  html += '<div style="display: flex; justify-content: space-between; margin-bottom: 50px;"><div style="width: 45%; text-align: center; border-top: 1px solid #000; padding-top: 5px;">Assinatura do Recebedor</div><div style="width: 45%; text-align: center; border-top: 1px solid #000; padding-top: 5px;">Documento (CPF / RG)</div></div>';
  html += '<div style="display: flex; justify-content: space-between;"><div style="width: 45%; text-align: center; border-top: 1px solid #000; padding-top: 5px;">Data de Recebimento</div><div style="width: 45%; text-align: center; border-top: 1px solid #000; padding-top: 5px;">Motorista/Entregador</div></div></div></div>';

  var overlay = document.getElementById('relatorioOverlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'relatorioOverlay'; document.body.appendChild(overlay); }
  overlay.innerHTML = '<div class="rel-toolbar no-print"><button class="rel-toolbar-btn" onclick="imprimirRelatorio()">🖨️ Imprimir</button><button class="rel-toolbar-btn close" onclick="fecharRelatorio()">✕ Fechar</button></div>' + html;
  overlay.classList.add('show'); overlay.scrollTop = 0;
  setTimeout(function () { window.print(); }, 1000);
}

// ══════════════ MOTOR DOS BALÕES DE AJUDA ══════════════
document.addEventListener('click', function (e) {
  if (!e.target.classList.contains('help-icon')) {
    document.querySelectorAll('.tooltip-balloon').forEach(b => b.remove());
    document.querySelectorAll('.help-icon.active').forEach(i => i.classList.remove('active'));
    return;
  }
  var icon = e.target;
  if (icon.classList.contains('active')) {
    icon.classList.remove('active');
    document.querySelectorAll('.tooltip-balloon').forEach(b => b.remove());
    return;
  }
  document.querySelectorAll('.tooltip-balloon').forEach(b => b.remove());
  document.querySelectorAll('.help-icon.active').forEach(i => i.classList.remove('active'));
  icon.classList.add('active');
  var texto = icon.getAttribute('data-tooltip');
  var balloon = document.createElement('div');
  balloon.className = 'tooltip-balloon';
  balloon.textContent = texto;
  document.body.appendChild(balloon);
  var rect = icon.getBoundingClientRect();
  balloon.style.left = (rect.left + (rect.width / 2)) + 'px';
  balloon.style.top = (rect.top - balloon.offsetHeight - 10) + 'px';
});

// ══════════════ SERVICE WORKER (PWA) ══════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(function (reg) { console.log('[Estoque] Service Worker registrado:', reg.scope); })
      .catch(function (err) { console.warn('[Estoque] Service Worker falhou:', err); });
  });
}

// ══════════════ Splash bootstrap ══════════════
document.body.classList.add('pronto');
setTimeout(() => {
  const tampa = document.getElementById('tampa-carregamento');
  if (tampa) {
    tampa.style.opacity = '0';
    setTimeout(() => tampa.remove(), 400);
  }
}, 150);

