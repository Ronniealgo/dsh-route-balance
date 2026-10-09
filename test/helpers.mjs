import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function temporary(t, suffix = '') {
  const parent = path.resolve(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, `dshrb-test-${suffix}`));
  t.after(() => { assert.equal(path.dirname(dir), parent); assert.ok(path.basename(dir).startsWith('dshrb-test-')); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
export function npmCli() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  try { candidates.push(require.resolve('npm/bin/npm-cli.js')); } catch {}
  const found = candidates.find((file) => file && file.endsWith('.js') && fs.existsSync(file));
  if (!found) throw new Error('npm CLI not found next to Node; provide npm_execpath');
  return found;
}
export function profile(t, bytes) {
  const home = temporary(t, 'profile-'), dir = path.join(home, 'profiles/desktop');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}');
  const require = createRequire(import.meta.url);
  const parser = process.env.DSH_ROUTE_BALANCE_YAML_PACKAGE || require.resolve('yaml/package.json');
  assert.equal(JSON.parse(fs.readFileSync(parser, 'utf8')).name, 'yaml');
  fs.cpSync(path.dirname(parser), path.join(dir, 'node_modules/yaml'), { recursive: true });
  const patch = path.join(dir, 'cordis.patch.yml'); fs.writeFileSync(patch, bytes);
  return { home, dir, patch, link: path.join(dir, 'node_modules/dsh-route-balance'), state: `${patch}.dsh-route-balance.json`, root: ROOT };
}
