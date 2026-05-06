// ══════════════════════════════════════════════════════════════
//  ESTOQUE DIGITAL — app.js v15.8 (Saída Premium + NFe XML)
//  Grupo Carlos Vaz — CRV/LAS
//  Mudanças v15.8:
//   - Marcar item do carrinho como falta (botão ❌)
//   - Campo Observação livre abaixo do destino
//   - Removido botão "Importar Lista" do carrinho de faltas
//   - Modal de falta NÃO abre teclado automático
//   - Adicionar/Remover destinos (igual setor)
//   - Setores e Destinos SINCRONIZADOS via Sheets (CONFIG_DESTINOS)
//   - Importação de NFe via XML (entrada em lote, soma estoque)
// ══════════════════════════════════════════════════════════════

var API_URL = 'https://script.google.com/macros/s/AKfycbyvw-6uBYct475K2nv5J-U2z39KHxbNOCqkVMaPl6MiFGnd3zTMiLPr5ivMfKNDZ55B/exec';
var SESSION_KEY = 'cv_estoque_sessao';
var CART_KEY = 'cv_estoque_carrinho';
var AUDIT_PENDING_KEY = 'cv_auditoria_pendente';
var IMPORT_LISTA_KEY = 'cv_estoque_lista_importacao';
var FALTAS_KEY = 'cv_estoque_faltas';
var GEMINI_API_KEY = 'AIzaSyCAXte0VgEJ_JWFWewtrlCg1BtqbOaRKbc';
var GEMINI_MODEL = 'gemini-2.0-flash';

var SYNC_CACHE_KEY = 'cv_estoque_sync_cache';
var SYNC_CACHE_TIME_KEY = 'cv_estoque_sync_time';

// 🚀 v15.8 — Cache local de config (destinos/setores sincronizados)
var CONFIG_CACHE_KEY = 'cv_estoque_config_cache';

var CREDS_OFFLINE = {
  "LUIZ":   "4e94d7cf6a395fd8e12ad235143b25e60de3a9ac18a5cb6d090325138d22a7a1",
  "LUCAS":  "1e79f09abad6c8321bf6a1dee19aa4949ce95fa3f962361869c406555ade9062",
  "TASSIO": "53c822e4be542a84710324d05458d7c155d9a0a3ee2c8ea6a621c3b426b123d",
  "AMARAL": "d16bcb871bbfe495833cee0fd592bbf47540fee7801ade3d8ccf7b97372ad042",
  "ALEX":   "e3f961a998c170860de4cab5c8f9548522a1938d6599cf40f827333b503d8eed",
  "LAURA":  "776eef5b0172b1949cae6c3ca5ad14560f2c151dc9e23f5caa6786969ee13469",
  "GESTOR": "704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157"
};

var UNIDADES_DISPONIVEIS = ['UN','KG','L','CX','PCT','FARDO','RL','FD','GL'];
var STATUS_ORDEM = { 'VENCIDO':0, 'CRÍTICO':1, 'ATENÇÃO':2, 'MONITORAR':3, 'OK':4, 'ZERADO':5 };

// 🚀 v15.8 — Padrões de fallback (caso o servidor ainda não tenha CONFIG_DESTINOS)
var DESTINOS_PEDIDO_PADRAO = ['IBÍCUI','NOVA CANAÃ','BOA NOVA','DARIO MEIRA','FLORESTA AZUL'];
var DESTINOS_CONSUMO_PADRAO = ['SÍTIO','ESCRITÓRIO','MERCADO'];
var SETORES_REQ_PADRAO = ['EDUCAÇÃO','SAÚDE','ASSISTÊNCIA SOCIAL','ADMINISTRAÇÃO','INFRAESTRUTURA'];

// Listas dinâmicas (preenchidas via syncConfig)
var configRemota = {
  destinosPedido: DESTINOS_PEDIDO_PADRAO.slice(),
  destinosConsumo: DESTINOS_CONSUMO_PADRAO.slice(),
  setores: SETORES_REQ_PADRAO.slice()
};

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
var itensFalta = [];
var auditoriasPendentes = [];
var miniModalContext = null;
var ptrState = { startY:0, currentY:0, pulling:false, ready:false };
var audioCtx = null;

// 🚀 v15.8 — Cache da NFe importada (entre upload e confirmação)
var nfeImportData = null;

function debounce(fn, wait){
  var timer = null;
  return function(){
    var ctx = this, args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function(){ fn.apply(ctx, args); }, wait);
  };
}

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

document.addEventListener('DOMContentLoaded', function () {
  if (window.GodModeTracker) {
    GodModeTracker.init({ idCliente: 'crv', aplicativo: 'Estoque' });
  }
  restaurarCarrinho();
  restaurarFaltas();
  restaurarAuditoriasPendentes();
  restaurarConfigLocal();
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

    if (CREDS_OFFLINE[user] && CREDS_OFFLINE[user] === senhaHash) {
      sessao = { nome: user, nivel: user === 'GESTOR' ? 'gestor' : 'funcionario', senha: senhaHash };
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
      esconderLogin();
      iniciarApp();
      btn.disabled = false; btn.textContent = 'Entrar';
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ acao: 'login', usuario: user, senha: senhaHash }),
        redirect: 'follow'
      }).then(function(r){ return r.json(); }).then(function(d){
        if(d.status === 'ok' && d.nivel){
          sessao.nivel = d.nivel;
          localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
          if (sessao.nivel === 'gestor') {
            var bg = document.getElementById('badgeGestor');
            if(bg) bg.style.display = '';
          }
        }
      }).catch(function(){});
      return;
    }

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
      err.textContent = 'Sem conexão e credenciais inválidas';
      shakeLogin();
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
  itensFalta = [];
  persistirFaltas();
  localStorage.removeItem(SESSION_KEY);
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
// PERSISTÊNCIA — CARRINHO, FALTAS, AUDITORIA, CONFIG
// ══════════════════════════════════════════════════════════════
function persistirCarrinho(){
  try { localStorage.setItem(CART_KEY, JSON.stringify(carrinhoSaida)); } catch(e){}
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

function persistirFaltas(){
  try { localStorage.setItem(FALTAS_KEY, JSON.stringify(itensFalta)); } catch(e){}
}
function restaurarFaltas(){
  try {
    var raw = localStorage.getItem(FALTAS_KEY);
    if(raw){
      var arr = JSON.parse(raw);
      if(Array.isArray(arr)) itensFalta = arr;
    }
  } catch(e){ itensFalta = []; }
}

function restaurarConfigLocal(){
  try {
    var raw = localStorage.getItem(CONFIG_CACHE_KEY);
    if(raw){
      var c = JSON.parse(raw);
      if(c.destinosPedido && c.destinosPedido.length) configRemota.destinosPedido = c.destinosPedido;
      if(c.destinosConsumo && c.destinosConsumo.length) configRemota.destinosConsumo = c.destinosConsumo;
      if(c.setores && c.setores.length) configRemota.setores = c.setores;
    }
  } catch(e){}
}

// 🚀 v15.8 — Sincroniza config (destinos/setores) com servidor
function syncConfigRemota(){
  fetch(API_URL + '?config=1')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(d && d.status === 'ok'){
        if(Array.isArray(d.destinosPedido)) configRemota.destinosPedido = d.destinosPedido;
        if(Array.isArray(d.destinosConsumo)) configRemota.destinosConsumo = d.destinosConsumo;
        if(Array.isArray(d.setores)) configRemota.setores = d.setores;
        try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(configRemota)); } catch(e){}
        popularSetoresReqSelect();
        toggleDestinoVisibilidade();
      }
    })
    .catch(function(){});
}

function adicionarItemConfig(tipo, nome){
  // tipo: 'DESTINO_PEDIDO' | 'DESTINO_CONSUMO' | 'SETOR'
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ acao:'configAdd', tipo:tipo, nome:nome }),
    redirect: 'follow'
  }).then(function(r){ return r.json(); });
}
function removerItemConfig(tipo, nome){
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ acao:'configRemove', tipo:tipo, nome:nome }),
    redirect: 'follow'
  }).then(function(r){ return r.json(); });
}

// ══════════════════════════════════════════════════════════════
// MODAL DE FALTA (🚀 v15.8 — sem teclado automático)
// ══════════════════════════════════════════════════════════════
function abrirModalFalta(prefill){
  prefill = prefill || {};
  var modal = document.getElementById('faltaModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'faltaModal';
    modal.className = 'mini-modal';
    document.body.appendChild(modal);
  }
  var unidadesOpts = UNIDADES_DISPONIVEIS
    .map(function(u){
      var sel = (prefill.unidade && prefill.unidade === u) ? ' selected' : (u==='UN' && !prefill.unidade ? ' selected' : '');
      return '<option value="'+u+'"'+sel+'>'+u+'</option>';
    }).join('');
  modal.innerHTML =
    '<div class="mm-backdrop" onclick="fecharModalFalta()"></div>'+
    '<div class="mm-card">'+
      '<div class="mm-header">'+
        '<div class="mm-title">❌ Adicionar Item em Falta</div>'+
        '<div class="mm-sub">Será impresso em bloco separado no comprovante</div>'+
      '</div>'+
      '<div class="mm-body">'+
        '<label class="mm-label">Nome do produto</label>'+
        '<input type="text" id="faltaNome" class="mm-input-qtd" style="font-size:1rem; text-align:left;" placeholder="Ex: ARROZ TIPO 1" value="'+escapeHtml(prefill.nome||'')+'">'+
        '<div style="display:flex; gap:10px; margin-top:12px;">'+
          '<div style="flex:1;">'+
            '<label class="mm-label">Quantidade</label>'+
            '<input type="number" inputmode="decimal" id="faltaQtd" class="mm-input-qtd" value="'+(prefill.quantidade||1)+'" min="0.01" step="0.01" readonly onclick="this.removeAttribute(\'readonly\'); this.select();">'+
          '</div>'+
          '<div style="flex:1;">'+
            '<label class="mm-label">Unidade</label>'+
            '<select id="faltaUnidade" class="form-field">'+unidadesOpts+'</select>'+
          '</div>'+
        '</div>'+
        '<label class="mm-label" style="margin-top:12px;">Observação (opcional)</label>'+
        '<input type="text" id="faltaObs" class="form-field" placeholder="Ex: pediram 10, só temos 3" value="'+escapeHtml(prefill.observacao||'')+'">'+
      '</div>'+
      '<div class="mm-actions">'+
        '<button class="mm-btn mm-cancel" onclick="fecharModalFalta()">Cancelar</button>'+
        '<button class="mm-btn mm-confirm" onclick="confirmarItemFalta()" style="background:var(--red);">❌ Adicionar Falta</button>'+
      '</div>'+
    '</div>';
  modal.classList.add('show');
  // 🚀 v15.8 — NÃO chama focus() automático. Teclado só abre quando o usuário tocar no campo.
  // Garantia extra contra autofocus de algum browser/iOS:
  setTimeout(function(){
    if(document.activeElement && document.activeElement.blur){
      try { document.activeElement.blur(); } catch(e){}
    }
  }, 50);
}
function fecharModalFalta(){
  var modal = document.getElementById('faltaModal');
  if(modal) modal.classList.remove('show');
}
function confirmarItemFalta(){
  var nome = (document.getElementById('faltaNome').value||'').trim().toUpperCase();
  var qtd = parseFloat(document.getElementById('faltaQtd').value);
  var unidade = document.getElementById('faltaUnidade').value;
  var obs = (document.getElementById('faltaObs').value||'').trim();
  if(!nome){ toast('Informe o nome do produto'); return; }
  if(!qtd || qtd <= 0){ toast('Quantidade inválida'); return; }
  itensFalta.push({
    id: Date.now()+Math.floor(Math.random()*1000),
    nome: nome, quantidade: qtd, unidade: unidade, observacao: obs
  });
  persistirFaltas();
  fecharModalFalta();
  renderCarrinho();
  toast('❌ "'+nome+'" marcado como falta');
}
function removerItemFalta(id){
  itensFalta = itensFalta.filter(function(f){ return f.id !== id; });
  persistirFaltas();
  renderCarrinho();
}

// 🚀 v15.8 — Mover item do carrinho para faltas
function moverParaFalta(linha){
  var idx = carrinhoSaida.findIndex(function(x){ return x.linha === linha; });
  if(idx < 0) return;
  var item = carrinhoSaida[idx];

  // Remove do carrinho
  carrinhoSaida.splice(idx, 1);
  removerAuditoriaPendente(linha);
  persistirCarrinho();

  // Adiciona em faltas (mantém qtd, unidade, nome)
  itensFalta.push({
    id: Date.now()+Math.floor(Math.random()*10000),
    nome: item.nome,
    quantidade: item.quantidade,
    unidade: item.unidadeDigitada || item.unidadeBase || item.unidade || 'UN',
    observacao: ''
  });
  persistirFaltas();
  renderCarrinho();
  toast('❌ "' + item.nome + '" movido para faltas');
}

// ══════════════════════════════════════════════════════════════
// AUDITORIA PENDENTE
// ══════════════════════════════════════════════════════════════
function persistirAuditoriasPendentes(){
  try { localStorage.setItem(AUDIT_PENDING_KEY, JSON.stringify(auditoriasPendentes)); } catch(e){}
}
function restaurarAuditoriasPendentes(){
  try{
    var raw = localStorage.getItem('cv_auditoria_pendente');
    if(!raw) return;
    var dados = JSON.parse(raw);
    if(dados && dados.itens && dados.itens.length > 0){
      mostrarBannerAuditoria(dados.itens.length);
    }
  }catch(e){}
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
  document.getElementById('detalheModal').querySelector('.modal-bar h2').textContent = '📋 Detalhes';
  abrirAuditoriaModal(linha);
}

function tocarBeep(){
  try {
    if(!audioCtx){ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = 800; gain.gain.value = 0.3;
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start();
    setTimeout(function(){ try{ osc.stop(); }catch(e){} }, 200);
  } catch(e){}
}

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
  var ub = document.getElementById('userBadge');
  if(ub) ub.textContent = sessao.nome;

  if (sessao.nivel === 'gestor') document.getElementById('badgeGestor').style.display = '';

  var cacheNovo = localStorage.getItem(SYNC_CACHE_KEY);
  if(cacheNovo){
    try {
      dadosEstoque = JSON.parse(cacheNovo);
      renderPainel(dadosEstoque);
    } catch(e){}
  } else {
    var cacheAntigo = localStorage.getItem('cv_estoque_cache');
    if (cacheAntigo) {
      try {
        dadosEstoque = limparDuplicatasZeradas(JSON.parse(cacheAntigo));
        renderPainel(dadosEstoque);
      } catch(e){}
    }
  }

  document.getElementById('ldScreen').classList.add('hidden');
  syncDados();
  syncConfigRemota();
  refreshInterval = setInterval(function(){ syncDados(); syncConfigRemota(); }, 300000);
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
  if (tab === 'comprovantes') { carregarComprovantes(); }
}

function syncDados(forceFresh) {
  if(!forceFresh){
    try {
      var cached = localStorage.getItem(SYNC_CACHE_KEY);
      var cacheTime = localStorage.getItem(SYNC_CACHE_TIME_KEY);
      if(cached && cacheTime){
        var d = JSON.parse(cached);
        dadosEstoque = d;
        sincronizarCarrinhoComEstoque();
        renderPainel(d);
      }
    } catch(e){}
  }

  fetch(API_URL)
    .then(function(r){ return r.json(); })
    .then(function(d){
      dadosEstoque = d;
      try {
        localStorage.setItem(SYNC_CACHE_KEY, JSON.stringify(d));
        localStorage.setItem(SYNC_CACHE_TIME_KEY, Date.now().toString());
      } catch(e){}

      sincronizarCarrinhoComEstoque();
      renderPainel(d);

      var abaAtiva = document.querySelector('.tab-btn.active');
      if(abaAtiva){
        var idAba = abaAtiva.id || '';
        if(idAba === 'tabSaida') renderSaidaList(d.produtos);
        else if(idAba === 'tabAuditoria') renderAuditoriaList(d.produtos);
        else if(idAba === 'tabRapida') renderSaidaRapidaList(d.produtos);
        else if(idAba === 'tabHistorico') renderHistoricoCards();
      }

      setBadge(true);
    })
    .catch(function (err) {
      setBadge(false);
    });
}

function setBadge(on) {
  var b = document.getElementById('badgeStatus');
  b.textContent = on ? 'Online' : 'Offline';
  b.className = 'badge ' + (on ? 'badge-online' : 'badge-offline');
}

function sincronizarCarrinhoComEstoque(){
  if(!dadosEstoque || !dadosEstoque.produtos) return;
  carrinhoSaida.forEach(function(item){
    if(item.pendenteCadastro) return;
    var p = dadosEstoque.produtos.find(function(x){ return x.linha === item.linha; });
    if(p){
      item.max = p.quantidade;
      item.overStock = (item.quantidadeBase || item.quantidade) > p.quantidade;
    }
  });
  persistirCarrinho();
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

var filtrarProdutos = debounce(function() {
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
}, 200);

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
      if (d.status === 'ok') { fecharEditar(); showSuccess('✅', d.mensagem, ''); syncDados(true); }
      else { toast(d.msg || 'Erro'); }
    })
    .catch(function () { toast('Sem conexão'); })
    .finally(function () { btn.disabled = false; btn.textContent = 'Salvar Alterações'; });
}

function confirmarExcluir(linha) {
  if (!confirm('Tem certeza que deseja excluir?')) return;
  fecharDetalhe();
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'excluir', senha: sessao.senha, linha: linha }), redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') { showSuccess('🗑️', d.mensagem, ''); syncDados(true); }
      else { toast('Erro ao excluir'); }
    })
    .catch(function () { toast('Sem conexão'); });
}

// ══════════════════════════════════════════════════════════════
// SAÍDA — LISTA, CARRINHO, MINI-MODAL
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

var filtrarSaida = debounce(function() {
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
}, 200);

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
        '<input type="number" inputmode="decimal" id="mmQtd" class="mm-input-qtd" value="'+ctx.quantidadePre+'" min="0.01" step="0.01" readonly onclick="this.removeAttribute(\'readonly\'); this.select();">'+
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
  removerAuditoriaPendente(linha);
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

  if(unidade !== ctx.unidadeBase && fator !== 1){
    var conhecido = (ctx.fatoresConversao||{})[unidade];
    if(conhecido !== fator){
      salvarFatorNoServidor(ctx.linha, unidade, fator);
      if(dadosEstoque && dadosEstoque.produtos){
        var prod = dadosEstoque.produtos.find(function(x){ return x.linha === ctx.linha; });
        if(prod){
          prod.fatoresConversao = prod.fatoresConversao || {};
          prod.fatoresConversao[unidade] = fator;
          try { localStorage.setItem(SYNC_CACHE_KEY, JSON.stringify(dadosEstoque)); } catch(e){}
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

// 🚀 v15.8 — renderCarrinho com botão ❌ e SEM o botão "Importar Lista"
function renderCarrinho() {
  var area = document.getElementById('carrinhoArea');
  var list = document.getElementById('cartList');
  var count = document.getElementById('cartCount');
  if (!area) return;

  if (carrinhoSaida.length === 0 && itensFalta.length === 0) {
    area.style.display = 'none';
    return;
  }
  area.style.display = 'block';
  count.textContent = carrinhoSaida.length + itensFalta.length;

  var h = '';

  carrinhoSaida.forEach(function (item) {
    var unTxt = item.unidadeDigitada || item.unidade || '';
    var overCls = item.overStock ? ' over-stock' : '';
    var pendCls = item.pendenteCadastro ? ' pendente-cadastro' : '';
    var overTag = '';
    if(item.pendenteCadastro){
      overTag = '<span class="cart-over-tag" style="background:var(--orange); color:#fff;">📝 SEM CADASTRO</span>';
    } else if(item.overStock){
      overTag = '<span class="cart-over-tag">⚠️ Over</span>';
    }
    h += '<div class="cart-item'+overCls+pendCls+'">' +
         '<div class="cart-info" onclick="abrirMiniModalEdicao('+item.linha+')" style="cursor:pointer;"><strong>' + escapeHtml(item.nome) + '</strong>' +
         '<small>'+item.quantidade+' '+escapeHtml(unTxt)+
           (item.unidadeDigitada && item.unidadeDigitada !== item.unidadeBase && !item.pendenteCadastro ? ' (= '+item.quantidadeBase+' '+escapeHtml(item.unidadeBase)+')' : '')+
           (item.pendenteCadastro ? ' • ⚠️ Cadastrar na auditoria' : ' • Estoque: ' + item.max + ' ' + escapeHtml(item.unidadeBase || item.unidade)) + '</small></div>' +
         '<div class="cart-tap-hint" style="display:flex; align-items:center; gap:6px;">'+overTag+
           '<button onclick="event.stopPropagation(); moverParaFalta('+item.linha+')" title="Marcar como falta" style="background:rgba(255,69,58,0.12); border:1px solid rgba(255,69,58,0.3); color:var(--red); border-radius:8px; padding:6px 10px; font-size:0.85rem; cursor:pointer; font-weight:700;">❌</button>'+
           '<button onclick="event.stopPropagation(); abrirMiniModalEdicao('+item.linha+')" title="Editar" style="background:rgba(10,132,255,0.12); border:1px solid rgba(10,132,255,0.3); color:var(--blue); border-radius:8px; padding:6px 10px; font-size:0.85rem; cursor:pointer;">✏️</button>'+
         '</div>' +
         '</div>';
  });

  if(itensFalta.length > 0){
    h += '<div class="falta-divider" style="margin:14px 0 8px; padding:8px 12px; background:rgba(255,69,58,0.1); border-left:4px solid var(--red); border-radius:6px; font-weight:700; color:var(--red); font-size:0.85rem;">❌ Itens em Falta ('+itensFalta.length+')</div>';
    itensFalta.forEach(function(f){
      h += '<div class="cart-item falta-item" style="border-left:4px solid var(--red); background:rgba(255,69,58,0.05);">'+
        '<div class="cart-info"><strong>'+escapeHtml(f.nome)+'</strong>'+
        '<small>'+f.quantidade+' '+escapeHtml(f.unidade)+(f.observacao?' • '+escapeHtml(f.observacao):'')+'</small></div>'+
        '<div class="cart-tap-hint">'+
          '<button onclick="event.stopPropagation(); removerItemFalta('+f.id+')" style="background:transparent; border:none; color:var(--red); font-size:1.2rem; cursor:pointer; padding:0 8px;">🗑️</button>'+
        '</div>'+
      '</div>';
    });
  }

  // 🚀 v15.8 — Removido o botão "📋 Importar Lista". Mantido só o "+ 1 Item" de falta.
  h += '<div style="margin-top:10px;">'+
       '<button class="cam-btn" onclick="abrirModalFalta()" style="width:100%; background:rgba(255,69,58,0.1); color:var(--red); font-weight:700; border:1px dashed var(--red);">❌ + 1 Item em Falta</button>'+
       '</div>';

  list.innerHTML = h;

  persistirCarrinho();
  persistirFaltas();
}

function abrirMiniModalEdicao(linha){
  var item = carrinhoSaida.find(function(x){ return x.linha === linha; });
  if(!item) return;

  if(item.pendenteCadastro){
    abrirMiniModal({
      linha: item.linha,
      nome: item.nome + ' (sem cadastro)',
      unidadeBase: item.unidadeBase,
      estoqueAtual: 0,
      fatoresConversao: {},
      quantidadePre: item.quantidade,
      unidadePre: item.unidadeDigitada || item.unidadeBase,
      fatorPre: item.fator || 1,
      edicao: true
    });
    return;
  }

  if(!dadosEstoque) return;
  var p = dadosEstoque.produtos.find(function(x){ return x.linha === linha; });
  if(!p){ toast('Produto não encontrado'); return; }
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
// 🚀 v15.8 — CONFIRMAR SAÍDA EM LOTE (com Observação)
// ══════════════════════════════════════════════════════════════
function confirmarSaidaLote() {
  if (carrinhoSaida.length === 0 && itensFalta.length === 0) return;
  var btn = document.getElementById('btnConfirmarLote');
  if(btn && btn.disabled) return;

  var motivoInput = document.getElementById('loteMotivoSelect');
  var setorSelect = document.getElementById('loteSetorSelect');
  var destinoSelect = document.getElementById('loteDestinoSelect');
  var destinoLivre = document.getElementById('loteMotivoObs');
  var observacaoEl = document.getElementById('loteObservacao');

  var motivoValue = motivoInput ? motivoInput.value : 'SAÍDA';

  var destinoFinal = '';
  if(destinoSelect){
    var sel = destinoSelect.value;
    if(sel === '__novo__' || sel === '__remover__'){
      toast('⚠️ Confirme/cancele a edição de destino antes de prosseguir.');
      return;
    }
    if(sel === 'OUTRO…' || sel === 'OUTRO...' || sel === '__custom__'){
      destinoFinal = destinoLivre && destinoLivre.value.trim() ? destinoLivre.value.trim() : '';
    } else if(sel){
      destinoFinal = sel;
    } else if(destinoLivre && destinoLivre.value.trim()){
      destinoFinal = destinoLivre.value.trim();
    }
  }

  var setorFinal = '';
  if(setorSelect){
    if(setorSelect.value === '__novo__' || setorSelect.value === '__remover__'){
      toast('⚠️ Confirme/cancele a edição de setor antes de prosseguir.');
      return;
    }
    setorFinal = setorSelect.value || '';
  }

  if(motivoValue === 'SAÍDA DE PEDIDO'){
    if(!setorFinal){ toast('⚠️ Selecione o setor solicitante!'); if(setorSelect){ setorSelect.focus(); } return; }
    if(!destinoFinal){ toast('⚠️ Informe o destino do pedido!'); return; }
  }
  if(motivoValue === 'CONSUMO INTERNO' || motivoValue === 'CONSUMO'){
    if(!destinoFinal){ toast('⚠️ Informe o destino do consumo!'); return; }
  }
  if(!destinoFinal) destinoFinal = 'Não informado';

  var observacao = observacaoEl ? (observacaoEl.value||'').trim() : '';

  var motivoFinal = motivoValue;
  if(setorFinal) motivoFinal += ' - ' + setorFinal;
  if (destinoFinal !== 'Não informado') motivoFinal += ' - ' + destinoFinal;
  if (observacao) motivoFinal += ' • Obs: ' + observacao;

  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

  var faltasParaRomaneio = JSON.parse(JSON.stringify(itensFalta));
  var itensParaRomaneio = JSON.parse(JSON.stringify(carrinhoSaida));

  var itensPayload = carrinhoSaida
    .filter(function(i){ return !i.pendenteCadastro && i.linha > 0; })
    .map(function (i) {
      return {
        linha: i.linha,
        quantidade: i.quantidade,
        unidadeDigitada: i.unidadeDigitada || i.unidadeBase,
        fator: i.fator || 1,
        motivo: motivoFinal
      };
    });

  carrinhoSaida.forEach(function (item) {
    if(item.pendenteCadastro || item.linha <= 0) return;
    var p = dadosEstoque.produtos.find(function (x) { return x.linha === item.linha; });
    if (p) p.quantidade -= (item.quantidadeBase || (item.quantidade * (item.fator||1)));
  });

  carrinhoSaida = [];
  persistirCarrinho();
  itensFalta = [];
  persistirFaltas();
  if (motivoInput) motivoInput.value = 'SAÍDA DE PEDIDO';
  if (setorSelect) setorSelect.value = '';
  if (destinoSelect) destinoSelect.value = '';
  if (destinoLivre) destinoLivre.value = '';
  if (observacaoEl) observacaoEl.value = '';
  toggleDestinoOutro();
  toggleNovoSetorBox();
  toggleNovoDestinoBox();
  toggleDestinoVisibilidade();
  renderCarrinho(); renderSaidaList(dadosEstoque.produtos); renderPainel(dadosEstoque);

  if (motivoValue === 'SAÍDA DE PEDIDO') {
    showSuccess('🖨️', 'Pedido Separado!', 'Gerando comprovante de entrega...');
    gerarComprovantePedido(itensParaRomaneio, destinoFinal, setorFinal, faltasParaRomaneio, observacao);
    salvarComprovanteServidor({
      operador: sessao.nome,
      motivo: motivoValue,
      setor: setorFinal,
      destino: destinoFinal,
      observacao: observacao,
      itens: itensParaRomaneio,
      faltas: faltasParaRomaneio
    });
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
    .then(function (d) { syncDados(true); })
    .catch(function (err) { toast('Sincronizando em 2º plano...'); })
    .finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar Baixa Total'; }
    });
}
