import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {maintain,route} from './api.mjs';
import {localRepository} from './local-db.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const env={...process.env,TURNO_RATE_SALT:process.env.TURNO_RATE_SALT||randomBytes(24).toString('hex')};
const repo=localRepository();
const host=env.TURNO_HOST||'127.0.0.1', port=Number(env.PORT||8787);
const assets={'/assets/app.js':readFileSync(join(root,'app.js')),'/assets/qrcode.js':readFileSync(join(root,'vendor/qrcode.js'))};
const html=readFileSync(join(root,'index.html'));
let maintaining=false;
setInterval(async()=>{
  if(maintaining)return;
  maintaining=true;
  try{await maintain(repo,env);}catch{console.error('No se pudo completar el mantenimiento.');}
  finally{maintaining=false;}
},30000).unref();
createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,'http://'+(req.headers.host||'localhost'));
    if(Object.hasOwn(assets,url.pathname)){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(assets[url.pathname]);return;}
    if(url.pathname==='/'||url.pathname==='/barbero'||/^\/b\/[a-z0-9-]+$/.test(url.pathname)){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
    }
    const chunks=[];let size=0;
    for await(const chunk of req){
      size+=chunk.length;
      if(size>8192){res.writeHead(413);res.end();return;}
      chunks.push(chunk);
    }
    const response=await route(new Request(url,{method:req.method,headers:req.headers,body:size?Buffer.concat(chunks):undefined}),repo,env,req.socket.remoteAddress);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{console.error('Error al procesar la solicitud.');res.writeHead(500);res.end('Error interno.');}
}).listen(port,host,()=>{
  console.log('Crea tu barbería en http://localhost:'+port+'/barbero');
});
