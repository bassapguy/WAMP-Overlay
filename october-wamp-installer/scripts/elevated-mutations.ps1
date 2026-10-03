param(
  [Parameter(Mandatory = $true)][string]$PayloadPath,
  [Parameter(Mandatory = $true)][string]$ResultPath
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Result([hashtable]$result) {
  $json = $result | ConvertTo-Json -Compress -Depth 5
  [System.IO.File]::WriteAllText($ResultPath, $json, $utf8)
}


try {
  $payload = Get-Content -LiteralPath $PayloadPath -Raw | ConvertFrom-Json
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator permission was not granted.' }

  if ($payload.action -eq 'mirror') {
    $projectRoot = [System.IO.Path]::GetFullPath([string]$payload.projectRoot)
    $phpExe = [System.IO.Path]::GetFullPath([string]$payload.phpExe)
    $wampRoot = [System.IO.Path]::GetFullPath([string]$payload.wampRoot).TrimEnd('\')
    if (-not $projectRoot.StartsWith((Join-Path $wampRoot 'www').TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'The October project must stay inside the selected WampServer www folder.' }
    if (-not $phpExe.StartsWith((Join-Path $wampRoot 'bin\php').TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'PHP must be a WampServer PHP executable.' }
    $artisan = Join-Path $projectRoot 'artisan'
    if (-not (Test-Path -LiteralPath $artisan -PathType Leaf)) { throw 'October artisan file was not found.' }
    $output = & $phpExe $artisan 'october:mirror' 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw ('October mirror failed: ' + $output.Trim()) }
    Write-Result @{ ok = $true; detail = 'October public files mirrored with Administrator permission.' }
    exit 0
  }


  if ($payload.action -ne 'write-site') { throw 'Unsupported elevated action.' }
  $wampRoot = [System.IO.Path]::GetFullPath([string]$payload.wampRoot).TrimEnd('\')
  $vhosts = [System.IO.Path]::GetFullPath([string]$payload.vhostsPath)
  $httpd = [System.IO.Path]::GetFullPath([string]$payload.httpdExe)
  $documentRoot = [System.IO.Path]::GetFullPath([string]$payload.documentRoot)
  if (-not $vhosts.StartsWith($wampRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'The vhost configuration must be inside the selected WampServer folder.' }
  if (-not $httpd.StartsWith($wampRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Apache must be inside the selected WampServer folder.' }
  $apacheRoot = Split-Path (Split-Path $httpd -Parent) -Parent
  $httpdConf = [System.IO.Path]::GetFullPath([string]$payload.httpdConfPath)
  $expectedConfig = [System.IO.Path]::GetFullPath((Join-Path $apacheRoot 'conf\httpd.conf'))
  $expectedVhosts = [System.IO.Path]::GetFullPath((Join-Path $apacheRoot 'conf\extra\httpd-vhosts.conf'))
  if ($httpdConf -ine $expectedConfig) { throw 'Only the version-resolved Apache httpd.conf can be used.' }
  if ($vhosts -ine $expectedVhosts) { throw 'Only the version-resolved Apache httpd-vhosts.conf can be edited.' }
  $allowedSitesRoot = [System.IO.Path]::GetFullPath((Join-Path $wampRoot 'www')).TrimEnd('\') + '\'
  if (-not $documentRoot.StartsWith($allowedSitesRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'The document root must stay inside the selected WampServer www folder.' }
  if ([string]$payload.hostsPath -ne (Join-Path $env:SystemRoot 'System32\drivers\etc\hosts')) { throw 'Unexpected Windows hosts file path.' }
  if ($payload.domain -notmatch '^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(test|localhost)$') { throw 'Invalid local domain.' }
  if (-not (Test-Path -LiteralPath $payload.documentRoot -PathType Container)) { throw 'The document root does not exist.' }

  $marker = '# WAMP-LOCAL-SITE-INSTALLER: ' + $payload.domain.ToLowerInvariant()
  $oldVhosts = [System.IO.File]::ReadAllText($vhosts)
  $oldHosts = [System.IO.File]::ReadAllText($payload.hostsPath)
  $hasMarker = $oldVhosts.Contains($marker)
  $existingDomainReference = $false
  foreach ($line in ($oldVhosts -split "`r?`n")) {
    $directive = ($line -split '#', 2)[0].Trim()
    if ($directive -match '^\s*(?:ServerName|ServerAlias)\s+(.+)$' -and (($Matches[1] -split '\s+') -contains $payload.domain)) {
      $existingDomainReference = $true
      break
    }
  }
  if ($hasMarker -or $existingDomainReference) { throw 'A virtual host already uses this domain or alias. No existing vhost was changed.' }

  $hostLines = $oldHosts -split "`r?`n"
  $domainLines = @($hostLines | Where-Object { (($_ -split '#')[0] -split '\s+') -contains $payload.domain })
  $conflictingHostLines = @($domainLines | Where-Object { $_ -notmatch ('^\s*127\.0\.0\.1\s+' + [regex]::Escape($payload.domain) + '(?:\s|$)') })
  if ($conflictingHostLines.Count -gt 0) { throw 'This domain already maps to another address in the Windows hosts file.' }

  $escapedRoot = ([string]$payload.documentRoot).Replace('\', '/')
  $block = @"
$marker
<VirtualHost *:80>
    ServerName $($payload.domain)
    DocumentRoot "$escapedRoot"
    <Directory "$escapedRoot">
        Options FollowSymLinks
        AllowOverride All
        Require local
    </Directory>
</VirtualHost>
# END WAMP-LOCAL-SITE-INSTALLER
"@
  $tempVhosts = $vhosts + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  $backupVhosts = $vhosts + '.' + [guid]::NewGuid().ToString('N') + '.bak'
  $tempHosts = $payload.hostsPath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  $backupHosts = $payload.hostsPath + '.' + [guid]::NewGuid().ToString('N') + '.bak'
  $vhostsChanged = $false
  $hostsChanged = $false
  try {
    $nextVhosts = $oldVhosts.TrimEnd() + "`r`n`r`n" + $block + "`r`n"
    [System.IO.File]::WriteAllText($tempVhosts, $nextVhosts, $utf8)
    [System.IO.File]::Replace($tempVhosts, $vhosts, $backupVhosts, $true)
    $vhostsChanged = $true

    if ($domainLines.Count -eq 0) {
      [System.IO.File]::WriteAllText($tempHosts, $oldHosts.TrimEnd() + "`r`n127.0.0.1`t$($payload.domain)`t$marker`r`n", $utf8)
      [System.IO.File]::Replace($tempHosts, $payload.hostsPath, $backupHosts, $true)
      $hostsChanged = $true
    }

    $testOutput = & $httpd '-d' $apacheRoot '-f' $httpdConf '-t' 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw ('Apache configuration test failed: ' + $testOutput.Trim()) }
    if ([string]::IsNullOrWhiteSpace([string]$payload.serviceName)) { throw 'Apache service name was not found. Start it from the WampServer tray menu, then check again.' }
    $restartOutput = & $httpd '-d' $apacheRoot '-f' $httpdConf '-k' 'restart' '-n' ([string]$payload.serviceName) 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw ('Apache restart failed: ' + $restartOutput.Trim()) }
    Write-Result @{ ok = $true; detail = 'Vhost validated and Apache restarted successfully.'; localUrl = 'http://{0}' -f $payload.domain }
    exit 0
  } catch {
    if ($vhostsChanged -and (Test-Path -LiteralPath $backupVhosts)) { [System.IO.File]::Replace($backupVhosts, $vhosts, $null, $true) }
    if ($hostsChanged -and (Test-Path -LiteralPath $backupHosts)) { [System.IO.File]::Replace($backupHosts, $payload.hostsPath, $null, $true) }
    throw
  } finally {
    Remove-Item -LiteralPath $tempVhosts, $backupVhosts, $tempHosts, $backupHosts -Force -ErrorAction SilentlyContinue
  }
} catch {
  Write-Result @{ ok = $false; detail = $_.Exception.Message }
  exit 1
} finally {
  Remove-Item -LiteralPath $PayloadPath -Force -ErrorAction SilentlyContinue
}
