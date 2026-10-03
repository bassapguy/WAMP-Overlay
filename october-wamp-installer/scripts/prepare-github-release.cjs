const fs = require('node:fs');
const path = require('node:path');

const repository = process.env.GITHUB_REPOSITORY ?? '';
const [owner, repo, extra] = repository.split('/');
if (!owner || !repo || extra) {
  console.error('GITHUB_REPOSITORY must be set to owner/repository by GitHub Actions.');
  process.exit(1);
}

const manifestPath = path.join(__dirname, '..', 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const versionTag = (process.env.GITHUB_REF_NAME ?? '').replace(/^v/, '');
if (versionTag && versionTag !== manifest.version) {
  console.error(`Release tag ${versionTag} does not match package version ${manifest.version}. Bump package.json before tagging.`);
  process.exit(1);
}
manifest.build ??= {};
manifest.build.publish = [{ provider: 'github', owner, repo, releaseType: 'release' }];
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Configured GitHub Releases updates for ${owner}/${repo}.`);
