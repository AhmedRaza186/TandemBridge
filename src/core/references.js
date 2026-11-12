// UI style packs. The planner picks one, and it is copied into the project for the agents to follow.
const fs = require('fs');
const path = require('path');

const dirOf = () => process.env.TANDEMBRIDGE_REFERENCES || path.join(__dirname, '..', '..', 'references');
const customDir = () => path.join(dirOf(), 'custom');
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const IMAGES = ['.png', '.jpg', '.jpeg', '.webp'];

// A folder counts as a pack only when it has reference.json.
function packsIn(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'custom' && fs.existsSync(path.join(root, e.name, 'reference.json')))
    .map((e) => {
      const dir = path.join(root, e.name);
      return { suited_for: [], summary: '', ...JSON.parse(fs.readFileSync(path.join(dir, 'reference.json'), 'utf8')), id: e.name, dir };
    });
}

const listReferences = () => [...packsIn(dirOf()), ...packsIn(customDir())];
const findReference = (id) => listReferences().find((r) => r.id === id);

// The part of the planner prompt that depends on which packs exist.
function referenceRules() {
  const packs = listReferences().map((r) => `- ${r.id}: ${r.summary} Suited for: ${r.suited_for.join(', ')}.`);
  return [
    'UI references:',
    packs.length ? packs.join('\n') : '(none installed)',
    'Set ui_reference to the id above that best fits the requested look. Every project with a user interface gets one, even if the fit is only close, because it also carries the shared craft rules. Use null only when the project has no user interface. Never invent an id.'
  ].join('\n');
}

// Copies the chosen pack into the project, where the agents can read it.
function installReference(workspace, id) {
  const pack = findReference(id);
  if (!pack) throw new Error(`no UI reference named ${id}`);
  const target = path.join(workspace, 'docs', 'design-reference');
  fs.cpSync(pack.dir, target, { recursive: true });
  // The shared craft rules go with every pack, built-in or custom.
  const craft = path.join(dirOf(), 'CRAFT.md');
  if (fs.existsSync(craft)) fs.copyFileSync(craft, path.join(target, 'CRAFT.md'));
}

const STUB = (title) => `# ${title}

No written guide yet. Before any UI work, study the images in \`screens/\` closely and work out the
color palette, type scale, spacing, layout patterns, and motion. Apply that style to this project.
Do not copy its text, images, logos, or code.
`;

// Creates a user's pack from a folder of screenshots, optionally with its own DESIGN.md.
function addReference(id, source, { url, title, suitedFor = [] } = {}) {
  if (!ID.test(id)) throw new Error('name must be lowercase letters, numbers and dashes, like my-style');
  if (findReference(id)) throw new Error(`a reference named ${id} already exists`);
  if (!source || !fs.existsSync(source)) throw new Error(`no such file or folder: ${source}`);

  const stat = fs.statSync(source);
  const files = stat.isDirectory() ? fs.readdirSync(source).map((f) => path.join(source, f)) : [source];
  const images = files.filter((f) => IMAGES.includes(path.extname(f).toLowerCase()) && fs.statSync(f).isFile());
  const guide = files.find((f) => path.basename(f).toLowerCase() === 'design.md');
  if (!images.length && !guide) throw new Error(`${source} has no screenshots (${IMAGES.join(', ')}) and no DESIGN.md. A URL alone gives the agents nothing to look at.`);

  const dir = path.join(customDir(), id);
  fs.mkdirSync(path.join(dir, 'screens'), { recursive: true });
  images.forEach((f) => fs.copyFileSync(f, path.join(dir, 'screens', path.basename(f))));
  const name = title || id;
  if (guide) fs.copyFileSync(guide, path.join(dir, 'DESIGN.md'));
  else fs.writeFileSync(path.join(dir, 'DESIGN.md'), STUB(name));
  fs.writeFileSync(path.join(dir, 'reference.json'), JSON.stringify({
    title: name, suited_for: suitedFor, summary: `Owner-supplied style reference: ${name}.`, ...(url ? { url } : {})
  }, null, 2) + '\n');
  return { dir, images: images.length, hasGuide: !!guide };
}

module.exports = { listReferences, findReference, referenceRules, installReference, addReference };
