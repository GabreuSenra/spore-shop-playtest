import {eligible,summarize,registeredSaves,saveProgression} from './analytics.mjs';
import {demoRuns} from './demo.mjs';
import {createSheetsClient,sheetsEndpoint} from './sheets-client.mjs';
import {renderColumnChart,regionColor,exactNumber} from './column-charts.mjs';
const $=id=>document.getElementById(id);
const format=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});
const fmt=v=>format.format(v);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog,raw=[],summary,mode='empty',token='',api='',page=0,busy=false;
try {api=localStorage.getItem('spore-playtest-api')||'';} catch {}
const status=(message,warning=false)=>{$('status').textContent=message;$('status').classList.toggle('warning',warning);};
const setOptions=(id,values,label)=>{
  const picker=$(id),current=picker.value;
  picker.innerHTML=`<option value="">${label}</option>`+values.map(([id,name])=>`<option value="${escape(id)}">${escape(name)}</option>`).join('');
  if(values.some(([id])=>id===current))picker.value=current;
};
function choices(){
  const rows=eligible(raw);
  setOptions('campaign',[...new Set(rows.map(r=>r.campaign))].sort().map(v=>[v,v]),'Todas as campanhas');
  setOptions('build',[...new Set(rows.map(r=>r.build))].sort().map(v=>[v,v]),'Todas as versões');
}
function bars(id,rows,{field='value',color='var(--green)',value=fmt,max,empty='Nenhuma run nesta seleção.'}={}) {
  const bound=max??Math.max(1,...rows.map(r=>r[field]||0));
  $(id).innerHTML=rows.length?rows.map(r=>`<div class="bar-row"><div class="bar-label"><span>${escape(r.name)}${r.note?`<small>${escape(r.note)}</small>`:''}</span><strong>${escape(value(r[field],r))}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,Math.min(100,(r[field]||0)/bound*100))}%;background:${color}"></div></div></div>`).join(''):`<p class="empty">${empty}</p>`;
}
function render(){
  const filters=Object.fromEntries(['campaign','build','region','from','to'].map(id=>[id,$(id).value]));
  summary=summarize(raw,catalog,filters); const s=summary,n=s.runs.length;
  $('runs-total').textContent=fmt(n);$('players-total').textContent=`${fmt(s.players)} saves anônimos`;
  for(const key of ['spores','gold','relics']) {
    $(key+'-total').textContent=fmt(s[key]);$(key+'-average').textContent=`${fmt(n?s[key]/n:0)} por run`;
  }
  bars('spores-chart',s.byRegion.map(r=>({...r,note:`n=${r.n}`})),{field:'spores',value:(v,r)=>r.n?fmt(v):'—'});
  renderRegionalMedians();renderSaveProgression();
  bars('unlocks-chart',s.unlocks,{field:'n',max:s.players||1,value:v=>`${fmt(v)} / ${fmt(s.players)} · ${fmt(s.players?v/s.players*100:0)}%`});
  $('spent-average').textContent=fmt(s.avgSpent);$('spent-total').textContent=fmt(s.spent);
  $('purchase-average').textContent=fmt(s.avgPurchase);$('purchase-count').textContent=fmt(s.purchases);
  bars('order-chart',s.order.filter(r=>r.n).map(r=>({...r,note:`n=${r.n} · 1ª compra: ${r.first}`})),{field:'average',value:v=>`${fmt(v)}ª`,empty:'Nenhuma compra observada. As áreas aparecerão após compras no micélio.'});
  renderTree(); renderTable();
}

function renderRegionalMedians(){
  for(const [metric,field,label] of [['gold','medianGold','Ouro vendido'],['relics','medianRelics','Relíquias coletadas']]) {
    const detail=$(metric+'-region-detail');detail.textContent='Passe o mouse ou selecione uma barra para ver o valor exato e a amostra.';
    const rows=summary.byRegion.map(r=>({label:r.name,value:r[field],n:r.n,color:regionColor(catalog,r.id),
      detail:`mediana de ${label.toLowerCase()} por run · ${r.n} runs` }));
    renderColumnChart($(metric+'-region-chart'),rows,{title:`Mediana de ${label.toLowerCase()} por região`,
      yLabel:`Mediana de ${label.toLowerCase()} / run`,xLabel:'Região',minimumStep:metric==='relics'?.5:0,
      onInspect:(_,text)=>detail.textContent=text});
  }
}

function renderSaveProgression(){
  const saves=registeredSaves(summary.runs);
  setOptions('save-picker',saves.map(s=>[s.id,`Save ${s.id.slice(0,8)}…${s.id.slice(-4)} · ${s.count} runs · ${s.first.slice(0,10)}`]),'Selecione um save');
  if(saves.length===1&&!$('save-picker').value)$('save-picker').value=saves[0].id;
  const id=$('save-picker').value,rows=id?saveProgression(summary.runs,id):[];
  $('save-summary').textContent=id?`Save ${id} · ${rows.length} runs na seleção · ${exactNumber(rows.reduce((sum,r)=>sum+r.gold,0))} de ouro · ${exactNumber(rows.reduce((sum,r)=>sum+r.relics,0))} relíquias`
    :saves.length?'Escolha um save para acompanhar seus ganhos e as mudanças de região.':'Nenhum save disponível nos filtros atuais. Conecte a planilha ou explore a demonstração.';
  $('region-legend').innerHTML=catalog.regions.filter(region=>rows.some(r=>r.region===region.id)).map(region=>`<span><i style="background:${regionColor(catalog,region.id)}"></i>${escape(region.name)}</span>`).join('');
  $('save-run-detail').textContent=id?'Passe o mouse ou selecione uma barra para ver ouro, relíquias e região exatos da run.':'Selecione um save para explorar sua trajetória.';
  for(const [metric,label] of [['gold','Ouro recebido'],['relics','Relíquias coletadas']]) {
    const container=$(metric+'-save-chart');
    if(!rows.length){container.innerHTML='<p class="empty">Selecione um save com runs válidas para ver a progressão.</p>';continue;}
    const columns=rows.map(r=>{
      const region=catalog.regions.find(region=>region.id===r.region)?.name||r.region;
      return {label:`#${r.run_number}`,value:r[metric],color:regionColor(catalog,r.region),
        detail:`${region} · ${r.started_at.replace('T',' ')} UTC · ouro: ${exactNumber(r.gold)} · relíquias: ${exactNumber(r.relics)}`};
    });
    renderColumnChart(container,columns,{title:`${label} por run do save selecionado`,yLabel:`${label} na run`,xLabel:'Runs em ordem de registro',
      perRun:true,minimumStep:metric==='relics'?1:0,onInspect:(_,text)=>$('save-run-detail').textContent=text});
  }
}
function renderTable(){
  const rows=[...summary.runs].sort((a,b)=>b.started_at.localeCompare(a.started_at)||b.run_number-a.run_number);
  const pages=Math.max(1,Math.ceil(rows.length/15));page=Math.min(page,pages-1);
  $('run-table').innerHTML=rows.slice(page*15,(page+1)*15).map(r=>`<tr><td>#${fmt(r.run_number)}<small>${escape(r.playtest_id.slice(0,8))}…${escape(r.playtest_id.slice(-4))}</small></td><td>${escape(r.started_at.replace('T',' ').slice(0,16))}<small>${escape(r.build)} · UTC</small></td><td>${escape(catalog.regions.find(x=>x.id===r.region)?.name||r.region)}</td><td>${fmt(r.spores)}</td><td>${fmt(r.gold)}</td><td>${fmt(r.relics)}</td><td>${fmt(r.spent)}</td><td>${r.result==='voltou'?'Retornou':'Desmaiou'}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Nenhuma run encontrada. Ajuste os filtros ou conecte a API.</td></tr>';
  $('table-count').textContent=`${fmt(rows.length)} runs na seleção`;$('page-label').textContent=`${page+1} / ${pages}`;
  $('page-prev').disabled=page===0;$('page-next').disabled=page>=pages-1;
}
let camera=null,baseCamera=null,drag=null;
function renderTree(){
  const nodes=catalog.nodes.filter(n=>!n.placeholder),ids=new Map(nodes.map(n=>[n.id,n]));
  const minX=Math.min(...nodes.map(n=>n.x))-150,minY=Math.min(...nodes.map(n=>n.y))-150;
  baseCamera=[minX,minY,Math.max(...nodes.map(n=>n.x))-minX+150,Math.max(...nodes.map(n=>n.y))-minY+150];
  camera??=[...baseCamera]; updateCamera();
  const cat=$('tree-category').value,max=Math.max(1,...[...summary.heat.values()].map(v=>v.ranks));const seen=new Set();
  const edges=[];
  for(const n of nodes)for(const id of n.links){
    const target=ids.get(id),key=[n.id,id].sort().join('|');if(!target||seen.has(key))continue;seen.add(key);
    edges.push(`<path d="M ${n.x} ${n.y} L ${target.x} ${target.y}" stroke="#486044" stroke-width="6" opacity=".5" fill="none"/>`);
  }
  $('tree').innerHTML=edges.join('')+nodes.map(n=>{
    const heat=summary.heat.get(n.id),ranks=heat?.ranks||0,t=ranks/max;
    const color=ranks?`hsl(${98-58*t} ${32+35*t}% ${35+29*t}%)`:'#26382a';
    const opacity=cat&&!n.categories.includes(cat)?.17:1;
    return `<g class="node" tabindex="0" role="button" data-id="${escape(n.id)}" aria-label="${escape(n.name)}: ${ranks} compras" opacity="${opacity}" transform="translate(${n.x} ${n.y})"><title>${escape(n.name)} · ${ranks} compras · ${heat?.players.size||0} saves</title><circle r="${n.id==='Mother'?49:31}" fill="${color}" stroke="${ranks?'#a7c580':'#586e4d'}" stroke-width="5"/><path d="M -17 0 Q -15 -25 0 -25 Q 15 -25 17 0 Z M -5 0 V 15 H 5 V 0" fill="${ranks?'#101c12':'#8ba17b'}" transform="scale(${n.id==='Mother'?1.4:1})"/><text y="61" text-anchor="middle" fill="#a4b59b" font-size="24">${escape(n.name)}</text></g>`;
  }).join('');
  $('tree').querySelectorAll('.node').forEach(el=>{
    const detail=()=>{const n=ids.get(el.dataset.id),h=summary.heat.get(n.id);$('tree-detail').innerHTML=`<b>${escape(n.name)}</b> · ${fmt(h?.ranks||0)} ranks comprados · ${fmt(h?.players.size||0)} saves<br>${escape(n.categories.map(c=>catalog.categories[c]).join(' · ')||'Sem categoria no filtro')} · ${escape(n.description)}`;};
    el.addEventListener('click',detail);el.addEventListener('focus',detail);el.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();detail();}});
  });
}
function updateCamera(){if(camera)$('tree').setAttribute('viewBox',camera.join(' '));}
function zoom(factor){const next=camera[2]*factor;if(next<baseCamera[2]*.1||next>baseCamera[2]*2)return;camera=[camera[0]+camera[2]*(1-factor)/2,camera[1]+camera[3]*(1-factor)/2,next,camera[3]*factor];updateCamera();}
$('tree').addEventListener('pointerdown',e=>{if(e.target.closest('.node'))return;drag={x:e.clientX,y:e.clientY,camera:[...camera]};$('tree').setPointerCapture(e.pointerId);});
$('tree').addEventListener('pointermove',e=>{if(!drag)return;const rect=$('tree').getBoundingClientRect(),scale=Math.max(camera[2]/rect.width,camera[3]/rect.height);camera=[drag.camera[0]-(e.clientX-drag.x)*scale,drag.camera[1]-(e.clientY-drag.y)*scale,...drag.camera.slice(2)];updateCamera();});
for(const event of ['pointerup','pointercancel'])$('tree').addEventListener(event,()=>drag=null);
$('zoom-in').onclick=()=>zoom(.75);$('zoom-out').onclick=()=>zoom(1.333);$('zoom-reset').onclick=()=>{camera=[...baseCamera];updateCamera();};
$('tree-category').onchange=renderTree;
$('save-picker').onchange=renderSaveProgression;
for(const [source,target] of [['gold-save-chart','relics-save-chart'],['relics-save-chart','gold-save-chart']]) {
  $(source).addEventListener('scroll',event=>{
    const track=event.target,other=$(target).querySelector('.run-chart-track');
    if(track.classList.contains('run-chart-track')&&other&&Math.abs(other.scrollLeft-track.scrollLeft)>1)other.scrollLeft=track.scrollLeft;
  },true);
}
$('page-prev').onclick=()=>{page--;renderTable();};$('page-next').onclick=()=>{page++;renderTable();};
$('filters').addEventListener('change',()=>{page=0;render();});
$('filters').addEventListener('reset',()=>setTimeout(()=>{page=0;render();},0));
$('settings-open').onclick=()=>{$('api-url').value=api;$('api-token').value=token;$('settings').showModal();};
$('settings-close').onclick=()=>$('settings').close();
$('demo').onclick=()=>{if(busy)return;raw=demoRuns(catalog);mode='demo';choices();page=0;render();$('source-badge').textContent='Demonstração';$('source-badge').classList.add('demo');status('DEMONSTRAÇÃO · Dados fictícios para explorar o painel. Nenhum resultado de jogadores reais está sendo exibido.',true);$('settings').close();};
async function connect(){
  if(busy)return;busy=true;$('refresh').disabled=true;$('demo').disabled=true;
  status('Buscando runs na API…');
  let connection;
  try {
    api=sheetsEndpoint(api);
    connection=createSheetsClient(api);
    const received=[];let cursor='';
    do {
      const body=await connection.readPage(token,cursor);if(!Array.isArray(body.runs))throw Error('Resposta do Google Sheets incompatível.');
      received.push(...body.runs);const next=body.next_cursor||'';if(next&&next===cursor)throw Error('Paginação inválida na API.');cursor=next;
      if(received.length>=50000&&cursor)throw Error('A consulta excedeu 50 mil runs. Exporte ou arquive campanhas antigas antes de continuar.');
    } while(cursor);
    raw=received;mode='live';choices();page=0;render();$('settings').close();
    $('source-badge').textContent='Sheets conectado';$('source-badge').classList.remove('demo');
    status(`Dados reais · ${fmt(raw.length)} runs recebidas · Atualizado às ${new Date().toLocaleTimeString('pt-BR')}. A última run é enviada após a próxima expedição, troca de save ou saída do jogo.`);
    try{localStorage.setItem('spore-playtest-api',api);}catch{}
  } catch(error){
    status(`${error.message} ${mode==='demo'?'A tela continua mostrando a demonstração.':mode==='live'?'A tela mantém a última consulta, que pode estar desatualizada.':'Configure a conexão para receber dados reais.'}`,true);
  } finally{connection?.close();busy=false;$('refresh').disabled=false;$('demo').disabled=false;}
}
$('connection-form').onsubmit=e=>{e.preventDefault();api=$('api-url').value.trim().replace(/\/+$/,'');token=$('api-token').value;$('api-token').value='';connect();};
$('refresh').onclick=()=>{if(mode==='live')connect();else $('settings-open').click();};
$('export').onclick=()=>{
  const header=['fonte','run_id','save_anonimo','run','inicio_utc','build','campanha','regiao','esporos','ouro_vendido','reliquias','ouro_gasto','regioes_liberadas','compras_em_ordem'];
  const cell=v=>{let text=String(v);if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const rows=summary.runs.map(r=>[mode,r.run_id,r.playtest_id,r.run_number,r.started_at,r.build,r.campaign,r.region,r.spores,r.gold,r.relics,r.spent,r.unlocked_regions.join(', '),JSON.stringify(r.purchases)]);
  const csv='\uFEFF'+[header,...rows].map(row=>row.map(cell).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`spore-shop-${mode}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
document.querySelectorAll('nav a').forEach(a=>a.addEventListener('click',()=>{document.querySelectorAll('nav a').forEach(n=>n.classList.toggle('active',n===a));}));
try {
  const res=await fetch('catalog.json');if(!res.ok)throw Error('Catálogo indisponível.');catalog=await res.json();
  setOptions('region',catalog.regions.map(r=>[r.id,r.name]),'Todas as regiões');setOptions('tree-category',Object.entries(catalog.categories),'Todas as áreas');
  render();$('api-url').value=api;
} catch {status('Não foi possível carregar o catálogo da árvore. Sirva esta pasta por HTTP e confira catalog.json.',true);}
