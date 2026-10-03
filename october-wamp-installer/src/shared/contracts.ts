export type InstallablePlatform = 'empty' | 'wordpress' | 'bookstack' | 'october';
export type DetectedPlatform = InstallablePlatform | 'unknown' | 'ambiguous';
export type VhostState = 'ready' | 'missing-root' | 'unresolved-root' | 'unknown-platform' | 'ambiguous-platform';

export interface SiteSetupDraft {
  wampRoot: string;
  siteName: string;
  domain: string;
  projectRoot: string;
  documentRoot: string;
  dbHost: string;
  dbPort: number;
  dbAdminUser: string;
  dbAdminPassword: string;
  databaseName: string;
  platform: InstallablePlatform;
  licenseKey: string;
}

export type CheckState = 'unchecked' | 'running' | 'pass' | 'warning' | 'blocked' | 'failed';
export type StepState = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
export type SetupPhase = 'idle' | 'checking' | 'running' | 'completed' | 'partial' | 'failed';
export type SetupStepId = 'create-folder' | 'provision-database' | 'install-platform' | 'write-vhost' | 'validate-reload-apache';

export interface PreflightCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  blocking: boolean;
}

export interface ResolvedTargets {
  apacheVersion: string;
  apacheServiceName: string;
  apacheServiceRunning: boolean;
  phpVersion: string;
  databaseVersion: string;
  databaseExe: string;
  databaseServiceName: string;
  databaseServiceRunning: boolean;
  vhostsPath: string;
  httpdConfPath: string;
  httpdExe: string;
  phpExe: string;
  phpIni: string;
  composerPhar: string;
  composerVersion: string;
  gitPath: string;
  hostsPath: string;
  projectRoot: string;
  documentRoot: string;
}

export interface ConfiguredVhost {
  id: string;
  serverName: string;
  aliases: string[];
  documentRoot: string | null;
  documentRootSource: 'vhost' | 'global-default' | 'unresolved';
  configPath: string;
  state: VhostState;
  detectedPlatform: DetectedPlatform;
  evidence: string[];
  canOpenLocally: boolean;
}

export interface VhostInventory {
  wampRoot: string;
  vhostsPath: string;
  checkedAt: number;
  sites: ConfiguredVhost[];
  warnings: string[];
}

export interface PreflightReport {
  checkedAt: number;
  checks: PreflightCheck[];
  targets: ResolvedTargets | null;
  databaseName: string;
  canStart: boolean;
  draftFingerprint?: string;
}

export interface ProgressEvent {
  runId: string;
  stepId: SetupStepId;
  state: StepState;
  detail: string;
  timestamp: number;
}

export interface SetupResult {
  phase: SetupPhase;
  runId: string;
  domain: string;
  localUrl: string;
  databaseName: string;
  completedSteps: SetupStepId[];
  warnings: string[];
  error?: string;
}

export interface InitialConfig {
  suggestedWampRoot: string;
}

export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  detail: string;
  percent?: number;
}

export interface InstallerApi {
  getInitialConfig: () => Promise<InitialConfig>;
  browseForDirectory: (startingPath?: string) => Promise<string | null>;
  listConfiguredVhosts: (wampRoot: string) => Promise<VhostInventory>;
  confirmChanges: (details: { domain: string; projectRoot: string; databaseName: string }) => Promise<boolean>;
  runPreflight: (draft: SiteSetupDraft) => Promise<PreflightReport>;
  createLocalSite: (draft: SiteSetupDraft) => Promise<SetupResult>;
  openLocalSite: (domain: string) => Promise<void>;
  onProgress: (callback: (event: ProgressEvent) => void) => () => void;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdates: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => void;
  onUpdateStatus: (callback: (state: UpdateState) => void) => () => void;
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => void;
}

export const PLATFORM_OPTIONS: ReadonlyArray<{ id: InstallablePlatform | 'companyassistant'; label: string; description: string; disabled?: boolean }> = [
  { id: 'empty', label: 'Empty site', description: 'Create a simple local starter page.' },
  { id: 'wordpress', label: 'WordPress', description: 'Download WordPress and prepare its local database configuration.' },
  { id: 'bookstack', label: 'BookStack', description: 'Install BookStack using Git, Composer, and WampServer PHP.' },
  { id: 'october', label: 'October CMS', description: 'Install October CMS and optionally bind a license key.' },
  { id: 'companyassistant', label: 'Companyassistant', description: 'This installer is not available yet.', disabled: true },
];

export const PLATFORM_LABELS: Record<InstallablePlatform, string> = {
  empty: 'Empty site',
  wordpress: 'WordPress',
  bookstack: 'BookStack',
  october: 'October CMS',
};

export const SETUP_STEPS: ReadonlyArray<{ id: SetupStepId; label: string }> = [
  { id: 'create-folder', label: 'Create project folder' },
  { id: 'provision-database', label: 'Provision site database and user' },
  { id: 'install-platform', label: 'Install selected platform' },
  { id: 'write-vhost', label: 'Write vhost configuration' },
  { id: 'validate-reload-apache', label: 'Validate and reload Apache' },
];
