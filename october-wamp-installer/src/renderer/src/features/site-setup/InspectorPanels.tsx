import type { InstallablePlatform, PreflightReport, ProgressEvent, SetupResult, SetupStepId } from '../../../../shared/contracts';
import { PLATFORM_LABELS, SETUP_STEPS } from '../../../../shared/contracts';
import type { SiteSetupDraft } from '../../../../shared/contracts';

const PLATFORM_EXTENSIONS: Record<InstallablePlatform, string> = {
  empty: 'No PHP extension checks required',
  wordpress: 'mysqli · PDO_MySQL',
  bookstack: 'cURL · DOM · GD · iconv · mbstring · MySQLnd · OpenSSL · PDO · PDO_MySQL · tokenizer · XML · ZipArchive',
  october: 'PDO · PDO_MySQL · cURL · OpenSSL · mbstring · ZipArchive · GD · SimpleXML',
};

function StatusMark({ state }: { state: string }) {
  return <span aria-hidden="true" className={`status-mark status-mark--${state}`} />;
}

function statusText(state: string): string {
  const labels: Record<string, string> = { pass: 'Ready', warning: 'Review', blocked: 'Blocked', failed: 'Failed', running: 'Checking', unchecked: 'Not checked', complete: 'Complete', pending: 'Pending', skipped: 'Skipped' };
  return labels[state] ?? state;
}

export function PreflightPanel({ report, platform }: { report: PreflightReport | null; platform: InstallablePlatform }) {
  const checks = report?.checks ?? [];
  const summary = !report ? 'Not checked' : report.canStart ? 'Ready to create' : 'Resolve blocking checks';
  const known = (id: string) => checks.find((item) => item.id === id);
  const entries = [
    known('wamp'), known('www-directory'), known('site-input'), known('apache'), known('php'), known('composer'), known('git'), known('database'), known('extensions'), known('apache-config'), known('domain-conflict'), known('hosts'), known('folder'),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const requirements = [
    ['apache', 'Apache service', 'Service/version pending'],
    ['php', 'PHP version', platform === 'empty' ? 'Not required' : platform === 'wordpress' ? '8.3+ required' : '8.2+ required'],
    ['composer', 'Composer', platform === 'bookstack' ? '2.2+ required' : platform === 'october' ? '2+ required' : 'Not required'],
    ...(platform === 'bookstack' ? [['git', 'Git', 'Required to fetch release branch']] : []),
    ['database', 'Database service', 'MySQL / MariaDB · pending'],
  ];

  return (
    <section aria-labelledby="preflight-heading" className="inspector-panel preflight-panel">
      <div className="panel-heading">
        <h2 id="preflight-heading">Preflight checks</h2>
        <span className="panel-summary">{summary}</span>
      </div>
      {report ? (
        <ul className="checks-list">
          {entries.map((item) => (
            <li className="check-row" key={item.id}>
              <span className="check-label"><StatusMark state={item.state} />{item.label}</span>
              <span className={`check-detail check-detail--${item.state}`} title={item.detail}>{item.detail}</span>
            </li>
          ))}
          {platform !== 'empty' ? <li className="extensions-detail"><span><StatusMark state={known('extensions')?.state ?? 'unchecked'} />Required PHP extensions for {PLATFORM_LABELS[platform]}</span><code>{PLATFORM_EXTENSIONS[platform]}</code></li> : null}
        </ul>
      ) : (
        <ul className="checks-list">
          {requirements.map(([id, label, detail]) => <li className="check-row" key={id}><span className="check-label"><StatusMark state="unchecked" />{label}</span><code className="check-detail">{detail}</code></li>)}
          <li className="preflight-placeholder"><StatusMark state="unchecked" />Run a check to inspect requirements for {PLATFORM_LABELS[platform]}.</li>
        </ul>
      )}
    </section>
  );
}

export function ChangeManifest({ draft, report }: { draft: SiteSetupDraft; report: PreflightReport | null }) {
  const targets = report?.targets;
  return (
    <section aria-labelledby="manifest-heading" className="inspector-panel manifest-panel">
      <h2 id="manifest-heading">Change manifest</h2>
      <dl className="manifest-list">
        <div className="manifest-row"><dt>Site software</dt><dd>{PLATFORM_LABELS[draft.platform]}</dd></div>
        <div className="manifest-row"><dt>Local domain</dt><dd>{draft.domain || 'Not set'}</dd></div>
        <div className="manifest-row"><dt>Project folder</dt><dd>{draft.projectRoot || 'Not set'}</dd></div>
        <div className="manifest-row"><dt>Document root</dt><dd>{draft.documentRoot || 'Not set'}</dd></div>
        <div className="manifest-row"><dt>Database name</dt><dd>{draft.databaseName || 'Not set'}</dd></div>
        <div className="manifest-block"><dt>Apache vhost target</dt><dd>{targets?.vhostsPath ?? 'Resolved after WampServer version check'}</dd></div>
        <div className="manifest-block"><dt>Windows hosts file</dt><dd>{targets?.hostsPath ?? 'C:\\Windows\\System32\\drivers\\etc\\hosts'}</dd></div>
      </dl>
      <p className="manifest-warning">The vhost and loopback entry may require Administrator permission. Apache is validated before it is restarted.</p>
    </section>
  );
}

export function ExecutionLedger({ progress, result, platform }: { progress: ProgressEvent[]; result: SetupResult | null; platform: InstallablePlatform }) {
  const lastEvent = new Map<SetupStepId, ProgressEvent>();
  for (const event of progress) lastEvent.set(event.stepId, event);
  const phaseText = result?.phase === 'completed' ? 'Completed' : result?.phase === 'partial' ? 'Partial setup' : result?.phase === 'failed' ? 'Stopped' : progress.length ? 'Running' : 'Pending';
  return (
    <section aria-labelledby="ledger-heading" className="inspector-panel ledger-panel" aria-live="polite">
      <div className="panel-heading"><h2 id="ledger-heading">Execution order</h2><span className="panel-summary">{phaseText}</span></div>
      <ol className="ledger-list">
        {SETUP_STEPS.map((step, index) => {
          const state = lastEvent.get(step.id)?.state ?? (step.id === 'install-platform' && platform === 'empty' ? 'skipped' : 'pending');
          const detail = lastEvent.get(step.id)?.detail ?? (step.id === 'install-platform' && platform === 'empty' ? 'No CMS selected; the starter page is created with the project folder.' : undefined);
          const label = step.id === 'install-platform' ? `Install ${PLATFORM_LABELS[platform]}` : step.label;
          return (
            <li className={`ledger-row ledger-row--${state}`} key={step.id}>
              <span aria-hidden="true" className="ledger-number">{state === 'complete' ? <i className="ph ph-check" /> : index + 1}</span>
              <div className="ledger-content">
                <div className="ledger-title-row"><span className="ledger-title">{label}</span><span className="ledger-state">{statusText(state)}</span></div>
                {detail ? <p className="ledger-detail" title={detail}>{detail}</p> : step.id === 'install-platform' && platform === 'wordpress' ? <p className="ledger-detail">Official archive → config → finish at /wp-admin/install.php</p> : step.id === 'install-platform' && platform === 'bookstack' ? <p className="ledger-detail">Git release → Composer → environment → key → migrations</p> : step.id === 'install-platform' && platform === 'october' ? <p className="ledger-detail">Composer → october:install → october:migrate → october:mirror</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {result?.error ? <p className="result-error" role="alert">{result.error}</p> : null}
      {result?.warnings.map((warning) => <p className="result-warning" key={warning}>{warning}</p>)}
      {result?.phase === 'completed' ? <p className="result-success"><StatusMark state="pass" />Local site is ready at <code>{result.localUrl}</code></p> : null}
    </section>
  );
}
