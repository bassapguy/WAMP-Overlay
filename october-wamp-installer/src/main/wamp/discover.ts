import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, win32 } from 'node:path';
import type { PreflightCheck, PreflightReport, ResolvedTargets, SiteSetupDraft } from '../../shared/contracts';
import { PLATFORM_LABELS } from '../../shared/contracts';
import { SiteSetupDraftSchema } from '../validation';
import { locateInPath, redactSecrets, runCommand } from '../process';

const PLATFORM_EXTENSIONS: Record<SiteSetupDraft['platform'], string[]> = {
  empty: [],
  wordpress: ['mysqli'],
  bookstack: ['curl', 'dom', 'gd', 'iconv', 'mbstring', 'mysqlnd', 'openssl', 'pdo', 'pdo_mysql', 'tokenizer', 'xml', 'zip'],
  october: ['PDO', 'pdo_mysql', 'curl', 'openssl', 'mbstring', 'zip', 'gd', 'SimpleXML'],
};
const WINDOWS_HOSTS = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');

type VersionFolder = { name: string; path: string };

async function childFolders(folder: string): Promise<VersionFolder[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: join(folder, entry.name) }))
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

async function existingFile(...paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Keep testing known variants.
    }
  }
  return null;
}


async function findWindowsService(executable: string | null): Promise<{ name: string; running: boolean } | null> {
  if (!executable) return null;
  const escaped = executable.replaceAll("'", "''");
  const command = `$needle='${escaped}'; Get-CimInstance Win32_Service | Where-Object { $_.PathName -and $_.PathName.IndexOf($needle,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1 Name,State | ConvertTo-Json -Compress`;
  try {
    const { stdout } = await runCommand('powershell.exe', ['-NoProfile', '-Command', command], { timeoutMs: 5_000 });
    if (!stdout.trim()) return null;
    const result = JSON.parse(stdout.trim()) as { Name: string; State: string };
    return { name: result.Name, running: result.State?.toLowerCase() === 'running' };
  } catch {
    return null;
  }
}

export async function findWampTargets(wampRoot: string): Promise<ResolvedTargets | null> {
  const root = resolve(wampRoot);
  const apacheFolders = await childFolders(join(root, 'bin', 'apache'));
  const phpFolders = await childFolders(join(root, 'bin', 'php'));
  const databaseFolders = [
    ...(await childFolders(join(root, 'bin', 'mysql'))),
    ...(await childFolders(join(root, 'bin', 'mariadb'))),
  ].sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));

  let apacheFolder: VersionFolder | undefined;
  let apacheExe: string | null = null;
  let httpdConf: string | null = null;
  let vhostsConf: string | null = null;
  let apacheServiceName = '';
  let apacheServiceRunning = false;
  let fallbackApache: { folder: VersionFolder; executable: string; config: string; vhosts: string; serviceName: string } | null = null;
  for (const folder of apacheFolders) {
    const executable = await existingFile(join(folder.path, 'bin', 'httpd.exe'));
    const config = await existingFile(join(folder.path, 'conf', 'httpd.conf'));
    const vhosts = await existingFile(join(folder.path, 'conf', 'extra', 'httpd-vhosts.conf'));
    if (!executable || !config || !vhosts) continue;
    const service = await findWindowsService(executable);
    const candidate = { folder, executable, config, vhosts, serviceName: service?.name ?? '' };
    fallbackApache ??= candidate;
    if (!service?.running) continue;
    apacheFolder = folder;
    apacheExe = executable;
    httpdConf = config;
    vhostsConf = vhosts;
    apacheServiceName = service.name;
    apacheServiceRunning = true;
    break;
  }
  if (!apacheExe && fallbackApache) {
    apacheFolder = fallbackApache.folder;
    apacheExe = fallbackApache.executable;
    httpdConf = fallbackApache.config;
    vhostsConf = fallbackApache.vhosts;
    apacheServiceName = fallbackApache.serviceName;
  }

  const apacheConfigText = httpdConf ? await readFile(httpdConf, 'utf8').catch(() => '') : '';
  const activePhpFolderName = apacheConfigText.match(/LoadModule\s+\S*php\S*\s+"?[^"\r\n]*?bin[/\\]php[/\\](php[^/\\]+)[/\\][^"\r\n]+/i)?.[1];
  const activePhpFolder = phpFolders.find((folder) => folder.name.toLowerCase() === activePhpFolderName?.toLowerCase());
  const orderedPhpFolders = activePhpFolder ? [activePhpFolder, ...phpFolders.filter((folder) => folder !== activePhpFolder)] : phpFolders;
  let phpFolder: VersionFolder | undefined;
  let phpExe: string | null = null;
  let phpIni: string | null = null;
  for (const folder of orderedPhpFolders) {
    phpExe = await existingFile(join(folder.path, 'php.exe'));
    phpIni = await existingFile(join(folder.path, 'php.ini'));
    if (phpExe) {
      phpFolder = folder;
      break;
    }
  }

  let dbFolder: VersionFolder | undefined;
  let dbExe: string | null = null;
  let databaseServiceName = '';
  let databaseServiceRunning = false;
  const fallbackDatabaseCandidates: Array<{ folder: VersionFolder; executable: string }> = [];
  for (const folder of databaseFolders) {
    const executable = await existingFile(
      join(folder.path, 'bin', 'mysqld.exe'),
      join(folder.path, 'bin', 'mariadbd.exe'),
      join(folder.path, 'bin', 'mysql.exe'),
    );
    if (!executable) continue;
    fallbackDatabaseCandidates.push({ folder, executable });
    const service = await findWindowsService(executable);
    if (service?.running) {
      dbFolder = folder;
      dbExe = executable;
      databaseServiceName = service.name;
      databaseServiceRunning = true;
      break;
    }
    if (!dbExe && service) {
      dbFolder = folder;
      dbExe = executable;
      databaseServiceName = service.name;
    }
  }
  if (!dbExe && fallbackDatabaseCandidates[0]) {
    dbFolder = fallbackDatabaseCandidates[0].folder;
    dbExe = fallbackDatabaseCandidates[0].executable;
  }
  const httpdVersion = apacheExe ? await runCommand(apacheExe, ['-v']).catch(() => null) : null;
  const phpVersion = phpExe ? await runCommand(phpExe, ['-v']).catch(() => null) : null;
  const databaseVersion = dbExe ? await runCommand(dbExe, ['--version']).catch(() => null) : null;
  const composerPath = await locateInPath(['composer']);
  const gitPath = await locateInPath(['git']);
  let composerVersion = '';
  if (composerPath) {
    try {
      const safePath = composerPath.replaceAll("'", "''");
      const { stdout, stderr } = await runCommand('powershell.exe', ['-NoProfile', '-Command', `& '${safePath}' --version --no-ansi`], { timeoutMs: 12_000 });
      composerVersion = `${stdout}\n${stderr}`.trim();
    } catch {
      composerVersion = '';
    }
  }

  return {
    apacheVersion: httpdVersion?.stdout.match(/Apache\/(\S+)/i)?.[1] ?? apacheFolder?.name ?? 'Not found',
    apacheServiceName,
    apacheServiceRunning,
    phpVersion: phpVersion?.stdout.match(/PHP\s+(\S+)/i)?.[1] ?? phpFolder?.name ?? 'Not found',
    databaseVersion: databaseVersion?.stdout.trim() || (dbFolder?.name ?? 'Not found'),
    databaseExe: dbExe ?? '',
    databaseServiceName,
    databaseServiceRunning,
    vhostsPath: vhostsConf ?? join(root, 'bin', 'apache', '[Apache version]', 'conf', 'extra', 'httpd-vhosts.conf'),
    httpdConfPath: httpdConf ?? join(root, 'bin', 'apache', '[Apache version]', 'conf', 'httpd.conf'),
    httpdExe: apacheExe ?? '',
    phpExe: phpExe ?? '',
    phpIni: phpIni ?? '',
    composerPhar: composerPath ?? '',
    composerVersion,
    gitPath: gitPath ?? '',
    hostsPath: WINDOWS_HOSTS,
    projectRoot: '',
    documentRoot: '',
  };
}

function check(id: string, label: string, state: PreflightCheck['state'], detail: string, blocking: boolean): PreflightCheck {
  return { id, label, state, detail, blocking };
}

function validDomain(domain: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:test|localhost)$/i.test(domain);
}

async function phpExtensions(phpExe: string, extensionList: string[]): Promise<{ missing: string[]; detail: string }> {
  if (!phpExe) return { missing: extensionList, detail: 'PHP CLI not found' };
  try {
    const { stdout } = await runCommand(phpExe, ['-m'], { timeoutMs: 8_000 });
    const present = new Set(stdout.split(/\r?\n/).map((value) => value.trim().toLowerCase()));
    const missing = extensionList.filter((extension) => !present.has(extension.toLowerCase()));
    return { missing, detail: missing.length ? `Missing ${missing.join(', ')}` : 'All required extensions loaded' };
  } catch {
    return { missing: extensionList, detail: 'Unable to read PHP modules' };
  }
}

export async function checkApacheModules(httpdConfPath: string, httpdExePath: string, vhostsConfPath: string): Promise<{ rewrite: boolean; vhosts: boolean }> {
  try {
    const content = await readFile(httpdConfPath, 'utf8');
    const includePattern = /^\s*Include(?:Optional)?\s+(?:"([^"]+)"|'([^']+)'|([^\s#]+))/gim;
    const serverRoot = content.match(/^\s*ServerRoot\s+"?([^"\r\n]+)"?/im)?.[1]?.trim();
    const apacheRoot = win32.resolve(win32.dirname(win32.dirname(httpdExePath)));
    const includeBase = serverRoot && !serverRoot.includes('${') && !serverRoot.includes('%')
      ? win32.resolve(win32.dirname(httpdConfPath), serverRoot.replaceAll('/', '\\'))
      : apacheRoot;
    let match: RegExpExecArray | null;
    let vhostsIncluded = false;
    while ((match = includePattern.exec(content))) {
      const includeValue = (match[1] ?? match[2] ?? match[3] ?? '').replaceAll('/', '\\');
      if (!includeValue || /[*?]/.test(includeValue)) continue;
      const resolvedInclude = win32.isAbsolute(includeValue) ? win32.resolve(includeValue) : win32.resolve(includeBase, includeValue);
      if (resolvedInclude.toLowerCase() === win32.resolve(vhostsConfPath).toLowerCase()) {
        vhostsIncluded = true;
        break;
      }
    }
    return { rewrite: /^\s*LoadModule\s+rewrite_module\s+/im.test(content), vhosts: vhostsIncluded };
  } catch {
    return { rewrite: false, vhosts: false };
  }
}

export async function buildPreflight(draftInput: SiteSetupDraft): Promise<PreflightReport> {
  const draft = SiteSetupDraftSchema.parse(draftInput);
  const root = resolve(draft.wampRoot);
  const checks: PreflightCheck[] = [];
  const targets = await findWampTargets(root);
  const wampExists = await stat(root).then((entry) => entry.isDirectory()).catch(() => false);
  const targetBinariesFound = Boolean(targets?.httpdExe && targets.phpExe && targets.databaseExe);
  checks.push(check('wamp', 'WampServer folder', wampExists && targetBinariesFound ? 'pass' : 'blocked', wampExists && targetBinariesFound ? root : 'Choose a WampServer folder with Apache, PHP, and database version folders.', true));

  const projectRoot = resolve(draft.projectRoot);
  const documentRoot = resolve(draft.documentRoot);
  const allowedRoot = resolve(root, 'www');
  const rootContained = projectRoot.toLowerCase().startsWith(`${allowedRoot.toLowerCase()}\\`);
  const documentRootContained = documentRoot.toLowerCase() === projectRoot.toLowerCase()
    || documentRoot.toLowerCase().startsWith(`${projectRoot.toLowerCase()}\\`);
  const siteInputValid = validDomain(draft.domain) && rootContained && documentRootContained;
  checks.push(check('site-input', 'Site path and local domain', siteInputValid ? 'pass' : 'blocked', siteInputValid ? `${draft.domain} → ${documentRoot}` : 'Use a .test/.localhost domain and keep the site folder under Wamp www with its document root inside the project.', true));
  const wwwAvailable = await stat(allowedRoot).then((entry) => entry.isDirectory()).catch(() => false);
  checks.push(check('www-directory', 'Wamp www folder', wwwAvailable ? 'pass' : 'blocked', wwwAvailable ? allowedRoot : 'The selected WampServer www folder does not exist. Choose a valid WampServer root.', true));

  if (!targets) {
    checks.push(check('apache', 'Apache service', 'blocked', 'Apache was not found under the selected WampServer folder.', true));
    checks.push(check('database', 'Database service', 'blocked', 'MySQL or MariaDB was not found under the selected WampServer folder.', true));
    const requiresPhp = draft.platform !== 'empty';
    const requiresComposer = draft.platform === 'bookstack' || draft.platform === 'october';
    checks.push(check('php', 'PHP version', requiresPhp ? 'blocked' : 'warning', requiresPhp ? 'PHP is required for the selected platform.' : 'Not required for an empty starter site.', requiresPhp));
    checks.push(check('composer', 'Composer', requiresComposer ? 'blocked' : 'warning', requiresComposer ? 'Composer 2+ is required for the selected platform.' : 'Not required for this platform.', requiresComposer));
    checks.push(check('git', 'Git', draft.platform === 'bookstack' ? 'blocked' : 'warning', draft.platform === 'bookstack' ? 'Git is required to fetch the BookStack release branch.' : 'Not required for this platform.', draft.platform === 'bookstack'));
    checks.push(check('extensions', 'Required PHP extensions', requiresPhp && PLATFORM_EXTENSIONS[draft.platform].length ? 'blocked' : 'warning', requiresPhp ? `Required for ${PLATFORM_LABELS[draft.platform]}.` : 'Not required for an empty starter site.', requiresPhp && PLATFORM_EXTENSIONS[draft.platform].length > 0));
    checks.push(check('apache-config', 'Apache modules and vhost include', 'blocked', 'The Apache configuration could not be located.', true));
  } else {
    const serviceReady = targets.apacheServiceRunning && Boolean(targets.apacheServiceName);
    checks.push(check('apache', 'Apache service', serviceReady ? 'pass' : 'blocked', targets.apacheServiceName ? `${targets.apacheVersion} · ${targets.apacheServiceName} ${serviceReady ? 'running' : 'stopped · start it from the WampServer tray'}` : `${targets.apacheVersion} · service name not detected`, !serviceReady));

    const minPhp = draft.platform === 'wordpress' ? 8.3 : 8.2;
    const requiresPhp = draft.platform !== 'empty';
    const phpMatch = targets.phpVersion.match(/(\d+)\.(\d+)/);
    const phpMajor = Number(phpMatch?.[1] ?? 0);
    const phpMinor = Number(phpMatch?.[2] ?? 0);
    const phpSupported = phpMajor > Math.floor(minPhp) || (phpMajor === Math.floor(minPhp) && phpMinor >= Math.round((minPhp % 1) * 10));
    checks.push(check('php', 'PHP version', !requiresPhp ? 'warning' : phpSupported ? 'pass' : 'blocked', !requiresPhp ? 'Not required for an empty starter site.' : `${targets.phpVersion}${phpSupported ? '' : ` · ${minPhp.toFixed(1)}+ required`}`, requiresPhp && !phpSupported));

    const composerMajor = Number(targets.composerVersion.match(/Composer\s+version\s+(\d+)/i)?.[1] ?? '0');
    const composerMinor = Number(targets.composerVersion.match(/Composer\s+version\s+\d+\.(\d+)/i)?.[1] ?? '0');
    const requiresComposer = draft.platform === 'bookstack' || draft.platform === 'october';
    const composerSupported = composerMajor >= 3 || (composerMajor === 2 && (draft.platform !== 'bookstack' || composerMinor >= 2));
    checks.push(check('composer', 'Composer', !requiresComposer ? 'warning' : composerSupported ? 'pass' : 'blocked', !requiresComposer ? 'Not required for this platform.' : composerSupported ? targets.composerVersion.split(/\r?\n/)[0] : draft.platform === 'bookstack' ? 'Composer 2.2+ was not detected on PATH.' : 'Composer 2+ was not detected on PATH.', requiresComposer && !composerSupported));
    checks.push(check('git', 'Git', draft.platform !== 'bookstack' ? 'warning' : targets.gitPath ? 'pass' : 'blocked', draft.platform !== 'bookstack' ? 'Not required for this platform.' : targets.gitPath ? targets.gitPath : 'Install Git and add it to PATH.', draft.platform === 'bookstack' && !targets.gitPath));

    let dbConnection = false;
    let existingDatabase = false;
    let databasePathMatches = false;
    let dbDetail = `Testing ${draft.dbHost}:${draft.dbPort}`;
    let dbClient: Awaited<ReturnType<(typeof import('mysql2/promise'))['createConnection']>> | null = null;
    try {
      const mysql = await import('mysql2/promise');
      dbClient = await mysql.createConnection({ host: draft.dbHost, port: draft.dbPort, user: draft.dbAdminUser, password: draft.dbAdminPassword, connectTimeout: 3_000 });
      const [versionRows] = await dbClient.query('SELECT VERSION() AS version, @@basedir AS basedir');
      const [rows] = await dbClient.query('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [draft.databaseName]);
      if (Array.isArray(versionRows) && versionRows[0] && typeof versionRows[0] === 'object') {
        const serverInfo = versionRows[0] as { version?: string; basedir?: string };
        if (serverInfo.version) targets.databaseVersion = serverInfo.version;
        if (serverInfo.basedir) {
          const databaseRoot = resolve(serverInfo.basedir);
          const relativeRoot = relative(root, databaseRoot);
          databasePathMatches = relativeRoot === '' || (!relativeRoot.startsWith('..') && !isAbsolute(relativeRoot));
        }
      }
      existingDatabase = Array.isArray(rows) && rows.length > 0;
      dbConnection = true;
      dbDetail = existingDatabase ? `${targets.databaseVersion} · ${draft.databaseName} already exists` : `${targets.databaseVersion} · connected as ${draft.dbAdminUser}`;
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : 'Database connection failed';
      dbDetail = redactSecrets(message, [draft.dbAdminPassword]);
    } finally {
      if (dbClient) await dbClient.end().catch(() => undefined);
    }
    const databaseServiceReady = targets.databaseServiceRunning && Boolean(targets.databaseServiceName);
    const databaseVersionMatch = targets.databaseVersion.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    const databaseMajor = Number(databaseVersionMatch?.[1] ?? 0);
    const databaseMinor = Number(databaseVersionMatch?.[2] ?? 0);
    const databaseMinimum = draft.platform === 'wordpress'
      ? { mysql: { major: 8, minor: 0 }, mariaDb: { major: 10, minor: 11 } }
      : draft.platform === 'bookstack'
        ? { mysql: { major: 8, minor: 0 }, mariaDb: { major: 10, minor: 6 } }
        : draft.platform === 'october'
          ? { mysql: { major: 5, minor: 7 }, mariaDb: { major: 10, minor: 2 } }
          : { mysql: { major: 0, minor: 0 }, mariaDb: { major: 0, minor: 0 } };
    const isMariaDb = /maria/i.test(targets.databaseVersion);
    const minimum = isMariaDb ? databaseMinimum.mariaDb : databaseMinimum.mysql;
    const databaseSupported = draft.platform === 'empty'
      || databaseMajor > minimum.major
      || (databaseMajor === minimum.major && databaseMinor >= minimum.minor);
    const dbReady = dbConnection && databaseServiceReady && databasePathMatches && !existingDatabase && databaseSupported;
    const dbDetailForPlatform = draft.platform !== 'empty' && !databaseSupported
      ? `${targets.databaseVersion} · requires MySQL ${databaseMinimum.mysql.major}.${databaseMinimum.mysql.minor}+ or MariaDB ${databaseMinimum.mariaDb.major}.${databaseMinimum.mariaDb.minor}+`
      : dbDetail;
    checks.push(check('database', 'Database service', dbReady ? 'pass' : 'blocked', !databaseServiceReady ? 'Start the selected WampServer MySQL/MariaDB service from the tray menu, then check again.' : dbConnection && !databasePathMatches ? 'The database connection is not the WampServer instance under the selected root.' : dbDetailForPlatform, true));

    const extensionList = PLATFORM_EXTENSIONS[draft.platform];
    if (!extensionList.length) {
      checks.push(check('extensions', 'Required PHP extensions', 'warning', 'Not required for an empty starter site.', false));
    } else {
      const extensionResult = await phpExtensions(targets.phpExe, extensionList);
      checks.push(check('extensions', 'Required PHP extensions', extensionResult.missing.length === 0 ? 'pass' : 'blocked', extensionResult.detail, extensionResult.missing.length > 0));
    }

    const modules = await checkApacheModules(targets.httpdConfPath, targets.httpdExe, targets.vhostsPath);
    let vhostConfigOkay = false;
    try {
      await readFile(targets.vhostsPath, 'utf8');
      const apacheRoot = win32.dirname(win32.dirname(targets.httpdExe));
      const result = await runCommand(targets.httpdExe, ['-d', apacheRoot, '-f', targets.httpdConfPath, '-t'], { timeoutMs: 10_000 });
      vhostConfigOkay = result.exitCode === 0;
    } catch {
      vhostConfigOkay = false;
    }
    const needsRewrite = draft.platform !== 'empty';
    const configState = vhostConfigOkay && modules.vhosts && (!needsRewrite || modules.rewrite) ? 'pass' : 'blocked';
    const configDetail = needsRewrite && !modules.rewrite ? 'mod_rewrite is not enabled.' : !modules.vhosts ? 'httpd-vhosts.conf is not included in httpd.conf.' : vhostConfigOkay ? 'Vhost include and Apache syntax are ready.' : 'Apache configuration test failed.';
    checks.push(check('apache-config', 'Apache modules and vhost include', configState, configDetail, true));

    const vhosts = await readFile(targets.vhostsPath, 'utf8').catch(() => '');
    const hasDomainReference = vhosts.split(/\r?\n/).some((line) => {
      const directive = line.split('#', 1)[0].trim();
      const match = directive.match(/^\s*(?:ServerName|ServerAlias)\s+(.+)$/i);
      return Boolean(match?.[1].split(/\s+/).some((host) => host.toLowerCase() === draft.domain.toLowerCase()));
    });
    if (hasDomainReference) {
      checks.push(check('domain-conflict', 'Domain availability', 'blocked', 'A matching ServerName or ServerAlias already exists in httpd-vhosts.conf. Choose another local domain.', true));
    } else {
      checks.push(check('domain-conflict', 'Domain availability', 'pass', 'No existing vhost uses this domain.', false));
    }

    const hosts = await readFile(targets.hostsPath, 'utf8').catch(() => '');
    const domainHostLines = hosts.split(/\r?\n/).filter((line) => line.split('#')[0].trim().split(/\s+/).slice(1).some((host) => host.toLowerCase() === draft.domain.toLowerCase()));
    const conflictingHost = domainHostLines.some((line) => !/^\s*127\.0\.0\.1\s/i.test(line));
    if (conflictingHost) {
      checks.push(check('hosts', 'Windows hosts entry', 'blocked', 'This domain already resolves to a non-loopback address in the Windows hosts file.', true));
    } else {
      checks.push(check('hosts', 'Windows hosts entry', 'warning', domainHostLines.length ? 'Already mapped to 127.0.0.1.' : 'A loopback entry will be added; Windows may ask for Administrator permission.', false));
    }

    targets.projectRoot = projectRoot;
    targets.documentRoot = documentRoot;
  }

  if (targets) {
    const folderExists = await stat(projectRoot).then(() => true).catch(() => false);
    checks.push(check('folder', 'Project folder availability', folderExists ? 'blocked' : 'pass', folderExists ? 'The project destination already exists; choose a new folder to avoid overwriting data.' : projectRoot, true));
  }

  const canStart = checks.every((entry) => !entry.blocking || entry.state === 'pass');
  return {
    checkedAt: Date.now(),
    checks,
    targets,
    databaseName: draft.databaseName,
    canStart,
  };
}
