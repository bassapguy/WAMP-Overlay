import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SiteDatabaseCredentials } from '../database';
import type { ResolvedTargets, SiteSetupDraft } from '../../shared/contracts';
import { redactSecrets, runLongCommand } from '../process';

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function environmentValue(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '').replaceAll('\n', '')}"`;
}

async function runComposer(targets: ResolvedTargets, args: string[], cwd: string, secrets: string[], onOutput?: (text: string) => void): Promise<void> {
  if (!targets.composerPhar) throw new Error('Composer 2.2 or later was not found. Install Composer and add it to PATH.');
  const command = `& ${quotePowerShell(targets.composerPhar)} ${args.map(quotePowerShell).join(' ')}; exit $LASTEXITCODE`;
  const env = { ...process.env, PATH: `${dirname(targets.phpExe)};${dirname(targets.composerPhar)};${process.env.PATH ?? ''}` };
  await runLongCommand('powershell.exe', ['-NoProfile', '-Command', command], { cwd, env, timeoutMs: 45 * 60_000, secrets }, onOutput);
}

function setEnvironment(contents: string, key: string, value: string): string {
  const expression = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${environmentValue(value)}`;
  return expression.test(contents) ? contents.replace(expression, line) : `${contents}${contents.endsWith('\n') ? '' : '\n'}${line}\n`;
}

export async function createBookStackProject(draft: SiteSetupDraft, targets: ResolvedTargets, onOutput?: (text: string) => void): Promise<void> {
  if (!targets.gitPath) throw new Error('Git was not found. Install Git for Windows and add it to PATH.');
  await mkdir(dirname(draft.projectRoot), { recursive: true });
  onOutput?.('Fetching the official BookStack release branch with Git.');
  await runLongCommand(targets.gitPath, ['clone', '--branch', 'release', '--single-branch', 'https://source.bookstackapp.com/bookstack.git', draft.projectRoot], {
    cwd: dirname(draft.projectRoot),
    timeoutMs: 15 * 60_000,
  }, onOutput);
}

export async function installBookStack(draft: SiteSetupDraft, targets: ResolvedTargets, credentials: SiteDatabaseCredentials, onOutput?: (text: string) => void): Promise<string[]> {
  const secrets = [draft.dbAdminPassword, credentials.password];
  onOutput?.('Installing production Composer dependencies.');
  await runComposer(targets, ['install', '--no-dev', '--no-interaction', '--prefer-dist'], draft.projectRoot, secrets, onOutput);

  const envExample = await readFile(join(draft.projectRoot, '.env.example'), 'utf8');
  let env = envExample;
  const values: Record<string, string> = {
    APP_URL: `http://${draft.domain}`,
    DB_HOST: credentials.host,
    DB_PORT: String(credentials.port),
    DB_DATABASE: credentials.databaseName,
    DB_USERNAME: credentials.username,
    DB_PASSWORD: credentials.password,
    MAIL_MAILER: 'log',
  };
  for (const [key, value] of Object.entries(values)) env = setEnvironment(env, key, value);
  await writeFile(join(draft.projectRoot, '.env'), env, { encoding: 'utf8', flag: 'wx' });

  const artisan = join(draft.projectRoot, 'artisan');
  onOutput?.('Generating the BookStack application key.');
  await runLongCommand(targets.phpExe, [artisan, 'key:generate', '--force'], { cwd: draft.projectRoot, timeoutMs: 120_000, secrets }, onOutput);
  onOutput?.('Applying BookStack database migrations.');
  await runLongCommand(targets.phpExe, [artisan, 'migrate', '--force'], { cwd: draft.projectRoot, timeoutMs: 8 * 60_000, secrets }, onOutput);
  return [
    'BookStack upstream documents Linux-focused installation workflows. Verify Apache write access to storage, bootstrap/cache, and public/uploads on this Windows/WampServer setup.',
    'Configure SMTP before relying on account invitations or password reset email.',
    'Change the initial BookStack administrator password immediately after the first sign-in.',
  ].map((warning) => redactSecrets(warning, secrets));
}
