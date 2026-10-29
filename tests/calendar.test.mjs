import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNoteDate, formatToday } from '../src/calendar.ts';
test('Local midnight labels stay on the local calendar day',()=>{
  const local=new Date(2026,9,29,0,30,0);
  assert.equal(local.getHours(),0);assert.equal(local.getDate(),29);
  assert.equal(formatNoteDate(local.toISOString()),'29 октября');
  assert.equal(formatToday(local),'четверг, 29 октября');
});
test('Absolute timestamps retain their instant while local labels may differ',()=>{
  const instant=new Date('2026-10-28T15:30:00.000Z');
  assert.equal(instant.toISOString(),'2026-10-28T15:30:00.000Z');
  if(process.env.TZ==='Asia/Vladivostok') {assert.equal(instant.getHours(),1);assert.equal(formatNoteDate(instant.toISOString()),'29 октября');}
  if(process.env.TZ==='UTC') {assert.equal(instant.getHours(),15);assert.equal(formatNoteDate(instant.toISOString()),'28 октября');}
});
