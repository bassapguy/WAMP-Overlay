import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve, win32 } from 'node:path';
import type { ConfiguredVhost, DetectedPlatform, VhostInventory, VhostState } from '../../shared/contracts';
import { checkApacheModules, findWampTargets } from './discover';

interface ParsedVhost {
  id: string;
  line: number;
  serverName: string;
  aliases: string[];
  documentRoot: string | null;
  documentRootSource: 'vhost' | 'global-default' | 'unresolved';
}

function stripApacheComment(line: string): string {
  let quote = '';
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote) {
      escaped = true;
      continue;
    }
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? '' : character;
      continue;
    }
    if (character === '#' && !quote) return line.slice(0, index);
  }
  return line;
}

function directiveValue(line: string, name: string): string | null {
  const match = line.match(new RegExp(`^\\s*${name}\\s+(?:"([^"]*)"|'([^']*)'|(.+?))\\s*$`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '').trim() : null;
}

function collectDefines(text: string, values: Map<string, string>): void {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripApacheComment(rawLine).trim();
    const match = line.match(/^Define\s+([A-Za-z_][\w]*)\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/i);
    if (match) values.set(match[1], match[2] ?? match[3] ?? match[4] ?? '');
  }
}

function expandApacheVariables(value: string, defines: Map<string, string>): string | null {
  let expanded = value;
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const matches = Array.from(expanded.matchAll(/\$\{([A-Za-z_][\w]*)\}/g));
    if (!matches.length) return /\$\{|%[^%]+%/.test(expanded) ? null : expanded;
    for (const match of matches) {
      const key = match[1];
      if (seen.has(key) || !defines.has(key)) return null;
      seen.add(key);
      expanded = expanded.replaceAll(match[0], defines.get(key)!);
    }
  }
  return /\$\{|%[^%]+%/.test(expanded) ? null : expanded;
}

function resolveApachePath(value: string | null, base: string, defines: Map<string, string>): string | null {
  if (!value) return null;
  const expanded = expandApacheVariables(value, defines);
  if (!expanded) return null;
  const normalized = expanded.replaceAll('/', '\\');
  const absolute = win32.isAbsolute(normalized) || isAbsolute(normalized);
  return win32.normalize(absolute ? normalized : win32.resolve(base, normalized));
}

export function parseConfiguredVhosts(httpdConf: string, vhostsConf: string, httpdConfPath: string): ParsedVhost[] {
  const defines = new Map<string, string>();
  collectDefines(httpdConf, defines);
  collectDefines(vhostsConf, defines);

  let serverRootValue: string | null = null;
  let globalDocumentRootValue: string | null = null;
  for (const rawLine of httpdConf.split(/\r?\n/)) {
    const line = stripApacheComment(rawLine).trim();
    serverRootValue ??= directiveValue(line, 'ServerRoot');
    globalDocumentRootValue ??= directiveValue(line, 'DocumentRoot');
  }
  const configDirectory = win32.dirname(httpdConfPath);
  const serverRoot = resolveApachePath(serverRootValue, configDirectory, defines) ?? win32.dirname(win32.dirname(httpdConfPath));
  const globalDocumentRoot = resolveApachePath(globalDocumentRootValue, serverRoot, defines);

  const parsed: ParsedVhost[] = [];
  let current: Omit<ParsedVhost, 'id'> | null = null;
  let depth = 0;
  let lineNumber = 0;
  for (const rawLine of vhostsConf.split(/\r?\n/)) {
    lineNumber += 1;
    const line = stripApacheComment(rawLine).trim();
    if (!line) continue;
    if (/^<\s*VirtualHost\b/i.test(line)) {
      if (current) depth += 1;
      else {
        current = { line: lineNumber, serverName: '', aliases: [], documentRoot: null, documentRootSource: 'unresolved' };
        depth = 1;
      }
      continue;
    }
    if (/^<\s*\/\s*VirtualHost\s*>/i.test(line)) {
      if (current && depth > 1) depth -= 1;
      else if (current) {
        if (!current.documentRoot && globalDocumentRoot) {
          current.documentRoot = globalDocumentRoot;
          current.documentRootSource = 'global-default';
        }
        const displayName = current.serverName || current.aliases[0] || `unnamed-vhost-${current.line}`;
        parsed.push({ ...current, id: `${displayName.toLowerCase()}-${current.line}`, serverName: displayName });
        current = null;
        depth = 0;
      }
      continue;
    }
    if (!current) continue;

    const serverName = directiveValue(line, 'ServerName');
    if (serverName && !current.serverName) current.serverName = serverName.split(/\s+/)[0];
    const aliases = directiveValue(line, 'ServerAlias');
    if (aliases) current.aliases.push(...aliases.split(/\s+/).filter(Boolean));
    const documentRoot = directiveValue(line, 'DocumentRoot');
    if (documentRoot) {
      current.documentRoot = resolveApachePath(documentRoot, serverRoot, defines);
      current.documentRootSource = current.documentRoot ? 'vhost' : 'unresolved';
    }
  }
  if (current) {
    if (!current.documentRoot && globalDocumentRoot) {
      current.documentRoot = globalDocumentRoot;
      current.documentRootSource = 'global-default';
    }
    const displayName = current.serverName || current.aliases[0] || `unnamed-vhost-${current.line}`;
    parsed.push({ ...current, id: `${displayName.toLowerCase()}-${current.line}`, serverName: displayName });
  }
  return parsed.map((entry) => ({ ...entry, aliases: Array.from(new Set(entry.aliases)) }));
}

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then((entry) => entry.isFile()).catch(() => false);
}

async function directoryExists(path: string): Promise<boolean> {
  return stat(path).then((entry) => entry.isDirectory()).catch(() => false);
}

async function readComposerName(root: string): Promise<string> {
  const source = await readFile(win32.join(root, 'composer.json'), 'utf8').catch(() => '');
  try {
    const value = JSON.parse(source) as { name?: unknown };
    return typeof value.name === 'string' ? value.name.toLowerCase() : '';
  } catch {
    return '';
  }
}

async function detectAtRoot(root: string): Promise<{ matches: Array<{ platform: 'wordpress' | 'bookstack' | 'october'; evidence: string[] }>; evidence: string[] }> {
  const wordpressMarkers = await Promise.all([
    directoryExists(win32.join(root, 'wp-admin')),
    directoryExists(win32.join(root, 'wp-includes')),
    directoryExists(win32.join(root, 'wp-content')),
    fileExists(win32.join(root, 'wp-includes', 'version.php')),
  ]);
  const wordpressEvidence = [
    wordpressMarkers[0] && 'wp-admin/',
    wordpressMarkers[1] && 'wp-includes/',
    wordpressMarkers[2] && 'wp-content/',
    wordpressMarkers[3] && 'wp-includes/version.php',
  ].filter((item): item is string => Boolean(item));

  const [artisan, composerName, octoberModule, bookstackBook] = await Promise.all([
    fileExists(win32.join(root, 'artisan')),
    readComposerName(root),
    fileExists(win32.join(root, 'modules', 'backend', 'Module.php')),
    fileExists(win32.join(root, 'app', 'Entities', 'Book.php')),
  ]);
  const octoberEvidence = [
    artisan && 'artisan',
    composerName.includes('october') && `composer.json name: ${composerName}`,
    octoberModule && 'modules/backend/Module.php',
  ].filter((item): item is string => Boolean(item));
  const bookstackEvidence = [
    artisan && 'artisan',
    bookstackBook && 'app/Entities/Book.php',
    composerName.includes('bookstack') && `composer.json name: ${composerName}`,
  ].filter((item): item is string => Boolean(item));

  const matches: Array<{ platform: 'wordpress' | 'bookstack' | 'october'; evidence: string[] }> = [];
  if (wordpressMarkers.filter(Boolean).length >= 3) matches.push({ platform: 'wordpress', evidence: wordpressEvidence });
  if (artisan && (composerName.includes('october') || octoberModule)) matches.push({ platform: 'october', evidence: octoberEvidence });
  if (artisan && (bookstackBook || composerName.includes('bookstack'))) matches.push({ platform: 'bookstack', evidence: bookstackEvidence });
  return { matches, evidence: [...wordpressEvidence, ...octoberEvidence.filter((item) => item !== 'artisan'), ...bookstackEvidence.filter((item) => item !== 'artisan')] };
}

export async function identifyPlatform(documentRoot: string): Promise<{ platform: DetectedPlatform; evidence: string[] }> {
  const projectRoot = win32.dirname(documentRoot);
  const roots = basename(documentRoot).toLowerCase() === 'public' ? [documentRoot, projectRoot] : [documentRoot];
  const results = await Promise.all(roots.map(async (root) => ({ root, ...await detectAtRoot(root) })));
  const matches = results.flatMap((result) => result.matches.map((match) => ({ ...match, root: result.root })));
  const unique = new Map(matches.map((match) => [match.platform, match]));
  if (unique.size > 1) return { platform: 'ambiguous', evidence: matches.map((match) => `${win32.basename(match.root)}: ${match.evidence.join(', ')}`) };
  if (unique.size === 1) {
    const [platform, result] = Array.from(unique.entries())[0];
    return { platform, evidence: result.evidence.map((item) => `${win32.basename(result.root)}: ${item}`) };
  }
  return { platform: 'unknown', evidence: Array.from(new Set(results.flatMap((result) => result.evidence))) };
}

function isLocalDomain(value: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:test|localhost)$/i.test(value);
}

async function hasLoopbackHostMapping(domain: string): Promise<boolean> {
  const hostsPath = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
  const source = await readFile(hostsPath, 'utf8').catch(() => '');
  return source.split(/\r?\n/).some((line) => {
    const fields = line.split('#', 1)[0].trim().split(/\s+/);
    const address = fields[0]?.toLowerCase();
    return (address === '127.0.0.1' || address === '::1') && fields.slice(1).some((host) => host.toLowerCase() === domain.toLowerCase());
  });
}

export async function listConfiguredVhosts(wampRoot: string): Promise<VhostInventory> {
  const root = resolve(wampRoot);
  const targets = await findWampTargets(root);
  const warnings: string[] = [];
  if (!targets?.httpdConfPath || !targets.vhostsPath) {
    return { wampRoot: root, vhostsPath: '', checkedAt: Date.now(), sites: [], warnings: ['Apache configuration was not found under the selected WampServer root.'] };
  }
  const [httpdConf, vhostsConf] = await Promise.all([
    readFile(targets.httpdConfPath, 'utf8').catch(() => null),
    readFile(targets.vhostsPath, 'utf8').catch(() => null),
  ]);
  if (vhostsConf === null) {
    return { wampRoot: root, vhostsPath: targets.vhostsPath, checkedAt: Date.now(), sites: [], warnings: ['Could not read the resolved Apache vhost configuration.'] };
  }
  if (httpdConf === null) {
    return { wampRoot: root, vhostsPath: targets.vhostsPath, checkedAt: Date.now(), sites: [], warnings: ['Could not read the resolved Apache main configuration.'] };
  }
  const apacheModules = await checkApacheModules(targets.httpdConfPath, targets.httpdExe, targets.vhostsPath);
  if (!apacheModules.vhosts) warnings.push('The resolved httpd-vhosts.conf is not directly included in httpd.conf. Inventory may include vhosts that Apache is not loading.');
  const parsed = parseConfiguredVhosts(httpdConf, vhostsConf, targets.httpdConfPath);
  const sites: ConfiguredVhost[] = await Promise.all(parsed.map(async (entry) => {
    const documentRoot = entry.documentRoot ? win32.normalize(entry.documentRoot) : null;
    const rootExists = documentRoot ? await directoryExists(documentRoot) : false;
    const detection = rootExists && documentRoot ? await identifyPlatform(documentRoot) : { platform: 'unknown' as const, evidence: [] };
    const state: VhostState = !documentRoot
      ? 'unresolved-root'
      : !rootExists
        ? 'missing-root'
        : detection.platform === 'ambiguous'
          ? 'ambiguous-platform'
          : detection.platform === 'unknown'
            ? 'unknown-platform'
            : 'ready';
    const canOpenLocally = isLocalDomain(entry.serverName) && rootExists
      && (entry.serverName.toLowerCase().endsWith('.localhost') || await hasLoopbackHostMapping(entry.serverName));
    if (entry.serverName.startsWith('unnamed-vhost-')) warnings.push(`The vhost on line ${entry.line} has no ServerName; its first alias or line number is shown.`);
    return {
      id: entry.id,
      serverName: entry.serverName,
      aliases: entry.aliases,
      documentRoot,
      documentRootSource: entry.documentRootSource,
      configPath: targets.vhostsPath,
      state,
      detectedPlatform: detection.platform,
      evidence: detection.evidence,
      canOpenLocally,
    };
  }));
  return { wampRoot: root, vhostsPath: targets.vhostsPath, checkedAt: Date.now(), sites, warnings: Array.from(new Set(warnings)) };
}
