import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, batLaunch, waitReady, stop, launch, deadline } from './helpers/lifecycle.mjs';
const windows=process.platform==='win32';
if(windows) {
  const powershell=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  test('Real Windows BAT: foreign cwd, Unicode, ! & ^ () % #, missing Python, health and reuse',async t=>{
    const root=await fixture(t);
    const env={MIYUNEYA_OFFLINE:'1',PYTHON:'C:\\missing\\python.exe',PYTHONHOME:'C:\\broken-python',TZ:process.env.TZ};
    const first=batLaunch(root,env);const pointer=await waitReady(root,first,30000);
    const second=batLaunch(root,env);assert.equal((await deadline(second.closed,20000)).code,0);
    assert.ok(second.output.includes(`http://127.0.0.1:${pointer.port}`));
    await stop(root,first);assert.equal((await first.closed).code,0);
    const log=await readFile(join(root,'.runtime','logs','startup.log'),'utf8');assert.match(log,/writes-drained/);
  });
  test('Windows file association launch (ShellExecute), the same entry point used by Explorer',async t=>{
    const root=await fixture(t);const child=batLaunch(root,{MIYUNEYA_OFFLINE:'1'},true);
    await waitReady(root,child,30000);await stop(root,child);assert.equal((await child.closed).code,0);
  });
  test('PowerShell from Node: rejects corrupt portable Node and selects a working PATH interpreter',async t=>{
    const root=await fixture(t);await mkdir(join(root,'.runtime','node'),{recursive:true});await writeFile(join(root,'.runtime','node','node.exe'),'broken binary');
    const env={...process.env,MIYUNEYA_OFFLINE:'1'};delete env.MIYUNEYA_NODE;
    const child=launch(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts','bootstrap.ps1'),'-ProbeOnly'],{env});
    assert.equal((await deadline(child.closed)).code,0,child.errors);
    const result=JSON.parse(child.output.trim());assert.ok(result.executable);assert.match(result.version,/^\d+\.\d+\.\d+$/);
  });
  test('No Node and offline: visible stage/exit without deleting an old broken runtime',async t=>{
    const root=await fixture(t);await mkdir(join(root,'.runtime','node'),{recursive:true});const broken=join(root,'.runtime','node','node.exe');await writeFile(broken,'keep damaged binary for diagnosis');
    const child=batLaunch(root,{MIYUNEYA_NODE:undefined,MIYUNEYA_OFFLINE:'1',PATH:join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot});
    assert.equal((await deadline(child.closed)).code,20);assert.match(child.errors,/node-download/);assert.match(child.errors,/offline mode/);
    assert.equal(await readFile(broken,'utf8'),'keep damaged binary for diagnosis');
  });
  test('Explicit corrupt Node path does not silently download or ignore the user override',async t=>{
    const root=await fixture(t);const child=batLaunch(root,{MIYUNEYA_NODE:join(root,'not-node.exe'),MIYUNEYA_OFFLINE:'1'});
    assert.equal((await deadline(child.closed)).code,20);assert.match(child.errors,/MIYUNEYA_NODE/);
    const log=await readFile(join(root,'.runtime','logs','bootstrap.log'),'utf8');assert.doesNotMatch(log,/node-download/);
  });
}
