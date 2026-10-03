import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLongCommand } from '../process';
import type { SiteDatabaseCredentials } from '../database';
import type { SiteSetupDraft } from '../../shared/contracts';

const WORDPRESS_ARCHIVE_URL = 'https://wordpress.org/latest.zip';
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 300 * 1024 * 1024;

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function downloadWordPress(onOutput?: (text: string) => void): Promise<string> {
  onOutput?.('Downloading the official WordPress release archive.');
  const response = await fetch(WORDPRESS_ARCHIVE_URL, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`WordPress download failed with HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_ARCHIVE_BYTES) throw new Error('The WordPress archive exceeds the 80 MB safety limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The WordPress download returned no response body.');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ARCHIVE_BYTES) {
        await reader.cancel();
        throw new Error('The WordPress archive exceeded the 80 MB safety limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const scratch = await mkdtemp(join(tmpdir(), 'wamp-wordpress-'));
  await writeFile(join(scratch, 'wordpress.zip'), Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), { flag: 'wx' });
  return scratch;
}

async function extractArchiveSafely(archivePath: string, destination: string): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$archivePath = ${quotePowerShell(archivePath)}`,
    `$destination = [System.IO.Path]::GetFullPath(${quotePowerShell(destination)}).TrimEnd('\\') + '\\'`,
    '$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)',
    'try {',
    '  if ($archive.Entries.Count -gt 20000) { throw \'The archive contains too many entries.\' }',
    '  [long]$total = 0',
    '  foreach ($entry in $archive.Entries) {',
    '    $name = $entry.FullName.Replace(\'/\', \'\\\')',
    '    if ([System.IO.Path]::IsPathRooted($name) -or $name -match \'(^|\\\\)\\.\\.(\\\\|$)\' -or $name.Contains(\':\')) { throw \'The archive contains an unsafe file path.\' }',
    '    $unixMode = ([long]$entry.ExternalAttributes -shr 16) -band 0xF000',
    '    if ($unixMode -eq 0xA000) { throw \'The archive contains a symbolic link.\' }',
    '    $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($destination, $name))',
    '    if (-not $target.StartsWith($destination, [System.StringComparison]::OrdinalIgnoreCase)) { throw \'The archive contains a path outside its extraction folder.\' }',
    '    if ($entry.Name -eq \'\') { [System.IO.Directory]::CreateDirectory($target) | Out-Null; continue }',
    '    $total += $entry.Length',
    `    if ($total -gt ${MAX_UNPACKED_BYTES}) { throw 'The expanded archive exceeds the 300 MB safety limit.' }`,
    '    $parent = [System.IO.Path]::GetDirectoryName($target)',
    '    [System.IO.Directory]::CreateDirectory($parent) | Out-Null',
    '    $input = $entry.Open()',
    '    try {',
    '      $output = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)',
    '      try { $input.CopyTo($output) } finally { $output.Dispose() }',
    '    } finally { $input.Dispose() }',
    '  }',
    '} finally { $archive.Dispose() }',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await runLongCommand('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], { cwd: destination, timeoutMs: 2 * 60_000 });
}

export async function createWordPressProject(draft: SiteSetupDraft, onOutput?: (text: string) => void): Promise<void> {
  const scratch = await downloadWordPress(onOutput);
  try {
    const extracted = join(scratch, 'extracted');
    await mkdir(extracted, { recursive: false });
    onOutput?.('Validating and extracting WordPress archive paths.');
    await extractArchiveSafely(join(scratch, 'wordpress.zip'), extracted);
    const extractedRoot = join(extracted, 'wordpress');
    await mkdir(draft.projectRoot, { recursive: false });
    const entries = await readdir(extractedRoot, { withFileTypes: true });
    if (!entries.some((entry) => entry.isFile() && entry.name === 'wp-settings.php')) throw new Error('The WordPress archive did not contain the expected application files.');
    await cp(extractedRoot, draft.projectRoot, { recursive: true, errorOnExist: true, force: false });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function phpString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\r', '').replaceAll('\n', '')}'`;
}

function replacePhpConstant(source: string, name: string, value: string): string {
  const expression = new RegExp(`define\\(\\s*(['"])${name}\\1\\s*,\\s*(['"])(.*?)\\2\\s*\\);`);
  const next = `define( '${name}', ${phpString(value)} );`;
  return expression.test(source) ? source.replace(expression, next) : `${source}\n${next}\n`;
}

export async function configureWordPress(draft: SiteSetupDraft, credentials: SiteDatabaseCredentials): Promise<string[]> {
  let config = await readFile(join(draft.projectRoot, 'wp-config-sample.php'), 'utf8');
  config = replacePhpConstant(config, 'DB_NAME', credentials.databaseName);
  config = replacePhpConstant(config, 'DB_USER', credentials.username);
  config = replacePhpConstant(config, 'DB_PASSWORD', credentials.password);
  config = replacePhpConstant(config, 'DB_HOST', `${credentials.host}:${credentials.port}`);
  for (const name of ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT']) {
    config = replacePhpConstant(config, name, randomBytes(48).toString('base64url'));
  }
  await writeFile(join(draft.projectRoot, 'wp-config.php'), config, { encoding: 'utf8', flag: 'wx' });
  return ['Open /wp-admin/install.php to choose the site title and create the first WordPress administrator account.'];
}
