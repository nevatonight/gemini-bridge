import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const setup = await readFile(new URL('Setup.ps1', root), 'utf8');
const uninstall = await readFile(new URL('Uninstall.ps1', root), 'utf8');

function indexOrFail(text, needle, label = needle) {
  const i = text.indexOf(needle);
  assert.notEqual(i, -1, `missing ${label}`);
  return i;
}

test('Setup pins npm install to the official npm registry', () => {
  assert.match(setup, /@google\/gemini-cli@\{0\}[\s\S]{0,500}'--registry','https:\/\/registry\.npmjs\.org\/'/);
});

test('automatic Node install pins winget to the winget source', () => {
  assert.match(setup, /winget\.exe[\s\S]{0,800}'--source','winget'/);
});

test('pre-existing hidden launcher is backed up and restored on pre-commit rollback', () => {
  assert.match(setup, /LauncherBackup/);
  assert.match(setup, /function\s+Backup-Launcher\b/);
  assert.match(setup, /function\s+Restore-Launcher\b/);
  const backupCall = indexOrFail(setup, 'Backup-Launcher', 'launcher backup call');
  const startCall = setup.lastIndexOf('Start-BridgeHost $node');
  assert.ok(startCall > backupCall, 'launcher must be backed up before candidate Host launcher is written/started');
  const rollback = setup.match(/function\s+Rollback-Release\([^)]*\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(rollback, /Restore-Launcher/);
});

test('core release commits before shortcut mutation and shortcut failure is ancillary', () => {
  const stage5 = setup.match(/Stage 5 'Start and verify the exact new Host';([^\n]+)/)?.[1] ?? '';
  assert.ok(stage5, 'Stage 5 body not found');
  const commit = indexOrFail(stage5, 'Commit-Release');
  const shortcuts = indexOrFail(stage5, 'Install-Shortcuts');
  assert.ok(commit < shortcuts, 'shortcut mutation must occur only after core commit');
  assert.match(stage5, /try\{Install-Shortcuts\}catch\{[^}]*Warn/i);
});

test('Setup refuses accidental downgrade before quiescing or modifying the installed release', () => {
  assert.match(setup, /function\s+Assert-NoDowngrade\b/);
  const stage2 = setup.match(/Stage 2 'Quiesce existing Host and protect local state';([^\n]+)/)?.[1] ?? '';
  assert.ok(stage2, 'Stage 2 body not found');
  const readCfg = indexOrFail(stage2, '$oldCfg=Read-RuntimeSafe');
  const guard = indexOrFail(stage2, 'Assert-NoDowngrade $oldCfg');
  const quiesce = indexOrFail(stage2, 'Enter-MaintenanceIfRunning');
  assert.ok(readCfg < guard && guard < quiesce, 'downgrade guard must run after config read and before quiesce');
});

test('Uninstall never starts Host for an existing installation whose bridge.sqlite is missing', () => {
  assert.match(uninstall, /Test-Path \$Install[\s\S]{0,1200}bridge\.sqlite[\s\S]{0,700}Ensure-Host/);
  const main = uninstall.slice(uninstall.indexOf('try{'));
  const missingDb = indexOrFail(main, "Join-Path $State 'bridge.sqlite'", 'uninstall bridge.sqlite guard');
  const ensure = indexOrFail(main, 'Ensure-Host $cfg');
  assert.ok(missingDb < ensure, 'bridge.sqlite guard must precede any Ensure-Host call');
});

test('Uninstall proves or blocks residual Host ownership even when program directory is already missing', () => {
  assert.match(uninstall, /function\s+Quiesce-ResidualHostWithoutProgram\b/);
  const main = uninstall.slice(uninstall.indexOf('try{'));
  assert.match(main, /if\s*\(Test-Path \$Install\)[\s\S]*?else\s*\{[^}]*Quiesce-ResidualHostWithoutProgram/s);
  const fn = uninstall.match(/function\s+Quiesce-ResidualHostWithoutProgram\b[^\{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(fn, /Read-Health/);
  assert.match(fn, /Lock-MatchesLiveHost/);
  assert.match(fn, /Stop-And-Prove/);
  assert.doesNotMatch(fn, /Ensure-Host/);
});
