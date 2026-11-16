const colors=['#b6dd77','#58c6a0','#85b8ef','#c3aff0','#ed9479','#e7bd6c'];
const exact=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:20});
const short=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});
const compact=new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const exactNumber=value=>exact.format(value);
export const regionColor=(catalog,id)=>colors[Math.max(0,catalog.regions.findIndex(r=>r.id===id))%colors.length];

function lines(label,max=17) {
  const result=[''];
  for(const word of String(label).split(' ')) {
    if(result.at(-1)&&result.at(-1).length+word.length+1>max)result.push(word);
    else result[result.length-1]+=(result.at(-1)?' ':'')+word;
  }
  return result.slice(0,3);
}

export function chartScale(values,minimumStep=0) {
  const maximum=Math.max(0,...values.filter(Number.isFinite));
  if(maximum===0)return {top:minimumStep>=1?5:1,step:minimumStep>=1?1:.2};
  const rough=maximum/4,power=10**Math.floor(Math.log10(rough));
  const step=Math.max(minimumStep,([1,2,2.5,5,10].find(v=>v*power>=rough)??10)*power);
  return {top:Math.ceil(maximum/step)*step,step};
}

// A zero baseline, one bar per observation, and exact values in accessible labels/details.
export function columnChartMarkup(rows,{title,yLabel,xLabel,perRun=false,minimumStep=0}={}) {
  const width=perRun?Math.max(684,rows.length*68+24):760,height=356,left=perRun?0:76,right=24,top=40,bottom=perRun?69:92;
  const plotWidth=width-left-right,plotHeight=height-top-bottom;
  const scale=chartScale(rows.map(r=>r.value),minimumStep),slot=plotWidth/Math.max(1,rows.length),barWidth=Math.min(perRun?42:62,slot*.57);
  const grid=[],ticks=[];
  for(let i=0;i<=Math.round(scale.top/scale.step);i++) {
    const value=i*scale.step,y=top+plotHeight-value/scale.top*plotHeight;
    grid.push(`<path d="M ${left} ${y} H ${width-right}" class="column-grid"/>`);
    ticks.push(`<text x="${perRun?64:left-12}" y="${y+4}" text-anchor="end" class="column-tick">${escape(Math.abs(value)>=10000?compact.format(value):short.format(value))}</text>`);
  }
  const bars=rows.map((row,index)=>{
    const x=left+slot*(index+.5),hasValue=Number.isFinite(row.value),barHeight=hasValue?row.value/scale.top*plotHeight:0;
    const y=top+plotHeight-barHeight;
    const label=perRun?[row.label]:lines(row.label);
    const description=hasValue?`${row.label}: ${exactNumber(row.value)} · ${row.detail}`:`${row.label}: sem runs nesta seleção`;
    return `<g class="column-bar" tabindex="0" role="button" data-index="${index}" aria-label="${escape(description)}"><title>${escape(description)}</title>
      <rect x="${x-slot*.45}" y="${top}" width="${slot*.9}" height="${plotHeight}" fill="transparent"/>
      ${hasValue?`<rect class="column-fill" x="${x-barWidth/2}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" fill="${row.color}"/>${row.value===0?`<path d="M ${x-barWidth/2} ${top+plotHeight} h ${barWidth}" stroke="${row.color}" stroke-width="3"/>`:''}`:''}
      <text x="${x}" y="${hasValue?Math.max(top-9,y-10):top+plotHeight-10}" text-anchor="middle" class="column-value">${hasValue?escape(perRun&&exactNumber(row.value).length<=11?exactNumber(row.value):Math.abs(row.value)>=10000?compact.format(row.value):short.format(row.value)):'—'}</text>
      <text x="${x}" y="${top+plotHeight+22}" text-anchor="middle" class="column-label">${label.map((text,i)=>`<tspan x="${x}" dy="${i?15:0}">${escape(text)}</tspan>`).join('')}</text>
      ${!perRun?`<text x="${x}" y="${height-31}" text-anchor="middle" class="column-sample">n=${row.n}</text>`:''}</g>`;
  }).join('');
  const plot=`<svg class="column-svg ${perRun?'run-columns':''}" ${perRun?`style="width:max(100%, ${width}px)" preserveAspectRatio="none"`:''} viewBox="0 0 ${width} ${height}" role="group" aria-label="${escape(title)}">
    ${perRun?'':`<text x="${left}" y="16" class="column-axis-title">${escape(yLabel)}</text>${ticks.join('')}`}${grid.join('')}
    <path d="${perRun?`M 0 ${top+plotHeight}`:`M ${left} ${top} V ${top+plotHeight}`} H ${width-right}" class="column-axis"/>${bars}
    <text x="${left+plotWidth/2}" y="${height-5}" text-anchor="middle" class="column-axis-title">${escape(xLabel)}</text></svg>`;
  return perRun?`<div class="run-chart-frame"><span class="run-axis-caption">${escape(yLabel)}</span><svg class="run-axis-svg" viewBox="0 0 76 ${height}" preserveAspectRatio="none" aria-hidden="true">${ticks.join('')}<path d="M 75 ${top} V ${top+plotHeight}" class="column-axis"/></svg><div class="run-chart-track">${plot}</div></div>`:plot;
}

export function renderColumnChart(container,rows,options) {
  container.innerHTML=columnChartMarkup(rows,options);
  const describe=index=>{
    const row=rows[index];
    options.onInspect?.(row,Number.isFinite(row.value)?`${row.label} · ${exactNumber(row.value)} · ${row.detail}`:`${row.label} · Sem runs nesta seleção.`);
  };
  container.querySelectorAll('.column-bar').forEach(el=>{
    for(const name of ['mouseenter','focus','click'])el.addEventListener(name,()=>describe(Number(el.dataset.index)));
    el.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();describe(Number(el.dataset.index));}});
  });
}
