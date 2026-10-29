import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../scripts/evaluate.mjs';

test('Fixed control set: identity changes, contradictions, calendar, routing, calculations and unsupported answers',async()=>{
  const result=await evaluate();
  assert.equal(result.total,50);assert.deepEqual(result.failures,[]);assert.equal(result.passed,result.total);
  assert.equal(result.categories.length,6);
});
