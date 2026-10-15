const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, shell, dialog, screen, clipboard } = require('electron');
const { fork, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const rootDir = path.resolve(__dirname, '..');
app.setPath('userData', path.join(rootDir, '.data'));
const data = app.getPath('userData'); fs.mkdirSync(data, { recursive: true });
function lifecycle(event, details = {}) {
  try {
    const file = path.join(data, 'lifecycle.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.previous`);
    fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), pid: process.pid, event, ...details }) + '\n');
  } catch { /* Diagnostics must never prevent startup or shutdown. */ }
}
lifecycle('process-start', { version: app.getVersion(), executable: process.execPath });
process.on('uncaughtExceptionMonitor', (error, origin) => lifecycle('uncaught-exception', { origin, error: error.stack || String(error) }));
process.on('exit', code => lifecycle('process-exit', { code }));
app.on('child-process-gone', (_, details) => lifecycle('child-process-gone', details));
const configFile = path.join(data, 'settings.json');
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function saveJson(file, value) { const temp = `${file}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2)); fs.renameSync(temp, file); }
const defaults = ['Desktop','Documents','Downloads','Pictures','Music','Videos','Projects','source','PycharmProjects','Calibre Library'].map(n => path.join(os.homedir(), n));
for (const key of ['OneDrive','OneDriveCommercial','OneDriveConsumer']) if (process.env[key]) defaults.push(process.env[key]);
function normalizeRoots(roots) {
  const candidates = [...new Map(roots.filter(p => typeof p === 'string').map(p => [path.resolve(p).toLowerCase(),path.resolve(p)])).values()].filter(p => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });
  return candidates.filter(p => !candidates.some(other => other !== p && p.toLowerCase().startsWith(other.toLowerCase().replace(/[\\/]$/, '') + path.sep)));
}
let config = readJson(configFile, { roots: normalizeRoots(defaults), launchAtLogin: false });
let win, tray, worker, ready, quitting = false, serial = 0, generation = 0;
let pending = new Map(), allowed = new Map(), latestStatus, engineError = '', hotkey = false;
function call(method, ...args) {
  return new Promise((resolve,reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Search engine timed out')); }, 60000);
    pending.set(id, { resolve, reject, timeout });
    if (!worker?.connected) { clearTimeout(timeout); pending.delete(id); reject(new Error('Search engine is unavailable')); return; }
    worker.send({ id, method, args });
  });
}
function loadApps() {
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'],
    { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      try { const list = JSON.parse(stdout.replace(/^\uFEFF/,'')); resolve([].concat(list).filter(x => x.Name && x.AppID).map(x => ({ name: x.Name, id: x.AppID }))); }
      catch { resolve([]); }
    }));
}
async function startEngine() {
  const myGeneration = ++generation;
  const previous = worker; worker = null; previous?.kill();
  for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error('Index restarted')); } pending.clear();
  allowed.clear(); engineError = ''; latestStatus = null;
  const current = worker = fork(path.join(__dirname, 'worker.cjs'), [], {
    execPath: process.execPath, env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, stdio: ['ignore','pipe','pipe','ipc'] });
  current.stderr.on('data', b => fs.appendFileSync(path.join(data, 'engine.log'), b));
  current.stdout.on('data', () => {});
  current.on('message', ({id,value,error}) => {
    const p = pending.get(id); if (!p) return;
    pending.delete(id); clearTimeout(p.timeout); error ? p.reject(new Error(error)) : p.resolve(value);
  });
  current.on('error', error => { engineError = error.message; lifecycle('worker-error', { error: error.message }); });
  current.on('exit', (code, signal) => {
    lifecycle('worker-exit', { workerPid: current.pid, code, signal, expected: worker !== current || quitting });
    if (worker !== current) return;
    engineError = 'Search engine stopped. Use Reindex in settings to restart it.';
    for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error(engineError)); } pending.clear();
  });
  const apps = await loadApps();
  if (myGeneration !== generation) return;
  latestStatus = await call('init', normalizeRoots(config.roots), path.join(data,'indexes'), apps,
    readJson(path.join(data, 'usage.json'), {}));
  return latestStatus;
}
function launchEngine() { ready = startEngine(); ready.catch(e => { engineError = e.message; }); }
function show() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  win.setPosition(Math.round(display.x + (display.width - 860) / 2), Math.round(display.y + display.height * 0.16));
  win.show(); win.focus(); win.webContents.send('focus-search');
}
if (!app.requestSingleInstanceLock()) { lifecycle('duplicate-instance'); app.quit(); }
else {
  app.on('second-instance', () => { if (win) show(); });
  app.whenReady().then(() => {
    lifecycle('app-ready');
    win = new BrowserWindow({ width: 860, height: 610, show: false, frame: false, resizable: false,
      backgroundColor: '#12151c', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.loadFile(path.join(__dirname, 'index.html'));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.on('render-process-gone', (_, details) => lifecycle('renderer-exit', details));
    win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
    hotkey = globalShortcut.register('F2', () => win.isVisible() && win.isFocused() ? win.hide() : show());
    lifecycle('hotkey-registered', { shortcut: 'F2', success: hotkey });
    const image = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEklEQVR42mNkYPj/n4ECwESJ5lEDAHjTAh8nGCpWAAAAAElFTkSuQmCC');
    tray = new Tray(image); tray.setToolTip('Searcher · F2');
    tray.setContextMenu(Menu.buildFromTemplate([{ label:'Search (F2)', click:show }, {label:'Quit Searcher',click:() => { quitting = true; app.quit(); }}]));
    tray.on('click', show);
    launchEngine(); win.once('ready-to-show', show);
    ipcMain.handle('search', async (_, query, mode, cursors) => {
      if (typeof query !== 'string' || query.length > 1000 || !['all','apps','files','content'].includes(mode)) throw new Error('Invalid search');
      await ready;
      const response = await call('search', query, mode, cursors);
      for (const item of response.results) allowed.set(item.id, item);
      if (allowed.size > 20000) allowed = new Map(response.results.map(x => [x.id,x]));
      return response;
    });
    ipcMain.handle('status', async () => {
      if (latestStatus && !engineError) latestStatus = await call('status');
      return { ...latestStatus, engineError, hotkey, config };
    });
    ipcMain.handle('open', async (_, id, query, action) => {
      const item = allowed.get(id); if (!item) throw new Error('Result expired. Search again.');
      if (action === 'copy') { clipboard.writeText(item.path || item.id); return; }
      if (action === 'reveal' && item.path) { shell.showItemInFolder(item.path); return; }
      if (item.kind === 'app') {
        // App IDs come from Get-StartApps; pass one literal argument without a shell.
        await new Promise((resolve,reject) => execFile('explorer.exe', [`shell:AppsFolder\\${item.id}`], { windowsHide: true }, e => e && e.code !== 1 ? reject(e) : resolve()));
      } else {
        const error = await shell.openPath(item.path); if (error) throw new Error(error);
      }
      const usage = await call('track', item, typeof query === 'string' ? query.slice(0,1000) : '');
      saveJson(path.join(data, 'usage.json'), usage); win.hide();
    });
    ipcMain.handle('settings', async (_, action, value) => {
      if (action === 'add') {
        const result = await dialog.showOpenDialog(win, { properties:['openDirectory','multiSelections'] });
        if (!result.canceled) config.roots = normalizeRoots([...config.roots, ...result.filePaths]);
      } else if (action === 'remove') config.roots = config.roots.filter(p => p !== value);
      else if (action === 'login') {
        config.launchAtLogin = !!value;
        app.setLoginItemSettings({ openAtLogin: config.launchAtLogin, path: process.execPath, args: [rootDir] });
      } else if (action !== 'reindex') throw new Error('Invalid settings action');
      saveJson(configFile, config);
      if (action !== 'login') launchEngine();
      return config;
    });
    ipcMain.on('hide', () => win.hide());
    if (process.env.SEARCHER_SMOKE === '1') {
      ready.then(async () => {
        await new Promise(r => setTimeout(r, 2500));
        const report = await win.webContents.executeJavaScript(`(async () => {
          const input = document.querySelector('#query');
          input.value = 'calculator'; input.dispatchEvent(new Event('input', {bubbles:true}));
          await new Promise(r => setTimeout(r,800));
          const matched = [...document.querySelectorAll('.name')].some(e => e.textContent.toLowerCase().includes('calculator'));
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
          const selected = document.querySelectorAll('.row')[1]?.getAttribute('aria-selected');
          document.dispatchEvent(new KeyboardEvent('keydown',{key:',',ctrlKey:true,bubbles:true}));
          const settings = !document.querySelector('#settings').hidden;
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          return {title:document.title, input:!!input, bridge:typeof window.searcher?.search, matched, selected, settings};
        })()`);
        const result = await call('search', 'searcher', 'files');
        fs.writeFileSync(path.join(rootDir,'smoke-report.json'), JSON.stringify({hotkey, report, status:await call('status'), sample:result.results.slice(0,3)}, null, 2));
        const capture = await win.webContents.capturePage(); fs.writeFileSync(path.join(rootDir,'preview.png'), capture.toPNG());
        quitting = true; app.quit();
      }).catch(e => { fs.writeFileSync(path.join(rootDir,'smoke-report.json'),JSON.stringify({error:e.message})); quitting=true; app.quit(); });
    }
  }).catch(error => { lifecycle('startup-failed', { error: error.stack || String(error) }); app.quit(); });
  app.on('before-quit', () => { lifecycle('before-quit'); quitting = true; worker?.kill(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {});
}
