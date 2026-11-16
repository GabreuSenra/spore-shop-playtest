import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
import {siteFiles} from './site-files.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const allowed=new Set(siteFiles.map(name=>'/'+name));
const port=Number(process.env.SPORE_PLAYTEST_PORT||4173);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('SPORE_PLAYTEST_PORT must be between 1 and 65535');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
const server=createServer(async(req,res)=>{
 try {const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!allowed.has(pathname)){res.writeHead(404);return res.end('Not found');}const path=resolve(root,'.'+pathname);if(!path.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403);return res.end();}const body=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`A porta ${port} ja esta em uso. Encerre a previa anterior com Ctrl+C e tente novamente.`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
