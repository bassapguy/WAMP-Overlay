import type { SiteSetupDraft, ResolvedTargets } from '../shared/contracts';

export interface SiteMutationPayload {
  action: 'write-site';
  domain: string;
  projectRoot: string;
  documentRoot: string;
  wampRoot: string;
  vhostsPath: string;
  httpdConfPath: string;
  httpdExe: string;
  serviceName: string;
  hostsPath: string;
}

export function makeVhostPayload(
  draft: SiteSetupDraft,
  targets: ResolvedTargets,
  serviceName: string,
  documentRoot = draft.documentRoot,
): SiteMutationPayload {
  return {
    action: 'write-site',
    domain: draft.domain,
    projectRoot: draft.projectRoot,
    documentRoot,
    wampRoot: draft.wampRoot,
    vhostsPath: targets.vhostsPath,
    httpdConfPath: targets.httpdConfPath,
    httpdExe: targets.httpdExe,
    serviceName,
    hostsPath: targets.hostsPath,
  };
}
