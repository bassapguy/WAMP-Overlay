import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SiteSetupDraft } from '../../shared/contracts';

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export async function createEmptyProject(draft: SiteSetupDraft): Promise<void> {
  await mkdir(draft.projectRoot, { recursive: false });
  const body = `<!doctype html>\n<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(draft.siteName)}</title><body><main><h1>${escapeHtml(draft.siteName)}</h1><p>Your local WampServer site is ready for development.</p></main></body></html>\n`;
  await writeFile(join(draft.projectRoot, 'index.html'), body, { encoding: 'utf8', flag: 'wx' });
}
