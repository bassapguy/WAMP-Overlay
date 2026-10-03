import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildPreflight } from './wamp/discover';
import { listConfiguredVhosts } from './wamp/site-discovery';
import { provisionSite } from './provisioning/orchestrator';
import { initializeUpdater, checkForUpdates, downloadUpdate, getUpdateState, installDownloadedUpdate, subscribeToUpdateState } from './updates';
import { parseDraft, fingerprintDraft } from './validation';
import type { ProgressEvent } from '../shared/contracts';

let mainWindow: BrowserWindow | null = null;
let activeRun = false;
let lastSuccessfulPreflight: { fingerprint: string; checkedAt: number } | null = null;

function getDefaultWampRoot(): string {
  for (const candidate of ['C:\\wamp64', 'C:\\wamp']) {
    if (existsSync(candidate)) return candidate;
  }
  return 'C:\\wamp64';
}

function sendProgress(event: ProgressEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('installer:progress', event);
}

function sendUpdateStatus(state: ReturnType<typeof getUpdateState>): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('installer:update-status', state);
}

function assertTrustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? '';
  if (app.isPackaged) {
    if (!senderUrl.startsWith('file://')) throw new Error('Blocked request from an untrusted page.');
  } else if (!senderUrl.startsWith('http://localhost:') && !senderUrl.startsWith('http://127.0.0.1:')) {
    throw new Error('Blocked request from an untrusted page.');
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 980,
    minWidth: 1040,
    minHeight: 760,
    show: false,
    frame: false,
    backgroundColor: '#3C1518',
    title: 'Wamp Local Site Installer',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = app.isPackaged ? url.startsWith('file://') : /^https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(url);
    if (!allowed) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerIpc(): void {
  ipcMain.handle('installer:get-initial-config', (event) => {
    assertTrustedSender(event);
    return { suggestedWampRoot: getDefaultWampRoot() };
  });

  ipcMain.handle('installer:browse-for-directory', async (event, startingPath: unknown) => {
    assertTrustedSender(event);
    const defaultPath = typeof startingPath === 'string' && startingPath.length < 512 ? resolve(startingPath) : undefined;
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('installer:list-configured-vhosts', async (event, input: unknown) => {
    assertTrustedSender(event);
    if (typeof input !== 'string' || input.length > 512) throw new Error('Choose a valid WampServer folder before refreshing sites.');
    const wampRoot = resolve(input);
    const isWampRoot = existsSync(join(wampRoot, 'bin', 'apache')) && existsSync(join(wampRoot, 'bin', 'php'));
    if (!isWampRoot) throw new Error('The selected folder does not contain the expected WampServer Apache and PHP folders.');
    return listConfiguredVhosts(wampRoot);
  });

  ipcMain.handle('installer:confirm-changes', async (event, details: unknown) => {
    assertTrustedSender(event);
    if (typeof details !== 'object' || details === null) throw new Error('The change summary is invalid.');
    const item = details as Record<string, unknown>;
    if ([item.domain, item.projectRoot, item.databaseName].some((value) => typeof value !== 'string' || value.length > 512)) {
      throw new Error('The change summary contains invalid values.');
    }
    const response = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: 'Create this local site?',
      message: `Create ${String(item.domain)} and its database?`,
      detail: `A new folder will be created at:\n${String(item.projectRoot)}\n\nA database named ${String(item.databaseName)} and a separate site account will be created. Apache configuration and the Windows hosts file may be changed. Administrator approval may be requested.`,
      buttons: ['Create local site', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    return response.response === 0;
  });

  ipcMain.handle('installer:run-preflight', async (event, input: unknown) => {
    assertTrustedSender(event);
    if (activeRun) throw new Error('A site setup is already running.');
    const draft = parseDraft(input);
    const report = await buildPreflight(draft);
    lastSuccessfulPreflight = report.canStart
      ? { fingerprint: fingerprintDraft(draft), checkedAt: report.checkedAt }
      : null;
    return report;
  });

  ipcMain.handle('installer:create-local-site', async (event, input: unknown) => {
    assertTrustedSender(event);
    if (activeRun) throw new Error('A site setup is already running.');
    const draft = parseDraft(input);
    const report = await buildPreflight(draft);
    const freshAndMatching = lastSuccessfulPreflight
      && lastSuccessfulPreflight.fingerprint === fingerprintDraft(draft)
      && Date.now() - lastSuccessfulPreflight.checkedAt < 3 * 60_000;
    if (!report.canStart || !freshAndMatching || !report.targets) {
      lastSuccessfulPreflight = null;
      throw new Error('Preflight is no longer valid for these settings. Check again and resolve all blocking items.');
    }
    activeRun = true;
    lastSuccessfulPreflight = null;
    try {
      return await provisionSite(draft, report.targets, sendProgress);
    } finally {
      activeRun = false;
    }
  });

  ipcMain.handle('installer:get-update-state', (event) => {
    assertTrustedSender(event);
    return getUpdateState();
  });

  ipcMain.handle('installer:check-for-updates', async (event) => {
    assertTrustedSender(event);
    return checkForUpdates();
  });

  ipcMain.handle('installer:download-update', async (event) => {
    assertTrustedSender(event);
    await downloadUpdate();
  });

  ipcMain.on('installer:install-update', (event) => {
    assertTrustedSender(event);
    installDownloadedUpdate();
  });

  ipcMain.handle('installer:open-local-site', async (event, domain: unknown) => {
    assertTrustedSender(event);
    if (typeof domain !== 'string' || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:test|localhost)$/i.test(domain)) {
      throw new Error('Only a validated .test or .localhost address can be opened.');
    }
    await shell.openExternal(`http://${domain}`);
  });

  ipcMain.on('window:control', (event, action: unknown) => {
    assertTrustedSender(event);
    if (!mainWindow || !['minimize', 'toggle-maximize', 'close'].includes(String(action))) return;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'toggle-maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    if (action === 'close') mainWindow.close();
  });
}

void app.whenReady().then(() => {
  registerIpc();
  initializeUpdater();
  subscribeToUpdateState(sendUpdateStatus);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  ipcMain.removeAllListeners('window:control');
  for (const channel of [
    'installer:get-initial-config',
    'installer:browse-for-directory',
    'installer:list-configured-vhosts',
    'installer:confirm-changes',
    'installer:run-preflight',
    'installer:create-local-site',
    'installer:open-local-site',
    'installer:get-update-state',
    'installer:check-for-updates',
    'installer:download-update',
  ]) ipcMain.removeHandler(channel);
});

