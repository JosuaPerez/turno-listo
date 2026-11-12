import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {maintain,route} from './api.mjs';
import {withApiHeaders} from './http.mjs';
import {secureResponse} from './security.mjs';
import {localRepository} from './local-db.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const env={...process.env,TURNO_RATE_SALT:process.env.TURNO_RATE_SALT||randomBytes(24).toString('hex')};
const repo=localRepository();
const host=env.TURNO_HOST||'127.0.0.1', port=Number(env.PORT||8787);
const assets={
  '/assets/favicon.svg': ['image/svg+xml',readFileSync(join(root,'favicon.svg'))],
  '/assets/app.js': ['text/javascript',readFileSync(join(root,'app.js'))],
  '/assets/shared.js': ['text/javascript',readFileSync(join(root,'shared.js'))],
  '/assets/client.js': ['text/javascript',readFileSync(join(root,'client.js'))],
  '/assets/admin.js': ['text/javascript',readFileSync(join(root,'admin.js'))],
  '/assets/qrcode.js': ['text/javascript',readFileSync(join(root,'vendor/qrcode.js'))],
  '/assets/app.css': ['text/css',readFileSync(join(root,'app.css'))]
};
const html=readFileSync(join(root,'index.html'));
let maintaining=false;
setInterval(async()=>{
  if(maintaining)return;
  maintaining=true;
  try{await maintain(repo,env);}catch{console.error('No se pudo completar el mantenimiento.');}
  finally{maintaining=false;}
},30000).unref();
const server=createServer(async (req,res)=>{
  let pathname='';
  const send=async response=>{
    const secure=secureResponse(withApiHeaders(pathname,response));
    res.writeHead(secure.status,Object.fromEntries(secure.headers));
    res.end(Buffer.from(await secure.arrayBuffer()));
  };
  try {
    const url=new URL(req.url,'http://'+(req.headers.host||'localhost'));
    pathname=url.pathname;
    if(url.pathname==='/favicon.ico')return await send(new Response(null,{status:308,headers:{Location:'/assets/favicon.svg'}}));
    if(Object.hasOwn(assets,url.pathname)){
      const [type,data]=assets[url.pathname];
      return await send(new Response(data,{headers:{'Content-Type':type+'; charset=utf-8'}}));
    }
    if(url.pathname==='/'||url.pathname==='/barbero'||url.pathname==='/restablecer'||/^\/b\/[a-z0-9-]+$/.test(url.pathname)){
      return await send(new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}));
    }
    const chunks=[];let size=0;
    for await(const chunk of req){
      size+=chunk.length;
      if(size>8192)return await send(new Response('Solicitud demasiado larga.',{status:413}));
      chunks.push(chunk);
    }
    const response=await route(new Request(url,{method:req.method,headers:req.headers,body:size?Buffer.concat(chunks):undefined}),repo,env,req.socket.remoteAddress);
    await send(response);
  }catch{console.error('Error al procesar la solicitud.');if(!res.headersSent)await send(new Response('Error interno.',{status:500}));}
}).listen(port,host,()=>{
  console.log('Crea tu barbería en http://localhost:'+server.address().port+'/barbero');
});
