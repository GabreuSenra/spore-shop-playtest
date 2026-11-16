// A Google HTML-service iframe relays authenticated reads through google.script.run.
// Credentials travel in postMessage payloads, never URL parameters or browser storage.
export function sheetsEndpoint(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='script.google.com'||url.port||url.username||url.password||url.search||url.hash
    ||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname))throw Error('Informe a URL publicada do Apps Script: https://script.google.com/macros/s/…/exec');
  return url.href;
}
export function googleBridgeOrigin(origin){return /^https:\/\/(?:[a-z0-9-]+-)?script\.googleusercontent\.com$/.test(origin);}
const messages={unauthorized:'Credencial de leitura inválida.',origin_not_allowed:'Autorize a origem deste painel em ALLOWED_ORIGINS no Apps Script.',
  server_not_configured:'Execute setupPlaytest e confira as propriedades do Apps Script.',storage_error:'Não foi possível ler a planilha. Confira os cabeçalhos e o acesso do Apps Script.',
  invalid_cursor:'A paginação da planilha mudou. Atualize a consulta.',rpc_failed:'O Google não concluiu a leitura. Tente novamente.'};
export function sheetsError(code){return new Error(messages[code]||'A integração com o Google Sheets retornou um erro.');}

export function createSheetsClient(endpoint,{hostWindow=window,hostDocument=document,timeoutMs=30000}={}) {
  endpoint=sheetsEndpoint(endpoint);
  const bytes=new Uint8Array(32);hostWindow.crypto.getRandomValues(bytes);
  const channel=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
  const iframe=hostDocument.createElement('iframe');iframe.hidden=true;iframe.title='Conexão privada com Google Sheets';iframe.referrerPolicy='no-referrer';
  let remote=null,remoteOrigin='',closed=false,readyTimer,sequence=0;const pending=new Map();
  let resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  function receive(event){
    const data=event.data;
    if(closed||!data||data.channel!==channel||!googleBridgeOrigin(event.origin)||!event.source)return;
    if(data.type==='spore-ready'&&!remote){
      if(data.error){clearTimeout(readyTimer);rejectReady(sheetsError(data.error));return;}
      remote=event.source;remoteOrigin=event.origin;clearTimeout(readyTimer);resolveReady();return;
    }
    if(event.source!==remote||event.origin!==remoteOrigin||data.type!=='spore-result')return;
    const request=pending.get(data.request_id);if(!request)return;
    pending.delete(data.request_id);clearTimeout(request.timer);
    if(data.body?.ok!==true)request.reject(sheetsError(data.body?.error));else request.resolve(data.body);
  }
  hostWindow.addEventListener('message',receive);
  readyTimer=setTimeout(()=>rejectReady(Error('O Apps Script não respondeu. Confira a publicação para Qualquer pessoa, a URL /exec e ALLOWED_ORIGINS.')),timeoutMs);
  const url=new URL(endpoint);url.searchParams.set('view','bridge');url.searchParams.set('channel',channel);url.searchParams.set('parent_origin',hostWindow.location.origin);
  iframe.src=url.href;hostDocument.body.appendChild(iframe);
  return {
    async readPage(token,cursor=''){
      await ready;if(closed)throw Error('Conexão encerrada.');
      return new Promise((resolve,reject)=>{
        const requestId=String(++sequence);
        const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('A leitura do Google Sheets excedeu o tempo. Tente novamente.'));},timeoutMs);
        pending.set(requestId,{resolve,reject,timer});
        remote.postMessage({type:'spore-read',channel,request_id:requestId,token,cursor},remoteOrigin);
      });
    },
    close(){closed=true;clearTimeout(readyTimer);rejectReady(Error('Conexão encerrada.'));hostWindow.removeEventListener('message',receive);iframe.remove();
      for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Conexão encerrada.'));}pending.clear();}
  };
}
