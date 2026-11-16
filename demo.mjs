// Deterministic synthetic data. Never sent to the API.
export function demoRuns(catalog) {
  let seed=904; const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const id=n=>n.toString(16).padStart(32,'0'); const runs=[];
  const nodes=catalog.nodes.filter(n=>n.id!=='Mother'&&!n.placeholder&&n.categories.length);
  for(let player=1;player<=36;player++) {
    let order=0; const levels={}; const trips=8+Math.floor(rand()*18);
    for(let run=1;run<=trips;run++) {
      const depth=Math.min(5,Math.floor((run-1)/(3+player%3)));
      const region=catalog.regions[Math.floor(rand()*(depth+1))];
      const purchases=[]; let spent=0;
      for(let k=0;k<Math.floor(rand()*4);k++) {
        const pool=nodes.filter(n=>(levels[n.id]||0)<n.maxLevel);
        const skill=pool[Math.floor(rand()*Math.min(pool.length,20+run*5))]; if(!skill) continue;
        const gold=Math.round((40+order*5)*(0.7+rand())); levels[skill.id]=(levels[skill.id]||0)+1;
        purchases.push({skill_id:skill.id,level:levels[skill.id],order:++order,gold});spent+=gold;
      }
      const at=new Date(Date.UTC(2026,10,3+Math.floor((run+player)/4),10+player%10,run%60)).toISOString().slice(0,19);
      runs.push({schema:1,run_id:id(1000+player*100+run),revision:1,debug_used:false,playtest_id:id(player),run_number:run,tracking_from_start:true,
        build:player%4===0?'0.4-playtest.2':'0.4-playtest.1',campaign:'Demonstração',region:region.id,started_at:at,
        seconds:20+rand()*70,result:rand()>.06?'voltou':'desmaiou',spores:Math.round((70+run*28)*(1+region.tier*.3)*(.4+rand())),
        gold:Math.round((50+run*15)*region.tier*(.4+rand())),relics:Math.floor(rand()*Math.min(8,run/2)),relic_fragments:Math.floor(rand()*Math.min(30,run*2)),spent,
        unlocked_regions:catalog.regions.slice(0,depth+1).map(r=>r.id),purchases});
    }
  }
  return runs;
}
