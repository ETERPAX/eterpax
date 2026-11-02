/** Run only after validation. No network, environment secrets, code logging or DB writes. */
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, linkSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const campaign = 'social-annual-2026';
const hash = code => createHash('sha256').update(code).digest('hex');
export function generateInventory(directory) {
  const target = resolve(directory);
  // Never put usable codes anywhere inside a Git working tree (even ignored).
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (spawnSync('git', ['-C', ancestor, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).status === 0) {
    throw new Error('Private output must be outside Git');
  }
  mkdirSync(target, { recursive: true, mode: 0o700 });
  if (realpathSync(target) !== target || (lstatSync(target).mode & 0o077) !== 0) throw new Error('Private directory must be real and mode 0700');
  const file = join(target, 'social-annual-2026.private.json');
  if (!existsSync(file)) {
    const data = { campaign, instagram: [], facebook: [] };
    for (const platform of ['instagram', 'facebook']) {
      for (let slot = 1; slot <= 10; slot++) data[platform].push({ slot, code: `EPX-${randomBytes(24).toString('hex').toUpperCase()}` });
    }
    const temporary = join(target, `.inventory-${randomBytes(12).toString('hex')}`);
    writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    try { linkSync(temporary, file); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    finally { unlinkSync(temporary); }
  }
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || (lstatSync(file).mode & 0o077) !== 0) throw new Error('Private file must be regular and mode 0600');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.campaign !== campaign) throw new Error('Campaign mismatch');
  const rows = [];
  const unique = new Set();
  for (const platform of ['instagram', 'facebook']) {
    if (!Array.isArray(data[platform]) || data[platform].length !== 10) throw new Error('Inventory mismatch');
    for (const [index, row] of data[platform].entries()) {
      if (row.slot !== index + 1 || !/^EPX-[0-9A-F]{48}$/.test(row.code) || unique.has(row.code)) throw new Error('Invalid inventory');
      unique.add(row.code);
      rows.push({ platform, slot: row.slot, digest: hash(row.code) });
    }
  }
  // SQL contains hashes only. Idempotent RPC rejects a different inventory.
  const sql = `-- Does not enable redemption. Apply only to the reviewed project.\nSELECT public.install_social_promotion('${JSON.stringify(rows)}'::jsonb);\n`;
  const manifest = join(target, 'install-hashes.sql');
  try { writeFileSync(manifest, sql, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (lstatSync(manifest).isSymbolicLink() || readFileSync(manifest, 'utf8') !== sql) throw new Error('Existing hash manifest differs');
  }
  return { file, manifest };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/generate-social-promotion.mjs /absolute/private/directory');
    const result = generateInventory(process.argv[2]);
    console.log(`Private inventory: ${result.file}\nHash-only installation: ${result.manifest}\nCampaign remains disabled.`);
  } catch { console.error('Inventory generation failed; no codes printed. Check output location and existing files.'); process.exitCode = 1; }
}
