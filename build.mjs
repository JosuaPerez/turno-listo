import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=JSON.stringify(readFileSync('index.html','utf8'));
const asset=(type,path)=>[type,readFileSync(path,'utf8')];
const assets=JSON.stringify({
  '/assets/app.js':asset('text/javascript','app.js'),
  '/assets/shared.js':asset('text/javascript','shared.js'),
  '/assets/client.js':asset('text/javascript','client.js'),
  '/assets/admin.js':asset('text/javascript','admin.js'),
  '/assets/qrcode.js':asset('text/javascript','vendor/qrcode.js'),
  '/assets/app.css':asset('text/css','app.css')
});
const modules=['estimates','notifications','stats','http','shop','auth','repository','security','password-reset','api'];
const identifiers=/^[A-Za-z_$][\w$]*$/;
function names(list){
  const result=list.split(',').map(v=>v.trim());
  if(!result.every(v=>identifiers.test(v))||new Set(result).size!==result.length)throw Error('Lista de nombres inválida: '+list);
  return result;
}
export function bundle(namesInOrder,read){
  const known=new Map();
  return namesInOrder.map(module=>{
    if(!/^[a-z][a-z0-9-]*$/.test(module)||known.has(module))throw Error('Nombre de módulo inválido: '+module);
    const exported=new Set(), code=[];
    const addExport=name=>{
      if(exported.has(name))throw Error('Exportación duplicada en '+module+': '+name);
      exported.add(name);
    };
    for(const line of read(module).split('\n')){
      if(line.startsWith('import ')){
        const match=line.trim().match(/^import \{([^}]+)\} from '\.\/([\w-]+)\.mjs';$/);
        if(!match||!known.has(match[2]))throw Error('Importación no compatible o fuera de orden en '+module+': '+line);
        const imports=names(match[1]);
        if(imports.some(name=>!known.get(match[2]).has(name)))throw Error('Importación sin exportación en '+module+': '+line);
        code.push('const {'+imports.join(',')+'}=__'+match[2].replaceAll('-','_')+';');
      }else if(line.startsWith('export ')){
        const list=line.trim().match(/^export \{([^}]+)\};$/);
        if(list){names(list[1]).forEach(addExport);continue;}
        const declaration=line.slice(7);
        const match=declaration.match(/^(?:async function|function|const|class) ([A-Za-z_$][\w$]*)\b/);
        if(!match)throw Error('Exportación no compatible en '+module+': '+line);
        addExport(match[1]);code.push(declaration);
      }else code.push(line);
    }
    const block='const __'+module.replaceAll('-','_')+'=(()=>{\n'+code.join('\n')+'\nreturn Object.freeze({'+[...exported].join(',')+'});\n})();\n';
    new Script(block,{filename:module+'.bundle.js'});
    known.set(module,exported);
    return block;
  }).join('\n');
}
const api=bundle(modules,name=>readFileSync(name+'.mjs','utf8'));
const worker='const html='+html+', assets='+assets+';\n'+String.raw`
async function handle(request,env,ctx){
  const path=new URL(request.url).pathname;
  if(Object.hasOwn(assets,path)){
    const [type,body]=assets[path];
    return new Response(body,{headers:{'Content-Type':type+'; charset=utf-8'}});
  }
  if(path==='/'||path==='/barbero'||path==='/restablecer'||/^\/b\/[a-z0-9-]+$/.test(path))return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  return __api.route(request,__repository.repository(env.DB),{...env,TURNO_RUNTIME:'worker'},request.headers.get('CF-Connecting-IP')||'unknown',ctx.waitUntil.bind(ctx));
}
export default {
  async fetch(request,env,ctx){
    let response;
    try{response=await handle(request,env,ctx);}
    catch{response=__http.withApiHeaders(new URL(request.url).pathname,__http.fail('No pudimos completar la solicitud.',500));}
    return __security.secureResponse(response,true);
  },
  scheduled(controller,env,ctx){ctx.waitUntil(__api.maintain(__repository.repository(env.DB),env));}
};
`;
mkdirSync('dist/server',{recursive:true});
mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/server/index.js',api+'\n'+worker);
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
