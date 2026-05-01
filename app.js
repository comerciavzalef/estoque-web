// ══════════════════════════════════════════════════════════════
//  ESTOQUE DIGITAL — app.js v13.0 (Otimista, Agrupamento e Balões)
//  Grupo Carlos Vaz — CRV/LAS
// ══════════════════════════════════════════════════════════════


// ============================================================
//  TELEMETRY CLIENT — Cole no try/catch dos PWAs de ponta
// ============================================================
async function enviarLogParaCentral({ idCliente, aplicativo, usuario, dispositivo, tipoLog, mensagemErro }) {
  const URL_CENTRAL = 'https://script.google.com/macros/s/AKfycbzqjZtyCn7X1lWQBSRYLwW-MijJN53YLPoHJrjjBh5y6P1kTaBATNpAV13KV9OgNYPx/exec';
  const API_KEY     = 'ee91297b-685b-4ae4-b131-8434841c882e';

  try {
    await fetch(URL_CENTRAL, {
      method: 'POST',
      // text/plain → evita preflight OPTIONS (Apps Script não responde OPTIONS)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        apiKey: API_KEY,
        idCliente, aplicativo, usuario, dispositivo, tipoLog, mensagemErro
      })
    });
  } catch (e) {
    // Falha de telemetria nunca deve quebrar o app de ponta
    console.warn('[Telemetria] Falhou silenciosamente:', e);
  }
}

// EXEMPLO DE USO no try/catch real do app:
try {
  // ... lógica de negócio ...
} catch (err) {
  enviarLogParaCentral({
    idCliente:    'crv',
    aplicativo:   'Estoque',
    usuario:      sessaoAtual.nome,
    dispositivo:  navigator.userAgent,
    tipoLog:      'ERRO',
    mensagemErro: `${err.message}\n${err.stack || ''}`
  });
  // continua tratamento normal do erro no app
}


var API_URL = 'https://script.google.com/macros/s/AKfycbyvw-6uBYct475K2nv5J-U2z39KHxbNOCqkVMaPl6MiFGnd3zTMiLPr5ivMfKNDZ55B/exec';
var SESSION_KEY = 'cv_estoque_sessao';

var CREDS_OFFLINE = {
  'LUIZ':   '4e94d7cf6a395fd8e12ad235143b25e60de3a9ac18a5cb6d090325138d22a7a1',
  'LUCAS':  '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157', 
  'TASSIO': '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157',
  'AMARAL': '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157', 
  'ALEX':   '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157',
  'GESTOR': '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157'
};

var sessao = null; var dadosEstoque = null; var fotoData = ''; var fotoStream = null;
var refreshInterval = null; var relatorioAtivo = false; var flashLigado = false;
var html5QrcodeScannerEntrada = null; var html5QrcodeScannerSaida = null; var carrinhoSaida = [];

(function () {
  var s = localStorage.getItem(SESSION_KEY);
  if (s) { try { sessao = JSON.parse(s); if (sessao && sessao.nome) { esconderLogin(); iniciarApp(); return; } } catch (e) { } }
})();

function toggleSenha() {
  var input = document.getElementById('loginPass'); var icon = document.getElementById('eyeIcon');
  if (input.type === 'password') { input.type = 'text'; icon.textContent = '🙈'; } else { input.type = 'password'; icon.textContent = '👁️'; }
}

async function fazerLogin() {
  var user = document.getElementById('loginUser').value.trim().toUpperCase(); var pass = document.getElementById('loginPass').value.trim();
  var err = document.getElementById('loginError'); var btn = document.getElementById('loginBtn'); var lgpd = document.getElementById('lgpdCheck');
  err.textContent = '';
  if (!user || !pass) { err.textContent = 'Preencha todos os campos'; shakeLogin(); return; }
  if (lgpd && !lgpd.checked) { err.textContent = 'Aceite os termos da LGPD'; shakeLogin(); return; }
  btn.disabled = true; btn.textContent = 'Autenticando...';

  try {
    var senhaHash = await gerarHash(pass);
    fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'login', usuario: user, senha: senhaHash }), redirect: 'follow' })
    .then(function (r) { return r.json(); }).then(function (d) {
      if (d.status === 'ok') { sessao = { nome: d.nome, nivel: d.nivel, senha: senhaHash }; localStorage.setItem(SESSION_KEY, JSON.stringify(sessao)); esconderLogin(); iniciarApp(); } 
      else { err.textContent = d.msg || 'Credenciais inválidas'; shakeLogin(); }
    }).catch(function () {
      if (CREDS_OFFLINE[user] && CREDS_OFFLINE[user] === senhaHash) { sessao = { nome: user, nivel: user === 'GESTOR' ? 'gestor' : 'funcionario', senha: senhaHash }; localStorage.setItem(SESSION_KEY, JSON.stringify(sessao)); esconderLogin(); iniciarApp(); } 
      else { err.textContent = 'Sem conexão e credenciais inválidas'; shakeLogin(); }
    }).finally(function () { btn.disabled = false; btn.textContent = 'Entrar'; });
  } catch(e) { err.textContent = 'Erro no sistema'; shakeLogin(); btn.disabled = false; btn.textContent = 'Entrar'; }
}

async function gerarHash(texto) { const msgBuffer = new TextEncoder().encode(texto); const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer); const hashArray = Array.from(new Uint8Array(hashBuffer)); return hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); }
function shakeLogin() { var c = document.querySelector('.login-card'); c.classList.add('shake'); setTimeout(function () { c.classList.remove('shake'); }, 500); }
function esconderLogin() { document.getElementById('loginScreen').classList.add('hidden'); }

function logout() {
  sessao = null; dadosEstoque = null; carrinhoSaida = []; localStorage.removeItem(SESSION_KEY); localStorage.removeItem('cv_estoque_cache');
  if (refreshInterval) clearInterval(refreshInterval); stopFotoCamera(); pararScannerEntrada(); pararScannerSaida(); fecharRelatorio();
  document.getElementById('mainApp').style.display = 'none'; document.getElementById('loginScreen').classList.remove('hidden'); document.getElementById('badgeGestor').style.display = 'none';
  document.getElementById('loginUser').value = ''; document.getElementById('loginPass').value = ''; document.getElementById('loginPass').type = 'password'; document.getElementById('eyeIcon').textContent = '👁️'; document.getElementById('loginError').textContent = '';
  switchTab('painel');
}

// 🔴 INTELIGÊNCIA DE AGRUPAMENTO (Oculta Zeros Duplicados e Falsos Zeros)
function limparDuplicatasZeradas(d) {
  if (!d || !d.produtos) return d;

  var temSaldo = function(nome, marca) {
    return d.produtos.some(function(p) { 
      return p.quantidade > 0 && p.nome === nome && p.marca === marca; 
    });
  };

  var produtosFinais = [];
  var zerosVistos = {}; 

  d.produtos.forEach(function(p) {
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
      
      d.alertas.forEach(function(a) {
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
  document.getElementById('ldScreen').classList.remove('hidden'); document.getElementById('mainApp').style.display = 'block'; document.getElementById('userBadge').textContent = sessao.nome;
  if (sessao.nivel === 'gestor') document.getElementById('badgeGestor').style.display = '';
  var cache = localStorage.getItem('cv_estoque_cache');
  if(cache) { dadosEstoque = limparDuplicatasZeradas(JSON.parse(cache)); renderPainel(dadosEstoque); } 
  document.getElementById('ldScreen').classList.add('hidden'); syncDados(); refreshInterval = setInterval(syncDados, 300000);
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); }); document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); }); document.getElementById('content' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  if (tab === 'entrada') { if(document.getElementById('areaCameraEntrada').style.display === 'block') initFotoCamera(); } else { stopFotoCamera(); }
  if (tab !== 'entrada') pararScannerEntrada(); if (tab !== 'saida') pararScannerSaida();
  if (tab === 'saida' && dadosEstoque) { renderSaidaList(dadosEstoque.produtos); renderCarrinho(); }
  if (tab === 'auditoria' && dadosEstoque) { renderAuditoriaList(dadosEstoque.produtos); }
}

function syncDados() {
  fetch(API_URL + '?sync=1').then(function (r) { return r.json(); }).then(function (d) {
      d = limparDuplicatasZeradas(d);
      dadosEstoque = d; setBadge(true); localStorage.setItem('cv_estoque_cache', JSON.stringify(d)); renderPainel(d);
      if(document.getElementById('tabSaida').classList.contains('active')) renderSaidaList(d.produtos);
      if(document.getElementById('tabAuditoria').classList.contains('active')) renderAuditoriaList(d.produtos);
    }).catch(function () { setBadge(false); });
}
function setBadge(on) { var b = document.getElementById('badgeStatus'); b.textContent = on ? 'Online' : 'Offline'; b.className = 'badge ' + (on ? 'badge-online' : 'badge-offline'); }

function renderPainel(d) {
  if (!d) return; 
  var alertas = d.alertas || []; 
  var produtos = d.produtos || []; 
  var okCount = 0; var zeroCount = 0;
  
  var produtosUnicos = new Set();

  produtos.forEach(function (p) { 
    produtosUnicos.add(p.nome + '_' + p.marca);
    if (p.quantidade === 0) zeroCount++; 
    else if (p.status === 'OK' || p.status === 'MONITORAR') okCount++; 
  });

  document.getElementById('statTotal').textContent = produtosUnicos.size;
  document.getElementById('statOk').textContent = okCount; 
  document.getElementById('statAlertas').textContent = alertas.length; 
  document.getElementById('statZero').textContent = zeroCount;

  var alertSection = document.getElementById('alertasSection'); var alertList = document.getElementById('alertasList');
  if (alertas.length > 0) {
    alertSection.style.display = 'block'; var ah = '';
    alertas.forEach(function (a) {
      var cls = 'critical'; var icon = '⚠️'; var badgeCls = 'vencido';
      if (a.tipo === 'ESTOQUE ZERO') { cls = 'estoque-zero'; icon = '🚫'; badgeCls = 'zero'; } else if (a.status === 'CRÍTICO') { cls = 'critical'; icon = '🔴'; badgeCls = 'critico'; } else if (a.status === 'ATENÇÃO') { cls = 'warning'; icon = '🟡'; badgeCls = 'atencao'; } else if (a.status === 'VENCIDO') { cls = 'critical'; icon = '❌'; badgeCls = 'vencido'; }
      ah += '<div class="alerta-card ' + cls + '"><div class="alerta-icon">' + icon + '</div><div class="alerta-info"><div class="alerta-nome">' + a.produto + '</div><div class="alerta-detail">' + a.marca + ' • ' + a.setor + ' • Qtd: ' + a.quantidade + '</div></div><span class="alerta-badge ' + badgeCls + '">' + a.tipo + '</span></div>';
    }); alertList.innerHTML = ah;
  } else { alertSection.style.display = 'none'; }
  renderProdutos(produtos); document.getElementById('syncTime').textContent = d.timestamp ? 'Atualizado: ' + d.timestamp : '';
}

function renderProdutos(produtos) {
  var el = document.getElementById('produtosList');
  if (!produtos || produtos.length === 0) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">Nenhum produto cadastrado</div></div>'; return; }

  var grupos = {};
  var ordemChaves = [];
  produtos.forEach(function(p) {
    var chave = (p.nome + '_' + p.marca).toUpperCase();
    if (!grupos[chave]) {
      grupos[chave] = {
        nome: p.nome,
        marca: p.marca,
        setor: p.setor,
        unidade: p.unidade,
        quantidadeTotal: 0,
        melhorStatus: 'OK',
        melhorDias: 99999,
        lotes: [],
        linhas: []
      };
      ordemChaves.push(chave);
    }
    var g = grupos[chave];
    g.quantidadeTotal += parseFloat(p.quantidade) || 0;
    g.lotes.push(p);
    g.linhas.push(p.linha);

    var prioridade = { 'VENCIDO': 0, 'CRÍTICO': 1, 'ATENÇÃO': 2, 'MONITORAR': 3, 'OK': 4 };
    var statusAtual = p.quantidade === 0 ? 'OK' : (p.status || 'OK');
    if ((prioridade[statusAtual] || 4) < (prioridade[g.melhorStatus] || 4)) {
      g.melhorStatus = statusAtual;
    }
  });

  var html = '';
  ordemChaves.forEach(function(chave) {
    var g = grupos[chave];
    var statusFinal = g.quantidadeTotal === 0 ? 'SEM ESTOQUE' : g.melhorStatus;
    var statusCls = g.quantidadeTotal === 0 ? 'zero' : getStatusClass(g.melhorStatus, g.quantidadeTotal);
    var icon = g.quantidadeTotal === 0 ? '🚫' : getStatusIcon(g.melhorStatus, g.quantidadeTotal);
    var qtdCls = g.quantidadeTotal === 0 ? 'zero' : g.quantidadeTotal <= 5 ? 'low' : 'ok';

    var loteInfo = '';
    if (g.lotes.length > 1) {
      loteInfo = ' <span style="color:var(--text-tertiary); font-size:0.7rem;">(' + g.lotes.length + ' lotes)</span>';
    }

    var linhaPrincipal = g.linhas[0];
    var maiorQtd = 0;
    g.lotes.forEach(function(l) {
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

function getStatusClass(status, qtd) { if (qtd === 0) return 'zero'; switch (status) { case 'VENCIDO': return 'vencido'; case 'CRÍTICO': return 'critico'; case 'ATENÇÃO': return 'atencao'; case 'MONITORAR': return 'monitorar'; default: return 'ok'; } }
function getStatusIcon(status, qtd) { if (qtd === 0) return '🚫'; switch (status) { case 'VENCIDO': return '❌'; case 'CRÍTICO': return '🔴'; case 'ATENÇÃO': return '🟡'; case 'MONITORAR': return '🔵'; default: return '✅'; } }
function filtrarProdutos() {
  if (!dadosEstoque) return; var termo = document.getElementById('searchInput').value.toLowerCase().trim(); if (!termo) { renderProdutos(dadosEstoque.produtos); return; }
  var filtrados = dadosEstoque.produtos.filter(function (p) { return p.nome.toLowerCase().indexOf(termo) > -1 || p.marca.toLowerCase().indexOf(termo) > -1 || p.setor.toLowerCase().indexOf(termo) > -1 || (p.lote && p.lote.toLowerCase().indexOf(termo) > -1) || (p.codigoBarras && p.codigoBarras.indexOf(termo) > -1); }); renderProdutos(filtrados);
}

function toggleFlash() {
  var leitor = null;
  if (html5QrcodeScannerEntrada && html5QrcodeScannerEntrada.getState() === 2) leitor = html5QrcodeScannerEntrada;
  else if (html5QrcodeScannerSaida && html5QrcodeScannerSaida.getState() === 2) leitor = html5QrcodeScannerSaida;
  
  if (!leitor) { toast("Abra a câmera primeiro para ligar o flash."); return; }
  flashLigado = !flashLigado;
  
  leitor.applyVideoConstraints({ advanced: [{ torch: flashLigado }] }).then(function() {
    toast(flashLigado ? "🔦 Flash Ligado" : "🔦 Flash Desligado");
  }).catch(function() { toast("⚠️ Seu aparelho bloqueou o uso do flash pelo navegador."); flashLigado = false; });
}

function iniciarScannerEntrada() {
  document.getElementById('scannerEntradaArea').style.display = 'block'; html5QrcodeScannerEntrada = new Html5Qrcode("readerEntrada");
  html5QrcodeScannerEntrada.start({ facingMode: "environment" }, { fps: 15, qrbox: { width: 280, height: 120 }, aspectRatio: 1.0, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
    function(decodedText) { pararScannerEntrada(); document.getElementById('entCodigoBarras').value = decodedText; buscarProdutoPorCodigo(decodedText); if(navigator.vibrate) navigator.vibrate(100); }, function(err) {}).catch(function(err) { toast("Erro na câmara."); pararScannerEntrada(); });
}
function pararScannerEntrada() { flashLigado = false; if(html5QrcodeScannerEntrada) { html5QrcodeScannerEntrada.stop().then(function(){ html5QrcodeScannerEntrada.clear(); html5QrcodeScannerEntrada = null; }).catch(function(){}); } document.getElementById('scannerEntradaArea').style.display = 'none'; }
function buscarProdutoPorCodigo(codigo) {
  if (!dadosEstoque || !codigo) return; var p = dadosEstoque.produtos.find(function(x) { return x.codigoBarras === codigo; });
  if (p) { document.getElementById('entSetor').value = p.setor; document.getElementById('entProduto').value = p.nome; document.getElementById('entUnidade').value = p.unidade; document.getElementById('entMarca').value = p.marca; toast("📦 Produto reconhecido!"); }
}

function iniciarScannerSaida() {
  document.getElementById('scannerSaidaArea').style.display = 'block'; html5QrcodeScannerSaida = new Html5Qrcode("readerSaida");
  html5QrcodeScannerSaida.start({ facingMode: "environment" }, { fps: 15, qrbox: { width: 280, height: 120 }, aspectRatio: 1.0, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
    function(decodedText)  { pararScannerSaida(); var p = dadosEstoque.produtos.find(function(x) { return x.codigoBarras === decodedText; }); if(p) { adicionarAoCarrinho(p.linha); } else { toast("Código não encontrado no estoque."); } if(navigator.vibrate) navigator.vibrate(100); }, function(err) {}).catch(function(err) { toast("Erro na câmara."); pararScannerSaida(); });
}
function pararScannerSaida() { flashLigado = false; if(html5QrcodeScannerSaida) { html5QrcodeScannerSaida.stop().then(function(){ html5QrcodeScannerSaida.clear(); html5QrcodeScannerSaida = null; }).catch(function(){}); } document.getElementById('scannerSaidaArea').style.display = 'none'; }

function abrirDetalhe(linha) {
  if (!dadosEstoque) return; var p = dadosEstoque.produtos.find(function (x) { return x.linha === linha; }); if (!p) { toast('Produto não encontrado'); return; }
  var statusCls = getStatusClass(p.status, p.quantidade); var icon = getStatusIcon(p.status, p.quantidade); var isGestor = sessao && sessao.nivel === 'gestor';
  var h = '<div class="detalhe-header"><span class="d-icon">' + icon + '</span><div class="d-nome">' + p.nome + '</div><div class="d-marca">' + p.marca + (p.lote ? ' • Lote: ' + p.lote : '') + '</div></div><div class="detalhe-grid"><div class="detalhe-item"><div class="d-val" style="color:var(--blue);">' + p.quantidade + ' ' + p.unidade + '</div><div class="d-lbl">Estoque</div></div><div class="detalhe-item"><div class="d-val"><span class="prod-status ' + statusCls + '" style="font-size:.7rem;">' + p.status + '</span></div><div class="d-lbl">Status</div></div><div class="detalhe-item"><div class="d-val" style="font-size:.9rem;">' + p.setor + '</div><div class="d-lbl">Setor</div></div><div class="detalhe-item"><div class="d-val" style="font-size:.9rem;">' + (p.validade || '—') + '</div><div class="d-lbl">Validade</div></div>';
  var diasTxt = '—'; var diasColor = 'var(--green)'; if (p.diasVencer !== '' && p.diasVencer !== null && p.diasVencer !== undefined) { diasTxt = p.diasVencer + ' dias'; if (p.diasVencer < 0) diasColor = 'var(--red)'; else if (p.diasVencer <= 7) diasColor = 'var(--orange)'; else if (p.diasVencer <= 30) diasColor = 'var(--yellow)'; }
  h += '<div class="detalhe-item"><div class="d-val" style="color:' + diasColor + ';">' + diasTxt + '</div><div class="d-lbl">Dias p/ Vencer</div></div><div class="detalhe-item"><div class="d-val" style="font-size:.9rem;">' + (p.data || '—') + '</div><div class="d-lbl">Data Cadastro</div></div></div>';
  h += '<div class="detalhe-actions">'; if (p.quantidade > 0) { h += '<button class="btn-saida-det" onclick="adicionarAoCarrinhoDetalhe(' + p.linha + ')">🛒 Adicionar ao Carrinho</button>'; }
  if (isGestor) { h += '<button class="btn-edit" onclick="abrirEditar(' + p.linha + ')">✏️ Editar</button><button class="btn-delete" onclick="confirmarExcluir(' + p.linha + ')">🗑️ Excluir</button>'; }
  h += '</div>'; document.getElementById('detalheBody').innerHTML = h; document.getElementById('detalheModal').classList.add('show');
}
function fecharDetalhe() { document.getElementById('detalheModal').classList.remove('show'); }
function adicionarAoCarrinhoDetalhe(linha) { fecharDetalhe(); adicionarAoCarrinho(linha); switchTab('saida'); }

function abrirEditar(linha) {
  if (!dadosEstoque) return; var p = dadosEstoque.produtos.find(function (x) { return x.linha === linha; }); if (!p) return; fecharDetalhe();
  var h = '<div class="form-card"><input type="hidden" id="editLinha" value="' + linha + '"><div class="form-group"><label class="form-label">Produto</label><input type="text" id="editProduto" class="form-field" value="' + escapeHtml(p.nome) + '"></div><div class="form-group"><label class="form-label">Marca</label><input type="text" id="editMarca" class="form-field" value="' + escapeHtml(p.marca) + '"></div><div class="form-group"><label class="form-label">Código de Barras</label><input type="text" id="editCodigoBarras" class="form-field" value="' + escapeHtml(p.codigoBarras || '') + '"></div><div class="form-group"><label class="form-label">Setor</label><select id="editSetor" class="form-field">';
  var setores = ['MERCEARIA', 'AÇOUGUE', 'LATICÍNIOS', 'CONGELADOS', 'HORTIFRUTI', 'BEBIDAS', 'LIMPEZA', 'HIGIENE', 'UTILIDADES', 'OUTROS']; setores.forEach(function (s) { h += '<option value="' + s + '"' + (s === p.setor ? ' selected' : '') + '>' + s + '</option>'; });
  h += '</select></div><div class="form-row"><div class="form-group"><label class="form-label">Quantidade</label><input type="number" id="editQtd" class="form-field" value="' + p.quantidade + '" min="0" step="0.01"></div><div class="form-group"><label class="form-label">Unidade</label><select id="editUnidade" class="form-field">'; ['UN', 'KG', 'L', 'CX', 'PCT', 'RL', 'FD', 'GL'].forEach(function (u) { h += '<option value="' + u + '"' + (u === p.unidade ? ' selected' : '') + '>' + u + '</option>'; });
  h += '</select></div></div><div class="form-row"><div class="form-group"><label class="form-label">Validade</label><input type="date" id="editValidade" class="form-field" value="' + (p.validade || '') + '"></div><div class="form-group"><label class="form-label">Lote</label><input type="text" id="editLote" class="form-field" value="' + escapeHtml(p.lote) + '"></div></div><div class="form-group"><label class="form-label">Observações</label><input type="text" id="editObs" class="form-field" value="' + escapeHtml(p.observacoes || '') + '"></div><button class="submit-btn" id="btnSalvarEdit" onclick="salvarEdicao()" style="background:var(--blue);">Salvar Alterações</button></div>';
  document.getElementById('editBody').innerHTML = h; document.getElementById('editModal').classList.add('show');
}
function fecharEditar() { document.getElementById('editModal').classList.remove('show'); }
function salvarEdicao() {
  var btn = document.getElementById('btnSalvarEdit'); btn.disabled = true; btn.textContent = 'Salvando...';
  var payload = { acao: 'editar', senha: sessao.senha, linha: parseInt(document.getElementById('editLinha').value), produto: document.getElementById('editProduto').value.trim(), marca: document.getElementById('editMarca').value.trim(), setor: document.getElementById('editSetor').value, quantidade: document.getElementById('editQtd').value, unidade: document.getElementById('editUnidade').value, validade: document.getElementById('editValidade').value, lote: document.getElementById('editLote').value.trim(), observacoes: document.getElementById('editObs').value.trim(), codigoBarras: document.getElementById('editCodigoBarras').value.trim() };
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) { if (d.status === 'ok') { fecharEditar(); showSuccess('✅', d.mensagem, ''); syncDados(); } else { toast(d.msg || 'Erro'); } }).catch(function () { toast('Sem conexão'); }).finally(function () { btn.disabled = false; btn.textContent = 'Salvar Alterações'; });
}
function confirmarExcluir(linha) { if (!confirm('Tem certeza que deseja excluir?')) return; fecharDetalhe(); fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'excluir', senha: sessao.senha, linha: linha }), redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) { if (d.status === 'ok') { showSuccess('🗑️', d.mensagem, ''); syncDados(); } else { toast('Erro ao excluir'); } }).catch(function () { toast('Sem conexão'); }); }

function renderSaidaList(produtos) {
  var el = document.getElementById('saidaList');
  if (!produtos || produtos.length === 0) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">📤</div><div class="empty-text">Nenhum produto disponível</div></div>'; return; }

  var grupos = {};
  var ordem = [];
  produtos.forEach(function(p) {
    if (p.quantidade <= 0) return;
    var chave = (p.nome + '_' + p.marca).toUpperCase();
    if (!grupos[chave]) {
      grupos[chave] = { nome: p.nome, marca: p.marca, setor: p.setor, unidade: p.unidade, quantidadeTotal: 0, linhaMaior: p.linha, maiorQtd: 0 };
      ordem.push(chave);
    }
    var g = grupos[chave];
    g.quantidadeTotal += parseFloat(p.quantidade) || 0;
    if (p.quantidade > g.maiorQtd) { g.maiorQtd = p.quantidade; g.linhaMaior = p.linha; }
  });

  if (ordem.length === 0) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">🚫</div><div class="empty-text">Estoque zerado</div></div>'; return; }

  var html = '';
  ordem.forEach(function(chave) {
    var g = grupos[chave];
    html += '<div class="saida-card" onclick="adicionarAoCarrinho(' + g.linhaMaior + ')"><div class="saida-icon">📦</div><div class="saida-info"><div class="saida-nome">' + escapeHtml(g.nome) + '</div><div class="saida-meta">' + escapeHtml(g.marca) + ' • ' + escapeHtml(g.setor) + '</div></div><div class="saida-qtd">' + g.quantidadeTotal + ' ' + escapeHtml(g.unidade) + '</div><button class="saida-btn">+ Add</button></div>';
  });
  el.innerHTML = html;
}

function filtrarSaida() { if (!dadosEstoque) return; var termo = document.getElementById('saidaSearch').value.toLowerCase().trim(); if (!termo) { renderSaidaList(dadosEstoque.produtos); return; } var filtrados = dadosEstoque.produtos.filter(function (p) { return (p.nome.toLowerCase().indexOf(termo) > -1 || p.marca.toLowerCase().indexOf(termo) > -1 || p.setor.toLowerCase().indexOf(termo) > -1 || (p.codigoBarras && p.codigoBarras.indexOf(termo) > -1)) && p.quantidade > 0; }); renderSaidaList(filtrados); }
function adicionarAoCarrinho(linha) {
  if (!dadosEstoque) return; var p = dadosEstoque.produtos.find(function(x) { return x.linha === linha; }); if (!p) return; var itemExistente = carrinhoSaida.find(function(x) { return x.linha === linha; });
  if (itemExistente) { if (itemExistente.quantidade + 1 > p.quantidade) { toast('Estoque insuficiente!'); return; } itemExistente.quantidade++; } else { if (p.quantidade < 1) { toast('Estoque zerado.'); return; } carrinhoSaida.push({ linha: p.linha, nome: p.nome, quantidade: 1, max: p.quantidade, unidade: p.unidade }); } toast(p.nome + ' adicionado!'); renderCarrinho();
}
function alterarQtdCarrinho(linha, delta) { var item = carrinhoSaida.find(function(x) { return x.linha === linha; }); if (!item) return; item.quantidade += delta; if (item.quantidade > item.max) item.quantidade = item.max; if (item.quantidade <= 0) carrinhoSaida = carrinhoSaida.filter(function(x) { return x.linha !== linha; }); renderCarrinho(); }
function renderCarrinho() {
  var area = document.getElementById('carrinhoArea'); var list = document.getElementById('cartList'); var count = document.getElementById('cartCount'); if (carrinhoSaida.length === 0) { area.style.display = 'none'; return; }
  area.style.display = 'block'; count.textContent = carrinhoSaida.length; var h = '';
  carrinhoSaida.forEach(function(item) { h += '<div class="cart-item"><div class="cart-info"><strong>' + escapeHtml(item.nome) + '</strong><small>Estoque: ' + item.max + ' ' + item.unidade + '</small></div><div class="cart-controls"><button onclick="alterarQtdCarrinho(' + item.linha + ', -1)">-</button><span>' + item.quantidade + '</span><button onclick="alterarQtdCarrinho(' + item.linha + ', 1)">+</button></div></div>'; }); list.innerHTML = h;
}

function confirmarSaidaLote() {
  if (carrinhoSaida.length === 0) return; var btn = document.getElementById('btnConfirmarLote'); 
  var motivoInput = document.getElementById('loteMotivoSelect') || document.getElementById('loteMotivo');
  var obsInput = document.getElementById('loteMotivoObs');
  var motivoValue = motivoInput ? motivoInput.value : 'SAÍDA'; 
  var motivoFinal = motivoValue;
  var destino = obsInput && obsInput.value.trim() !== '' ? obsInput.value.trim() : 'Não informado';
  if (destino !== 'Não informado') { motivoFinal += ' - ' + destino; }
  
  if(btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  
  var itensParaRomaneio = JSON.parse(JSON.stringify(carrinhoSaida));
  var itensPayload = carrinhoSaida.map(function(i) { return { linha: i.linha, quantidade: i.quantidade, motivo: motivoFinal }; });
  
  carrinhoSaida.forEach(function(item) {
      var p = dadosEstoque.produtos.find(function(x) { return x.linha === item.linha; });
      if(p) p.quantidade -= item.quantidade; 
  });
  
  carrinhoSaida = [];
  if(motivoInput) motivoInput.value = 'SAÍDA DE PEDIDO';
  if(obsInput) obsInput.value = '';
  renderCarrinho(); renderSaidaList(dadosEstoque.produtos); renderPainel(dadosEstoque);
  
  if (motivoValue === 'SAÍDA DE PEDIDO') {
      showSuccess('🖨️', 'Pedido Separado!', 'Gerando comprovante de entrega...');
      gerarComprovantePedido(itensParaRomaneio, destino);
  } else {
      showSuccess('📤', 'Baixa Concluída!', 'Estoque atualizado.');
  }

  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'saidaLote', colaborador: sessao.nome, nome: sessao.nome, itens: itensPayload }), redirect: 'follow' })
    .then(function (r) { return r.json(); }).then(function (d) { syncDados(); })
    .catch(function () { toast('Sincronizando em 2º plano...'); })
    .finally(function () { if(btn) { btn.disabled = false; btn.textContent = '✅ Confirmar Baixa Total'; }});
}

function renderAuditoriaList(produtos) {
  var el = document.getElementById('auditoriaList');
  if (!produtos || produtos.length === 0) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">🕵️</div><div class="empty-text">Nenhum produto disponível</div></div>'; return; }

  var grupos = {};
  var ordem = [];
  produtos.forEach(function(p) {
    var chave = (p.nome + '_' + p.marca).toUpperCase();
    if (!grupos[chave]) {
      grupos[chave] = { nome: p.nome, marca: p.marca, setor: p.setor, linhas: [] };
      ordem.push(chave);
    }
    grupos[chave].linhas.push(p.linha);
  });

  var html = '';
  ordem.forEach(function(chave) {
    var g = grupos[chave];
    var linhaPrincipal = g.linhas[0];
    html += '<div class="saida-card" onclick="abrirAuditoriaModal(' + linhaPrincipal + ')"><div class="saida-icon" style="background:var(--purple); color:#fff;">🕵️</div><div class="saida-info"><div class="saida-nome">' + escapeHtml(g.nome) + '</div><div class="saida-meta">' + escapeHtml(g.marca) + ' • ' + escapeHtml(g.setor) + '</div></div><button class="saida-btn" style="background:var(--purple-soft); color:var(--purple);">Auditar</button></div>';
  });
  el.innerHTML = html;
}

function filtrarAuditoria() { if (!dadosEstoque) return; var termo = document.getElementById('auditoriaSearch').value.toLowerCase().trim(); if (!termo) { renderAuditoriaList(dadosEstoque.produtos); return; } var filtrados = dadosEstoque.produtos.filter(function (p) { return p.nome.toLowerCase().indexOf(termo) > -1 || p.marca.toLowerCase().indexOf(termo) > -1 || p.setor.toLowerCase().indexOf(termo) > -1 || (p.codigoBarras && p.codigoBarras.indexOf(termo) > -1); }); renderAuditoriaList(filtrados); }
function abrirAuditoriaModal(linha) {
  if (!dadosEstoque) return; var p = dadosEstoque.produtos.find(function(x) { return x.linha === linha; }); if (!p) return; document.getElementById('auditoriaProdNome').textContent = p.nome; document.getElementById('auditoriaProdSetor').textContent = p.marca + ' • ' + p.setor; document.getElementById('auditoriaProdLinha').value = linha; document.getElementById('auditoriaQtdFisica').value = ''; document.getElementById('auditoriaModal').classList.add('show');
}
function fecharAuditoria() { document.getElementById('auditoriaModal').classList.remove('show'); }

function enviarAuditoria() {
  var btn = document.getElementById('btnSalvarAuditoria'); var qtdStr = document.getElementById('auditoriaQtdFisica').value; if (qtdStr === '') { toast('Informe a quantidade'); return; }
  var qtd = parseFloat(qtdStr); var linha = parseInt(document.getElementById('auditoriaProdLinha').value); btn.disabled = true; btn.textContent = 'Verificando...';
  
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'auditoria', linha: linha, qtdFisica: qtd, nome: sessao.nome }), redirect: 'follow' })
    .then(function (r) { return r.json(); }).then(function (d) {
      if (d.status === 'ok') { 
        fecharAuditoria(); 
        if (d.match) { showSuccess('✅', 'Tudo Certo!', d.msg); } 
        else { 
          var resp = confirm('⚠️ Divergência Detectada!\n\nA prateleira tem ' + qtd + ' itens, mas o sistema esperava ' + (qtd - d.diferenca) + '.\n\nDeseja que o App AJUSTE O SALDO da planilha agora?');
          if(resp) {
            var prod = dadosEstoque.produtos.find(function(x){ return x.linha === linha; });
            if(prod) prod.quantidade = qtd;
            renderPainel(dadosEstoque);
            showSuccess('🔄', 'Estoque Ajustado!', 'O saldo corrigido para ' + qtd + '.');
            fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'ajusteAuditoria', linha: linha, quantidade: qtd, nome: sessao.nome }), redirect: 'follow' }).then(syncDados);
          } else { showSuccess('⚠️', 'Apenas Registrado', 'A diferença foi enviada ao Gestor.'); }
        } 
      } else { toast(d.msg || 'Erro'); }
    }).catch(function () { toast('Sem conexão'); }).finally(function () { btn.disabled = false; btn.textContent = 'Verificar Divergência'; });
}

function enviarEntrada() {
  var produto = document.getElementById('entProduto').value.trim(); var qtd = document.getElementById('entQtd').value; if (!produto) { toast('Informe o nome do produto'); return; } if (!qtd || parseFloat(qtd) <= 0) { toast('Informe a quantidade'); return; } var btn = document.getElementById('btnEntrada'); btn.disabled = true; btn.textContent = 'Registando...';
  
  var payload = { acao: 'entrada', colaborador: sessao.nome, nome: sessao.nome, setor: document.getElementById('entSetor').value, produto: produto, marca: document.getElementById('entMarca').value.trim(), quantidade: qtd, unidade: document.getElementById('entUnidade').value, validade: document.getElementById('entValidade').value, lote: document.getElementById('entLote').value.trim(), observacoes: document.getElementById('entObs').value.trim(), codigoBarras: document.getElementById('entCodigoBarras').value.trim(), foto: fotoData };
  
  if(!dadosEstoque.produtos) dadosEstoque.produtos = [];
  dadosEstoque.produtos.unshift({
    linha: Date.now(), 
    nome: produto, marca: payload.marca, setor: payload.setor,
    quantidade: parseFloat(qtd), unidade: payload.unidade,
    status: 'OK', validade: payload.validade, lote: payload.lote, codigoBarras: payload.codigoBarras
  });
  dadosEstoque = limparDuplicatasZeradas(dadosEstoque);
  renderPainel(dadosEstoque);

  showSuccess('📦', 'Produto Registrado!', produto + ' adicionado.');
  limparFormEntrada(); switchTab('painel');
  
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' })
    .then(function (r) { return r.json(); }).then(function (d) { syncDados(); })
    .catch(function () { toast('Sincronizando no servidor...'); })
    .finally(function () { btn.disabled = false; btn.textContent = 'Salvar Entrada'; });
}

function limparFormEntrada() { document.getElementById('entCodigoBarras').value = ''; document.getElementById('entSetor').value = ''; document.getElementById('entProduto').value = ''; document.getElementById('entMarca').value = ''; document.getElementById('entQtd').value = ''; document.getElementById('entUnidade').value = 'UN'; document.getElementById('entValidade').value = ''; document.getElementById('entLote').value = ''; document.getElementById('entObs').value = ''; resetarFoto(); document.getElementById('areaCameraEntrada').style.display = 'none'; document.getElementById('btnRevelarCamera').style.display = 'flex'; }
function mostrarCameraEntrada() { document.getElementById('btnRevelarCamera').style.display = 'none'; document.getElementById('areaCameraEntrada').style.display = 'block'; initFotoCamera(); }
function initFotoCamera() { if (fotoStream) return; var video = document.getElementById('fotoVideo'); if (!video) return; navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 480, height: 480 } }).then(function (s) { fotoStream = s; video.srcObject = s; }).catch(function () { }); }
function capturarFoto() { var v = document.getElementById('fotoVideo'); var c = document.getElementById('fotoCanvas'); c.width = 480; c.height = 480; c.getContext('2d').drawImage(v, 0, 0, 480, 480); fotoData = c.toDataURL('image/jpeg', 0.5); v.style.display = 'none'; c.style.display = 'block'; document.getElementById('btnFotoCapture').style.display = 'none'; document.getElementById('btnFotoReset').style.display = ''; document.getElementById('fotoOk').style.display = 'block'; }
function resetarFoto() { var v = document.getElementById('fotoVideo'); var c = document.getElementById('fotoCanvas'); if (v) v.style.display = 'block'; if (c) c.style.display = 'none'; var btnCap = document.getElementById('btnFotoCapture'); var btnRst = document.getElementById('btnFotoReset'); var okEl = document.getElementById('fotoOk'); if (btnCap) btnCap.style.display = ''; if (btnRst) btnRst.style.display = 'none'; if (okEl) okEl.style.display = 'none'; fotoData = ''; }
function stopFotoCamera() { if (fotoStream) { fotoStream.getTracks().forEach(function (t) { t.stop(); }); fotoStream = null; } }

function toggleRelatorio() {
  if (relatorioAtivo) { fecharRelatorio(); return; } toast('Carregando dados...'); 
  if (dadosEstoque && dadosEstoque.produtos && dadosEstoque.produtos.length > 0) gerarRelatorio(); else mostrarRelatorioVazio();
}
function mostrarRelatorioVazio() {
  relatorioAtivo = true; var sw = document.getElementById('switchRelatorio'); if (sw) sw.classList.add('on');
  var overlay = document.getElementById('relatorioOverlay'); if (!overlay) { overlay = document.createElement('div'); overlay.id = 'relatorioOverlay'; document.body.appendChild(overlay); }
  overlay.innerHTML = '<div class="rel-toolbar no-print"><button class="rel-toolbar-btn close" onclick="fecharRelatorio()">Fechar</button></div><div class="rel-container"><div class="rel-header"><div class="rel-logo">ESTOQUE DIGITAL</div><div class="rel-empresa">Grupo Carlos Vaz — CRV/LAS</div></div><div class="rel-empty"><div class="rel-empty-icon">📋</div><div class="rel-empty-title">Sem dados na planilha</div></div></div>'; overlay.classList.add('show');
}
function gerarRelatorio() {
  relatorioAtivo = true; var sw = document.getElementById('switchRelatorio'); if (sw) sw.classList.add('on');
  var produtos = dadosEstoque.produtos; var hoje = new Date(); var dataStr = String(hoje.getDate()).padStart(2, '0') + '/' + String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear(); var horaStr = String(hoje.getHours()).padStart(2, '0') + ':' + String(hoje.getMinutes()).padStart(2, '0');
  var vencidos = []; var criticos = []; var atencao = []; var monitorar = []; var zerados = []; var todos = []; var porSetor = {};
  produtos.forEach(function (p) { todos.push(p); var setor = p.setor || 'SEM SETOR'; if (!porSetor[setor]) porSetor[setor] = []; porSetor[setor].push(p); if (p.quantidade === 0) zerados.push(p); if (p.status === 'VENCIDO') vencidos.push(p); else if (p.status === 'CRÍTICO') criticos.push(p); else if (p.status === 'ATENÇÃO') atencao.push(p); else if (p.status === 'MONITORAR') monitorar.push(p); });
  function sortByDias(a, b) { var da = (a.diasVencer !== '' && a.diasVencer !== null && a.diasVencer !== undefined) ? a.diasVencer : 9999; var db = (b.diasVencer !== '' && b.diasVencer !== null && b.diasVencer !== undefined) ? b.diasVencer : 9999; return da - db; }
  vencidos.sort(sortByDias); criticos.sort(sortByDias); atencao.sort(sortByDias); monitorar.sort(sortByDias);

  var html = '<div class="rel-container"><div class="rel-header"><div class="rel-logo">ESTOQUE DIGITAL</div><div class="rel-empresa">Grupo Carlos Vaz — CRV/LAS</div><div class="rel-data">Relatório gerado em ' + dataStr + ' às ' + horaStr + ' por ' + (sessao ? sessao.nome : '—') + '</div></div><div class="rel-summary">';
  html += buildRelSummaryCard('Total de Produtos', todos.length, 'blue') + buildRelSummaryCard('Estoque Zerado', zerados.length, 'red') + buildRelSummaryCard('Vencidos', vencidos.length, 'red') + buildRelSummaryCard('Críticos (≤7d)', criticos.length, 'orange') + buildRelSummaryCard('Atenção (≤30d)', atencao.length, 'yellow') + buildRelSummaryCard('Monitorar (≤60d)', monitorar.length, 'blue') + '</div>';
  if (vencidos.length > 0) html += buildRelSection('❌ Produtos Vencidos', vencidos, 'vencido');
  if (criticos.length > 0) html += buildRelSection('🔴 Produtos Críticos — Vencem em até 7 dias', criticos, 'critico');
  if (atencao.length > 0) html += buildRelSection('🟡 Produtos em Atenção — Vencem em até 30 dias', atencao, 'atencao');
  if (monitorar.length > 0) html += buildRelSection('🔵 Produtos para Monitorar — Vencem em até 60 dias', monitorar, 'monitorar');
  if (zerados.length > 0) { html += '<div class="rel-section"><div class="rel-section-title zero">🚫 Estoque Zerado</div>'; var zeradosPorSetor = {}; zerados.forEach(function (p) { var s = p.setor || 'SEM SETOR'; if (!zeradosPorSetor[s]) zeradosPorSetor[s] = []; zeradosPorSetor[s].push(p); }); Object.keys(zeradosPorSetor).sort().forEach(function (setor) { html += '<div class="rel-setor-group"><div class="rel-setor-name">' + escapeHtml(setor) + '</div>' + buildRelTable(zeradosPorSetor[setor], false) + '</div>'; }); html += '</div>'; }
  html += '<div class="rel-section"><div class="rel-section-title all">📦 Inventário Completo por Setor</div>';
  Object.keys(porSetor).sort().forEach(function (setor) { html += '<div class="rel-setor-group"><div class="rel-setor-name">' + escapeHtml(setor) + ' <span class="rel-setor-count">(' + porSetor[setor].length + ' produtos)</span></div>' + buildRelTable(porSetor[setor], true) + '</div>'; });
  html += '</div><div class="rel-footer">Estoque Digital — Grupo Carlos Vaz · ' + dataStr + '</div></div>';

  var overlay = document.getElementById('relatorioOverlay'); if (!overlay) { overlay = document.createElement('div'); overlay.id = 'relatorioOverlay'; document.body.appendChild(overlay); }
  overlay.innerHTML = '<div class="rel-toolbar no-print"><button class="rel-toolbar-btn" onclick="imprimirRelatorio()">🖨️ Imprimir</button><button class="rel-toolbar-btn close" onclick="fecharRelatorio()">✕ Fechar</button></div>' + html;
  overlay.classList.add('show'); overlay.scrollTop = 0;
}
function buildRelSection(title, items, cls) { var html = '<div class="rel-section"><div class="rel-section-title ' + cls + '">' + title + '</div>'; var grouped = {}; items.forEach(function (p) { var s = p.setor || 'SEM SETOR'; if (!grouped[s]) grouped[s] = []; grouped[s].push(p); }); Object.keys(grouped).sort().forEach(function (setor) { html += '<div class="rel-setor-group"><div class="rel-setor-name">' + escapeHtml(setor) + '</div>' + buildRelTable(grouped[setor], true) + '</div>'; }); return html + '</div>'; }
function buildRelTable(items, showDias) { var html = '<table class="rel-table"><thead><tr><th>Produto</th><th>Marca</th><th>Qtd</th><th>Un</th><th>Validade</th>' + (showDias ? '<th>Dias</th>' : '') + '<th>Status</th><th>Lote</th></tr></thead><tbody>'; items.forEach(function (p) { var statusCls = getStatusClass(p.status, p.quantidade); var diasTxt = '—'; if (p.diasVencer !== '' && p.diasVencer !== null && p.diasVencer !== undefined) diasTxt = p.diasVencer + 'd'; html += '<tr><td class="rel-td-nome">' + escapeHtml(p.nome) + '</td><td>' + escapeHtml(p.marca) + '</td><td class="rel-td-num ' + (p.quantidade === 0 ? 'zero' : '') + '">' + p.quantidade + '</td><td>' + escapeHtml(p.unidade) + '</td><td>' + escapeHtml(p.validade || '—') + '</td>' + (showDias ? '<td class="rel-td-num rel-dias-' + statusCls + '">' + diasTxt + '</td>' : '') + '<td><span class="rel-status-badge ' + statusCls + '">' + (p.quantidade === 0 ? 'SEM ESTOQUE' : (p.status || 'OK')) + '</span></td><td>' + escapeHtml(p.lote || '—') + '</td></tr>'; }); return html + '</tbody></table>'; }
function buildRelSummaryCard(label, value, color) { return '<div class="rel-stat-card ' + color + '"><div class="rel-stat-val">' + value + '</div><div class="rel-stat-lbl">' + label + '</div></div>'; }
function imprimirRelatorio() { window.print(); }
function fecharRelatorio() { relatorioAtivo = false; var sw = document.getElementById('switchRelatorio'); if (sw) sw.classList.remove('on'); var overlay = document.getElementById('relatorioOverlay'); if (overlay) overlay.classList.remove('show'); }

function showSuccess(icon, msg, detail) { document.getElementById('successIcon').textContent = icon; document.getElementById('successMsg').textContent = msg; document.getElementById('successDetail').textContent = detail || ''; var ov = document.getElementById('successOverlay'); ov.classList.add('show'); setTimeout(function () { ov.classList.remove('show'); }, 3000); }
function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 3500); }
function escapeHtml(str) { if (!str) return ''; return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function gerarComprovantePedido(itens, destino) {
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
  html += '<strong>Destino / Obra:</strong> <span style="font-size: 16px; font-weight: 700; text-transform: uppercase;">' + escapeHtml(destino) + '</span><br></div>';
  html += '<table style="width: 100%; border-collapse: collapse; margin-bottom: 40px; font-size: 14px;">';
  html += '<thead><tr style="background: #eee; border-bottom: 2px solid #000;"><th style="padding: 12px 8px; text-align: left;">Qtd</th><th style="padding: 12px 8px; text-align: left;">Un</th><th style="padding: 12px 8px; text-align: left;">Produto</th><th style="padding: 12px 8px; text-align: center;">Conferido</th></tr></thead><tbody>';

  itens.forEach(function(item) {
    html += '<tr style="border-bottom: 1px solid #ddd;">';
    html += '<td style="padding: 12px 8px; font-weight: 800; font-size: 16px;">' + item.quantidade + '</td>';
    html += '<td style="padding: 12px 8px; color: #555;">' + escapeHtml(item.unidade) + '</td>';
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
  setTimeout(function() { window.print(); }, 1000);
}

// ══════════════ MOTOR DOS BALÕES DE AJUDA (MOBILE TOUCH) ══════════════
document.addEventListener('click', function(e) {
  if (!e.target.classList.contains('help-icon')) { document.querySelectorAll('.tooltip-balloon').forEach(b => b.remove()); document.querySelectorAll('.help-icon.active').forEach(i => i.classList.remove('active')); return; }
  var icon = e.target;
  if (icon.classList.contains('active')) { icon.classList.remove('active'); document.querySelectorAll('.tooltip-balloon').forEach(b => b.remove()); return; }
  document.querySelectorAll('.tooltip-balloon').forEach(b => b.remove()); document.querySelectorAll('.help-icon.active').forEach(i => i.classList.remove('active'));
  icon.classList.add('active'); var texto = icon.getAttribute('data-tooltip'); var balloon = document.createElement('div'); balloon.className = 'tooltip-balloon'; balloon.textContent = texto; document.body.appendChild(balloon);
  var rect = icon.getBoundingClientRect(); balloon.style.left = (rect.left + (rect.width / 2)) + 'px'; balloon.style.top = (rect.top - balloon.offsetHeight - 10) + 'px';
});
