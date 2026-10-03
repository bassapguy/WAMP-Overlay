# Wamp Local Site Installer

Windows Electron utility for inventorying configured WampServer Apache vhosts and creating a new local site with one selected platform: WordPress, BookStack, October CMS, or an empty starter page. Companyassistant is visible as Coming soon.

## Requirements

- Windows 10/11 and WampServer installed on each computer where you manage or run local sites.
- A Wamp root such as `C:\wamp64` or `C:\wamp`; each machine may use a different path.
- A MySQL/MariaDB account allowed to create databases and users. A fresh Wamp installation may use `root` with a blank password; use the credentials configured on that machine.
- WordPress: PHP 8.3+, MySQL 8.0+ or MariaDB 10.11+, `mysqli` and PDO_MySQL; internet access to download WordPress.
- BookStack: PHP 8.2+, MySQL 8.0+ or MariaDB 10.6+, its documented extensions, Composer 2.2+, and Git on PATH. BookStack describes Linux-oriented install steps; Windows/WampServer is best-effort and needs manual validation. SMTP setup and writable-directory permissions require review.
- October CMS: PHP 8.2+, Composer 2+, the PHP extensions shown during preflight, and internet access. Its Windows mirror step asks for Administrator approval.
- Administrator approval for edits to Apache vhost configuration and the Windows hosts file. The app itself should not be run as Administrator.

## Install on your own computer or another Windows machine

### Build a local installer

On a development computer with Node.js 22 installed:

```powershell
cd october-wamp-installer
npm ci
npm run dist:win
```

The NSIS installer is written to `release/Wamp Local Site Installer-1.0.0-Setup.exe` (the version in the filename changes when `package.json` is bumped). Copy that `.exe` to each target Windows computer and run it to install the desktop program. The installer is separate from WampServer: install and start WampServer on every target computer first, then choose that machine’s Wamp root and database credentials in the app.

The app program is installed locally; the websites, databases, Apache configuration, and hosts file remain on each computer. They do not sync between your desktop and laptop. To move a website itself, use that CMS’s own export/backup/migration process.

Windows may show SmartScreen because this initial installer is not Authenticode-signed. Only run it if you trust where you obtained the build. Code signing can be added later with a certificate held in CI secrets.

### Run during development

```powershell
cd october-wamp-installer
npm ci
npm run dev
```

## GitHub Releases and automatic updates

The public source repository is [bassapguy/WAMP-Overlay](https://github.com/bassapguy/WAMP-Overlay). Pushing a version tag matching `package.json` (for example, `v1.0.0`) triggers [the Windows release workflow](../.github/workflows/release-windows.yml). It installs dependencies, runs the tests and production build, then publishes the NSIS installer and update metadata to GitHub Releases. The workflow configures the updater feed for this repository and fails if the tag and app version differ.

For a subsequent release, update the version in `package.json`, commit the change, then push the matching tag:

```powershell
cd october-wamp-installer
# After updating package.json to 1.0.1 and committing the change:
git tag v1.0.1
git push origin v1.0.1
```

In the installed app, use **Check for updates**, then download and restart when a release is available. GitHub Actions uses its repository-scoped `GITHUB_TOKEN`; no access token should be committed or embedded in the app.

## Dashboard and platform workflow

1. On launch, the dashboard reads configured `<VirtualHost>` entries from the Apache configuration found under the selected Wamp root. It does not list every unconfigured folder under `www`.
2. A vhost row shows its configured domain, resolved document root, likely platform, root state, and an expansion with aliases/config path/file evidence. Missing and unresolved paths remain visible. CMS detection is heuristic; `Unknown` or `Ambiguous` means the files did not support a confident identification.
3. **Create local site** allows exactly one platform per new vhost. Companyassistant is disabled until its installer is ready.
4. Run **Check again** and resolve blocking requirements. Review the site/database/vhost paths in the manifest and confirm the native dialog.
5. The installer creates a database and separate site-scoped database account, downloads/installs the selected platform, writes its vhost and local hosts entry with narrowly scoped elevation, validates Apache configuration, then restarts Apache. Partial work is reported and not automatically deleted.
6. WordPress setup prepares core files and `wp-config.php`; finish the site title and first administrator account at `/wp-admin/install.php`. BookStack setup prepares code, Composer dependencies, environment, and migrations; verify the Windows writable folders, email configuration, and initial account. October retains its Composer, license, install, migration, and elevated mirror sequence.

## Safety and data handling

- The renderer is sandboxed, context isolated, has no Node integration, and uses a narrow typed preload API. Filesystem, Apache config, SQL, process, and updater work stays in the main process.
- The Wamp admin password and October license are transient form values and are redacted from progress. Application code receives a randomly generated account scoped to its site database; the Wamp administrator password is not written into CMS configuration.
- The updater uses GitHub Releases; publishing credentials belong in GitHub Actions, not source files or installed app settings. Public releases are the supported first-release target.
- Windows UAC is requested only for Apache/hosts-file mutation or October’s mirror helper. Configuration backups are created before changes, Apache syntax is checked, and changed files are rolled back if the mutation fails.

## Known limits

- WampServer layouts and active service versions vary; preflight shows the resolved targets and blocks when required services/configuration are not available.
- Apache parsing covers ordinary `VirtualHost`, `ServerName`, `ServerAlias`, `DocumentRoot`, global `DocumentRoot`, quoted paths, and resolvable `Define` variables. Unresolved Apache variables remain unresolved instead of being guessed.
- BookStack’s upstream docs are Linux-focused; treat this Windows/WampServer install as experimental and verify it manually.
- Live CMS provisioning requires testing on the target WampServer machine. Do not use a test install that could alter a machine you need: created folders, database users/databases, and successful earlier steps are intentionally preserved after a later failure.

## Official references

- [BookStack installation](https://www.bookstackapp.com/docs/admin/installation/)
- [WordPress requirements](https://wordpress.org/about/requirements/)
- [WordPress installation](https://developer.wordpress.org/advanced-administration/before-install/howto-install/)
- [electron-builder auto update](https://www.electron.build/docs/features/auto-update/)
