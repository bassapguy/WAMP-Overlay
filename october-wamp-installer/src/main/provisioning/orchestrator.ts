import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ProgressEvent, SetupResult, SetupStepId, SiteSetupDraft } from '../../shared/contracts';
import { SETUP_STEPS } from '../../shared/contracts';
import type { ResolvedTargets } from '../../shared/contracts';
import { createDatabase, type SiteDatabaseCredentials } from '../database';
import { redactSecrets } from '../process';
import { createOctoberProject, installOctober } from '../october/install';
import { createBookStackProject, installBookStack } from '../platforms/bookstack';
import { createEmptyProject } from '../platforms/empty';
import { configureWordPress, createWordPressProject } from '../platforms/wordpress';
import { writeSiteConfiguration } from '../windows/elevation';
import { makeVhostPayload } from '../vhost';

export type ProgressSink = (event: ProgressEvent) => void;

export async function provisionSite(draft: SiteSetupDraft, targets: ResolvedTargets, onProgress: ProgressSink): Promise<SetupResult> {
  const runId = randomUUID();
  const completedSteps: SetupStepId[] = [];
  const warnings: string[] = [];
  const stepStates = new Map<SetupStepId, 'pending' | 'running' | 'complete' | 'failed' | 'skipped'>();
  for (const step of SETUP_STEPS) stepStates.set(step.id, 'pending');
  let credentials: SiteDatabaseCredentials | null = null;

  const emit = (stepId: SetupStepId, state: 'pending' | 'running' | 'complete' | 'failed' | 'skipped', detail: string) => {
    stepStates.set(stepId, state);
    onProgress({ runId, stepId, state, detail: redactSecrets(detail, [draft.dbAdminPassword, draft.licenseKey, credentials?.password ?? '']), timestamp: Date.now() });
  };
  const localResult = (phase: SetupResult['phase'], error?: string): SetupResult => ({
    phase,
    runId,
    domain: draft.domain,
    localUrl: phase === 'completed' ? `http://${draft.domain}` : '',
    databaseName: draft.databaseName,
    completedSteps,
    warnings,
    ...(error ? { error: redactSecrets(error, [draft.dbAdminPassword, draft.licenseKey, credentials?.password ?? '']).split('\n')[0].slice(0, 360) } : {}),
  });

  try {
    emit('create-folder', 'running', draft.platform === 'empty' ? `Creating ${draft.projectRoot}.` : `Preparing ${draft.platform} project files in ${draft.projectRoot}.`);
    switch (draft.platform) {
      case 'empty':
        await createEmptyProject(draft);
        break;
      case 'wordpress':
        await createWordPressProject(draft, (detail) => emit('create-folder', 'running', detail));
        break;
      case 'bookstack':
        await createBookStackProject(draft, targets, (detail) => emit('create-folder', 'running', detail));
        break;
      case 'october':
        await createOctoberProject(draft, targets, (detail) => emit('create-folder', 'running', detail));
        break;
    }
    completedSteps.push('create-folder');
    emit('create-folder', 'complete', draft.projectRoot);

    emit('provision-database', 'running', `Creating ${draft.databaseName} and a dedicated site account.`);
    credentials = await createDatabase(draft);
    completedSteps.push('provision-database');
    emit('provision-database', 'complete', `Database ${draft.databaseName} and its site-specific user were created.`);

    let documentRoot = draft.documentRoot;
    if (draft.platform === 'empty') {
      emit('install-platform', 'skipped', 'No CMS was selected; the starter page is ready.');
    } else {
      emit('install-platform', 'running', `Installing ${draft.platform}.`);
      if (draft.platform === 'wordpress') warnings.push(...await configureWordPress(draft, credentials));
      if (draft.platform === 'bookstack') warnings.push(...await installBookStack(draft, targets, credentials, (detail) => emit('install-platform', 'running', detail)));
      if (draft.platform === 'october') {
        const result = await installOctober(draft, targets, credentials, (detail) => emit('install-platform', 'running', detail));
        warnings.push(...result.warnings);
        documentRoot = result.documentRoot;
      }
      completedSteps.push('install-platform');
      emit('install-platform', 'complete', `${draft.platform} files and initial database setup are ready.`);
    }

    const serviceName = targets.apacheServiceName;
    emit('write-vhost', 'running', `Adding ${draft.domain} with document root ${documentRoot}.`);
    const vhostResult = await writeSiteConfiguration(makeVhostPayload(draft, targets, serviceName, documentRoot));
    if (!vhostResult.ok) throw new Error(vhostResult.detail);
    completedSteps.push('write-vhost');
    emit('write-vhost', 'complete', vhostResult.detail);
    completedSteps.push('validate-reload-apache');
    emit('validate-reload-apache', 'complete', 'Apache configuration passed and the service restart completed.');

    if (draft.platform === 'wordpress') warnings.push('Open /wp-admin/install.php to choose the site title and create the first WordPress administrator account.');
    if (draft.platform === 'bookstack') warnings.push('BookStack upstream documents Linux-focused installation workflows; confirm this local Windows/WampServer installation manually.');
    for (const step of SETUP_STEPS) {
      if (stepStates.get(step.id) === 'pending') emit(step.id, 'skipped', 'Not required for this setup.');
    }
    return localResult('completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Site setup failed.';
    const failedStep = Array.from(stepStates.entries()).find(([, state]) => state === 'running')?.[0];
    if (failedStep) emit(failedStep, 'failed', message);
    for (const [stepId, state] of stepStates.entries()) {
      if (state === 'pending') emit(stepId, 'skipped', 'Not run because an earlier step failed.');
    }
    const projectWasCreated = await stat(draft.projectRoot).then(() => true).catch(() => false);
    const phase = completedSteps.length > 0 || projectWasCreated ? 'partial' : 'failed';
    warnings.push('Completed steps and any partial project files were preserved. Review the ledger before retrying; created data was not automatically deleted.');
    return localResult(phase, message);
  }
}
