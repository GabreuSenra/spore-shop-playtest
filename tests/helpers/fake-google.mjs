import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

// Execute the actual deployment source against a small Sheets/Apps Script emulator.
// This verifies our integration logic; it does not claim a live Google deployment.
export function googleEnvironment(){
  const cells=[],properties=new Map(),state={writes:0,flushes:0,locked:false,busy:false,failWrite:false,maxRows:1000,maxColumns:26,created:0,
    activeEmail:'owner@example.test',effectiveEmail:'owner@example.test'};
  const sheet={
    getLastRow:()=>cells.length,getMaxRows:()=>state.maxRows,getMaxColumns:()=>state.maxColumns,
    insertColumnsAfter:(_,n)=>state.maxColumns+=n,insertRowsAfter:(_,n)=>state.maxRows+=n,
    setFrozenRows(){},hideColumns(){},setColumnWidths(){},setColumnWidth(){},
    getRange(row,column,height=1,width=1){return{
      getValues(){return Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>cells[row+r-1]?.[column+c-1]??''));},
      setValues(values){
        if(state.failWrite)throw Error('sheet_unavailable');
        if(!state.locked&&row!==1)throw Error('write_without_lock');
        if(values.length!==height||values.some(r=>r.length!==width))throw Error('bad_range');
        for(let r=0;r<height;r++){cells[row+r-1]??=[];for(let c=0;c<width;c++){
          if(typeof values[r][c]==='string'&&values[r][c].startsWith('='))throw Error('formula_injection');
          cells[row+r-1][column+c-1]=values[r][c];
        }}state.writes++;
      },
      setBackground(){return this;},setFontColor(){return this;},setFontWeight(){return this;},
      createTextFinder(text){return{matchEntireCell(){return this;},useRegularExpression(){return this;},findNext(){
        for(let i=row-1;i<row-1+height;i++)if(cells[i]?.[column-1]===text)return{getRow:()=>i+1};return null;
      }}}
    };}
  };
  let hasSheet=false;
  const book={getId:()=> 'test-spreadsheet',getUrl:()=> 'https://docs.google.com/spreadsheets/d/test-spreadsheet',
    getSheetByName:()=>hasSheet?sheet:null,insertSheet(){hasSheet=true;return sheet;}};
  const context=vm.createContext({console:{log(){}},Set,Date,JSON,Number,Math,String,Array,Error,
    Session:{getActiveUser:()=>({getEmail:()=>state.activeEmail}),getEffectiveUser:()=>({getEmail:()=>state.effectiveEmail})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null,setProperty(key,value){properties.set(key,value);return this;}})},
    SpreadsheetApp:{create(){state.created++;return book;},getActiveSpreadsheet:()=>null,openById(id){if(id!==book.getId())throw Error('no_access');return book;},flush(){state.flushes++;}},
    Utilities:{getUuid:randomUUID},LockService:{getScriptLock:()=>({tryLock(){if(state.busy)return false;state.locked=true;return true;},releaseLock(){state.locked=false;}})},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:body=>({body,setMimeType(){return this;}})},
    HtmlService:{XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},createHtmlOutput:body=>({body}),
      createTemplateFromFile:()=>({evaluate(){return{config:this.bridgeConfig,setTitle(){return this;},setXFrameOptionsMode(){return this;}};}})}
  });
  vm.runInContext(readFileSync(new URL('../../api/apps-script/Code.gs',import.meta.url),'utf8'),context,{filename:'Code.gs'});
  const post=envelope=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(envelope)}}).body);
  return {context,cells,properties,state,sheet,post,setup:()=>context.setupPlaytest(),
    send(run,token=properties.get('INGEST_TOKEN')){return post({action:'ingest',token,run});},
    read(cursor='',token=properties.get('READ_TOKEN')){return context.readPlaytestPage({token,cursor});}};
}

export const id=n=>n.toString(16).padStart(32,'0');
export const run=(extra={})=>({schema:1,run_id:id(1),playtest_id:id(2),revision:1,debug_used:false,tracking_from_start:true,
  build:'0.4-test',campaign:'test',region:'Clareira',run_number:1,result:'voltou',started_at:'2026-11-16T12:00:00',
  seconds:30,spores:10,gold:40,relics:1,spent:20,unlocked_regions:['Clareira'],purchases:[{skill_id:'Filtro',level:1,order:1,gold:20}],...extra});
