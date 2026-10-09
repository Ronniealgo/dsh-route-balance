// Source-level release checks. Heuristics are not proof that every secret is absent.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceFiles } from './release-files.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function checkSource(root = ROOT, options = {}) {
  const files = sourceFiles(root), issues = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    // A virtual C:/Users/x test path is not operator identity; actual personal
    // home paths and old repository placeholder URLs must not be published.
    if (file.endsWith('.md') && /github\.com\/OWNER\/|C:[\\/]+Users[\\/]+a(?:[\\/]|\b)/i.test(text)) issues.push(`${file}: personal path or placeholder URL`);
    if (file.endsWith('.md')) {
      const prose = text.replace(/```[\s\S]*?```/g, '');
      for (const match of prose.matchAll(/\]\(<?([^)>]+)>?\)/g)) {
        const target = match[1].trim();
        if (/^(?:https?:|mailto:|#)/.test(target)) continue;
        const relative = decodeURIComponent(target.split('#')[0]);
        if (!fs.existsSync(path.resolve(root, path.dirname(file), relative))) issues.push(`${file}: broken local link ${relative}`);
      }
    }
    if (/\.(?:js|mjs|cjs|ps1|yml|json|md)$/.test(file) && /\bsk-[A-Za-z0-9_-]{24,}\b/.test(text)) issues.push(`${file}: credential-like literal requires manual review`);
    if (options.syntax !== false && /\.(?:js|mjs|cjs)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
      if (result.status !== 0 || result.error) issues.push(`${file}: JavaScript syntax check failed`);
    }
  }
  return { passed: issues.length === 0, files: files.length, issues, scope: 'source syntax, documentation links and limited privacy heuristics' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = checkSource(); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.passed ? 0 : 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
