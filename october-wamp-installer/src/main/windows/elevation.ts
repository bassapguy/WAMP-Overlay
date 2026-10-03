import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { SiteMutationPayload } from '../vhost';
import { runCommand } from '../process';

export interface ElevatedResult {
  ok: boolean;
  detail: string;
  localUrl?: string;
}

type MirrorPayload = { action: 'mirror'; projectRoot: string; phpExe: string; wampRoot: string };
type MutationPayload = SiteMutationPayload | MirrorPayload;

function quotePs(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'scripts', 'elevated-mutations.ps1')
    : join(app.getAppPath(), 'scripts', 'elevated-mutations.ps1');
}

function parseResult(value: string): ElevatedResult {
  const result = JSON.parse(value) as Partial<ElevatedResult>;
  if (typeof result.ok !== 'boolean' || typeof result.detail !== 'string') {
    throw new Error('The elevated operation returned an invalid status.');
  }
  return {
    ok: result.ok,
    detail: result.detail.slice(0, 360),
    ...(typeof result.localUrl === 'string' ? { localUrl: result.localUrl } : {}),
  };
}

async function elevate(payload: MutationPayload): Promise<ElevatedResult> {
  const helper = helperPath();
  const id = randomUUID();
  const tempDir = app.getPath('temp');
  const payloadPath = join(tempDir, `wamp-installer-${id}.json`);
  const resultPath = join(tempDir, `wamp-installer-${id}-result.json`);
  await writeFile(payloadPath, JSON.stringify(payload), { encoding: 'utf8', flag: 'wx' });

  const argumentsText = `-NoProfile -ExecutionPolicy Bypass -File "${helper}" -PayloadPath "${payloadPath}" -ResultPath "${resultPath}"`;
  const launcher = `$arguments=${quotePs(argumentsText)}; $target=Join-Path $PSHOME 'powershell.exe'; $process=Start-Process -FilePath $target -Verb RunAs -ArgumentList $arguments -Wait -PassThru; exit $process.ExitCode`;
  const encoded = Buffer.from(launcher, 'utf16le').toString('base64');

  try {
    let launcherError = '';
    try {
      await runCommand('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], { timeoutMs: 10 * 60_000 });
    } catch (error) {
      launcherError = error instanceof Error ? error.message : 'PowerShell could not start the elevated operation.';
    }

    try {
      return parseResult(await readFile(resultPath, 'utf8'));
    } catch {
      if (/canceled|cancelled|user did not grant|operation was canceled/i.test(launcherError)) {
        return { ok: false, detail: 'Administrator permission was cancelled. No elevated file changes were applied.' };
      }
      return {
        ok: false,
        detail: launcherError ? launcherError.split('\n').slice(-2).join(' ').slice(0, 280) : 'The elevated operation did not return a result.',
      };
    }
  } finally {
    await Promise.all([rm(payloadPath, { force: true }), rm(resultPath, { force: true })]);
  }
}

export function writeSiteConfiguration(payload: SiteMutationPayload): Promise<ElevatedResult> {
  return elevate(payload);
}

export function mirrorOctober(projectRoot: string, phpExe: string, wampRoot: string): Promise<ElevatedResult> {
  return elevate({ action: 'mirror', projectRoot, phpExe, wampRoot });
}
