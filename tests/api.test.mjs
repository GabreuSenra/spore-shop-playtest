import test from 'node:test';
import assert from 'node:assert/strict';
import {googleEnvironment,run,id} from './helpers/fake-google.mjs';

test('visible setup entry point rejects anonymous and non-owner web execution before any writes',()=>{
  const e=googleEnvironment();
  for(const active of ['', 'other@example.test']) {
    e.state.activeEmail=active;assert.throws(()=>e.setup(),/editor do Apps Script/);
    assert.equal(e.state.created,0);assert.equal(e.state.writes,0);assert.equal(e.properties.size,0);
  }
  e.state.activeEmail='owner@example.test';e.setup();assert.equal(e.state.created,1);
});

test('setup creates headers and distinct credentials; repeating it preserves data and credentials',()=>{
  const e=googleEnvironment();e.setup();const keys=[...e.properties];e.send(run());e.setup();
  assert.equal(e.state.created,1);assert.equal(e.cells.length,2);assert.equal(e.cells[0].length,26);
  assert.deepEqual([...e.properties],keys);assert.notEqual(e.properties.get('INGEST_TOKEN'),e.properties.get('READ_TOKEN'));
});
test('valid run is visible in scalar columns and reconstructed without unknown fields or credentials',()=>{
  const e=googleEnvironment();e.setup();assert.equal(e.send(run({extra:'drop'})).ok,true);
  assert.deepEqual(e.cells[1].slice(8,12),[10,40,1,20]);
  const page=e.read();assert.equal(page.ok,true);assert.equal(page.runs.length,1);assert.equal(page.runs[0].extra,undefined);
  assert.equal(JSON.stringify(e.cells).includes(e.properties.get('INGEST_TOKEN')),false);assert.equal(e.state.locked,false);
});
test('validation rejects false-looking strings, invalid orders, fractional counts and wrong id types',()=>{
  const e=googleEnvironment();e.setup();
  for(const change of [{debug_used:'false'},{gold:-1},{spores:1.5},{run_id:[id(1)]},{playtest_id:[id(2)]},{started_at:'yesterday'},{unlocked_regions:'all'},
    {purchases:[{skill_id:'x',level:1,order:0,gold:1}]}])assert.equal(e.send(run(change)).error,'invalid_payload');
  assert.equal(e.cells.length,1);
});
test('read/write credentials are separate; missing or equal server secrets fail closed',()=>{
  const e=googleEnvironment();assert.equal(e.send(run(),'x').error,'server_not_configured');e.setup();
  assert.equal(e.send(run(),e.properties.get('READ_TOKEN')).error,'unauthorized');
  assert.equal(e.read('',e.properties.get('INGEST_TOKEN')).error,'unauthorized');
  assert.equal(e.context.readPlaytestPage({}).error,'unauthorized');
  e.properties.set('READ_TOKEN',e.properties.get('INGEST_TOKEN'));assert.equal(e.read().error,'server_not_configured');
});
test('duplicate and out-of-order deliveries retain the newest village totals in one row',()=>{
  const e=googleEnvironment();e.setup();e.send(run());e.send(run({revision:3,gold:120,spent:50}));const writes=e.state.writes;
  e.send(run({revision:2,gold:80}));e.send(run());assert.equal(e.state.writes,writes);
  assert.equal(e.cells.length,2);assert.equal(e.read().runs[0].gold,120);assert.equal(e.read().runs[0].spent,50);
});
test('an older debug exclusion erases all metrics and prevents later clean resurrection',()=>{
  const e=googleEnvironment();e.setup();e.send(run({revision:9}));
  e.send({schema:1,run_id:id(1),revision:2,debug_used:true});e.send(run({revision:10}));
  assert.equal(e.read().runs.length,0);assert.equal(e.cells[1][1],9);assert.equal(e.cells[1][2],true);
  assert.ok(e.cells[1].slice(3,17).every(v=>v===''));assert.ok(e.cells[1].slice(18).every(v=>v===''));
});
test('debug exclusion arriving before a clean payload also blocks the run permanently',()=>{
  const e=googleEnvironment();e.setup();e.send({schema:1,run_id:id(1),revision:1,debug_used:true});e.send(run({revision:8}));assert.equal(e.read().runs.length,0);
});
test('large purchase lists round-trip across cells below the Sheets cell-size limit; formulas remain text',()=>{
  const e=googleEnvironment();e.setup();const purchases=Array.from({length:900},(_,i)=>({skill_id:'skill_'+i+'x'.repeat(40),level:1,order:i+1,gold:1}));
  const p=run({build:'=IMPORTXML("x")',campaign:'@test',purchases});assert.equal(e.send(p).ok,true);
  assert.ok(e.cells[1][18].length>30000);assert.ok(e.cells[1][19].startsWith('j:'));assert.ok(e.cells[1].slice(18).every(c=>c.length<=32002));
  const actual=e.read().runs[0];assert.deepEqual(actual.purchases,purchases);assert.equal(actual.build,p.build);assert.ok(e.cells[1][13].startsWith("'="));
});
test('writes acquire a script lock and busy/failure replies cannot be mistaken for an ack',()=>{
  const e=googleEnvironment();e.setup();e.state.busy=true;assert.equal(e.send(run()).error,'busy');assert.equal(e.cells.length,1);
  e.state.busy=false;e.state.failWrite=true;assert.equal(e.send(run()).error,'storage_error');assert.equal(e.state.locked,false);
});
test('pagination is bounded and keeps a fixed append boundary while skipping debug rows',()=>{
  const e=googleEnvironment();e.setup();
  for(let n=1;n<=205;n++)e.send(run({run_id:id(n)}));
  e.send({schema:1,run_id:id(2),revision:2,debug_used:true});
  const first=e.read();assert.equal(first.runs.length,99);e.send(run({run_id:id(206)}));
  const second=e.read(first.next_cursor),third=e.read(second.next_cursor);
  assert.equal(second.runs.length,100);assert.equal(third.runs.length,5);assert.equal(third.next_cursor,null);
  assert.equal(new Set([...first.runs,...second.runs,...third.runs].map(r=>r.run_id)).size,204);
});
test('bad cursors, malformed JSON and manual header corruption produce explicit errors',()=>{
  const e=googleEnvironment();e.setup();e.send(run());
  for(const cursor of ['no','0:2','2:999','9007199254740992:2'])assert.equal(e.read(cursor).error,'invalid_cursor');
  assert.equal(JSON.parse(e.context.doPost({postData:{contents:'bad'}}).body).error,'invalid_json');
  e.cells[0][0]='renamed';assert.equal(e.read().error,'server_not_configured');
});
test('bridge enforces the configured parent origin and never places a credential in HTML',()=>{
  const e=googleEnvironment();e.setup();const channel='a'.repeat(64);
  const good=e.context.doGet({parameter:{view:'bridge',parent_origin:'https://gabreusenra.github.io',channel}});
  assert.equal(good.config.error,'');assert.equal(JSON.stringify(good).includes(e.properties.get('READ_TOKEN')),false);
  const bad=e.context.doGet({parameter:{view:'bridge',parent_origin:'https://evil.test',channel}});assert.equal(bad.config.error,'origin_not_allowed');
  const health=JSON.parse(e.context.doGet({parameter:{}}).body);assert.equal(health.service,'spore-shop-playtest');assert.equal(health.runs,undefined);
});

test('fragments round-trip separately while legacy runs remain unrecorded and invalid fragment values are rejected',()=>{
 const e=googleEnvironment();e.setup();
 assert.equal(e.send(run({relics:2,relic_fragments:17})).ok,true);
 assert.equal(e.read().runs[0].relics,2);assert.equal(e.read().runs[0].relic_fragments,17);
 assert.equal(e.send(run({revision:2,relic_fragments:0})).ok,true);assert.equal(e.read().runs[0].relic_fragments,0);
 for(const value of [-1,1.5,'5',null])assert.equal(e.send(run({revision:3,relic_fragments:value})).error,'invalid_payload');
 assert.equal(e.send(run({run_id:id(88)})).ok,true);assert.equal(e.read().runs[1].relic_fragments,undefined);
 e.send({schema:1,run_id:id(1),revision:3,debug_used:true});assert.equal(e.read().runs.length,1);
});
