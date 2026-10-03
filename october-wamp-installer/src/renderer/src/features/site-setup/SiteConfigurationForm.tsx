import type { ChangeEvent, ReactNode } from 'react';
import type { InstallablePlatform, SiteSetupDraft } from '../../../../shared/contracts';
import { PLATFORM_LABELS } from '../../../../shared/contracts';
import PlatformSelector from './PlatformSelector';

interface SiteConfigurationFormProps {
  draft: SiteSetupDraft;
  locked: boolean;
  onChange: <K extends keyof SiteSetupDraft>(key: K, value: SiteSetupDraft[K]) => void;
  onBrowse: (field: 'wampRoot' | 'projectRoot') => void;
  discoverySummary: string;
  errors: Record<string, string>;
}

function Field({
  id,
  label,
  value,
  placeholder,
  disabled,
  type = 'text',
  help,
  onChange,
  mono = true,
  action,
  inputMode,
  error,
}: {
  id: string;
  label: ReactNode;
  value: string | number;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  help?: string;
  mono?: boolean;
  action?: { label: string; icon: string; onClick: () => void };
  inputMode?: 'numeric' | 'text';
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`field-control${action ? ' field-control--action' : ''}`}>
        <input
          aria-describedby={[help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          className={mono ? 'field-input field-input--mono' : 'field-input'}
          disabled={disabled}
          title={typeof value === 'string' ? value : undefined}
          id={id}
          inputMode={inputMode}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          type={type}
          value={value}
        />
        {action ? (
          <button aria-label={action.label} className="field-action" disabled={disabled} onClick={action.onClick} type="button">
            <i aria-hidden="true" className={`ph ${action.icon}`} />
            <span>{action.label}</span>
          </button>
        ) : null}
      </div>
      {help ? <p className="field-help" id={`${id}-help`}>{help}</p> : null}
      {error ? <p className="field-error" id={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

export default function SiteConfigurationForm({ draft, locked, onChange, onBrowse, discoverySummary, errors }: SiteConfigurationFormProps) {
  const platform = draft.platform as InstallablePlatform;
  const servedRootHelp = platform === 'bookstack' || platform === 'october'
    ? `${PLATFORM_LABELS[platform]} serves its public folder; the rest of the project stays outside the web root.`
    : platform === 'wordpress'
      ? 'WordPress is served from the site project folder.'
      : 'The starter page is served from the site project folder.';

  return (
    <section aria-label="Site configuration" className="configuration-panel">
      <div className="form-section form-section--first">
        <h2>WampServer installation</h2>
        <Field
          action={{ label: 'Browse', icon: 'ph-folder-open', onClick: () => onBrowse('wampRoot') }}
          disabled={locked}
          id="wamp-root"
          label="WampServer folder"
          error={errors.wampRoot}
          onChange={(value) => onChange('wampRoot', value)}
          value={draft.wampRoot}
        />
        <p className="form-detail"><span>Service/version discovery</span><span title={discoverySummary}>{discoverySummary}</span></p>
      </div>

      <div className="form-section">
        <PlatformSelector disabled={locked} onChange={(value) => onChange('platform', value)} value={platform} />
        {draft.platform === 'bookstack' ? <p className="platform-install-note">BookStack’s official setup guide is Linux-focused. This Windows/WampServer install is best-effort and needs manual verification.</p> : null}
        {draft.platform === 'wordpress' ? <p className="platform-install-note">WordPress files and database settings will be prepared. Complete the site title and administrator account in WordPress after setup.</p> : null}
      </div>

      <div className="form-section">
        <h2>Site details</h2>
        <div className="form-grid form-grid--two">
          <Field disabled={locked} error={errors.siteName} id="site-name" label="Project / site name" mono={false} onChange={(value) => onChange('siteName', value)} placeholder="my-new-site" value={draft.siteName} />
          <Field disabled={locked} error={errors.domain} id="site-domain" label="Local domain" mono={false} onChange={(value) => onChange('domain', value)} placeholder="my-new-site.test" value={draft.domain} />
          <Field
            action={{ label: 'Choose parent', icon: 'ph-folder-open', onClick: () => onBrowse('projectRoot') }}
            disabled={locked}
            id="project-root"
            label="Project folder"
            error={errors.projectRoot}
            onChange={(value) => onChange('projectRoot', value)}
            value={draft.projectRoot}
          />
          <Field
            disabled={locked}
            help={servedRootHelp}
            id="document-root"
            label="Document root"
            error={errors.documentRoot}
            onChange={(value) => onChange('documentRoot', value)}
            value={draft.documentRoot}
          />
        </div>
      </div>

      <div className="form-section">
        <h2><i aria-hidden="true" className="ph ph-database" />Database connection</h2>
        <div className="form-grid form-grid--database">
          <Field disabled={locked} error={errors.dbHost} id="db-host" label="Host" onChange={(value) => onChange('dbHost', value)} value={draft.dbHost} />
          <Field disabled={locked} error={errors.dbPort} id="db-port" inputMode="numeric" label="Port" onChange={(value) => onChange('dbPort', Number(value) || 0)} type="number" value={draft.dbPort || ''} />
          <Field disabled={locked} error={errors.dbAdminUser} id="db-user" label="Admin username" onChange={(value) => onChange('dbAdminUser', value)} value={draft.dbAdminUser} />
          <Field disabled={locked} error={errors.databaseName} id="db-name" label="Database name" onChange={(value) => onChange('databaseName', value)} value={draft.databaseName} />
          <Field disabled={locked} error={errors.dbAdminPassword} id="db-password" label="Admin password" onChange={(value) => onChange('dbAdminPassword', value)} type="password" value={draft.dbAdminPassword} />
        </div>
        <p className="field-help">The installer creates a separate account limited to this site’s database.</p>
      </div>

      {draft.platform === 'october' ? (
        <div className="form-section form-section--last">
          <h2>October CMS license</h2>
          <Field
            disabled={locked}
            help="Optional for local use. Marketplace access and project updates remain limited without a key."
            id="license-key"
            label={<><i aria-hidden="true" className="ph ph-key" />License key <span className="optional">(optional for local use)</span></>}
            error={errors.licenseKey}
            onChange={(value) => onChange('licenseKey', value)}
            placeholder="Enter license key"
            type="password"
            value={draft.licenseKey}
          />
        </div>
      ) : null}
    </section>
  );
}
