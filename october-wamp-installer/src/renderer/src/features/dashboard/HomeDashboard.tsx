import { useState } from 'react';
import type { ConfiguredVhost, VhostInventory } from '../../../../shared/contracts';

interface HomeDashboardProps {
  wampRoot: string;
  inventory: VhostInventory | null;
  isRefreshing: boolean;
  error: string;
  onBrowse: () => void;
  onRefresh: () => void;
  onCreateSite: () => void;
  onOpenSite: (domain: string) => void;
}

function platformLabel(site: ConfiguredVhost): string {
  switch (site.detectedPlatform) {
    case 'empty': return 'Empty site';
    case 'wordpress': return 'Likely WordPress';
    case 'bookstack': return 'Likely BookStack';
    case 'october': return 'Likely October CMS';
    case 'ambiguous': return 'Platform ambiguous';
    default: return 'Platform unknown';
  }
}

function stateLabel(site: ConfiguredVhost): string {
  switch (site.state) {
    case 'missing-root': return 'Document root not found';
    case 'unresolved-root': return 'Document root unresolved';
    case 'unknown-platform': return 'No recognized platform files';
    case 'ambiguous-platform': return 'Conflicting platform files';
    default: return 'Document root found';
  }
}

export default function HomeDashboard({ wampRoot, inventory, isRefreshing, error, onBrowse, onRefresh, onCreateSite, onOpenSite }: HomeDashboardProps) {
  const [expandedSite, setExpandedSite] = useState<string | null>(null);
  return (
    <>
      <header className="app-header dashboard-header">
        <div>
          <h1>My local sites</h1>
          <p>Configured Apache virtual hosts for this WampServer installation.</p>
        </div>
        <div className="header-actions">
          <button className="quiet-button" disabled={isRefreshing} onClick={onRefresh} type="button">
            {isRefreshing ? <span aria-hidden="true" className="spinner" /> : null}{isRefreshing ? 'Refreshing…' : 'Refresh sites'}
          </button>
          <button className="primary-button" onClick={onCreateSite} type="button"><i aria-hidden="true" className="ph ph-plus" />Create local site</button>
        </div>
      </header>

      {error ? <div className="alert-banner alert-banner--error" role="alert">{error}</div> : null}

      <section aria-labelledby="sites-source-heading" className="dashboard-source">
        <div className="source-copy">
          <h2 id="sites-source-heading">WampServer installation</h2>
          <code title={wampRoot}>{wampRoot || 'Choose a WampServer folder'}</code>
          <p>{inventory?.vhostsPath ? `Apache vhosts: ${inventory.vhostsPath}` : 'Choose a WampServer folder to locate Apache configuration.'}</p>
        </div>
        <button className="quiet-button" onClick={onBrowse} type="button"><i aria-hidden="true" className="ph ph-folder-open" />Browse folder</button>
      </section>

      <section aria-label="Configured local sites" className="sites-panel">
        <div aria-hidden="true" className="site-list-header">
          <span>Local domain</span><span>Platform</span><span>Document root</span><span>State</span><span>Actions</span>
        </div>
        {inventory?.sites.length ? (
          <div className="site-list" aria-label="Apache configured virtual hosts">
            {inventory.sites.map((site, index) => {
              const evidenceId = `vhost-evidence-${index}`;
              const isExpanded = expandedSite === site.id;
              return (
                <div className={`site-entry site-entry--${site.state}`} key={site.id}>
                  <div className="site-row">
                    <button aria-controls={evidenceId} aria-expanded={isExpanded} className="site-domain site-expand" onClick={() => setExpandedSite(isExpanded ? null : site.id)} type="button">
                      <i aria-hidden="true" className={`ph ${isExpanded ? 'ph-caret-down' : 'ph-caret-right'}`} />
                      <span aria-hidden="true" className={`status-mark ${site.state === 'ready' ? 'status-mark--pass' : 'status-mark--warning'}`} />
                      <span className="site-domain-text">{site.serverName}</span>
                    </button>
                    <span className="site-platform">{platformLabel(site)}</span>
                    <code className="site-root" title={site.documentRoot ?? undefined}>{site.documentRoot ?? 'Path could not be resolved'}</code>
                    <span className={`site-state site-state--${site.state}`}>{stateLabel(site)}</span>
                    <span className="site-actions">
                      {site.canOpenLocally ? <button className="site-open-button" onClick={() => onOpenSite(site.serverName)} type="button">Open site <i aria-hidden="true" className="ph ph-arrow-square-out" /></button> : <span className="muted-copy">Not openable</span>}
                    </span>
                  </div>
                  <div className="site-evidence" hidden={!isExpanded} id={evidenceId}>
                    <dl>
                      <div><dt>Aliases</dt><dd>{site.aliases.length ? site.aliases.join(', ') : 'None configured'}</dd></div>
                      <div><dt>Document root source</dt><dd>{site.documentRootSource === 'global-default' ? 'Apache global DocumentRoot' : site.documentRootSource === 'vhost' ? 'VirtualHost DocumentRoot' : 'Unresolved Apache path variable'}</dd></div>
                      <div><dt>Configuration file</dt><dd><code>{site.configPath}</code></dd></div>
                      <div><dt>Platform evidence</dt><dd>{site.evidence.length ? site.evidence.join(' · ') : 'No recognized files found at the resolved root.'}</dd></div>
                    </dl>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="sites-empty" role="status">
            <i aria-hidden="true" className="ph ph-hard-drives" />
            <h2>{inventory ? 'No configured vhosts found' : 'Sites not loaded'}</h2>
            <p>{inventory ? 'Apache’s configured vhost file contains no VirtualHost entries. Creating a site adds one here.' : 'Choose or refresh the WampServer folder to read its Apache vhost configuration.'}</p>
            <button className="quiet-button" disabled={isRefreshing} onClick={onRefresh} type="button">{isRefreshing ? 'Reading Apache config…' : 'Refresh sites'}</button>
          </div>
        )}
        {inventory?.warnings.map((warning) => <p className="inventory-warning" key={warning}><i aria-hidden="true" className="ph ph-warning-circle" />{warning}</p>)}
      </section>
      <p className="dashboard-footnote">Platform names are based on file evidence and may be incomplete. Expand a row to review the evidence and Apache source path.</p>
    </>
  );
}
