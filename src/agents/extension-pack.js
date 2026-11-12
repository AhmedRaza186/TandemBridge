// Packs extensions/antigravity into a .vsix and installs it with the Antigravity IDE's own CLI.
// No packaging tool is downloaded: a .vsix is a zip with a manifest, built here with tar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SOURCE = path.join(__dirname, '..', '..', 'extensions', 'antigravity');
// [source, path inside the extension]. The log parser is shared with `watch`.
const FILES = [...['package.json', 'extension.js', 'view.js', 'panel.html', 'media/icon.svg'].map((f) => [path.join(SOURCE, f), f]),
  [path.join(__dirname, 'live-parse.js'), 'parse-log.js']];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function manifest(pkg) {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${esc(pkg.name)}" Version="${esc(pkg.version)}" Publisher="${esc(pkg.publisher)}" />
    <DisplayName>${esc(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${esc(pkg.description)}</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${esc(pkg.engines.vscode)}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".html" ContentType="text/html" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
`;

// Windows ships bsdtar, which writes zip files. Git Bash's GNU tar does not, so use it by path.
const tarBin = () => (process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar');

function packExtension(outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandembridge-vsix-'))) {
  const pkg = JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf8'));
  const stage = path.join(outDir, 'stage');
  fs.mkdirSync(path.join(stage, 'extension'), { recursive: true });
  for (const [from, to] of FILES) {
    fs.mkdirSync(path.dirname(path.join(stage, 'extension', to)), { recursive: true });
    fs.copyFileSync(from, path.join(stage, 'extension', to));
  }
  fs.writeFileSync(path.join(stage, 'extension.vsixmanifest'), manifest(pkg));
  fs.writeFileSync(path.join(stage, '[Content_Types].xml'), CONTENT_TYPES);
  const vsix = path.join(outDir, `${pkg.publisher}.${pkg.name}-${pkg.version}.vsix`);
  const r = spawnSync(tarBin(), ['--format', 'zip', '-cf', vsix, '-C', stage, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not pack the extension: ${r.stderr || r.error}`);
  return { vsix, version: pkg.version };
}

function installExtension(cli) {
  if (!fs.existsSync(cli)) throw new Error(`IDE not found at ${cli}.`);
  const { vsix, version } = packExtension();
  // The IDE's CLI is a .cmd file, which needs cmd.exe. Both paths come from config, not task text.
  const r = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `""${cli}" --install-extension "${vsix}" --force"`], { encoding: 'utf8', windowsVerbatimArguments: true })
    : spawnSync(cli, ['--install-extension', vsix, '--force'], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.status !== 0) throw new Error(`install failed: ${out}`);
  return { version, out };
}

module.exports = { packExtension, installExtension, manifest };
