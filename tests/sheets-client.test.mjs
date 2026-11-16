import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {createSheetsClient,sheetsEndpoint,googleBridgeOrigin} from '../sheets-client.mjs';
import {googleEnvironment,run} from './helpers/fake-google.mjs';
const endpoint='https://script.google.com/macros/s/testDeployment/exec';
const googleOrigin='https://n-test-script.googleusercontent.com';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function browser({server,origin='https://gabreusenra.github.io',runBridge=false}={}) {
  const listeners=new Set(),requests=[],frames=[];let bridgeHandler;
  const hostWindow={crypto:webcrypto,location:{origin},addEventListener(_,f){listeners.add(f);},removeEventListener(_,f){listeners.delete(f);}};
  const dispatch=event=>{for(const listener of listeners)listener(event);};
  const top={postMessage(data,targetOrigin){assert.equal(targetOrigin,origin);dispatch({data,origin:googleOrigin,source:remote});}};
  const remote={postMessage(data,targetOrigin){requests.push({data,targetOrigin});if(bridgeHandler)bridgeHandler({data,origin,source:top});}};
  const hostDocument={createElement(){return{remove(){this.removed=true;}};},body:{appendChild(frame){
    frames.push(frame);if(!runBridge)return;
    const url=new URL(frame.src),parameters=Object.fromEntries(url.searchParams);
    const config=server.context.doGet({parameter:parameters}).config;
    const script=readFileSync(new URL('../api/apps-script/Bridge.html',import.meta.url),'utf8').match(/<script>([\s\S]*)<\/script>/)[1]
      .replace(/<\?!=[\s\S]*?\?>/,JSON.stringify(config));
    let success,failure;
    const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(fn){failure=fn;return this;},readPlaytestPage(data){
      try{success(server.context.readPlaytestPage(data));}catch{failure();}
    }};
    vm.runInNewContext(script,{window:{top,addEventListener(_,f){bridgeHandler=f;}},google:{script:{run:runner}},Object});
  }}};
  const channel=()=>new URL(frames[0].src).searchParams.get('channel');
  const emit=(data,extra={})=>dispatch({data:{channel:channel(),...data},origin:googleOrigin,source:remote,...extra});
  return{hostWindow,hostDocument,requests,frames,remote,emit};
}

test('endpoint and Google bridge origins reject lookalikes, credentials, queries and development URLs',()=>{
  assert.equal(sheetsEndpoint(endpoint),endpoint);
  for(const value of ['http://script.google.com/macros/s/test/exec',endpoint+'?token=secret',endpoint+'#x',endpoint.replace('/exec','/dev'),
    endpoint.replace('script.google.com','script.google.com.evil.test'),endpoint.replace('https://','https://user:secret@')])assert.throws(()=>sheetsEndpoint(value));
  assert.equal(googleBridgeOrigin(googleOrigin),true);assert.equal(googleBridgeOrigin('https://script.googleusercontent.com'),true);
  assert.equal(googleBridgeOrigin(googleOrigin+'.evil.test'),false);assert.equal(googleBridgeOrigin('https://evil.test'),false);
});
test('read tokens are posted only after a trusted nonce-bound handshake and responses are source-bound',async()=>{
  const b=browser();const client=createSheetsClient(endpoint,{...b,timeoutMs:1000});
  const promise=client.readPage('private-read-credential');
  b.emit({type:'spore-ready'},{origin:'https://evil.test'});await tick();assert.equal(b.requests.length,0);
  b.emit({type:'spore-ready',channel:'wrong'});await tick();assert.equal(b.requests.length,0);
  b.emit({type:'spore-ready'});await tick();assert.equal(b.requests.length,1);
  const request=b.requests[0];assert.equal(request.targetOrigin,googleOrigin);assert.equal(request.data.token,'private-read-credential');
  assert.equal(b.frames[0].src.includes('private-read-credential'),false);
  let resolved=false;promise.then(()=>resolved=true);
  b.emit({type:'spore-result',request_id:request.data.request_id,body:{ok:true,runs:[]}},{source:{}});await tick();assert.equal(resolved,false);
  b.emit({type:'spore-result',request_id:request.data.request_id,body:{ok:true,runs:[]}});assert.deepEqual((await promise).runs,[]);
  client.close();assert.equal(b.frames[0].removed,true);
});
test('actual bridge script connects the published dashboard client to Apps Script and preserves authorization',async()=>{
  const server=googleEnvironment();server.setup();server.send(run());
  const b=browser({server,runBridge:true});const client=createSheetsClient(endpoint,{...b,timeoutMs:1000});
  const page=await client.readPage(server.properties.get('READ_TOKEN'));assert.equal(page.runs[0].spores,10);
  await assert.rejects(client.readPage(server.properties.get('INGEST_TOKEN')),/inválida/);
  client.close();
});
test('actual bridge reports a disallowed parent without transmitting a read credential',async()=>{
  const server=googleEnvironment();server.setup();const b=browser({server,runBridge:true,origin:'https://evil.test'});
  const client=createSheetsClient(endpoint,{...b,timeoutMs:1000});await assert.rejects(client.readPage('secret'),/ALLOWED_ORIGINS/);
  assert.equal(b.requests.length,0);client.close();
});
test('a missing Google deployment times out cleanly',async()=>{
  const b=browser();const client=createSheetsClient(endpoint,{...b,timeoutMs:15});
  await assert.rejects(client.readPage('secret'),/não respondeu/);client.close();
});
