import { execFile as nodeExecFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(nodeExecFile);
const MAX_OUTPUT = 160_000;

function redact(text: string, secrets: string[] = []): string {
  return secrets.filter(Boolean).reduce((result, secret) => result.split(secret).join('[redacted]'), text);
}

export function redactSecrets(text: string, secrets: string[]): string {
  return redact(text, secrets);
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; secrets?: string[]; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  const timeout = options.timeoutMs ?? 20_000;
  try {
    const result = await execFile(executable, args, {
      cwd: options.cwd,
      timeout,
      windowsHide: true,
      maxBuffer: MAX_OUTPUT,
      encoding: 'utf8',
      env: options.env,
    });
    return {
      stdout: redact(String(result.stdout ?? ''), options.secrets),
      stderr: redact(String(result.stderr ?? ''), options.secrets),
      exitCode: 0,
    };
  } catch (error) {
    const commandError = error as Error & { code?: string | number; stdout?: string; stderr?: string };
    const exitCode = typeof commandError.code === 'number' ? commandError.code : -1;
    throw new Error(redact([commandError.message, commandError.stderr, commandError.stdout].filter(Boolean).join('\n'), options.secrets).slice(0, MAX_OUTPUT), { cause: exitCode });
  }
}

export function runLongCommand(
  executable: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number; secrets?: string[]; env?: NodeJS.ProcessEnv },
  onOutput?: (chunk: string) => void,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = options.timeoutMs ?? 45 * 60_000;
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error(`Command timed out after ${Math.round(timeoutMs / 60_000)} minutes.`));
    }, timeoutMs);
    const append = (target: 'stdout' | 'stderr', buffer: Buffer) => {
      const text = redact(buffer.toString('utf8'), options.secrets).slice(0, 4_000);
      if (target === 'stdout') stdout = `${stdout}${text}`.slice(-MAX_OUTPUT);
      else stderr = `${stderr}${text}`.slice(-MAX_OUTPUT);
      onOutput?.(text);
    };
    const finish = (error?: Error, code = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve({ stdout, stderr, exitCode: code });
    };

    child.stdout.on('data', (buffer: Buffer) => append('stdout', buffer));
    child.stderr.on('data', (buffer: Buffer) => append('stderr', buffer));
    child.once('error', (error) => finish(new Error(redact(error.message, options.secrets))));
    child.once('close', (code) => {
      if (code === 0) finish(undefined, 0);
      else finish(new Error(redact(`${executable} exited with code ${code ?? 'unknown'}.\n${stderr || stdout}`, options.secrets)), code ?? -1);
    });
  });
}

export async function locateInPath(binaryNames: string[]): Promise<string | null> {
  for (const binaryName of binaryNames) {
    try {
      const { stdout } = await execFile('where.exe', [binaryName], { windowsHide: true, timeout: 5_000, encoding: 'utf8' });
      const match = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (match) return match;
    } catch {
      // Try the next known executable name.
    }
  }
  return null;
}
