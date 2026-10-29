import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, batLaunch, waitReady, stop, deadline } from './helpers/lifecycle.mjs';
if(process.platform==='win32' && process.env.MIYUNEYA_NETWORK_TEST==='1') {
  const cleanPath=join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot;
  test('Official portable bootstrap with SHA-256 then a second BAT startup strictly offline', {timeout:180000},async t=>{
    const root=await fixture(t);const env={MIYUNEYA_NODE:undefined,MIYUNEYA_OFFLINE:'0',PATH:cleanPath};
    const first=batLaunch(root,env);await waitReady(root,first,150000);await stop(root,first);assert.equal((await first.closed).code,0);
    const prepared=(await readdir(join(root,'.runtime'))).find(name=>/^node-v24\.22\.1-win-/.test(name));assert.ok(prepared);
    const executable=join(root,'.runtime',prepared,'node.exe');const before=await stat(executable);
    const second=batLaunch(root,{...env,MIYUNEYA_OFFLINE:'1'});await waitReady(root,second,30000);await stop(root,second);
    assert.equal((await second.closed).code,0);assert.equal((await stat(executable)).mtimeMs,before.mtimeMs);
  });
  test('Wrong SHA-256 rejects the official download before execution or installation',{timeout:180000},async t=>{
    const root=await fixture(t);const config=join(root,'scripts','runtime-sources.json');const sources=JSON.parse(await readFile(config));
    sources.windows.x64='0'.repeat(64);sources.windows.arm64='0'.repeat(64);await writeFile(config,JSON.stringify(sources));
    const child=batLaunch(root,{MIYUNEYA_NODE:undefined,MIYUNEYA_OFFLINE:'0',PATH:cleanPath});
    assert.equal((await deadline(child.closed,150000)).code,20);assert.match(child.errors,/SHA-256 mismatch/);
    const runtime=await readdir(join(root,'.runtime'));assert.equal(runtime.some(name=>name.startsWith('node-v')),false);
  });
}
