import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { SiteSetupDraft, ResolvedTargets } from '../../shared/contracts';
import { redactSecrets, runLongCommand } from '../process';
import { mirrorOctober } from '../windows/elevation';

export interface OctoberInstallResult {
  detail: string;
  documentRoot: string;
  warnings: string[];
}

function quotePs(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteEnv(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$')}"`;
}

async function runComposer(composerPath: string, args: string[], cwd: string, phpPath: string, secrets: string[], onOutput?: (text: string) => void): Promise<void> {
  const env = { ...process.env, PATH: `${dirname(phpPath)};${dirname(composerPath)};${process.env.PATH ?? ''}` };
  const command = `& ${quotePs(composerPath)} ${args.map(quotePs).join(' ')}; exit $LASTEXITCODE`;
  await runLongCommand('powershell.exe', ['-NoProfile', '-Command', command], { cwd, env, timeoutMs: 45 * 60_000, secrets }, onOutput);
}

export async function createOctoberProject(draft: SiteSetupDraft, targets: ResolvedTargets, onOutput?: (text: string) => void): Promise<void> {
  const secrets = [draft.dbAdminPassword, draft.licenseKey].filter(Boolean);
  if (!targets.composerPhar) throw new Error('Composer was not found. Install Composer 2 or add it to PATH, then check again.');
  if (!targets.phpExe) throw new Error('The WampServer PHP executable was not found.');
  onOutput?.('Creating October CMS project with Composer.');
  await runComposer(
    targets.composerPhar,
    ['create-project', 'october/october', basename(draft.projectRoot), '--no-interaction', '--prefer-dist'],
    dirname(draft.projectRoot),
    targets.phpExe,
    secrets,
    onOutput,
  );
}

async function configureOctoberEnv(draft: SiteSetupDraft, credentials: { host: string; port: number; databaseName: string; username: string; password: string }): Promise<void> {
  const envPath = join(draft.projectRoot, '.env');
  let contents = await readFile(envPath, 'utf8').catch(() => 'APP_ENV=local\n');
  const values: Record<string, string> = {
    APP_URL: `http://${draft.domain}`,
    DB_CONNECTION: 'mysql',
    DB_HOST: credentials.host,
    DB_PORT: String(credentials.port),
    DB_DATABASE: credentials.databaseName,
    DB_USERNAME: credentials.username,
    DB_PASSWORD: credentials.password,
  };
  for (const [key, value] of Object.entries(values)) {
    const expression = new RegExp(`^${key}=.*$`, 'm');
    const nextLine = `${key}=${quoteEnv(value)}`;
    if (expression.test(contents)) contents = contents.replace(expression, nextLine);
    else contents += `${contents.endsWith('\n') ? '' : '\n'}${nextLine}\n`;
  }
  await writeFile(envPath, contents, 'utf8');
}

export async function installOctober(
  draft: SiteSetupDraft,
  targets: ResolvedTargets,
  credentials: { host: string; port: number; databaseName: string; username: string; password: string },
  onOutput?: (text: string) => void,
): Promise<OctoberInstallResult> {
  const secrets = [draft.dbAdminPassword, draft.licenseKey, credentials.password].filter(Boolean);
  await configureOctoberEnv(draft, credentials);
  const artisan = join(draft.projectRoot, 'artisan');
  if (draft.licenseKey) {
    onOutput?.('Registering the supplied October CMS license key.');
    await runLongCommand(targets.phpExe, [artisan, 'project:set', draft.licenseKey], { cwd: draft.projectRoot, timeoutMs: 90_000, secrets }, onOutput);
  }
  onOutput?.('Running the October CMS installer.');
  await runLongCommand(targets.phpExe, [artisan, 'october:install', '--no-interaction'], { cwd: draft.projectRoot, timeoutMs: 8 * 60_000, secrets }, onOutput);
  onOutput?.('Applying October CMS database migrations.');
  await runLongCommand(targets.phpExe, [artisan, 'october:migrate', '--no-interaction'], { cwd: draft.projectRoot, timeoutMs: 8 * 60_000, secrets }, onOutput);
  onOutput?.('Creating the October public folder (Administrator permission required).');
  const mirror = await mirrorOctober(draft.projectRoot, targets.phpExe, draft.wampRoot);
  if (!mirror.ok) throw new Error(mirror.detail);
  return {
    detail: redactSecrets('October CMS installed, migrated, and mirrored.', secrets),
    documentRoot: join(draft.projectRoot, 'public'),
    warnings: ['October documents --no-interaction in its DDEV workflow. A direct Windows Composer install may still request input; failures remain visible for manual completion.'],
  };
}
