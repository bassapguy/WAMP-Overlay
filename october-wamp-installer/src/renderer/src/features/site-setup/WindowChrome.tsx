import { useEffect, useState, type MouseEvent } from 'react';
import type { InstallerApi, UpdateState } from '../../../../shared/contracts';

const INITIAL_UPDATE_STATE: UpdateState = { status: 'disabled', detail: 'GitHub Releases are not configured for this build.' };

export default function WindowChrome({ api }: { api?: InstallerApi }) {
  const [update, setUpdate] = useState(INITIAL_UPDATE_STATE);
  const [updateError, setUpdateError] = useState('');

  useEffect(() => {
    if (!api) return undefined;
    const unsubscribe = api.onUpdateStatus(setUpdate);
    void api.getUpdateState().then(setUpdate).catch(() => undefined);
    return unsubscribe;
  }, [api]);

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.detail === 2) api?.windowControl('toggle-maximize');
  };

  const updateAction = async () => {
    if (!api) return;
    setUpdateError('');
    try {
      if (update.status === 'available') await api.downloadUpdate();
      else if (update.status === 'downloaded') api.installUpdate();
      else await api.checkForUpdates();
    } catch (reason) {
      setUpdateError(reason instanceof Error ? reason.message : 'Unable to check for updates.');
    }
  };

  const updateLabel = update.status === 'checking'
    ? 'Checking…'
    : update.status === 'available'
      ? `Download ${update.version ?? 'update'}`
      : update.status === 'downloading'
        ? `Downloading ${update.percent ?? 0}%`
        : update.status === 'downloaded'
          ? `Restart to install ${update.version ?? 'update'}`
          : 'Check for updates';
  const updateDisabled = !api || update.status === 'disabled' || update.status === 'checking' || update.status === 'downloading';

  return (
    <header className="window-chrome" onDoubleClick={handleDoubleClick}>
      <div className="window-branding">
        <span aria-hidden="true" className="brand-mark">W</span>
        <span className="brand-title">Wamp Local Site Installer</span>
        <span className="brand-platform">Windows · WampServer</span>
      </div>
      <div className="window-controls" aria-label="Window controls">
        <span aria-live="polite" className={`update-detail update-detail--${update.status}`} title={updateError || update.detail}>{updateError || update.detail}</span>
        <button aria-label={updateLabel} className="update-button" disabled={updateDisabled} onClick={() => void updateAction()} title={updateError || update.detail} type="button">
          <i aria-hidden="true" className={`ph ${update.status === 'downloaded' ? 'ph-arrow-counter-clockwise' : 'ph-arrow-clockwise'}`} />
          <span>{updateLabel}</span>
        </button>
        <button aria-label="Minimize" onClick={() => api?.windowControl('minimize')} type="button"><i aria-hidden="true" className="ph ph-minus" /></button>
        <button aria-label="Maximize" onClick={() => api?.windowControl('toggle-maximize')} type="button"><i aria-hidden="true" className="ph ph-square" /></button>
        <button aria-label="Close" onClick={() => api?.windowControl('close')} type="button"><i aria-hidden="true" className="ph ph-x" /></button>
      </div>
    </header>
  );
}
