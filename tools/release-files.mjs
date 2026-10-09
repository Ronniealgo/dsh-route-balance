// Explicit source-archive boundary. No Git database, profiles, caches or dependency trees.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['.gitattributes', '.gitignore', 'AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'README.md', 'SECURITY.md', 'package.json', 'cordis.patch.yml', 'install.ps1'];
const directories = ['.github', 'docs', 'lib', 'src', 'test', 'tools'];
const forbidden = new Set(['.git', 'node_modules', '.dsh', '.codex', '.tmp', 'work', 'outputs', '__pycache__']);
export function sourceFiles(root = ROOT) {
  const files = [];
  const walk = (rel) => {
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('archive path escapes root');
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`source archive refuses links: ${rel}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) {
        if (forbidden.has(name) || /(?:\.log|\.tgz|\.zip|\.lock|\.tmp)$/.test(name) || name.includes('.tmp-')) continue;
        walk(path.posix.join(rel, name));
      }
    } else if (stat.isFile()) files.push(rel);
    else throw new Error(`source archive refuses non-regular file: ${rel}`);
  };
  for (const file of [...roots, ...directories]) walk(file);
  return files.sort();
}
export function sourceRecords(root = ROOT) {
  return sourceFiles(root).map((file) => {
    const bytes = fs.readFileSync(path.join(root, file));
    return { path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const records = sourceRecords();
  console.log(JSON.stringify({ version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, files: records }, null, 2));
}
