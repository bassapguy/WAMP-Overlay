import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { identifyPlatform, parseConfiguredVhosts } from './site-discovery';

describe('parseConfiguredVhosts', () => {
  const httpdConfPath = 'C:\\wamp64\\bin\\apache\\apache2.4.62\\conf\\httpd.conf';

  it('parses domains, aliases and quoted document roots while ignoring commented directives', () => {
    const httpd = 'ServerRoot "C:/wamp64/bin/apache/apache2.4.62"\n# DocumentRoot "C:/wrong"';
    const vhosts = [
      '<VirtualHost *:80>',
      '  ServerName notes.test',
      '  ServerAlias notes.local docs.test',
      '  DocumentRoot "C:/wamp64/www/notes # app/public" # comment',
      '</VirtualHost>',
      '# <VirtualHost *:80>',
      '# ServerName ignored.test',
    ].join('\n');

    expect(parseConfiguredVhosts(httpd, vhosts, httpdConfPath)).toEqual([
      {
        id: 'notes.test-1',
        line: 1,
        serverName: 'notes.test',
        aliases: ['notes.local', 'docs.test'],
        documentRoot: 'C:\\wamp64\\www\\notes # app\\public',
        documentRootSource: 'vhost',
      },
    ]);
  });

  it('resolves paths relative to ServerRoot and falls back to the Apache global DocumentRoot', () => {
    const httpd = 'ServerRoot "C:/wamp64/bin/apache/apache2.4.62"\nDocumentRoot "www"';
    const vhosts = '<VirtualHost *:80>\nServerName default.test\n</VirtualHost>';

    expect(parseConfiguredVhosts(httpd, vhosts, httpdConfPath)[0]).toMatchObject({
      documentRoot: 'C:\\wamp64\\bin\\apache\\apache2.4.62\\www',
      documentRootSource: 'global-default',
    });
  });

  it('expands declared Define values and leaves unknown Apache variables unresolved', () => {
    const httpd = 'Define SRVROOT "C:/wamp64"\nServerRoot "${SRVROOT}/bin/apache"';
    const vhosts = [
      '<VirtualHost *:80>\nServerName known.test\nDocumentRoot "${SRVROOT}/www/known"\n</VirtualHost>',
      '<VirtualHost *:80>\nServerName unresolved.test\nDocumentRoot "${OTHER_ROOT}/unresolved"\n</VirtualHost>',
    ].join('\n');

    expect(parseConfiguredVhosts(httpd, vhosts, httpdConfPath).map(({ documentRoot, documentRootSource }) => ({ documentRoot, documentRootSource }))).toEqual([
      { documentRoot: 'C:\\wamp64\\www\\known', documentRootSource: 'vhost' },
      { documentRoot: null, documentRootSource: 'unresolved' },
    ]);
  });

  it('retains a VirtualHost without ServerName using its first alias as the visible identifier', () => {
    const result = parseConfiguredVhosts('', '<VirtualHost *:80>\nServerAlias first.test second.test\nDocumentRoot C:/wamp64/www/alias\n</VirtualHost>', httpdConfPath);
    expect(result[0]).toMatchObject({ serverName: 'first.test', aliases: ['first.test', 'second.test'] });
  });
});

describe('identifyPlatform', () => {
  async function withTemporaryRoot(run: (root: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'wamp-platform-fixture-'));
    try {
      await run(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it('recognizes the known CMS file markers at an Apache public document root', async () => {
    await withTemporaryRoot(async (root) => {
      const wordpress = join(root, 'wordpress');
      await Promise.all(['wp-admin', 'wp-includes', 'wp-content'].map((path) => mkdir(join(wordpress, path), { recursive: true })));
      await writeFile(join(wordpress, 'wp-includes', 'version.php'), '<?php', 'utf8');
      expect(await identifyPlatform(wordpress)).toMatchObject({ platform: 'wordpress' });

      const october = join(root, 'october');
      await mkdir(join(october, 'modules', 'backend'), { recursive: true });
      await mkdir(join(october, 'public'), { recursive: true });
      await writeFile(join(october, 'artisan'), '', 'utf8');
      await writeFile(join(october, 'modules', 'backend', 'Module.php'), '', 'utf8');
      expect(await identifyPlatform(join(october, 'public'))).toMatchObject({ platform: 'october' });

      const bookstack = join(root, 'bookstack');
      await mkdir(join(bookstack, 'app', 'Entities'), { recursive: true });
      await mkdir(join(bookstack, 'public'), { recursive: true });
      await writeFile(join(bookstack, 'artisan'), '', 'utf8');
      await writeFile(join(bookstack, 'app', 'Entities', 'Book.php'), '', 'utf8');
      await writeFile(join(bookstack, 'composer.json'), JSON.stringify({ name: 'bookstack/bookstack' }), 'utf8');
      expect(await identifyPlatform(join(bookstack, 'public'))).toMatchObject({ platform: 'bookstack' });
    });
  });

  it('does not label a generic Laravel artisan project as a CMS', async () => {
    await withTemporaryRoot(async (root) => {
      await writeFile(join(root, 'artisan'), '', 'utf8');
      await writeFile(join(root, 'composer.json'), JSON.stringify({ name: 'example/custom-app' }), 'utf8');
      expect(await identifyPlatform(root)).toMatchObject({ platform: 'unknown' });
    });
  });

  it('reports conflicting strong signatures as ambiguous', async () => {
    await withTemporaryRoot(async (root) => {
      await Promise.all(['wp-admin', 'wp-includes', 'wp-content'].map((path) => mkdir(join(root, path), { recursive: true })));
      await mkdir(join(root, 'modules', 'backend'), { recursive: true });
      await writeFile(join(root, 'wp-includes', 'version.php'), '<?php', 'utf8');
      await writeFile(join(root, 'artisan'), '', 'utf8');
      await writeFile(join(root, 'modules', 'backend', 'Module.php'), '', 'utf8');
      expect(await identifyPlatform(root)).toMatchObject({ platform: 'ambiguous' });
    });
  });
});
