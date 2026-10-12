// Build lib/client.js from src/client.bundle.js + lib/core.js + lib/registry.js,
// stamping the package name and version into the bundle.
//   node tools/build-client.mjs [--check]
// --check exits non-zero when lib/client.js differs from what would be generated,
// which is what CI and `prepublishOnly` run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const check = process.argv.includes('--check');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const template = read('src/client.bundle.js');
const pkg = JSON.parse(read('package.json'));

/**
 * Strip a module down to declarations that can live inside the bundle factory:
 * the file-level doc comment, `export` keywords, and `import` lines (every
 * module is inlined into one scope, so imports would be duplicates).
 * The remaining source is indented to the placeholder's depth.
 */
function inlineSource(source, label) {
  const body = source
    .replace(/^\/\*\*[\s\S]*?\*\/\s*/, '')
    .replace(/^import\s[^\n]*\n/gm, '')
    .replace(/^export\s+async\s+function\s/gm, 'async function ')
    .replace(/^export\s+function\s/gm, 'function ')
    .replace(/^export\s+const\s/gm, 'const ')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .trim();
  if (body === '') throw new Error(`inlined module ${label} is empty`);
  return body.split('\n').map((line) => (line === '' ? '' : '    ' + line)).join('\n');
}

const output = template
  .replace('    __CORE__', inlineSource(read('lib/core.js'), 'lib/core.js'))
  .replace('    __REGISTRY__', inlineSource(read('lib/registry.js'), 'lib/registry.js'))
  .replaceAll('__ID__', pkg.name)
  .replaceAll('__VERSION__', pkg.version);

const target = path.join(root, 'lib/client.js');
const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

// Guards: both modules must have been inlined, and no marker may survive.
const guards = [
  ['function formatAmount(text)', 'core module'],
  ['function createStore(', 'registry module'],
  ['function mergeEntries(groups)', 'registry merge'],
  ['const accountSource = {', 'account source'],
];
for (const [needle, what] of guards) {
  if (!output.includes(needle)) throw new Error(`${what} was not inlined into the bundle`);
}
// Guard: the placeholder lines must be gone. The bare marker names still occur
// in the template's own documentation, which is intentionally kept in the
// shipped file, so the check targets the indented placeholder lines.
for (const marker of ['    __CORE__', '    __REGISTRY__', '__VERSION__']) {
  if (output.includes(marker)) throw new Error(`bundle still contains "${marker.trim()}"`);
}
// `__ID__` is a substring of the registry marker, so it is asserted before it
// rather than through the placeholder scan.
if (!output.includes(`id: "${pkg.name}"`)) throw new Error('bundle does not register the package id');

if (check) {
  if (previous !== output) {
    console.error('lib/client.js is stale — run: node tools/build-client.mjs');
    process.exit(1);
  }
  console.log('lib/client.js is up to date');
} else {
  if (previous === output) {
    console.log(`lib/client.js already current (${Buffer.byteLength(output, 'utf8')} bytes, v${pkg.version})`);
  } else {
    fs.writeFileSync(target, output);
    console.log(`wrote lib/client.js (${Buffer.byteLength(output, 'utf8')} bytes, ${pkg.name}@${pkg.version})`);
  }
}
