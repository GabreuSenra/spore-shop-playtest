export function eligible(runs) {
  const latest = new Map(); const blocked = new Set();
  for (const r of runs) {
    if (r.debug_used === true) blocked.add(r.run_id);
    if (!latest.has(r.run_id) || r.revision > latest.get(r.run_id).revision) latest.set(r.run_id,r);
  }
  return [...latest.values()].filter(r=>!blocked.has(r.run_id) && r.debug_used === false && ['voltou','desmaiou'].includes(r.result)).map(r=>({...r,relic_fragments:Number.isSafeInteger(r.relic_fragments)&&r.relic_fragments>=0?r.relic_fragments:null}));
}

export function median(values) {
  if(!values.length)return null;
  const ordered=[...values].sort((a,b)=>a-b),middle=Math.floor(ordered.length/2);
  return ordered.length%2?ordered[middle]:(ordered[middle-1]+ordered[middle])/2;
}

export function saveProgression(input,saveId) {
  return eligible(input).filter(r=>r.playtest_id===saveId).sort((a,b)=>a.started_at.localeCompare(b.started_at)
    ||a.run_number-b.run_number||a.run_id.localeCompare(b.run_id));
}

export function registeredSaves(input) {
  const saves=new Map();
  for(const r of eligible(input)) {
    if(!saves.has(r.playtest_id))saves.set(r.playtest_id,{id:r.playtest_id,count:0,first:r.started_at,last:r.started_at});
    const save=saves.get(r.playtest_id);save.count++;
    if(r.started_at<save.first)save.first=r.started_at;
    if(r.started_at>save.last)save.last=r.started_at;
  }
  return [...saves.values()].sort((a,b)=>a.first.localeCompare(b.first)||a.id.localeCompare(b.id));
}

export function summarize(input, catalog, filters = {}) {
  const runs = eligible(input).filter(r=>(!filters.build || r.build===filters.build) && (!filters.campaign || r.campaign===filters.campaign)
    && (!filters.region || r.region===filters.region) && (!filters.from || r.started_at.slice(0,10)>=filters.from) && (!filters.to || r.started_at.slice(0,10)<=filters.to));
  const total = field => runs.reduce((s,r)=>s+(r[field]??0),0);
  const fragmentRuns=runs.filter(r=>r.relic_fragments!==null);
  const byRegion = catalog.regions.map(region=>{
    const rows=runs.filter(r=>r.region===region.id), n=rows.length;
    return {...region,n,spores:rows.reduce((s,r)=>s+r.spores,0)/(n||1),gold:rows.reduce((s,r)=>s+r.gold,0)/(n||1),relics:rows.reduce((s,r)=>s+r.relics,0)/(n||1),
      fragmentSamples:rows.filter(r=>r.relic_fragments!==null).length,medianFragments:median(rows.filter(r=>r.relic_fragments!==null).map(r=>r.relic_fragments)),medianGold:median(rows.map(r=>r.gold)),medianRelics:median(rows.map(r=>r.relics))};
  });
  const players = new Map(), purchases = new Map(), skills = new Map(catalog.nodes.map(n=>[n.id,n]));
  for(const r of runs) {
    if(!players.has(r.playtest_id)) players.set(r.playtest_id, new Set());
    for(const id of r.unlocked_regions) players.get(r.playtest_id).add(id);
    for(const p of r.purchases) purchases.set(`${r.playtest_id}:${p.order}`,{...p,player:r.playtest_id,fromStart:r.tracking_from_start===true});
  }
  const heat = new Map(), first = new Map();
  for(const p of purchases.values()) {
    if(!heat.has(p.skill_id)) heat.set(p.skill_id,{ranks:0,players:new Set()});
    heat.get(p.skill_id).ranks++; heat.get(p.skill_id).players.add(p.player);
  }
  // Filters select a cohort; first-buy order still uses that cohort's observed lifetime history.
  for(const r of eligible(input)) {
    if(!players.has(r.playtest_id)||r.tracking_from_start!==true)continue;
    for(const p of r.purchases)for(const cat of skills.get(p.skill_id)?.categories||[]) {
      const key=`${r.playtest_id}:${cat}`;
      if(!first.has(key)||p.order<first.get(key).order)first.set(key,{cat,order:p.order,player:r.playtest_id});
    }
  }
  const order = Object.entries(catalog.categories).map(([id,name])=>{
    const values=[...first.values()].filter(v=>v.cat===id);
    return {id,name,n:values.length,average:values.length?values.reduce((s,v)=>s+v.order,0)/values.length:null,
      first:values.filter(v=>v.order===1).length};
  }).sort((a,b)=>(a.average??Infinity)-(b.average??Infinity));
  return {runs,byRegion,players:players.size,spores:total('spores'),gold:total('gold'),relics:total('relics'),relic_fragments:fragmentRuns.length?total('relic_fragments'):null,fragmentSamples:fragmentRuns.length,spent:total('spent'),
    avgSpent:runs.length?total('spent')/runs.length:0, avgPurchase:purchases.size?total('spent')/purchases.size:0,
    purchases:purchases.size,heat,order,unlocks:catalog.regions.map(r=>({...r,n:[...players.values()].filter(ids=>ids.has(r.id)).length}))};
}
