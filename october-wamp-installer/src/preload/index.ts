import { contextBridge, ipcRenderer } from 'electron';
import type { InstallerApi, ProgressEvent, SiteSetupDraft } from '../shared/contracts';

const api: InstallerApi = {
  getInitialConfig: () => ipcRenderer.invoke('installer:get-initial-config'),
  browseForDirectory: (startingPath?: string) => ipcRenderer.invoke('installer:browse-for-directory', startingPath),
  listConfiguredVhosts: (wampRoot) => ipcRenderer.invoke('installer:list-configured-vhosts', wampRoot),
  confirmChanges: (details) => ipcRenderer.invoke('installer:confirm-changes', details),
  runPreflight: (draft: SiteSetupDraft) => ipcRenderer.invoke('installer:run-preflight', draft),
  createLocalSite: (draft: SiteSetupDraft) => ipcRenderer.invoke('installer:create-local-site', draft),
  openLocalSite: (domain: string) => ipcRenderer.invoke('installer:open-local-site', domain),
  getUpdateState: () => ipcRenderer.invoke('installer:get-update-state'),
  onProgress: (callback: (event: ProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ProgressEvent) => callback(payload);
    ipcRenderer.on('installer:progress', listener);
    return () => ipcRenderer.removeListener('installer:progress', listener);
  },
  checkForUpdates: () => ipcRenderer.invoke('installer:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('installer:download-update'),
  installUpdate: () => ipcRenderer.send('installer:install-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: import('../shared/contracts').UpdateState) => callback(payload);
    ipcRenderer.on('installer:update-status', listener);
    return () => ipcRenderer.removeListener('installer:update-status', listener);
  },
  windowControl: (action) => ipcRenderer.send('window:control', action),
};

contextBridge.exposeInMainWorld('installerApi', api);
