import electronUpdater from 'electron-updater';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { UpdateState } from '../shared/contracts';

const { autoUpdater } = electronUpdater;

type UpdateListener = (state: UpdateState) => void;

let state: UpdateState = { status: 'disabled', detail: 'GitHub Releases are not configured for this build.' };
let initialized = false;
const listeners = new Set<UpdateListener>();

function publish(nextState: UpdateState): void {
  state = nextState;
  for (const listener of listeners) listener(state);
}

export function initializeUpdater(): void {
  if (!app.isPackaged) {
    publish({ status: 'disabled', detail: 'Update checks are available in the installed release build.' });
    return;
  }
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    publish({ status: 'disabled', detail: 'This build has no GitHub Releases feed configured.' });
    return;
  }
  if (initialized) return;
  initialized = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => publish({ status: 'checking', detail: 'Checking GitHub Releases.' }));
  autoUpdater.on('update-available', (info) => publish({ status: 'available', version: info.version, detail: `Version ${info.version} is available.` }));
  autoUpdater.on('update-not-available', (info) => publish({ status: 'up-to-date', version: info.version, detail: 'This installation is up to date.' }));
  autoUpdater.on('download-progress', (info) => publish({ status: 'downloading', version: state.version, percent: Math.round(info.percent), detail: `Downloading update · ${Math.round(info.percent)}%.` }));
  autoUpdater.on('update-downloaded', (info) => publish({ status: 'downloaded', version: info.version, detail: `Version ${info.version} is ready to install.` }));
  autoUpdater.on('error', (error) => publish({ status: 'error', detail: `Update check failed: ${error.message.slice(0, 240)}` }));
  publish({ status: 'idle', detail: 'Check for an available release.' });
}

export function getUpdateState(): UpdateState {
  return state;
}

export function subscribeToUpdateState(listener: UpdateListener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (state.status === 'disabled') return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not check GitHub Releases.';
    publish({ status: 'error', detail: `Update check failed: ${message.slice(0, 240)}` });
  }
  return state;
}

export async function downloadUpdate(): Promise<void> {
  if (state.status !== 'available') throw new Error('There is no available update to download.');
  publish({ ...state, status: 'downloading', percent: 0, detail: 'Starting update download.' });
  await autoUpdater.downloadUpdate();
}

export function installDownloadedUpdate(): void {
  if (state.status !== 'downloaded') throw new Error('The update download has not completed.');
  autoUpdater.quitAndInstall();
}
