// Kafmonde : le jeu du site dans sa propre fenêtre.
// Le jeu reste en ligne : ses mises à jour arrivent sans réinstaller (bouton ⟳ du jeu, ou F5).
// Seule cette fenêtre (ce dossier) a besoin d'un nouvel installeur ; elle se met à jour toute seule
// depuis les Releases GitHub (immigreproduction-del/kafmonde, voir LISEZMOI.md).
const { app, BrowserWindow, Menu, dialog, ipcMain, net, screen, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SITE = "https://immigreprod.pages.dev";
// --adresse=… : l'appli sur un autre Kafmonde (le banc de test local, voir npm run local).
const flag = process.argv.find((arg) => arg.startsWith("--adresse="));
const GAME = new URL(flag ? flag.slice("--adresse=".length) : `${SITE}/monde/`);
const ORIGIN = GAME.origin;
// Les pages de l'appli : la connexion au kompte et « hors ligne ».
const LOGIN = path.join(__dirname, "connexion.html");
const OFFLINE = path.join(__dirname, "hors-ligne.html");
const BACKGROUND = "#0d0a16";
const UPDATE_EVERY = 6 * 3600 * 1000;

let win = null;

// ---------------------------------------------------------------- IPv4 pour le site et le serveur du jeu
// Chez certains opérateurs (Free), la route IPv6 vers Cloudflare rame : 1 à 3 s par aller-retour au lieu
// de 30 ms en IPv4. On résout donc ces deux adresses en IPv4 avant le démarrage (la règle doit être posée
// avant que Chromium ne s'en serve) ; si la résolution échoue, rien ne change.
const SERVERS = ["immigreprod.pages.dev", "immigre-online.immigre-online.workers.dev"];
function forceIPv4() {
  try {
    const script = `const dns=require("dns");Promise.all(${JSON.stringify(SERVERS)}.map((h)=>dns.promises.resolve4(h).then((a)=>[h,a[0]]).catch(()=>null))).then((r)=>process.stdout.write(JSON.stringify(r.filter(Boolean))))`;
    const out = require("node:child_process").execFileSync(process.execPath, ["-e", script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 4000, windowsHide: true });
    const rules = JSON.parse(String(out)).filter(([, ip]) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)).map(([host, ip]) => `MAP ${host} ${ip}`);
    if (rules.length) app.commandLine.appendSwitch("host-resolver-rules", rules.join(","));
  } catch {}
}
if (!flag) forceIPv4();

// ---------------------------------------------------------------- où l'on peut aller dans la fenêtre
const parse = (url) => { try { return new URL(url); } catch { return null; } };
const inGame = (url) => url?.origin === ORIGIN && url.pathname.startsWith("/monde");
const page = (url) => (url?.protocol === "file:" ? path.basename(decodeURIComponent(url.pathname)) : "");
const isOffline = (url) => page(url) === "hors-ligne.html";
const isAppPage = (url) => isOffline(url) || page(url) === "connexion.html";
const allowed = (url) => inGame(url) || isAppPage(url);
// Tout le reste (le site, les liens) s'ouvre dans le vrai navigateur.
function outside(raw) {
  const url = parse(raw);
  if (url && (url.protocol === "https:" || url.protocol === "http:")) shell.openExternal(url.href);
}

// ---------------------------------------------------------------- taille et place de la fenêtre
const STATE = () => path.join(app.getPath("userData"), "fenetre.json");
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE(), "utf8")) || {}; } catch { return {}; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  const state = { bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen(), zoom: win.webContents.getZoomLevel() };
  try { fs.writeFileSync(STATE(), JSON.stringify(state)); } catch {}
}
// Une place gardée sur un écran débranché depuis : on repart au milieu de l'écran principal.
function onScreen(bounds) {
  return Boolean(bounds) && screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width - 80 && bounds.x + bounds.width > a.x + 80 && bounds.y >= a.y - 20 && bounds.y < a.y + a.height - 80);
}

// ---------------------------------------------------------------- connexion au kompte
// Le jeu sans kompte s'arrête sur « Konnection requise » : l'appli montre plutôt sa page de connexion,
// puis revient au jeu. En cas de doute (le site ne répond pas), on reste dans le jeu.
async function connected() {
  try {
    // Seulement depuis le jeu lui-même (pas depuis une page d'erreur qui serait encore affichée).
    return await win.webContents.executeJavaScript(`!location.pathname.startsWith("/monde") || !location.protocol.startsWith("http") ? true
      : fetch("/api/community?view=session", { credentials: "same-origin", cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null)).then((data) => !data || data.authenticated !== false).catch(() => true)`);
  } catch { return true; }
}
// Connexion ou création du kompte, comme le fait le site : le cookie de session reste dans l'appli.
function account(action, username, password) {
  return new Promise((resolve) => {
    const request = net.request({ method: "POST", url: new URL("/api/community", ORIGIN).href, useSessionCookies: true });
    request.setHeader("Content-Type", "application/json");
    let text = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        let data = {};
        try { data = JSON.parse(text); } catch {}
        if (response.statusCode < 300 && data.ok) resolve({ ok: true, name: data.user?.username || username });
        else resolve({ error: data.error || (response.statusCode === 429 ? "Trop d'essais : attends quelques minutes." : "Le site n'a pas répondu comme prévu.") });
      });
    });
    request.on("error", () => resolve({ error: "Pas de connexion au site. Vérifie internet." }));
    request.end(JSON.stringify({ action, username: String(username || "").slice(0, 24), password: String(password || "").slice(0, 200) }));
  });
}
ipcMain.handle("kafmonde:compte", async (event, { action, username, password } = {}) => {
  if (!isAppPage(parse(event.senderFrame?.url)) || !["login", "register"].includes(action)) return { error: "Action refusée." };
  const result = await account(action, username, password);
  if (result.ok) setTimeout(() => win?.webContents.loadURL(GAME.href), 350);
  return result;
});

// ---------------------------------------------------------------- touches
function keys(event, input) {
  if (input.type !== "keyDown") return;
  const wc = win.webContents, ctrl = input.control || input.meta, key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const act = (fn) => { event.preventDefault(); fn(); };
  if (key === "F5" || (ctrl && key === "r")) act(() => reload(input.shift || (ctrl && key === "F5")));
  else if (key === "F11") act(() => win.setFullScreen(!win.isFullScreen()));
  else if (ctrl && (key === "+" || key === "=")) act(() => wc.setZoomLevel(Math.min(3, wc.getZoomLevel() + 0.5)));
  else if (ctrl && key === "-") act(() => wc.setZoomLevel(Math.max(-3, wc.getZoomLevel() - 0.5)));
  else if (ctrl && key === "0") act(() => wc.setZoomLevel(0));
  else if (key === "F12" || (ctrl && input.shift && key === "i")) act(() => wc.toggleDevTools());
}
function reload(hard = false) {
  const wc = win.webContents;
  if (isAppPage(parse(wc.getURL()))) wc.loadURL(GAME.href);
  else if (hard) wc.reloadIgnoringCache();
  else wc.reload();
}

// ---------------------------------------------------------------- la fenêtre
function createWindow() {
  const saved = loadState();
  win = new BrowserWindow({
    width: 1280, height: 800, ...(onScreen(saved.bounds) ? saved.bounds : {}),
    minWidth: 640, minHeight: 480, show: false, title: "Kafmonde", backgroundColor: BACKGROUND,
    icon: path.join(__dirname, "build", "icon.png"), autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, autoplayPolicy: "no-user-gesture-required",
    },
  });
  if (saved.maximized) win.maximize();
  if (saved.fullscreen) win.setFullScreen(true);
  win.show();

  const wc = win.webContents;
  wc.on("before-input-event", keys);
  wc.on("will-navigate", (event, url) => { if (!allowed(parse(url))) { event.preventDefault(); outside(url); } });
  wc.on("will-redirect", (event, url) => { if (!allowed(parse(url))) { event.preventDefault(); outside(url); } });
  wc.setWindowOpenHandler(({ url }) => { outside(url); return { action: "deny" }; });
  // Pas de réseau, site injoignable : une petite page qui réessaie toute seule.
  wc.on("did-fail-load", (event, code, description, url, mainFrame) => {
    if (!mainFrame || code === -3 || isOffline(parse(url))) return; // -3 : remplacé par une autre navigation
    wc.loadFile(OFFLINE, { query: { u: allowed(parse(url)) ? url : GAME.href } });
  });
  // Le zoom gardé, remis une fois sur le jeu (il suit ensuite les rechargements).
  let zoom = Number.isFinite(saved.zoom) ? saved.zoom : null;
  wc.on("did-finish-load", async () => {
    const url = parse(wc.getURL());
    if (zoom !== null && inGame(url)) { wc.setZoomLevel(zoom); zoom = null; }
    if (inGame(url) && !(await connected()) && inGame(parse(wc.getURL()))) wc.loadFile(LOGIN);
  });
  // Copier-coller au clic droit dans le tchat ; rien sur le jeu.
  wc.on("context-menu", (event, params) => {
    const items = params.isEditable
      ? [{ role: "cut", label: "Couper" }, { role: "copy", label: "Copier" }, { role: "paste", label: "Coller" }, { type: "separator" }, { role: "selectAll", label: "Tout sélectionner" }]
      : params.selectionText.trim() ? [{ role: "copy", label: "Copier" }] : [];
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  let saveTimer = 0;
  const later = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 800); };
  for (const name of ["resize", "move", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) win.on(name, later);
  wc.on("zoom-changed", later);
  win.on("close", saveState);
  win.on("closed", () => { win = null; });

  wc.loadURL(GAME.href);
}

// ---------------------------------------------------------------- mises à jour de l'appli
// Elle lit latest.yml dans la dernière Release GitHub ; sans réseau ou sans Release, rien ne se passe.
function updates() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", () => {});
  autoUpdater.on("update-downloaded", async (info) => {
    if (!win) return;
    const { response } = await dialog.showMessageBox(win, {
      type: "info", title: "Kafmonde", buttons: ["Redémarrer", "Plus tard"], defaultId: 0, cancelId: 1,
      message: `La version ${info.version} de l'appli Kafmonde est prête.`,
      detail: "Elle s'installe en redémarrant l'appli, ou toute seule la prochaine fois que tu la fermes.",
    });
    if (response === 0) autoUpdater.quitAndInstall(true, true);
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_EVERY);
}

// ---------------------------------------------------------------- démarrage
// Une seule fenêtre : relancer l'appli ramène celle qui est ouverte.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId("fr.immigreprod.kafmonde");
  Menu.setApplicationMenu(null);
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(() => {
    // Le jeu n'a besoin ni du micro, ni de la caméra, ni de la position.
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(["fullscreen", "clipboard-sanitized-write"].includes(permission)));
    createWindow();
    updates();
  });
  app.on("window-all-closed", () => app.quit());
}
