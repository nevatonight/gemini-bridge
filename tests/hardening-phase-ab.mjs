import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('Phase AB: release manifest uses canonical relative paths without Unix ./ prefixes',async()=>{
  const lines=(await fsp.readFile(path.join(ROOT,'MANIFEST.sha256'),'utf8')).trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length>0);
  for(const line of lines){
    const m=line.match(/^([a-f0-9]{64})  (.+)$/i);
    assert.ok(m,`malformed manifest line: ${line}`);
    assert.doesNotMatch(m[2],/^\.\//,`non-canonical manifest path: ${m[2]}`);
    assert.doesNotMatch(m[2],/^\//,`absolute manifest path: ${m[2]}`);
    assert.ok(!m[2].split('/').includes('..'),`unsafe manifest path: ${m[2]}`);
  }
});

test('Phase AB: Windows Setup canonicalizes a benign ./ manifest prefix before exhaustive comparison',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');
  assert.match(s,/StartsWith\('\.\/'\)|-like\s+['"]\.\/*/i,'Setup must explicitly normalize an optional ./ prefix');
  assert.match(s,/Substring\(2\)|TrimStart/i,'Setup must remove the benign ./ prefix before key comparison');
  assert.match(s,/IsPathRooted\(\$rel\)/,'absolute paths must remain rejected');
  assert.match(s,/\$rel\.Split\('\/'\)\s+-contains\s+'\.\.'/,'parent traversal must remain rejected');
});


test('Phase AB: manifest is exhaustive and hashes exactly match the shipped development tree',async()=>{
  const manifestText=await fsp.readFile(path.join(ROOT,'MANIFEST.sha256'),'utf8');
  const expected=new Map();
  for(const line of manifestText.trim().split(/\r?\n/).filter(Boolean)){
    const m=line.match(/^([a-f0-9]{64})  (.+)$/i); assert.ok(m,`malformed manifest line: ${line}`);
    expected.set(m[2],m[1].toLowerCase());
  }
  const actual=[];
  async function walk(dir){
    for(const ent of await fsp.readdir(dir,{withFileTypes:true})){
      const full=path.join(dir,ent.name),rel=path.relative(ROOT,full).split(path.sep).join('/');
      if(rel==='MANIFEST.sha256'||rel==='node_modules'||rel.startsWith('node_modules/')) continue;
      const st=await fsp.lstat(full); assert.equal(st.isSymbolicLink(),false,`release tree symlink: ${rel}`);
      if(st.isDirectory()) await walk(full); else if(st.isFile()) actual.push(rel);
    }
  }
  await walk(ROOT); actual.sort();
  assert.deepEqual([...expected.keys()].sort(),actual,'manifest paths must exactly equal shipped files');
  for(const rel of actual){const b=await fsp.readFile(path.join(ROOT,rel));const h=crypto.createHash('sha256').update(b).digest('hex');assert.equal(expected.get(rel),h,`hash mismatch: ${rel}`);}
});
