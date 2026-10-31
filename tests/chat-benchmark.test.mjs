import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const script=fileURLToPath(new URL('../scripts/benchmark-chats.mjs',import.meta.url));
function execute(args,timeout=45000){
  return new Promise((resolve,reject)=>{
    const proc=spawn(process.execPath,[script,...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    proc.stdout.on('data',data=>stdout+=data);
    proc.stderr.on('data',data=>stderr+=data);
    const timer=setTimeout(()=>{proc.kill();reject(Error('Benchmark exceeded time limit'));},timeout);
    proc.once('error',e=>{clearTimeout(timer);reject(e);});
    proc.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
}
test('Нагрузочный сценарий реально записывает сообщения, проверяет поиск и страницы', {timeout:55000},async()=>{
  const done=await execute(['--messages=400']);
  assert.equal(done.code,0,done.stderr);
  const report=JSON.parse(done.stdout);
  assert.equal(report.synthetic,true);
  assert.equal(report.writtenMessages,400);
  assert.equal(report.searchMatches,1);
  assert.equal(report.latestPage,100);
  assert.equal(report.middlePage,100);
  assert.equal(report.sqliteVersion,4);
  assert.ok(report.dbBytes>0);
  assert.ok(report.ramRssBytes>0);
  assert.ok(Number.isFinite(report.writeMs));
});
test('Большие объёмы требуют явного подтверждения, пользовательские данные не затрагиваются',async()=>{
  const denied=await execute(['--messages=100000']);
  assert.notEqual(denied.code,0);
  assert.match(denied.stderr,/confirm-large/);
});
