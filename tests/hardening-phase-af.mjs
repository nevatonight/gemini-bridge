import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const text=rel=>fsp.readFile(path.join(ROOT,rel),'utf8');

test('Phase AF: Dashboard defines a coherent neutral surface/token system rather than browser-default styling',async()=>{
  const css=await text('ui/styles.css');
  for(const token of ['--bg','--sidebar','--surface','--surface-hover','--text','--text-secondary','--border','--shadow-composer']) assert.match(css,new RegExp(token.replace('--','\\-\\-')));
  assert.match(css,/body\s*\{[^}]*background\s*:\s*var\(--bg\)/s);
});

test('Phase AF: desktop layout is full-height product chrome with integrated sidebar and border-separated workspace',async()=>{
  const css=await text('ui/styles.css');
  assert.match(css,/\.app-shell\s*\{[^}]*height\s*:\s*100(?:d)?vh[^}]*grid-template-columns/s);
  assert.match(css,/\.sidebar\s*\{[^}]*background\s*:\s*var\(--sidebar\)[^}]*border-right/s);
  assert.match(css,/\.chat\s*\{[^}]*background\s*:\s*var\(--surface\)/s);
});

test('Phase AF: primary interactive controls have explicit hover focus-visible disabled and transition states',async()=>{
  const css=await text('ui/styles.css');
  assert.match(css,/:focus-visible/);
  assert.match(css,/button:disabled|button\[disabled\]/);
  assert.match(css,/transition\s*:/);
  assert.match(css,/\.primary:hover/);
});

test('Phase AF: composer is a centered elevated chat input with restrained width and responsive focus treatment',async()=>{
  const css=await text('ui/styles.css');
  assert.match(css,/\.conversation-column\s*\{[^}]*max-width\s*:\s*var\(--content-width\)/s);
  assert.match(css,/\.composer\s*\{[^}]*box-shadow\s*:\s*var\(--shadow-composer\)/s);
  assert.match(css,/\.composer:focus-within/);
});

test('Phase AF: dark mode has first-class surfaces instead of relying on browser color-scheme inversion',async()=>{
  const css=await text('ui/styles.css');
  assert.match(css,/@media\s*\(prefers-color-scheme\s*:\s*dark\)/);
  const dark=css.slice(css.search(/@media\s*\(prefers-color-scheme\s*:\s*dark\)/));
  assert.match(dark,/--bg\s*:/);assert.match(dark,/--sidebar\s*:/);assert.match(dark,/--surface\s*:/);assert.match(dark,/--text\s*:/);
});

test('Phase AF: motion and narrow viewport behavior respect user/platform constraints',async()=>{
  const css=await text('ui/styles.css');
  assert.match(css,/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/);
  assert.match(css,/@media\s*\(max-width\s*:\s*720px\)/);
});

test('Phase AF: ChatGPT panel uses the same polished neutral surface language with dark-mode and focus states',async()=>{
  const c=await text('web-extension/content.js');
  assert.match(c,/--gb-surface\s*:/);assert.match(c,/--gb-text\s*:/);assert.match(c,/--gb-border\s*:/);
  assert.match(c,/\.panel\{[^}]*box-shadow\s*:\s*var\(--gb-panel-shadow\)/s);
  assert.match(c,/:focus-visible/);assert.match(c,/@media\s*\(prefers-color-scheme\s*:\s*dark\)/);
});
