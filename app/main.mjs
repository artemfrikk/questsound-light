// QuestSound Light, desktop version: the same bridge as the console one (lib/bridge.mjs) in a window
// that looks like the site, with a tray icon. Closing the window keeps the bridge (and the lights) going.
// The window loads only its own files (app/ui), has no Node access and talks to this process through
// the few actions in preload.cjs.
import { app, BrowserWindow, Tray, Menu, ipcMain, clipboard, shell, nativeImage, Notification } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBridge } from '../lib/bridge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HIDDEN = process.argv.includes('--hidden'); // started with the computer: straight to the tray
app.setName('QuestSound Light');
if (process.platform === 'win32') app.setAppUserModelId('ru.questsound.light');

if (!app.requestSingleInstanceLock()) app.quit(); // a second double-click just brings the window back
else {
  let win = null, tray = null, bridge = null, status = null, quitting = false;
  const logs = [];
  const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
  const prefs = (() => { try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch { return {}; } })();
  const savePrefs = () => { try { fs.mkdirSync(path.dirname(prefsFile()), { recursive: true }); fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch { } };

  const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
  const log = msg => { const line = `${new Date().toLocaleTimeString()}  ${msg}`; logs.push(line); if (logs.length > 300) logs.shift(); send('log', line); };

  // ---- start with the computer: on Windows the program runs from where the one-file launcher unpacked it,
  // so the file to start is the launcher (QSL_LAUNCHER); the AppImage has its own path in APPIMAGE
  const exe = () => process.env.QSL_LAUNCHER || process.env.APPIMAGE || process.execPath;
  const linuxAutostart = () => path.join(os.homedir(), '.config', 'autostart', 'questsound-light.desktop');
  function getAutostart() {
    if (process.platform === 'linux') return fs.existsSync(linuxAutostart());
    return app.getLoginItemSettings({ path: exe(), args: ['--hidden'] }).openAtLogin;
  }
  function setAutostart(on) {
    if (process.platform === 'linux') {
      if (!on) { fs.rmSync(linuxAutostart(), { force: true }); return getAutostart(); }
      if (!process.env.APPIMAGE) return false; // only the AppImage has a fixed file to start
      fs.mkdirSync(path.dirname(linuxAutostart()), { recursive: true });
      fs.writeFileSync(linuxAutostart(), `[Desktop Entry]\nType=Application\nName=QuestSound Light\nExec="${process.env.APPIMAGE}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
    } else app.setLoginItemSettings({ openAtLogin: on, openAsHidden: on, path: exe(), args: ['--hidden'] });
    return getAutostart();
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 480, height: 720, minWidth: 400, minHeight: 520, show: false, title: 'QuestSound Light',
      backgroundColor: '#06080c', autoHideMenuBar: true, icon: path.join(here, 'ui', 'icon.png'),
      webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    });
    win.removeMenu();
    // nothing but our own page: links go to the browser, and only https ones
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.loadFile(path.join(here, 'ui', 'index.html'));
    win.once('ready-to-show', () => { if (!HIDDEN) win.show(); });
    win.on('close', e => {
      if (quitting) return;
      e.preventDefault(); win.hide();
      if (!prefs.trayHinted) { // said once: the lights keep working with the window closed
        prefs.trayHinted = true; savePrefs();
        if (Notification.isSupported()) new Notification({ title: 'QuestSound Light работает', body: 'Свет продолжает меняться. Открыть окно или выйти можно через значок рядом с часами.', icon: path.join(here, 'ui', 'icon.png') }).show();
      }
    });
  }
  const showWindow = () => { if (!win || win.isDestroyed()) createWindow(); win.show(); win.focus(); };
  async function quit() { quitting = true; tray?.destroy(); try { await bridge?.stop(); } catch { } app.quit(); }

  function trayMenu() {
    const s = status, state = !s ? 'Запуск…' : !s.online ? 'Нет связи с сервером' : s.linked ? 'Подключено к сайту' : 'Ждёт кода на сайте';
    tray.setToolTip('QuestSound Light — ' + state.toLowerCase());
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: state, enabled: false },
      { type: 'separator' },
      { label: 'Открыть', click: showWindow },
      { label: 'Выйти', click: quit },
    ]));
  }

  app.on('second-instance', showWindow);
  app.on('activate', showWindow); // macOS: a click on the Dock icon
  app.on('window-all-closed', () => { }); // the bridge lives on in the tray
  app.on('before-quit', () => { quitting = true; });

  app.whenReady().then(async () => {
    const img = nativeImage.createFromPath(path.join(here, process.platform === 'darwin' ? 'tray.png' : 'tray@2x.png')).resize({ width: process.platform === 'darwin' ? 18 : 16 });
    tray = new Tray(img);
    tray.on('click', showWindow);
    trayMenu();

    ipcMain.handle('get', () => ({ status, logs, autostart: getAutostart(), canAutostart: process.platform !== 'linux' || !!process.env.APPIMAGE }));
    ipcMain.handle('copy', (_, text) => { clipboard.writeText(String(text).slice(0, 20)); return true; });
    ipcMain.handle('unpair', () => { bridge?.unpair(); return true; });
    ipcMain.handle('new-code', () => bridge?.newCode());
    ipcMain.handle('autostart', (_, on) => setAutostart(!!on));
    ipcMain.handle('open-site', () => shell.openExternal((status?.server || 'https://questsound.ru').replace(/^http:\/\/(?!localhost|127\.)/, 'https://')));
    ipcMain.handle('quit', quit);

    createWindow();
    try {
      bridge = await startBridge({ server: process.env.QSL_SERVER, log, onChange: s => { status = s; send('status', s); trayMenu(); } });
      log(`QuestSound Light ${status?.version} → ${status?.server}`);
    } catch (e) { log('Не удалось запустить мост: ' + e.message); }
  });
}
