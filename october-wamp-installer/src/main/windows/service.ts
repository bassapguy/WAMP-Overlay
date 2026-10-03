import { runCommand } from '../process';

export async function findApacheService(httpdExe: string): Promise<string> {
  const escaped = httpdExe.replaceAll("'", "''");
  const command = `$needle='${escaped}'; (Get-CimInstance Win32_Service | Where-Object { $_.PathName -and $_.PathName.IndexOf($needle,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1 -ExpandProperty Name)`;
  try {
    const result = await runCommand('powershell.exe', ['-NoProfile', '-Command', command], { timeoutMs: 5_000 });
    return result.stdout.trim();
  } catch {
    return '';
  }
}
