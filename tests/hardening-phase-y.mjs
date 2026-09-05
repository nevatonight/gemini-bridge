import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=n=>fsp.readFile(path.join(ROOT,n),'utf8');

test('Phase Y: Setup guards predictable backup and launcher roots against reparse redirects',async()=>{
  const s=await read('Setup.ps1');
  assert.match(s,/\$BackupRoot\s*=\s*Join-Path\s+\$BaseRoot\s+['"]backups['"]/i);
  assert.match(s,/\$LauncherRoot\s*=\s*Join-Path\s+\$BaseRoot\s+['"]launcher['"]/i);
  assert.match(s,/Assert-AppOwnedPathSafe\s+\$BackupRoot\b/i);
  assert.match(s,/Assert-AppOwnedPathSafe\s+\$LauncherRoot\b/i);
  const rawBackupRootJoins=[...s.matchAll(/Join-Path\s+\$BaseRoot\s+['"]backups['"]/ig)];
  assert.equal(rawBackupRootJoins.length,1,'only the guarded BackupRoot declaration may join BaseRoot/backups directly');
});

test('Phase Y: Setup refuses reparse runtime.json before trusting old token/port or backing it up',async()=>{
  const s=await read('Setup.ps1');
  assert.match(s,/function Assert-AppOwnedFileSafe[\s\S]*?ReparsePoint/i);
  const stage2=s.slice(s.indexOf("Stage 2 'Quiesce"),s.indexOf("Stage 3 'Install",s.indexOf("Stage 2 'Quiesce")));
  assert.match(stage2,/Assert-AppOwnedFileSafe[^\n]*runtime\.json/i);
  assert.ok(stage2.indexOf('Assert-AppOwnedFileSafe')<stage2.indexOf('Read-RuntimeSafe'),'runtime.json guard must precede trusting old runtime config');
});

test('Phase Y: Uninstall guards launcher root and runtime.json before starting or recursively deleting anything',async()=>{
  const s=await read('Uninstall.ps1');
  assert.match(s,/\$LauncherRoot\s*=\s*Join-Path\s+\$Base\s+['"]launcher['"]/i);
  assert.match(s,/Assert-AppOwnedPathSafe\s+\$LauncherRoot\b/i);
  assert.match(s,/function Assert-AppOwnedFileSafe[\s\S]*?ReparsePoint/i);
  const main=s.slice(s.indexOf('$cfg=$null'));
  assert.ok(main.indexOf('Assert-AppOwnedFileSafe')>=0&&main.indexOf('Assert-AppOwnedFileSafe')<main.indexOf('$cfg=Read-Config'),'runtime.json guard must precede Read-Config');
});
