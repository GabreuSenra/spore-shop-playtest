import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,eligible,median,registeredSaves,saveProgression} from '../analytics.mjs';
const catalog={regions:[{id:'A',name:'Clareira'},{id:'B',name:'Bosque'}],categories:{filter:'Filtro',uv:'Lanterna UV'},nodes:[{id:'mixed',categories:['filter','uv']},{id:'filter',categories:['filter']}]};
const run=(id,extra={})=>({run_id:id,revision:1,debug_used:false,result:'voltou',playtest_id:'p1',tracking_from_start:true,build:'v1',campaign:'c1',region:'A',started_at:'2026-11-16T12:00:00',spores:0,gold:0,relics:0,spent:0,unlocked_regions:['A'],purchases:[],...extra});
test('upsert revisions deduplicate; debug wins even over a later clean revision',()=>{
 const input=[run('a',{spores:4}),run('a',{revision:2,spores:8}),run('b'),run('b',{revision:2,debug_used:true}),run('b',{revision:3}),run('c',{result:''})];
 assert.deepEqual(eligible(input).map(r=>[r.run_id,r.spores]),[['a',8]]);
});
test('regional means include zero runs and retain missing regions as no sample',()=>{
 const s=summarize([run('a',{spores:10,gold:100,relics:2,spent:80}),run('b')],catalog);
 assert.equal(s.byRegion[0].spores,5);assert.equal(s.byRegion[0].gold,50);assert.equal(s.byRegion[0].relics,1);
 assert.equal(s.avgSpent,40);assert.equal(s.byRegion[1].n,0);assert.equal(s.players,1);
});
test('first category purchase uses lifetime order once per save; mixed nodes match both filters',()=>{
 const a=run('a',{purchases:[{skill_id:'filter',order:3,level:1,gold:30}],spent:30});
 const b=run('b',{unlocked_regions:['A','B'],purchases:[{skill_id:'mixed',order:8,level:1,gold:50}],spent:50});
 const c=run('c',{playtest_id:'p2',purchases:[{skill_id:'mixed',order:1,level:1,gold:10}],spent:10});
 const s=summarize([a,b,c],catalog);const byId=Object.fromEntries(s.order.map(o=>[o.id,o]));
 assert.equal(byId.filter.average,2);assert.equal(byId.uv.average,4.5);assert.equal(byId.filter.n,2);
 assert.equal(byId.uv.first,1);assert.equal(s.heat.get('mixed').ranks,2);assert.equal(s.heat.get('mixed').players.size,2);
 assert.equal(s.unlocks[1].n,1);assert.equal(s.avgPurchase,30);
});
test('campaign/build/date/region filters change every metric on the same cohort',()=>{
 const input=[run('a'),run('b',{region:'B',build:'v2',campaign:'c2',started_at:'2026-11-15T10:00:00',spores:15})];
 const s=summarize(input,catalog,{region:'B',build:'v2',campaign:'c2',from:'2026-11-15',to:'2026-11-15'});
 assert.equal(s.runs.length,1);assert.equal(s.spores,15);assert.equal(s.byRegion[0].n,0);
 assert.equal(summarize(input,catalog,{from:'2026-11-17'}).players,0);
});
test('pre-existing saves contribute purchases and heat but cannot claim an observed first area',()=>{
 const s=summarize([run('a',{tracking_from_start:false,purchases:[{skill_id:'mixed',order:30,level:1,gold:10}],spent:10})],catalog);
 assert.equal(s.heat.get('mixed').ranks,1);assert.equal(s.purchases,1);assert.ok(s.order.every(r=>r.n===0));
});
test('a region/date filter does not mistake a later rank for the historical first area purchase',()=>{
 const input=[run('a',{region:'A',purchases:[{skill_id:'filter',order:3,level:1,gold:10}]}),run('b',{region:'B',purchases:[{skill_id:'filter',order:8,level:2,gold:20}]})];
 const s=summarize(input,catalog,{region:'B'});assert.equal(s.runs.length,1);assert.equal(s.order.find(x=>x.id==='filter').average,3);assert.equal(s.heat.get('filter').ranks,1);
});

test('regional medians use every eligible run, include zero, and resist one unusually rich run',()=>{
 const input=[0,10,20,10000].map((gold,i)=>run(String(i),{gold,relics:[0,0,2,50][i]}));
 input.push(run('other-region',{region:'B',gold:500,relics:9}));
 input.push(run('debug',{gold:90000,relics:900,debug_used:true}));
 input.push(run('interrupted',{gold:80000,result:'interrompida'}));
 const s=summarize(input,catalog);
 assert.equal(s.byRegion[0].medianGold,15);assert.equal(s.byRegion[0].medianRelics,1);assert.equal(s.byRegion[0].n,4);
 assert.equal(s.byRegion[0].gold,2507.5);assert.equal(s.byRegion[1].medianGold,500);
 assert.equal(summarize(input,catalog,{region:'A'}).byRegion[1].medianGold,null);
});
test('median sorts numerically, preserves the input, and distinguishes no sample from a measured zero',()=>{
 const numbers=[100,2,11];assert.equal(median(numbers),11);assert.deepEqual(numbers,[100,2,11]);
 assert.equal(median([0,0]),0);assert.equal(median([0,1]),.5);assert.equal(median([]),null);
 const s=summarize([],catalog);assert.ok(s.byRegion.every(r=>r.medianGold===null&&r.medianRelics===null));
});
test('a save trajectory keeps exact gold and relic totals for each run and excludes other saves/debug',()=>{
 const input=[run('later',{run_number:3,started_at:'2026-11-16T12:03:00',gold:43.125,relics:7,region:'B'}),
   run('first',{run_number:1,started_at:'2026-11-16T12:01:00',gold:0,relics:0}),
   run('later',{revision:2,run_number:3,started_at:'2026-11-16T12:03:00',gold:57.875,relics:8,region:'B'}),
   run('other',{playtest_id:'p2',run_number:2,gold:999}),run('debug',{run_number:2,debug_used:true,gold:500})];
 const rows=saveProgression(input,'p1');
 assert.deepEqual(rows.map(r=>[r.run_number,r.region,r.gold,r.relics]),[[1,'A',0,0],[3,'B',57.875,8]]);
 assert.equal(registeredSaves(input).find(s=>s.id==='p1').count,2);
 assert.equal(saveProgression(input,'missing').length,0);
});
