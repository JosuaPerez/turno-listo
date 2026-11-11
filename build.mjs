import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const html=JSON.stringify(readFileSync('index.html','utf8'));
const assets=JSON.stringify({'/assets/app.js':readFileSync('app.js','utf8'),'/assets/qrcode.js':readFileSync('vendor/qrcode.js','utf8')});
const modules=['estimates','notifications','auth','repository','stats','api'];
const api=modules.map(name=>readFileSync(name+'.mjs','utf8').replace(/^import .*\n/gm,'')).join('\n');
const worker='const html='+html+', assets='+assets+';\n'+String.raw`
export default {
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname;
    if(Object.hasOwn(assets,path))return new Response(assets[path],{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
    if(path==='/'||path==='/barbero'||/^\/b\/[a-z0-9-]+$/.test(path))return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    if(path.startsWith('/api/auth/')&&path!=='/api/auth/logout'&&!env.TURNO_PASSWORD_PEPPER)return fail('El inicio de sesión no está configurado.',503);
    return route(request,repository(env.DB),env,request.headers.get('CF-Connecting-IP')||'unknown',ctx.waitUntil.bind(ctx));
  },
  scheduled(controller,env,ctx){ctx.waitUntil(maintain(repository(env.DB),env));}
};
`;
mkdirSync('dist/server',{recursive:true});
mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/server/index.js',api+'\n'+worker);
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
