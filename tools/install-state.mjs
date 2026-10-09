// Conservative, journalled installer. Never rewrites an unowned YAML entry.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parsePatch } from './patch-check.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '# >>> dsh-route-balance (managed block) >>>';
const END = '# <<< dsh-route-balance <<<';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
function problem(message, code = 2) { const e = new Error(message); e.exitCode = code; return e; }
function atomic(file, bytes) {
  const temp = `${file}.tmp-${randomUUID()}`;
  fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function stat(file) { try { return fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function linkMatches(link, root) {
  const info = stat(link);
  if (!info) return false;
  return info.isSymbolicLink() && samePath(path.resolve(path.dirname(link), fs.readlinkSync(link)), root);
}
function assertLink(link, root) {
  if (stat(link) && !linkMatches(link, root)) throw problem('插件路径已被其它目录或联接占用；未修改。');
}
function locate(bytes, journal) {
  const block = Buffer.from(journal.block ?? '', 'base64');
  if (!block.length || !block.toString('utf8').startsWith(BEGIN) || !block.includes(Buffer.from(END))) throw problem('安装记录损坏；未修改。');
  const at = bytes.indexOf(block);
  const text = bytes.toString('utf8');
  if (at < 0 || bytes.indexOf(block, at + 1) !== -1 || text.split(BEGIN).length !== 2 || text.split(END).length !== 2) throw problem('受管理块被改动或标记不完整；未修改。');
  const pad = Buffer.from(journal.padding ?? '', 'base64');
  let start = at;
  if (pad.length) {
    if (at < pad.length || !bytes.subarray(at - pad.length, at).equals(pad) || digest(bytes.subarray(0, at - pad.length)) !== journal.beforeHash) throw problem('块前内容与记录不符，无法安全移除补加换行；未修改。');
    start -= pad.length;
  }
  return Buffer.concat([bytes.subarray(0, start), bytes.subarray(at + block.length)]);
}
export function installPackage(options, deps = {}) {
  const root = path.resolve(options.root ?? ROOT), home = path.resolve(options.dshHome);
  const profile = options.profile ?? 'desktop';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(profile)) throw problem('Profile 名称无效。');
  if (process.env.DSH_ROUTE_BALANCE_TEST === '1' && samePath(home, path.join(os.homedir(), '.dsh'))) throw problem('测试禁止操作真实 DSH 目录。');
  const profileDir = path.join(home, 'profiles', profile), patch = path.join(profileDir, 'cordis.patch.yml');
  if (!stat(profileDir)?.isDirectory() || !stat(patch)?.isFile() || stat(patch).isSymbolicLink()) throw problem('未找到普通的 profile/cordis.patch.yml 文件。');
  const name = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name;
  if (name !== 'dsh-route-balance') throw problem('不支持的插件包名。');
  const link = path.join(profileDir, 'node_modules', name), state = `${patch}.dsh-route-balance.json`, lock = `${patch}.dsh-route-balance.lock`;
  const validate = deps.validate ?? ((bytes) => parsePatch(bytes.toString('utf8'), path.join(profileDir, 'package.json')));
  const createLink = deps.createLink ?? (() => fs.symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir'));
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx', 0o600); } catch { throw problem('安装锁已存在；请确认没有另一安装进程，未修改。'); }
  try {
    const before = fs.readFileSync(patch), text = before.toString('utf8');
    let journal = null;
    if (stat(state)) {
      try { journal = JSON.parse(fs.readFileSync(state, 'utf8')); } catch { throw problem('安装记录不可读；未修改。'); }
      if (journal.version !== 1 || journal.package !== name || !samePath(journal.root ?? '', root)) throw problem('安装记录归属不匹配；未修改。');
    }
    if (options.uninstall) {
      if (!journal) {
        if (text.includes(BEGIN) || text.includes(END)) throw problem('发现标记但没有安装记录；未修改。');
        return { changed: false, message: '未发现受管理块（未修改）' };
      }
      const after = locate(before, journal);
      validate(after);
      if (journal.junctionCreated) assertLink(link, root);
      if (!fs.readFileSync(patch).equals(before)) throw problem('配置被其他进程更新；未修改。');
      let removed = false;
      try {
        atomic(patch, after);
        if (journal.junctionCreated && stat(link)) { fs.unlinkSync(link); removed = true; }
        fs.unlinkSync(state);
      } catch (error) {
        atomic(patch, before);
        if (removed && !stat(link)) createLink();
        throw error;
      }
      return { changed: true, message: '已移除插件自有块；其它配置字节保持不变。重启 DSH 后卸载生效。' };
    }
    if (journal) {
      locate(before, journal); assertLink(link, root);
      validate(before);
      if (!stat(link)) {
        createLink();
        try { atomic(state, Buffer.from(JSON.stringify({ ...journal, junctionCreated: true }) + '\n')); }
        catch (error) { if (linkMatches(link, root)) fs.unlinkSync(link); throw error; }
        return { changed: true, message: '已恢复缺失的插件联接；未重复添加配置。' };
      }
      return { changed: false, message: '插件已安装；未重复添加。' };
    }
    if (text.includes(BEGIN) || text.includes(END)) throw problem('发现未登记标记；未修改。');
    const rows = validate(before);
    const inspected = new WeakSet();
    const hasId = (value) => {
      if (!value || typeof value !== 'object' || inspected.has(value)) return false;
      inspected.add(value);
      return value.id === 'route-balance' || Object.values(value).some(hasId);
    };
    if (hasId(rows)) throw problem('已有非本安装器管理的 route-balance 条目；未修改。');
    // Converting a flow sequence without a full YAML round-trip would lose bytes.
    if (/^\s*\[\s*\]\s*(?:#.*)?$/m.test(text.replace(/^\uFEFF/, ''))) throw problem('空流式列表 [] 暂不支持自动追加；请先改为块式列表，文件未修改。', 3);
    assertLink(link, root);
    const ending = text.includes('\r\n') ? '\r\n' : '\n';
    const padding = before.length && !text.endsWith('\n') ? Buffer.from(ending) : Buffer.alloc(0);
    const block = Buffer.from([BEGIN, '- insert:', '    - id: route-balance', '      name: "dsh-route-balance"', '      config:', '        slot: sidebar.footer.action', '        refreshMs: 300000', END, ''].join(ending));
    const after = Buffer.concat([before, padding, block]);
    const newRows = validate(after);
    if (newRows.length !== rows.length + 1) throw problem('追加块未形成独立 YAML 条目；未修改。');
    const backup = `${patch}.bak-route-balance-${Date.now()}-${randomUUID()}`;
    const record = { version: 1, package: name, root, beforeHash: digest(before), block: block.toString('base64'), padding: padding.toString('base64'), junctionCreated: !stat(link) };
    fs.writeFileSync(backup, before, { flag: 'wx', mode: 0o600 });
    if (!fs.readFileSync(patch).equals(before)) throw problem('配置被其他进程更新；未修改。');
    let written = false, linked = false, recorded = false;
    try {
      atomic(state, Buffer.from(JSON.stringify(record) + '\n')); recorded = true;
      atomic(patch, after); written = true;
      validate(fs.readFileSync(patch));
      fs.mkdirSync(path.dirname(link), { recursive: true });
      if (record.junctionCreated) { createLink(); linked = true; }
    } catch (error) {
      if (written) atomic(patch, before);
      if (linked && linkMatches(link, root)) fs.unlinkSync(link);
      if (recorded && stat(state)) fs.unlinkSync(state);
      throw error;
    }
    return { changed: true, message: '安装完成，已保存原始字节备份。重启 DSH 并刷新页面后生效。' };
  } finally { fs.closeSync(lockFd); fs.unlinkSync(lock); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  try {
    const result = installPackage({ root: ROOT, dshHome: value('--home', path.join(os.homedir(), '.dsh')), profile: value('--profile', 'desktop'), uninstall: args.includes('--uninstall') });
    console.log(result.message);
  } catch (error) {
    console.error(error.code === 'MODULE_NOT_FOUND' ? '找不到目标 DSH profile 的 YAML 解析器；未安装。' : error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}
