import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InstallerApi, PreflightReport, ProgressEvent, SiteSetupDraft, SetupResult, VhostInventory } from '../../shared/contracts';
import type { InstallablePlatform } from '../../shared/contracts';
import HomeDashboard from './features/dashboard/HomeDashboard';
import SiteConfigurationForm from './features/site-setup/SiteConfigurationForm';
import { ChangeManifest, ExecutionLedger, PreflightPanel } from './features/site-setup/InspectorPanels';
import WindowChrome from './features/site-setup/WindowChrome';
import { buildPaths, deriveDatabaseName, draftKey, joinWindowsPath, normalizeProjectName, parentWindowsPath } from './utils/site-formatters';
import { getDraftErrors } from './utils/input-errors';

const FALLBACK_WAMP_ROOT = 'C:\\wamp64';

type AppView = 'sites' | 'create';

function createInitialDraft(wampRoot: string): SiteSetupDraft {
  const siteName = 'my-local-site';
  const paths = buildPaths(wampRoot, siteName, 'empty');
  return {
    wampRoot,
    siteName,
    domain: 'my-local-site.test',
    projectRoot: paths.projectRoot,
    documentRoot: paths.documentRoot,
    dbHost: '127.0.0.1',
    dbPort: 3306,
    dbAdminUser: 'root',
    dbAdminPassword: '',
    databaseName: deriveDatabaseName(siteName),
    platform: 'empty',
    licenseKey: '',
  };
}

export default function App() {
  const api: InstallerApi | undefined = window.installerApi;
  const [draft, setDraft] = useState(() => createInitialDraft(FALLBACK_WAMP_ROOT));
  const [view, setView] = useState<AppView>('sites');
  const [inventory, setInventory] = useState<VhostInventory | null>(null);
  const [refreshingSites, setRefreshingSites] = useState(false);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [edited, setEdited] = useState<Record<string, boolean>>({});
  const [justCopied, setJustCopied] = useState(false);

  const changedSinceCheck = !preflight || preflight.draftFingerprint !== draftKey(draft);
  const fieldErrors = useMemo(() => getDraftErrors(draft), [draft]);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const canCreate = Boolean(api && preflight?.canStart && !changedSinceCheck && !hasFieldErrors && !checking && !creating && !result);
  const completed = result?.phase === 'completed';
  const formLocked = checking || creating || Boolean(result);

  const refreshInventory = useCallback(async (wampRoot = draft.wampRoot) => {
    if (!api) {
      setError('The Electron preload bridge is unavailable. Run this application through Electron.');
      return;
    }
    setRefreshingSites(true);
    setError('');
    try {
      const nextInventory = await api.listConfiguredVhosts(wampRoot);
      setInventory(nextInventory);
    } catch (reason) {
      setInventory(null);
      setError(reason instanceof Error ? reason.message : 'Unable to read the Apache vhost configuration.');
    } finally {
      setRefreshingSites(false);
    }
  }, [api, draft.wampRoot]);

  useEffect(() => {
    if (!api) return;
    let ignore = false;
    void api.getInitialConfig().then(async (config) => {
      if (ignore) return;
      if (config.suggestedWampRoot !== draft.wampRoot) {
        setDraft(createInitialDraft(config.suggestedWampRoot));
      }
      try {
        const nextInventory = await api.listConfiguredVhosts(config.suggestedWampRoot);
        if (!ignore) setInventory(nextInventory);
      } catch (reason) {
        if (!ignore) setError(reason instanceof Error ? reason.message : 'Unable to read the Apache vhost configuration.');
      }
    }).catch((reason: unknown) => {
      if (!ignore) setError(reason instanceof Error ? reason.message : 'Unable to read initial configuration.');
    });
    return () => { ignore = true; };
  }, [api]);

  useEffect(() => {
    if (!api) return undefined;
    return api.onProgress((event) => setProgress((current) => [...current, event]));
  }, [api]);

  const setValue = useCallback(<K extends keyof SiteSetupDraft>(key: K, value: SiteSetupDraft[K]) => {
    setDraft((previous) => {
      const next = { ...previous, [key]: value };
      const wasUserEdited = edited[key];
      if (key === 'wampRoot' && typeof value === 'string') {
        const paths = buildPaths(value, previous.siteName, previous.platform);
        next.projectRoot = paths.projectRoot;
        if (!edited.documentRoot) next.documentRoot = paths.documentRoot;
      }
      if (key === 'projectRoot' && typeof value === 'string') {
        if (!edited.documentRoot) next.documentRoot = previous.platform === 'bookstack' || previous.platform === 'october' ? joinWindowsPath(value, 'public') : value;
      }
      if (key === 'siteName' && typeof value === 'string') {
        const normalized = normalizeProjectName(value);
        if (!wasUserEdited || value.length > 0) {
          if (!edited.domain) next.domain = `${normalized || 'new-site'}.test`;
          if (!edited.databaseName) next.databaseName = deriveDatabaseName(value);
          const defaultParent = joinWindowsPath(previous.wampRoot, 'www');
          const parent = edited.projectRoot ? parentWindowsPath(previous.projectRoot) : defaultParent;
          const projectRoot = joinWindowsPath(parent, normalized || 'new-site');
          next.projectRoot = projectRoot;
          if (!edited.documentRoot) next.documentRoot = previous.platform === 'bookstack' || previous.platform === 'october' ? joinWindowsPath(projectRoot, 'public') : projectRoot;
        }
      }
      if (key === 'platform' && typeof value === 'string') {
        const platform = value as InstallablePlatform;
        if (!edited.documentRoot) next.documentRoot = platform === 'bookstack' || platform === 'october' ? joinWindowsPath(previous.projectRoot, 'public') : previous.projectRoot;
        if (platform !== 'october') next.licenseKey = '';
      }
      return next;
    });
    setEdited((previous) => ({ ...previous, [key]: true }));
    setPreflight(null);
    setResult(null);
    setProgress([]);
    setError('');
  }, [edited]);

  const onBrowse = useCallback(async (field: 'wampRoot' | 'projectRoot') => {
    if (!api) return;
    setError('');
    try {
      const startingPath = field === 'wampRoot' ? draft.wampRoot : joinWindowsPath(draft.wampRoot, 'www');
      const path = await api.browseForDirectory(startingPath);
      if (!path) return;
      if (field === 'wampRoot') {
        setValue('wampRoot', path);
        await refreshInventory(path);
      } else {
        const target = joinWindowsPath(path, normalizeProjectName(draft.siteName) || 'new-site');
        setValue('projectRoot', target);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The folder picker failed.');
    }
  }, [api, draft.wampRoot, draft.siteName, setValue, refreshInventory]);

  const runCheck = useCallback(async () => {
    if (!api) {
      setError('The Electron preload bridge is unavailable. Run this application through Electron.');
      return;
    }
    setChecking(true);
    setResult(null);
    setProgress([]);
    setError('');
    try {
      const report = await api.runPreflight(draft);
      setPreflight({ ...report, draftFingerprint: draftKey(draft) });
    } catch (reason) {
      setPreflight(null);
      setError(reason instanceof Error ? reason.message : 'Preflight failed.');
    } finally {
      setChecking(false);
    }
  }, [api, draft]);

  const startSite = useCallback(async () => {
    if (!api || !canCreate) return;
    setError('');
    try {
      const approved = await api.confirmChanges({ domain: draft.domain, projectRoot: draft.projectRoot, databaseName: draft.databaseName });
      if (!approved) return;
      setCreating(true);
      setProgress([]);
      setResult(null);
      const setupResult = await api.createLocalSite(draft);
      setDraft((current) => ({ ...current, dbAdminPassword: '', licenseKey: '' }));
      setResult(setupResult);
      if (setupResult.phase !== 'completed') setError(setupResult.error ?? 'Setup did not complete. Review the execution ledger.');
      else {
        setPreflight(null);
        void refreshInventory(draft.wampRoot);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create the local site.');
    } finally {
      setCreating(false);
    }
  }, [api, canCreate, draft, refreshInventory]);

  const discoverySummary = preflight?.targets
    ? `Apache ${preflight.targets.apacheVersion} · PHP ${preflight.targets.phpVersion} · ${preflight.targets.databaseVersion}`
    : preflight
      ? 'WampServer version folders not found'
      : draft.wampRoot ? 'Run a check to identify installed versions' : 'Choose a WampServer folder';

  const summary = useMemo(() => {
    if (!api) return 'Electron desktop features unavailable';
    if (completed) return 'Local site created';
    if (creating) return 'Creating local site';
    if (checking) return 'Checking WampServer';
    if (!preflight) return 'Not checked';
    return preflight.canStart && !changedSinceCheck ? 'Ready to create' : 'Review blocking checks';
  }, [api, completed, creating, checking, preflight, changedSinceCheck]);

  const handleOpenSite = useCallback(async (domain: string) => {
    if (!api) return;
    try {
      await api.openLocalSite(domain);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open the local site.');
    }
  }, [api]);

  const handleCopyUrl = useCallback(async () => {
    if (!result?.localUrl) return;
    await navigator.clipboard.writeText(result.localUrl);
    setJustCopied(true);
    window.setTimeout(() => setJustCopied(false), 1600);
  }, [result?.localUrl]);

  return (
    <div className="app-shell">
      <main className="app-window">
        <WindowChrome api={api} />
        {view === 'sites' ? (
          <HomeDashboard
            error={error}
            inventory={inventory}
            isRefreshing={refreshingSites}
            onBrowse={() => void onBrowse('wampRoot')}
            onCreateSite={() => {
              setDraft(createInitialDraft(draft.wampRoot));
              setEdited({});
              setPreflight(null);
              setProgress([]);
              setResult(null);
              setError('');
              setView('create');
            }}
            onOpenSite={(domain) => void handleOpenSite(domain)}
            onRefresh={() => void refreshInventory()}
            wampRoot={draft.wampRoot}
          />
        ) : (
          <>
            <header className="app-header">
              <div className="create-heading">
                <button className="back-button" onClick={() => { setError(''); setView('sites'); }} type="button"><i aria-hidden="true" className="ph ph-arrow-left" />Back to sites</button>
                <h1>Create local site</h1>
                <p>Check this installation before adding a configured Apache vhost.</p>
              </div>
              <div className="header-actions">
                <span className="header-status"><span aria-hidden="true" className={`status-mark status-mark--${completed ? 'pass' : preflight?.canStart ? 'pass' : 'unchecked'}`} />{summary}</span>
                <button className="quiet-button" disabled={checking || creating} onClick={() => void runCheck()} type="button">
                  {checking ? <span aria-hidden="true" className="spinner" /> : null}{checking ? 'Checking…' : 'Check again'}
                </button>
                {completed ? (
                  <>
                    <button className="quiet-button" onClick={() => void handleCopyUrl()} type="button">{justCopied ? 'Copied URL' : 'Copy URL'}</button>
                    <button className="primary-button" onClick={() => void handleOpenSite(draft.domain)} type="button"><i aria-hidden="true" className="ph ph-arrow-square-out" />Open local site</button>
                  </>
                ) : (
                  <button className="primary-button" disabled={!canCreate} onClick={() => void startSite()} type="button">
                    {creating ? <span className="spinner" /> : null}{creating ? 'Creating local site…' : 'Create local site'}
                  </button>
                )}
              </div>
            </header>
            {error ? <div className="alert-banner alert-banner--error" role="alert">{error}</div> : null}
            {preflight && !preflight.canStart ? <div className="alert-banner" role="status">Resolve every blocking check before you create the local site.</div> : null}
            {result?.phase === 'partial' ? <div className="alert-banner" role="status">Setup stopped after {result.completedSteps.length} completed step{result.completedSteps.length === 1 ? '' : 's'}. Existing files, database changes, or partial CMS files were left in place for review.</div> : null}
            <div className="app-grid">
              <SiteConfigurationForm discoverySummary={discoverySummary} draft={draft} errors={fieldErrors} locked={formLocked} onBrowse={onBrowse} onChange={setValue} />
              <aside aria-label="Preflight and planned changes" className="inspector-column">
                <PreflightPanel platform={draft.platform} report={preflight} />
                <ChangeManifest draft={draft} report={preflight} />
                <ExecutionLedger platform={draft.platform} progress={progress} result={result} />
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
