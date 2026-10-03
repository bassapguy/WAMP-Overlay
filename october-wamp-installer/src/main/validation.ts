import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { SiteSetupDraft } from '../shared/contracts';

const pathString = z.string().trim().min(1, 'A folder is required').max(512).refine((value) => !/[\0\r\n]/.test(value), 'Folder paths cannot contain line breaks or control characters.');
const databaseIdentifierSchema = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/);

export const SiteSetupDraftSchema = z.object({
  wampRoot: pathString,
  siteName: z.string().trim().min(2).max(48).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  domain: z.string().trim().min(1).max(253).refine((value) => /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(test|localhost)$/.test(value), 'Use a local .test or .localhost domain.'),
  projectRoot: pathString,
  documentRoot: pathString,
  dbHost: z.string().trim().min(1).max(253).refine((value) => ['localhost', '127.0.0.1', '::1'].includes(value.toLowerCase()), 'Use a loopback address for WampServer MySQL/MariaDB.'),
  dbPort: z.number().int().min(1).max(65535),
  dbAdminUser: z.string().trim().min(1).max(128),
  dbAdminPassword: z.string().max(512).refine((value) => !/[\0\r\n]/.test(value), 'Password cannot contain line breaks.'),
  databaseName: databaseIdentifierSchema,
  platform: z.enum(['empty', 'wordpress', 'bookstack', 'october']),
  licenseKey: z.string().trim().max(256).refine((value) => !/[\0\r\n]/.test(value), 'License key cannot contain line breaks.'),
}).strict();

export function parseDraft(input: unknown): SiteSetupDraft {
  const draft = SiteSetupDraftSchema.parse(input);
  const domain = draft.domain.toLowerCase().replace(/\.$/, '');
  const wampRoot = resolve(draft.wampRoot);
  const projectRoot = resolve(draft.projectRoot);
  const documentRoot = resolve(draft.documentRoot);
  const allowedRoot = resolve(wampRoot, 'www');
  const projectRelative = relative(allowedRoot, projectRoot);
  const documentRelative = relative(projectRoot, documentRoot);
  if (!projectRelative || projectRelative.startsWith('..') || isAbsolute(projectRelative)) {
    throw new Error('The project folder must be inside the selected WampServer www folder.');
  }
  if (documentRelative.startsWith('..') || isAbsolute(documentRelative)) {
    throw new Error('The document root must be inside the project folder.');
  }
  if (draft.platform === 'october' && !draft.licenseKey.trim()) {
    // A local October project may be installed without binding a license.
  }
  if (draft.platform !== 'october' && draft.licenseKey.trim()) {
    throw new Error('An October CMS license key can only be supplied for an October CMS site.');
  }
  if (draft.dbHost.includes(';') || draft.dbHost.includes('\n') || draft.dbHost.includes('\r')) {
    throw new Error('Database host contains unsupported characters.');
  }
  return { ...draft, domain };
}

export function fingerprintDraft(draft: SiteSetupDraft): string {
  return JSON.stringify(draft);
}
