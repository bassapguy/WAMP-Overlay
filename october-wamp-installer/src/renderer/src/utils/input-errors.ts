import type { SiteSetupDraft } from '../../../shared/contracts';

const LOCAL_DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:test|localhost)$/i;
const DB_IDENTIFIER = /^[a-z_][a-z0-9_]{0,63}$/i;
const INVALID_SECRET_CHARACTERS = /[\0\r\n]/;

export function getDraftErrors(draft: SiteSetupDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.wampRoot.trim()) errors.wampRoot = 'Choose a WampServer folder.';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,47}$/.test(draft.siteName)) errors.siteName = 'Use 2–48 letters, numbers, hyphens, or underscores.';
  if (!LOCAL_DOMAIN.test(draft.domain)) errors.domain = 'Use a local .test or .localhost domain.';
  if (!draft.projectRoot.trim()) errors.projectRoot = 'Choose a project folder.';
  if (!draft.documentRoot.trim()) errors.documentRoot = 'Enter a document root.';
  if (!['localhost', '127.0.0.1', '::1'].includes(draft.dbHost.trim().toLowerCase())) errors.dbHost = 'Use a local WampServer address: localhost, 127.0.0.1, or ::1.';
  if (!Number.isInteger(draft.dbPort) || draft.dbPort < 1 || draft.dbPort > 65535) errors.dbPort = 'Enter a port from 1 to 65535.';
  if (!draft.dbAdminUser.trim() || draft.dbAdminUser.length > 128) errors.dbAdminUser = 'Enter a database username.';
  if (!DB_IDENTIFIER.test(draft.databaseName)) errors.databaseName = 'Use a letter/underscore first, then letters, numbers, or underscores.';
  if (draft.dbAdminPassword.length > 512 || INVALID_SECRET_CHARACTERS.test(draft.dbAdminPassword)) errors.dbAdminPassword = 'Password must be 512 characters or fewer and cannot contain line breaks.';
  if (draft.platform === 'october' && (draft.licenseKey.length > 256 || INVALID_SECRET_CHARACTERS.test(draft.licenseKey))) errors.licenseKey = 'License key must be 256 characters or fewer and cannot contain line breaks.';
  return errors;
}
