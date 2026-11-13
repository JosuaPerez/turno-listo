import {validHours,reception,summarize} from './stats.mjs';
import {getAccount,authRoute,parseBody,allowed,readBearer} from './auth.mjs';
import {NotificationProvider,enqueueNotice,dispatchNotices} from './notifications.mjs';
import {firstChair,chairAccepts,pauseRemaining,nextFor,serviceMinutes,range,predict,record} from './estimates.mjs';
import {resetRoute} from './password-reset.mjs';
import {initial,newShop} from './shop.mjs';
import {clean,json,fail,ticket,apiPath,withApiHeaders} from './http.mjs';
export {initial,newShop};
export function phoneNumber(value) {
  const digits=clean(value,24).replace(/\D/g,'');
  const number=digits.length===10?'1'+digits:digits;
  return /^1(?:809|829|849)\d{7}$/.test(number)?number:'';
}
const activeTickets=s=>Object.values(s.active);
const readWindows=new Map();
const allTickets=s=>[...s.queue,...activeTickets(s)];
function normalize(s){
  if(!s)return null;
  if(s.current){s.active[firstChair.id]??=s.current;s.current=null;}
  return s;
}
function publicView(s,token){
  const t=token?s.queue.find(t=>t.token===token):null;
  const active=token?activeTickets(s).find(t=>t.token===token):null;
  const now=Date.now();
  const estimate=chairId=>{
    const virtual={chairId};
    return range(predict({...s,queue:[...s.queue,virtual]},virtual,now));
  };
  const chairs=s.chairs.map(c=>({id:c.id,name:c.name,specialty:c.specialty||'',state:pauseRemaining(c,now)?'pausa':s.active[c.id]?'ocupado':'libre',range:estimate(c.id)}));
  const activeChair=active?s.chairs.find(c=>s.active[c.id]===active):null;
  const own=t?{position:s.queue.filter(v=>!t.chairId||!v.chairId||v.chairId===t.chairId).indexOf(t)+1,range:range(predict(s,t)),status:'waiting',chairId:t.chairId??null,barber:s.chairs.find(c=>c.id===t.chairId)?.name}:active?{status:active.started?'serving':'called',deadline:active.deadline,chairId:activeChair?.id,barber:activeChair?.name}:null;
  return {revision:s.revision,name:s.name,slug:s.slug,services:s.services,chairs,anyRange:estimate(null),mode:s.mode,hours:s.hours,open:reception(s),busy:!!activeTickets(s).length,waiting:s.queue.length,ahead:s.queue.length+activeTickets(s).length,range:range(predict(s)),phone:s.phone,own};
}
function refreshNotices(s){
  if(!reception(s)||!activeTickets(s).length)return;
  for(const t of s.queue){
    const eligible=s.chairs.filter(chair=>chairAccepts(s,t,chair));
    if(eligible.some(chair=>!s.active[chair.id]&&nextFor(s,chair)===t))continue;
    if(!eligible.some(chair=>s.active[chair.id])||t.soonNotified||!t.phone||predict(s,t)>15)continue;
    enqueueNotice(s,t,'soon',Date.now(),s.chairs.find(c=>c.id===t.chairId)?.name||'el primero disponible');
    t.soonNotified=true;
  }
}
function choice(s,id){
  if(id==null||id===''||id==='any')return s.chairs.length===1&&s.mode==='individual'?s.chairs[0].id:s.mode==='shared'?null:undefined;
  return s.chairs.some(c=>c.id===id)?id:undefined;
}
function callNext(s,chair,t,now=Date.now()){
  s.queue=s.queue.filter(v=>v.id!==t.id);
  s.active[chair.id]={...t,minutes:serviceMinutes(s,t.serviceId,chair.id,t.minutes),calledAt:now,deadline:now+s.noShowMinutes*60000};
  s.notices=s.notices.filter(n=>n.id!==t.id+':soon'||n.status==='sent');
  enqueueNotice(s,t,'called',now,chair.name);
}
function resolveNoShow(s,chairId,t,action){
  record(s,t,chairId,'no-show');
  delete s.active[chairId];
  s.notices=s.notices.filter(n=>n.id!==t.id+':called');
  if(action==='back'){
    const {calledAt,deadline,started,...waiting}=t;
    s.queue.push(waiting);
  }
}
const dayMs=86400000;
function expirePersonal(s,now){
  const old=s.queue.length;
  s.queue=s.queue.filter(t=>t.joined>now-dayMs);
  let changed=old!==s.queue.length;
  for(const [chairId,t] of Object.entries(s.active)){
    if((t.joined||0)>now-dayMs)continue;
    if(!t.started){delete s.active[chairId];changed=true;continue;}
    if(t.name||t.phone||t.token){t.name='';t.phone='';t.token='';changed=true;}
  }
  const count=s.notices.length;
  s.notices=s.notices.filter(n=>n.created>now-dayMs&&allTickets(s).some(t=>t.phone&&n.id.startsWith(t.id+':')));
  return changed||count!==s.notices.length;
}
export async function maintain(repo,env){
  const provider=new NotificationProvider(env);
  await repo.sweep();
  for(const slug of await repo.shops())await tick(repo.shop(slug),provider);
}
export async function tick(store,provider){
  for(let attempt=0;attempt<5;attempt++){
    const previous=await store.read();
    if(!previous)return null;
    const s=normalize(structuredClone(previous));
    const now=Date.now();
    let changed=expirePersonal(s,now);
    if(s.autoSkip)for(const [id,t] of Object.entries(s.active)){
      if(!t.started&&t.deadline<=now){resolveNoShow(s,id,t,'remove');changed=true;}
    }
    const count=s.notices.length;
    refreshNotices(s);
    if(!changed&&s.notices.length===count){
      if(!provider.automatic||!s.notices.some(n=>n.status==='pending'))return s;
      await dispatchNotices(store,provider);
      return normalize(await store.read());
    }
    s.revision=previous.revision+1;
    if(await store.write(s,previous.revision)){await dispatchNotices(store,provider);return normalize(await store.read());}
  }
  return normalize(await store.read());
}
function adminView(s,provider){
  const omitToken=({token,...t})=>t;
  return {...s,receiving:reception(s),stats:summarize(s),queue:s.queue.map(omitToken),active:Object.fromEntries(Object.entries(s.active).map(([id,t])=>[id,omitToken(t)])),notices:s.notices.filter(n=>n.status==='manual'||n.status==='pending'&&!provider.automatic||n.status==='sending'&&Date.now()-n.created>60000).map(n=>provider.present(n))};
}
// Public reads are limited per isolate. Writes and authentication keep shared limits.
function allowPublicRead(slug,ip,now=Date.now()){
  const key=slug+'\n'+ip, entry=readWindows.get(key);
  if(entry&&entry.until>now)return ++entry.hits<=300;
  if(readWindows.size>=4096)readWindows.delete(readWindows.keys().next().value);
  readWindows.set(key,{hits:1,until:now+60000});
  return true;
}
export async function route(request, repo, env={}, ip='unknown', defer) {
  const url=new URL(request.url), pathname=apiPath(url.pathname);
  let response;
  try{response=await handleRoute(request,repo,env,ip,defer,url,pathname);}
  catch{response=fail('No pudimos completar la solicitud.',500);}
  return withApiHeaders(url.pathname,response);
}
async function handleRoute(request,repo,env,ip,defer,url,pathname){
  if(env.TURNO_RUNTIME==='worker'){
    if(pathname==='/api/auth/register'&&!env.TURNO_INVITE)return fail('El registro no está habilitado',503);
    if(pathname.startsWith('/api/auth/')&&pathname!=='/api/auth/logout'&&!env.TURNO_PASSWORD_PEPPER)return fail('El inicio de sesión no está configurado.',503);
  }
  const provider=new NotificationProvider(env);
  const operatorPath=pathname==='/api/maintenance'||pathname==='/api/admin/reset';
  const operatorBearer=operatorPath&&env.TURNO_MAINTENANCE_KEY&&request.headers.get('Authorization')==='Bearer '+env.TURNO_MAINTENANCE_KEY;
  const sessionBearer=(pathname==='/api/agenda'||pathname==='/api/auth/logout')&&readBearer(request);
  if(request.method==='POST'&&!operatorBearer&&!sessionBearer&&request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return fail('Origen no permitido.',403);
  if(pathname==='/api/maintenance'){
    if(request.method!=='POST'||!env.TURNO_MAINTENANCE_KEY||request.headers.get('Authorization')!=='Bearer '+env.TURNO_MAINTENANCE_KEY)return fail('Ruta no encontrada.',404);
    await maintain(repo,env);return json({ok:true});
  }
  if(pathname==='/api/admin/reset'||pathname==='/api/auth/reset')return resetRoute(request,repo,env,ip,pathname==='/api/admin/reset');
  const auth=pathname.match(/^\/api\/auth\/(login|register|logout)$/);
  if(auth)return authRoute(request,repo,env,ip,auth[1]);
  const match=pathname.match(/^\/api\/b\/([a-z0-9-]{1,48})\/(estado|fila)$/);
  const admin=pathname==='/api/agenda';
  if(!match&&!admin)return fail('Ruta no encontrada.',404);
  if(match&&request.headers.has('Authorization'))return fail('Usa el token de turno para esta ruta.',401);
  const account=admin?await getAccount(request,repo):null;
  if(admin&&!account)return fail('Entra a tu agenda primero.',401);
  if(match){
    const permitted=request.method==='GET'?allowPublicRead(match[1],ip):await allowed(repo,env,request,'public:'+match[1]+':'+request.method,20,60000,ip);
    if(!permitted)return fail('Demasiadas solicitudes. Intenta en un minuto.',429);
  }
  const store=repo.shop(account?.slug||match[1]);
  const raw=request.headers.get('X-Turno-Token')||'';
  const token=/^[a-f0-9]{64}$/.test(raw)?raw:'';
  if(request.method==='GET'){
    const s=await tick(store,provider);
    if(!s)return fail('Barbería no encontrada.',404);
    return json(admin?adminView(s,provider):publicView(s,token));
  }
  if(request.method!=='POST'||(match&&match[2]!=='fila'))return fail('Método inválido.',405);
  const input=await parseBody(request);
  if(!input)return fail('Solicitud inválida o demasiado larga.');
  for(let attempt=0;attempt<5;attempt++){
    const previous=await store.read();
    if(!previous)return fail('Barbería no encontrada.',404);
    const s=normalize(structuredClone(previous));
    expirePersonal(s,Date.now());
    let resultToken=token;
    if((admin&&input.action==='add')||(!admin&&input.action==='join')){
      const name=clean(input.name,60), phone=phoneNumber(input.phone);
      const service=s.services.find(v=>v.id===input.serviceId);
      const minutes=service?.minutes;
      const chairId=choice(s,input.chairId);
      if(chairId===undefined)return fail('Selecciona un barbero.');
      if([...name].length<2||name.length>60||!minutes||((!admin||input.phone)&&!phone))return fail('Revisa el nombre, el WhatsApp y el servicio.');
      if(!admin&&(!reception(s)||input.consent!==true))return fail('La fila está cerrada o falta aceptar el aviso.',409);
      if(s.queue.length>=30)return fail('La fila está llena por ahora.',409);
      if(phone&&allTickets(s).some(t=>t.phone===phone))return fail('Ese WhatsApp ya tiene un turno activo.',409);
      resultToken=ticket();
      s.queue.push({id:crypto.randomUUID(),token:resultToken,name,phone,minutes,chairId,serviceId:service.id,joined:Date.now()});
    }else if(input.action==='reassign'){
      if(input.revision!==previous.revision)return fail('La fila cambió. Intenta de nuevo.',409);
      const t=s.queue.find(t=>admin?t.id===input.id:token&&t.token===token);
      if(!t)return fail('Ese turno ya no está en espera.',409);
      const chairId=choice(s,input.chairId);
      if(chairId===undefined)return fail('Selecciona un barbero.');
      t.chairId=chairId;
      s.events=[...(s.events||[]),{outcome:'reassign',chairId,at:Date.now()}].slice(-300);
    }else if(!admin && input.action==='leave'){
      if(!token||!s.queue.some(t=>t.token===token))return fail('Ese turno ya no está en espera.',409);
      const t=s.queue.find(v=>v.token===token);
      record(s,t,t.chairId,'left');
      s.queue=s.queue.filter(t=>t.token!==token);
      resultToken='';
    }else if(!admin&&input.action==='erase'){
      if(!token)return fail('Abre el turno desde el equipo donde te anotaste.',403);
      const t=activeTickets(s).find(v=>v.token===token);
      if(t){t.name='';t.phone='';t.token='';}
      const waiting=s.queue.find(v=>v.token===token);
      if(waiting)record(s,waiting,waiting.chairId,'left');
      s.queue=s.queue.filter(v=>v.token!==token);
      resultToken='';
    }else if(admin){
      switch(input.action){
        case 'qr-shared':s.qrShared=true;break;
        case 'toggle':s.open=!s.open;break;
        case 'pause':
        case 'resume': {
          const chair=s.chairs.find(c=>c.id===input.chairId);
          if(!chair||s.active[chair.id])return fail('El sillón no está libre.',409);
          if(input.action==='pause'){
            if(![5,10,15].includes(input.minutes))return fail('Elige una pausa de 5, 10 o 15 minutos.');
            chair.pausedUntil=Date.now()+input.minutes*60000;
          }else delete chair.pausedUntil;
          record(s,{},chair.id,input.action);
          break;
        }
        case 'reorder': {
          if(input.revision!==previous.revision)return fail('La fila cambió. Intenta de nuevo.',409);
          const index=s.queue.findIndex(t=>t.id===input.id);
          if(index<0)return fail('Ese turno ya no está en espera.',409);
          const ticket=s.queue[index];
          const positions=s.queue.map((_,i)=>i);
          const from=positions.indexOf(index);
          const destination={up:from-1,down:from+1,first:0}[input.direction];
          if(!Number.isInteger(destination)||destination===from||destination<0||destination>=positions.length)return fail('No se puede mover el turno en esa dirección.');
          const ordered=positions.map(i=>s.queue[i]);
          ordered.splice(destination,0,ordered.splice(from,1)[0]);
          positions.forEach((i,j)=>{s.queue[i]=ordered[j];});
          record(s,{},ticket.chairId,'reorder');
          break;
        }
        case 'next': {
          const chair=s.chairs.find(c=>c.id===input.chairId);
          const t=chair&&nextFor(s,chair);
          if(!t||s.active[chair.id])return fail('El sillón está ocupado o no hay turnos.',409);
          callNext(s,chair,t);break;
        }
        case 'start': {
          const t=s.active[input.chairId];
          if(!t||t.id!==input.id||t.started)return fail('El turno cambió.',409);
          if(s.autoSkip&&t.deadline<=Date.now())return fail('Ya venció el tiempo para este turno.',409);
          t.started=Date.now();break;
        }
        case 'no-show': {
          const t=s.active[input.chairId];
          if(!t||t.id!==input.id||t.started||!['back','remove'].includes(input.disposition))return fail('El turno cambió.',409);
          resolveNoShow(s,input.chairId,t,input.disposition);break;
        }
        case 'finish':
        case 'finish-next': {
          const t=s.active[input.chairId];
          if(!t||t.id!==input.id||!t.started)return fail('El turno cambió. Actualiza la agenda.',409);
          const now=Date.now();
          record(s,t,input.chairId,'served',now);
          delete s.active[input.chairId];
          const chair=s.chairs.find(c=>c.id===input.chairId);
          const next=input.action==='finish-next'&&chair&&nextFor(s,chair);
          if(next)callNext(s,chair,next,now);
          break;
        }
        case 'remove':
          if(!s.queue.some(t=>t.id===input.id))return fail('Ese turno ya no está en espera.',409);
          s.queue=s.queue.filter(t=>t.id!==input.id);break;
        case 'notice-done': {
          const n=s.notices.find(n=>n.id===input.id);
          if(n)n.status='sent';
          break;
        }
        case 'settings': {
          const phone=phoneNumber(input.phone);
          if(input.phone&&!phone)return fail('Escribe un WhatsApp dominicano válido.');
          const services=Array.isArray(input.services)?input.services.map(v=>({
            id:s.services.some(a=>a.id===v?.id)?v.id:crypto.randomUUID(),name:clean(v?.name,45),minutes:Number(v?.minutes),
            price:v?.price===''||v?.price==null?null:Number(v.price)
          })):[];
          const chairs=Array.isArray(input.chairs)?input.chairs.map(v=>({id:s.chairs.some(c=>c.id===v?.id)?v.id:crypto.randomUUID(),name:clean(v?.name,35),specialty:v?.specialty===undefined?s.chairs.find(c=>c.id===v?.id)?.specialty:clean(v.specialty,60),pausedUntil:s.chairs.find(c=>c.id===v?.id)?.pausedUntil})):[];
          if(services.length<1||services.length>12||new Set(services.map(v=>v.id)).size!==services.length||services.some(v=>!v.name||v.name.length>45||!Number.isInteger(v.minutes)||v.minutes<5||v.minutes>180||(v.price!==null&&(!Number.isFinite(v.price)||v.price<0||v.price>100000))))return fail('Revisa el catálogo.');
          if(chairs.length<1||chairs.length>8||new Set(chairs.map(v=>v.id)).size!==chairs.length||chairs.some(c=>!c.name||c.name.length>35||(c.specialty?.length||0)>60)||!['shared','individual'].includes(input.mode))return fail('Revisa los sillones y el tipo de fila.');
          if((s.queue.length||activeTickets(s).length)&&(input.mode!==s.mode||s.chairs.some(v=>!chairs.some(c=>c.id===v.id))||s.services.some(v=>!services.some(c=>c.id===v.id))))return fail('Vacía la fila antes de quitar servicios, sillones o cambiar el tipo de fila.',409);
          const noShowMinutes=Number(input.noShowMinutes);
          if(!Number.isInteger(noShowMinutes)||noShowMinutes<1||noShowMinutes>30)return fail('La espera para presentarse debe ser de 1 a 30 minutos.');
          const hours=validHours(input.hours), name=clean(input.name,60);
          if(!hours||!name||name.length>60)return fail('Revisa el nombre y el horario de la barbería.');
          s.name=name;s.phone=phone;s.services=services;s.chairs=chairs;s.mode=input.mode;s.hours=hours;
          s.noShowMinutes=noShowMinutes;s.autoSkip=input.autoSkip===true;
          if(input.onboarded===true)s.onboarded=true;
          break;
        }
        default:return fail('Acción desconocida.');
      }
    }else return fail('Acción desconocida.');
    refreshNotices(s);
    s.notices=s.notices.filter(n=>allTickets(s).some(t=>t.phone&&n.id.startsWith(t.id+':')));
    s.revision=previous.revision+1;
    if(await store.write(s,previous.revision)){
      if(defer&&provider.automatic)defer(dispatchNotices(store,provider));else await dispatchNotices(store,provider);
      return json(admin?adminView(await store.read(),provider):{...publicView(s,resultToken),token:resultToken});
    }
  }
  return fail('La fila cambió. Intenta de nuevo.',409);
}
