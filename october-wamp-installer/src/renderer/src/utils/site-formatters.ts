export function normalizeProjectName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').slice(0, 48);
}

export function deriveDatabaseName(value: string): string {
  const normalized = normalizeProjectName(value).replace(/-/g, '_');
  const safe = /^[a-z_]/.test(normalized) ? normalized : `site_${normalized}`;
  return safe.slice(0, 64) || 'site_database';
}

export function joinWindowsPath(...parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .map((part, index) => index === 0 ? part.replace(/[\\/]+$/g, '') : part.replace(/^[\\/]+|[\\/]+$/g, ''))
    .filter(Boolean)
    .join('\\');
  return joined.replace(/\\+/g, '\\');
}

export function parentWindowsPath(path: string): string {
  const normalized = path.replaceAll('/', '\\').replace(/\\+$/, '');
  const separator = normalized.lastIndexOf('\\');
  return separator > 2 ? normalized.slice(0, separator) : normalized;
}

export function buildPaths(wampRoot: string, siteName: string, platform: import('../../../shared/contracts').InstallablePlatform) {
  const folder = joinWindowsPath(wampRoot, 'www', normalizeProjectName(siteName) || 'new-site');
  const documentRoot = platform === 'wordpress' || platform === 'empty' ? folder : joinWindowsPath(folder, 'public');
  return { projectRoot: folder, documentRoot };
}

export function draftKey(draft: object): string {
  return JSON.stringify(draft);
}
