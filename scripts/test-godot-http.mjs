import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {googleEnvironment} from '../tests/helpers/fake-google.mjs';
const engine=process.argv[2]||process.env.GODOT_BIN;
if(!engine)throw Error('Pass the Godot executable path as the first argument or set GODOT_BIN.');
const root=resolve(process.argv[3] || process.env.SPORE_GAME_ROOT || fileURLToPath(new URL('../../spore-shop/',import.meta.url))),data=fileURLToPath(new URL('../.test-user/',import.meta.url));
await mkdir(data,{recursive:true});
const google=googleEnvironment();google.setup();google.properties.set('INGEST_TOKEN','test-write-only');
let posts=0,redirectGets=0;const acks=new Map();
const server=createServer(async(req,res)=>{
  try {
    if(req.method==='GET'&&req.url==='/probe'){res.writeHead(200);res.end('ok');return;}
    if(req.method==='GET'&&req.url.startsWith('/reply/')){redirectGets++;const value=acks.get(req.url);assert.ok(value);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));return;}
    assert.equal(req.method,'POST');assert.equal(req.url,'/exec');assert.equal(req.headers.authorization,undefined);
    let text='';for await(const chunk of req)text+=chunk;
    const envelope=JSON.parse(text);assert.equal(envelope.action,'ingest');assert.equal(envelope.token,'test-write-only');posts++;
    if(posts===1){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'busy'}));return;}
    const ack=google.post(envelope);assert.equal(ack.ok,true);const path='/reply/'+posts;acks.set(path,ack);
    res.writeHead(302,{Location:path});res.end();
  }catch(error){res.writeHead(500);res.end(JSON.stringify({ok:false,error:error.message}));}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const endpoint=`http://127.0.0.1:${server.address().port}/exec`;
try {
  assert.equal(await (await fetch(endpoint.replace('/exec','/probe'),{signal:AbortSignal.timeout(3000)})).text(),'ok');
  const child=spawn(engine,['--headless','--path',root,'--script','res://tests/PlaytestHttpTests.gd','--','--no-save','--playtest-test-endpoint='+endpoint],{
    cwd:root,windowsHide:true,env:{...process.env,APPDATA:data},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const timer=setTimeout(()=>{console.error(`HTTP test timed out: ${posts} posts, ${redirectGets} redirected GETs`);child.kill();},40000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
  process.stdout.write(stdout);if(stderr)process.stderr.write(stderr);
  assert.equal(code,0,'Godot HTTP fixture must complete successfully');assert.ok(stdout.includes('6 checks, 0 failed'));
  assert.equal(posts,3);assert.equal(redirectGets,2);assert.equal(google.read().runs.length,1);
  assert.equal(google.cells.filter(row=>row[2]===true).length,1);
  console.log('Godot -> HTTP -> Apps Script source -> Sheets emulator -> redirected ack: verified; only the finalized clean run was registered.');
}finally{await new Promise(resolve=>server.close(resolve));}
