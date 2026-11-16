import test from 'node:test';
import assert from 'node:assert/strict';
import {columnChartMarkup,chartScale,regionColor,exactNumber} from '../column-charts.mjs';

test('vertical run charts retain a bar and an exact accessible value for every run, including zero',()=>{
 const rows=[{label:'#108',value:0,color:'#aaa',detail:'Clareira'},{label:'#109',value:57.875,color:'#bbb',detail:'Bosque'}];
 const html=columnChartMarkup(rows,{title:'Ouro por run',yLabel:'Ouro recebido',xLabel:'Runs',perRun:true});
 assert.equal((html.match(/class="column-bar"/g)||[]).length,2);
 assert.ok(html.includes('#109: 57,875 · Bosque'));assert.ok(html.includes('>57,875</text>'));
 assert.ok(html.includes('#108: 0 · Clareira'));assert.ok(html.includes('Ouro recebido'));assert.ok(html.includes('Runs'));
});
test('regional charts keep missing regions distinct from zero medians and show sample sizes',()=>{
 const html=columnChartMarkup([{label:'Clareira',value:0,n:4,color:'#aaa',detail:'n=4'},
   {label:'Bosque',value:null,n:0,color:'#bbb',detail:'n=0'}],{title:'Medianas',yLabel:'Mediana',xLabel:'Região'});
 assert.ok(html.includes('Clareira: 0'));assert.ok(html.includes('Bosque: sem runs'));assert.ok(html.includes('n=4'));assert.ok(html.includes('—'));
});
test('chart scale includes the actual maximum with zero baseline and stable region colors across graphs',()=>{
 for(const maximum of [0,.5,3,57.875,1e6]){const scale=chartScale([0,maximum]);assert.ok(scale.top>=maximum);assert.ok(scale.top>0);assert.ok(scale.step>0);}
 const catalog={regions:[{id:'A'},{id:'B'},{id:'C'}]};assert.notEqual(regionColor(catalog,'A'),regionColor(catalog,'B'));
 assert.equal(regionColor(catalog,'B'),regionColor(catalog,'B'));assert.equal(exactNumber(57.875),'57,875');
});
