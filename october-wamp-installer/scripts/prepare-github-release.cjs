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
const refName = process.env.GITHUB_REF_NAME?.trim() || `v${manifest.version}`;
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(refName)) {
  console.error(`GITHUB_REF_NAME must use semantic version format, for example v1.2.3; for manual workflow runs, provide the release_tag input.`);
  process.exit(1);
}
const versionTag = refName.slice(1);
if (versionTag !== manifest.version) {
  console.error(`Release tag ${versionTag} does not match package version ${manifest.version}. Bump package.json before tagging.`);
  process.exit(1);
}
manifest.build ??= {};
manifest.build.publish = [{ provider: 'github', owner, repo, releaseType: 'release' }];
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Configured GitHub Releases updates for ${owner}/${repo}.`);
