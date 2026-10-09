// Parse only; custom !!js values remain inert strings, never executable code.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
export function parsePatch(text, requireFrom) {
  const YAML = createRequire(path.resolve(requireFrom))('yaml');
  const doc = YAML.parseDocument(text.replace(/^\uFEFF/, ''), { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value) => value }] });
  if (doc.errors.length) throw new Error('patch layer contains invalid YAML');
  const value = doc.toJS();
  if (!Array.isArray(value)) throw new Error('patch layer must be a top-level YAML sequence');
  return value;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), file = args[0], at = args.indexOf('--require-from');
  try {
    if (!file) throw new Error('usage: node tools/patch-check.mjs <patch.yml> [--require-from <package.json>]');
    const base = at >= 0 ? args[at + 1] : path.join(path.dirname(path.resolve(file)), 'package.json');
    const rows = parsePatch(fs.readFileSync(file, 'utf8'), base);
    console.log(`entries=${rows.length}`);
  } catch (error) {
    console.error(error.code === 'MODULE_NOT_FOUND' ? 'Cannot resolve the DSH profile YAML parser; no fallback to another profile.' : error.message);
    process.exitCode = 1;
  }
}
