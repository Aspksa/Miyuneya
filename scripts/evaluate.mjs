import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { emptyMemory, upsert } from '../server/memory.ts';
import { strictDate, reviewAnswer } from '../server/integrity.ts';
import { calculate, complexity } from '../server/logic.ts';

export async function evaluate() {
  const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/memory-evaluation.json',import.meta.url),'utf8'));
  const results=fixture.cases.map(c=>{
    let actual,expected=c.expected;
    if(c.kind==='distinct'||c.kind==='duplicate') { const m=emptyMemory();upsert(m,'fact',c.a);upsert(m,'fact',c.b);actual=m.items.length;expected=c.kind==='distinct'?2:1; }
    else if(c.kind==='date')actual=strictDate(c.value);
    else if(c.kind==='route')actual=complexity(c.text).complex;
    else if(c.kind==='math')actual=calculate(c.expr);
    else if(c.kind==='answer')actual=reviewAnswer('Любит чай',{claims:[{text:'Любит чай',verdict:c.verdict,evidence:[{source:'n',version:c.version,quote:c.quote}]}]},[{source:'n',version:'v1',text:'Любит чай',role:'note',at:'2026-10-30T00:00:00Z'}],true).status==='supported';
    else throw new Error('Unknown evaluation category '+c.kind);
    return {id:c.id,kind:c.kind,pass:actual===expected,actual,expected};
  });
  return {purpose:fixture.purpose,total:results.length,passed:results.filter(r=>r.pass).length,failures:results.filter(r=>!r.pass),categories:[...new Set(results.map(r=>r.kind))].map(kind=>({kind,total:results.filter(r=>r.kind===kind).length,passed:results.filter(r=>r.kind===kind&&r.pass).length}))};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const result=await evaluate();console.log(JSON.stringify(result,null,2));if(result.failures.length)process.exitCode=1;}
