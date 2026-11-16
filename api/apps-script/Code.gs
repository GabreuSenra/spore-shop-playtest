/* Spore Shop playtest receiver. Deploy as yourself, access: Anyone.
 * Run setupPlaytest once in the editor. Never publish the spreadsheet itself.
 * Functions ending in _ cannot be called through google.script.run.
 */
var PLAYTEST_ = {
  sheet: 'Runs', pageSize: 100, chunkSize: 32000, chunks: 8,
  headers: ['run_id','revision','debug_used','save_anonimo','run','regiao','inicio_utc','resultado',
    'esporos','ouro_vendido','reliquias','ouro_gasto','duracao_s','build','campanha','coleta_desde_inicio',
    'regioes_liberadas','recebido_utc','payload_1','payload_2','payload_3','payload_4','payload_5','payload_6','payload_7','payload_8']
};

// Public entry point appears in the editor menu; anonymous web clients cannot run setup.
function setupPlaytest() {
  var active = Session.getActiveUser().getEmail();
  var effective = Session.getEffectiveUser().getEmail();
  if (!active || !effective || active !== effective) {
    throw new Error('Execute setupPlaytest pelo editor do Apps Script, na conta proprietaria do projeto.');
  }
  setupPlaytest_();
}

function setupPlaytest_() {
  var properties = PropertiesService.getScriptProperties();
  var id = properties.getProperty('SPREADSHEET_ID');
  var book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!book) book = SpreadsheetApp.create('Spore Shop - Playtests');
  properties.setProperty('SPREADSHEET_ID', book.getId());
  ['INGEST_TOKEN','READ_TOKEN'].forEach(function(key) {
    if (!properties.getProperty(key)) properties.setProperty(key, (key==='INGEST_TOKEN'?'spore_write_':'spore_read_') + Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,''));
  });
  if (!properties.getProperty('ALLOWED_ORIGINS')) properties.setProperty('ALLOWED_ORIGINS', JSON.stringify([
    'https://gabreusenra.github.io','http://127.0.0.1:4173','http://localhost:4173'
  ]));
  var sheet = book.getSheetByName(PLAYTEST_.sheet) || book.insertSheet(PLAYTEST_.sheet);
  if (sheet.getLastRow() === 0) {
    if (sheet.getMaxColumns() < PLAYTEST_.headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), PLAYTEST_.headers.length-sheet.getMaxColumns());
    sheet.getRange(1,1,1,PLAYTEST_.headers.length).setValues([PLAYTEST_.headers]);
    sheet.getRange(1,1,1,PLAYTEST_.headers.length).setBackground('#243324').setFontColor('#edf0e5').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.hideColumns(19,8);
    sheet.setColumnWidths(1,18,140);
    sheet.setColumnWidth(1,260);
    sheet.setColumnWidth(7,180);
  }
  checkSheet_(sheet);
  console.log('Planilha preparada: ' + book.getUrl());
  console.log('Copie INGEST_TOKEN e READ_TOKEN em Configuracoes do projeto > Propriedades do script. Nao compartilhe READ_TOKEN com jogadores.');
}

function doPost(e) {
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') return json_({ok:false,error:'invalid_json'});
    if (e.postData.contents.length > 256000) return json_({ok:false,error:'payload_too_large'});
    var request;
    try { request = JSON.parse(e.postData.contents); } catch (_) {return json_({ok:false,error:'invalid_json'});}
    var config = config_();
    if (!authorized_(request && request.token, config.ingest)) return json_({ok:false,error:'unauthorized'});
    if (request.action !== 'ingest' || !validateRun_(request.run)) return json_({ok:false,error:'invalid_payload'});
    var run = request.run;
    var payload = run.debug_used ? '' : JSON.stringify(cleanRun_(run));
    if (payload.length > PLAYTEST_.chunkSize*PLAYTEST_.chunks) return json_({ok:false,error:'payload_too_large'});
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json_({ok:false,error:'busy'});
    try {
      var sheet = sheet_(config.id);
      var last = sheet.getLastRow();
      var match = last > 1 ? sheet.getRange(2,1,last-1,1).createTextFinder(run.run_id).matchEntireCell(true).useRegularExpression(false).findNext() : null;
      var row = match ? match.getRow() : last+1;
      var old = match ? sheet.getRange(row,1,1,3).getValues()[0] : null;
      // A debug marker wins forever, even against higher-revision clean retries.
      if (!old || (!old[2] && (run.debug_used || run.revision > Number(old[1])))) {
        var values = rowFor_(run,payload,old ? Math.max(Number(old[1]),run.revision) : run.revision);
        if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),Math.max(100,row-sheet.getMaxRows()));
        sheet.getRange(row,1,1,values.length).setValues([values]);
        SpreadsheetApp.flush();
      }
      return json_({ok:true,run_id:run.run_id,revision:run.revision});
    } finally { lock.releaseLock(); }
  } catch (error) { return json_({ok:false,error:error.message === 'not_configured' ? 'server_not_configured' : 'storage_error'}); }
}

function doGet(e) {
  if (!e || !e.parameter || e.parameter.view !== 'bridge') return json_({ok:true,service:'spore-shop-playtest',schema:1});
  var origin = String(e.parameter.parent_origin || '');
  var channel = String(e.parameter.channel || '');
  if (!/^[a-f0-9]{64}$/.test(channel) || !/^https?:\/\/[^/?#\s]+$/.test(origin)) return HtmlService.createHtmlOutput('Invalid bridge request');
  var error = '';
  try {
    var config = config_();
    if (config.origins.indexOf(origin) < 0) error = 'origin_not_allowed';
  } catch (_) {error = 'server_not_configured';}
  var template = HtmlService.createTemplateFromFile('Bridge');
  template.bridgeConfig = {origin:origin,channel:channel,error:error};
  return template.evaluate().setTitle('Spore Shop - Sheets bridge').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Only public RPC; every page requires the read credential. The write credential cannot read.
function readPlaytestPage(request) {
  try {
    var config = config_();
    if (!request || !authorized_(request.token,config.read)) return {ok:false,error:'unauthorized'};
    var sheet = sheet_(config.id);
    var cursor = request.cursor || '';
    if (typeof cursor !== 'string' || (cursor && !/^\d+:\d+$/.test(cursor))) return {ok:false,error:'invalid_cursor'};
    var last = sheet.getLastRow(), start=2, end=last;
    if (cursor) {
      var parts = cursor.split(':');start=Number(parts[0]);end=Number(parts[1]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<2 || end<1 || start>end+1 || end>last) return {ok:false,error:'invalid_cursor'};
    }
    var count = Math.min(PLAYTEST_.pageSize,Math.max(0,end-start+1));
    var rows = count ? sheet.getRange(start,1,count,PLAYTEST_.headers.length).getValues() : [];
    var runs=[];
    rows.forEach(function(row) {
      if (row[2] === true) return;
      var payload = row.slice(18).map(function(cell){return cell ? String(cell).slice(2) : '';}).join('');
      var run = JSON.parse(payload);
      if (!validateRun_(run) || run.debug_used || run.run_id !== row[0] || run.revision !== Number(row[1])) throw new Error('corrupt_row');
      runs.push(run);
    });
    return {ok:true,runs:runs,next_cursor:start+count<=end ? String(start+count)+':'+String(end) : null};
  } catch (error) {return {ok:false,error:error.message==='not_configured'?'server_not_configured':'storage_error'};}
}

function config_() {
  var p = PropertiesService.getScriptProperties();
  var config = {id:p.getProperty('SPREADSHEET_ID'),ingest:p.getProperty('INGEST_TOKEN'),read:p.getProperty('READ_TOKEN')};
  if (!config.id || !config.ingest || !config.read || config.ingest===config.read) throw new Error('not_configured');
  config.origins=JSON.parse(p.getProperty('ALLOWED_ORIGINS') || '[]');
  if (!Array.isArray(config.origins)) throw new Error('not_configured');
  return config;
}

function sheet_(id) {var sheet=SpreadsheetApp.openById(id).getSheetByName(PLAYTEST_.sheet);checkSheet_(sheet);return sheet;}
function checkSheet_(sheet) {
  if (!sheet || sheet.getLastRow()<1) throw new Error('not_configured');
  var headers=sheet.getRange(1,1,1,PLAYTEST_.headers.length).getValues()[0];
  if (JSON.stringify(headers)!==JSON.stringify(PLAYTEST_.headers)) throw new Error('not_configured');
}
function authorized_(value,expected) {
  if (typeof value!=='string' || !expected || value.length!==expected.length) return false;
  var diff=0;for(var i=0;i<value.length;i++)diff|=value.charCodeAt(i)^expected.charCodeAt(i);return diff===0;
}
function json_(value) {return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function identifier_(v) {return typeof v==='string' && /^[a-f0-9]{32}$/.test(v);}
function short_(v) {return typeof v==='string' && v.length>0 && v.length<=100;}
function count_(v) {return Number.isSafeInteger(v) && v>=0 && v<=1e12;}
function money_(v) {return typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1e15;}
function validateRun_(p) {
  if (!p || p.schema!==1 || !identifier_(p.run_id) || !Number.isSafeInteger(p.revision) || p.revision<1 || typeof p.debug_used!=='boolean')return false;
  if(p.debug_used)return true;
  return identifier_(p.playtest_id) && typeof p.tracking_from_start==='boolean' && short_(p.build) && short_(p.campaign) && short_(p.region)
    && count_(p.run_number) && p.run_number>0 && ['voltou','desmaiou'].indexOf(p.result)>=0
    && typeof p.started_at==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(p.started_at) && Number.isFinite(Date.parse(p.started_at))
    && money_(p.seconds) && p.seconds<=86400 && count_(p.spores) && money_(p.gold) && count_(p.relics) && (p.relic_fragments === undefined || count_(p.relic_fragments)) && money_(p.spent)
    && Array.isArray(p.unlocked_regions) && p.unlocked_regions.length<=100 && p.unlocked_regions.every(short_)
    && Array.isArray(p.purchases) && p.purchases.length<=2000 && p.purchases.every(function(x){return x && short_(x.skill_id) && count_(x.level) && x.level>0 && count_(x.order) && x.order>0 && money_(x.gold);})
    && new Set(p.purchases.map(function(x){return x.order;})).size===p.purchases.length;
}
function cleanRun_(p) {
  var out={};['schema','run_id','revision','debug_used','playtest_id','run_number','tracking_from_start','build','campaign','region',
    'started_at','seconds','result','spores','gold','relics','spent','unlocked_regions'].forEach(function(k){out[k]=p[k];});
  if (p.relic_fragments !== undefined) out.relic_fragments=p.relic_fragments;
  out.purchases=p.purchases.map(function(x){return {skill_id:x.skill_id,level:x.level,order:x.order,gold:x.gold};});return out;
}
function safeCell_(text) {return /^[=+\-@\t\r\n]/.test(String(text)) ? "'"+text : text;}
function rowFor_(p,payload,revision) {
  var row=p.debug_used ? [p.run_id,revision,true,'','','','','','','','','','','','','','',''] : [
    p.run_id,revision,false,p.playtest_id,p.run_number,safeCell_(p.region),p.started_at,p.result,p.spores,p.gold,p.relics,p.spent,
    p.seconds,safeCell_(p.build),safeCell_(p.campaign),p.tracking_from_start,JSON.stringify(p.unlocked_regions),''
  ];
  row[17]=new Date().toISOString();
  for(var i=0;i<PLAYTEST_.chunks;i++)row.push(payload ? 'j:'+payload.slice(i*PLAYTEST_.chunkSize,(i+1)*PLAYTEST_.chunkSize) : '');
  return row;
}
