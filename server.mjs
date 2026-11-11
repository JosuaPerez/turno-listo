import {createServer} from 'node:http';
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initial,route} from './api.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const dir=process.env.TURNO_DATA || join(root,'.data');
mkdirSync(dir,{recursive:true});
const file=join(dir,'fila.json'), keyPath=join(dir,'clave');
let key=process.env.TURNO_KEY;
if(!key) {
  try { key=readFileSync(keyPath,'utf8').trim(); } catch(error) {
    if(error.code!=='ENOENT') throw error;
    key=randomBytes(12).toString('hex'); writeFileSync(keyPath,key,{mode:0o600,flag:'wx'});
  }
}
const read=()=>{try { return {...structuredClone(initial),...JSON.parse(readFileSync(file,'utf8'))}; } catch(error) {
  if(error.code!=='ENOENT') throw error;
  return {...structuredClone(initial),revision:0};
}};
const store={read,write(next,rev){
  if(read().revision!==rev) return false;
  writeFileSync(file+'.tmp',JSON.stringify(next)); renameSync(file+'.tmp',file); return true;
}};
const host=process.env.TURNO_HOST||'127.0.0.1', port=Number(process.env.PORT||8787);
const assets={'/assets/app.js':readFileSync(join(root,'app.js')),'/assets/qrcode.js':readFileSync(join(root,'vendor/qrcode.js'))};
const html=readFileSync(join(root,'index.html'));
createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(Object.hasOwn(assets,url.pathname)){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(assets[url.pathname]);return;}
    if(url.pathname==='/' || url.pathname==='/barbero' || /^\/b\/[a-z0-9-]+$/.test(url.pathname)) {
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); res.end(html); return;
    }
    const chunks=[]; let size=0;
    for await(const chunk of req) {
      size+=chunk.length;
      if(size>8192){res.writeHead(413);res.end();return;}
      chunks.push(chunk);
    }
    const response=await route(new Request(url,{method:req.method,headers:req.headers,body:size?Buffer.concat(chunks):undefined}),store,key);
    res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch(error) { console.error(error.message); res.writeHead(500); res.end('Error interno.'); }
}).listen(port,host,()=>{
  console.log('Clientes: http://localhost:'+port);
  console.log('Barbero:  http://localhost:'+port+'/barbero');
  console.log('Clave del barbero: '+key);
});
