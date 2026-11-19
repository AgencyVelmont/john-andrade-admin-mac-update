// John Andrade Admin — lógica do app (esta parte se atualiza sozinha pelo Git; ver atualizador.js e main.js).
// Janela própria para o admin que já está no ar (login normal) + aviso nativo de lead novo, com som.
const { app, BrowserWindow, Menu, Notification, dialog, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { decide, texto } = require('./aviso');
const PUB = require('./config-publica.json');          // chave pública (anon) do Supabase: a mesma que o admin já traz no navegador

const URL_ADMIN = 'https://admin.johnandradecorretor.com.br/';
const ORIGEM = new URL(URL_ADMIN).origin;
const INTERVALO_MS = 45 * 1000;
const SONS = { brilho: 'Brilho', sucesso: 'Sucesso', mensagem: 'Mensagem' };
const ARQ_SOM = { brilho: 'sons/brilho.wav', sucesso: 'sons/sucesso.wav', mensagem: 'sons/mensagem.mp3' };

let ctx = { bundle: __dirname, versao: 0, verificaAtualizacao: null };
let janela = null, somJanela = null, saindo = false, naoLidos = 0, ultimoReload = 0, iniciado = false;

// ---------- configuração e registro (pasta de dados do app, no Mac do John) ----------
const ARQ_CFG = () => path.join(app.getPath('userData'), 'config.json');
const ARQ_LOG = () => path.join(app.getPath('userData'), 'registro.txt');
let cfg = { avisar: true, som: 'brilho', visto: { ultimo: null, ids: [] } };
function leCfg() { try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(ARQ_CFG(), 'utf8')) }; } catch (_) {} }
function salvaCfg() { try { fs.writeFileSync(ARQ_CFG(), JSON.stringify(cfg, null, 1)); } catch (_) {} }
function log(msg) {
  try {
    const f = ARQ_LOG(); let antigo = '';
    try { antigo = fs.readFileSync(f, 'utf8'); } catch (_) {}
    const linhas = (antigo + new Date().toISOString() + ' ' + msg + '\n').split('\n'); if (linhas.length > 400) linhas.splice(0, linhas.length - 400);
    fs.writeFileSync(f, linhas.join('\n'));
  } catch (_) {}
}

// ---------- som ----------
function tocaSom(nome) {
  const arq = ARQ_SOM[nome]; if (!arq) return;
  if (!somJanela || somJanela.isDestroyed()) {
    somJanela = new BrowserWindow({ show: false, webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false, sandbox: true } });
    somJanela.loadFile(path.join(ctx.bundle, 'som.html'));
  }
  const toca = () => somJanela.webContents.executeJavaScript(`tocar(${JSON.stringify(arq)})`).catch((e) => log('som falhou: ' + e.message));
  if (somJanela.webContents.isLoading()) somJanela.webContents.once('did-finish-load', toca); else toca();
}

// ---------- notificação nativa do macOS ----------
function avisa(titulo, corpo, leadId, teste) {
  if (!Notification.isSupported()) {
    log('Notification.isSupported() = false');
    if (teste) dialog.showMessageBox({ type: 'warning', message: 'Este Mac não está aceitando notificações do app.', detail: 'Abra Ajustes do Sistema > Notificações > John Andrade Admin e permita.' });
    return;
  }
  const usaSistema = cfg.som === 'sistema';
  const n = new Notification({ title: titulo, body: corpo, silent: !usaSistema, sound: usaSistema ? 'Glass' : undefined });
  n.on('show', () => log('notificação mostrada: ' + titulo));
  n.on('failed', (_e, erro) => {
    log('notificação FALHOU: ' + erro);
    dialog.showMessageBox({ type: 'warning', message: 'O Mac não deixou mostrar a notificação.', detail: 'Abra Ajustes do Sistema > Notificações > John Andrade Admin, ligue "Permitir notificações" e use de novo Avisos > Testar aviso.\n\nDetalhe: ' + erro });
  });
  n.on('click', () => { mostra(leadId ? ORIGEM + '/leads?lead=' + encodeURIComponent(leadId) : null); });
  n.show();
  if (!usaSistema && cfg.som !== 'nenhum') tocaSom(cfg.som);
  if (process.platform === 'darwin' && app.dock) { naoLidos += 1; app.dock.setBadge(String(naoLidos)); }
}

// ---------- busca de leads novos ----------
async function tokenDoAdmin() {
  if (!janela || janela.isDestroyed()) return null;
  try {
    return await janela.webContents.executeJavaScript(
      `(() => { for (const k of Object.keys(localStorage)) { if (/^sb-.*-auth-token$/.test(k)) { try { return JSON.parse(localStorage.getItem(k)).access_token || null; } catch (e) {} } } return null; })()`);
  } catch (_) { return null; }
}
async function confere() {
  if (!cfg.avisar) return;
  const token = await tokenDoAdmin();
  if (!token) { log('confere: sem login ainda'); return; }
  try {
    const r = await fetch(PUB.supabaseUrl + '/rest/v1/leads?select=id,name,source,created_at,property:properties(title)&order=created_at.desc&limit=30',
      { headers: { apikey: PUB.anonKey, Authorization: 'Bearer ' + token } });
    if (r.status === 401 || r.status === 403) {
      log('confere: acesso recusado (' + r.status + ')');
      if (Date.now() - ultimoReload > 600000 && janela && !janela.isDestroyed()) { ultimoReload = Date.now(); janela.webContents.reload(); }
      return;
    }
    if (!r.ok) { log('confere: HTTP ' + r.status); return; }
    const leads = await r.json();
    const { novos, visto } = decide(leads, cfg.visto);
    cfg.visto = visto; salvaCfg();
    log('confere: ' + leads.length + ' leads lidos, ' + novos.length + ' novo(s)');
    if (novos.length) { const t = texto(novos); avisa(t.titulo, t.corpo, novos[novos.length - 1].id, false); }
  } catch (e) { log('confere: erro ' + e.message); }
}

// ---------- o cartão "Notificações de novos leads" do admin é de navegador; dentro do app os avisos são nativos ----------
const INJETA = `(() => {
  if (window.__jaApp) return; window.__jaApp = 1;
  const aplica = () => {
    for (const sec of document.querySelectorAll('section')) {
      const h = sec.querySelector('h2'); if (!h || !/Notifica..es de novos leads/i.test(h.textContent) || sec.dataset.jaApp) continue;
      const alvo = sec.querySelector('.max-w-2xl'); const botoes = sec.querySelector('.shrink-0');
      if (!alvo) continue; sec.dataset.jaApp = '1';
      alvo.innerHTML = '<p style="font-size:14px;font-weight:600;color:#014340">Avisos nativos do Mac: ligados</p><p style="margin-top:6px;font-size:12px;line-height:1.5;color:#6b7280">No aplicativo, o aviso de lead novo aparece como notificação do Mac, com som. Não precisa ativar nada aqui. Para mudar o som ou testar: menu <b>Avisos</b> no topo da tela.</p>';
      if (botoes) botoes.style.display = 'none';
    }
  };
  new MutationObserver(aplica).observe(document.body, { childList: true, subtree: true }); aplica();
})();`;

// ---------- janela ----------
function abreFora(url) {
  try { const p = new URL(url).protocol; if (p === 'https:' || p === 'mailto:' || p === 'tel:') shell.openExternal(url); } catch (_) {}
}
function mostra(url) {
  if (!janela || janela.isDestroyed()) criaJanela();
  if (url) janela.loadURL(url);
  if (janela.isMinimized()) janela.restore();
  janela.show(); janela.focus();
}
function criaJanela() {
  janela = new BrowserWindow({
    width: 1360, height: 860, minWidth: 420, minHeight: 600, title: 'John Andrade Admin', backgroundColor: '#f2f2f2',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false }
  });
  janela.loadURL(URL_ADMIN);
  janela.webContents.setWindowOpenHandler(({ url }) => { abreFora(url); return { action: 'deny' }; });
  janela.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== ORIGEM) { e.preventDefault(); abreFora(url); } });
  janela.webContents.on('did-fail-load', (_e, codigo, _d, _u, principal) => { if (principal && codigo !== -3) janela.loadFile(path.join(ctx.bundle, 'offline.html')); });
  janela.webContents.on('did-finish-load', () => { janela.webContents.executeJavaScript(INJETA).catch(() => {}); setTimeout(confere, 4000); });
  janela.on('focus', () => { naoLidos = 0; if (process.platform === 'darwin' && app.dock) app.dock.setBadge(''); });
  janela.on('close', (e) => { if (process.platform === 'darwin' && !saindo) { e.preventDefault(); janela.hide(); } });
  janela.on('closed', () => { janela = null; });
}

function menu() {
  const somItens = [
    ...Object.entries(SONS).map(([id, nome]) => ({ label: nome, type: 'radio', checked: cfg.som === id, click: () => { cfg.som = id; salvaCfg(); tocaSom(id); } })),
    { label: 'Som padrão do Mac', type: 'radio', checked: cfg.som === 'sistema', click: () => { cfg.som = 'sistema'; salvaCfg(); } },
    { label: 'Sem som', type: 'radio', checked: cfg.som === 'nenhum', click: () => { cfg.som = 'nenhum'; salvaCfg(); } }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Ver', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'forceReload', label: 'Recarregar do zero' }, { type: 'separator' }, { role: 'resetZoom', label: 'Tamanho normal' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Tela cheia' }] },
    { label: 'Avisos', submenu: [
      { label: 'Avisar quando chegar lead novo', type: 'checkbox', checked: cfg.avisar, click: (i) => { cfg.avisar = i.checked; salvaCfg(); } },
      { label: 'Som do aviso', submenu: somItens },
      { type: 'separator' },
      { label: 'Testar aviso', click: () => avisa('Novo lead (teste)', 'Maria Souza — whatsapp · Casa à venda', null, true) },
      { label: 'Abrir Ajustes de Notificações do Mac', click: () => shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension') },
      { label: 'Ver registro dos avisos', click: () => { try { shell.showItemInFolder(ARQ_LOG()); } catch (_) {} } }
    ] },
    { label: 'App', submenu: [
      { label: 'Versão do app: ' + ctx.versao, enabled: false },
      { label: 'Verificar atualização agora', click: async () => { const ok = ctx.verificaAtualizacao ? await ctx.verificaAtualizacao() : false; dialog.showMessageBox({ message: ok ? 'Atualização baixada. Feche o app (Cmd+Q) e abra de novo para usar a nova versão.' : 'Você já está com a versão mais nova.' }); } }
    ] },
    { role: 'windowMenu' }
  ]));
}

function iniciar(opcoes) {
  if (iniciado) return; iniciado = true;
  ctx = { ...ctx, ...opcoes };
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', () => mostra());
  app.on('before-quit', () => { saindo = true; });
  app.whenReady().then(() => {
    leCfg();
    log('app iniciado, versão ' + ctx.versao);
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    menu();
    criaJanela();
    setInterval(confere, INTERVALO_MS);
    app.on('activate', () => mostra());
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
module.exports = { iniciar, log };
