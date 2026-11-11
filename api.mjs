import {NotificationProvider,enqueueNotice,dispatchNotices} from './notifications.mjs';
import {firstChair,chairAccepts,nextFor,serviceMinutes,range,predict,record} from './estimates.mjs';
export const initial = {
  open:true, phone:'', name:'Barbería Turno Listo', slug:'turno-listo',
  duration:30, queue:[], current:null, notices:[], active:{}, chairs:[firstChair], mode:'shared', history:[], noShowMinutes:5, autoSkip:false,
  services:[{id:'corte',name:'Corte',minutes:30},{id:'corte-barba',name:'Corte y barba',minutes:45},{id:'cejas',name:'Cejas',minutes:10}]
};
export const clean = (v,n) => typeof v==='string' ? v.trim().slice(0,n+1) : '';
export function phoneNumber(value) {
  const digits=clean(value,24).replace(/\D/g,'');
  const number=digits.length===10?'1'+digits:digits;
  return /^1(?:809|829|849)\d{7}$/.test(number)?number:'';
}
export const json = (value,status=200,headers={}) => Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
export const fail = (error,status=400) => json({error},status);
export const ticket = () => crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const activeTickets=s=>Object.values(s.active);
const allTickets=s=>[...s.queue,...activeTickets(s)];
function normalize(s){
  if(s.current){s.active[firstChair.id]??=s.current;s.current=null;}
  return s;
}
function publicView(s,token){
  const t=token?s.queue.find(t=>t.token===token):null;
  const active=token?activeTickets(s).find(t=>t.token===token):null;
  const own=t?{position:s.queue.filter(v=>s.mode==='shared'||v.chairId===t.chairId).indexOf(t)+1,range:range(predict(s,t)),status:'waiting'}:active?{status:active.started?'serving':'called',deadline:active.deadline}:null;
  return {name:s.name,slug:s.slug,services:s.services,chairs:s.chairs,mode:s.mode,open:s.open,busy:!!activeTickets(s).length,waiting:s.queue.length,range:range(predict(s)),phone:s.phone,own};
}
function refreshNotices(s){
  if(s.open)s.queue.forEach((t,i)=>{
    if((s.mode==='shared'?i:s.queue.filter(v=>v.chairId===t.chairId).indexOf(t))<2||predict(s,t)<=15)enqueueNotice(s,t,'soon');
  });
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
export async function tick(store,provider){
  for(let attempt=0;attempt<5;attempt++){
    const previous=await store.read();
    if(!previous)return null;
    const s=normalize(structuredClone(previous));
    const now=Date.now();
    let changed=false;
    if(s.autoSkip)for(const [id,t] of Object.entries(s.active)){
      if(!t.started&&t.deadline<=now){resolveNoShow(s,id,t,'remove');changed=true;}
    }
    const count=s.notices.length;
    refreshNotices(s);
    if(!changed&&s.notices.length===count){await dispatchNotices(store,provider);return normalize(await store.read());}
    s.revision=previous.revision+1;
    if(await store.write(s,previous.revision)){await dispatchNotices(store,provider);return normalize(await store.read());}
  }
  return normalize(await store.read());
}
function adminView(s,provider){
  return {...s,notices:s.notices.filter(n=>n.status==='manual'||n.status==='pending'&&!provider.automatic||n.status==='sending'&&Date.now()-n.created>60000).map(n=>provider.present(n))};
}
export async function route(request, store, key, env={}) {
  const provider=new NotificationProvider(env);
  const {pathname}=new URL(request.url);
  const match=pathname.match(/^\/api\/b\/([a-z0-9-]{1,48})\/(estado|fila)$/);
  const admin=pathname==='/api/agenda';
  if(!match&&!admin) return fail('Ruta no encontrada.',404);
  if(admin && (!key || request.headers.get('Authorization')!=='Bearer '+key)) return fail('Clave incorrecta.',401);
  const token=request.headers.get('X-Turno-Token')||'';
  if(request.method==='GET'){
    const s=await tick(store,provider);
    if(match && match[1]!==s.slug) return fail('Barbería no encontrada.',404);
    return json(admin?adminView(s,provider):publicView(s,token));
  }
  if(request.method!=='POST'||(match&&match[2]!=='fila')) return fail('Método inválido.',405);
  let input;
  try{input=await request.json();}catch{return fail('Solicitud inválida.');}
  if(!input||typeof input!=='object')return fail('Solicitud inválida.');
  for(let attempt=0;attempt<5;attempt++){
    const previous=await store.read(), s=normalize(structuredClone(previous));
    if(match && match[1]!==s.slug)return fail('Barbería no encontrada.',404);
    let resultToken=token;
    if((admin&&input.action==='add')||(!admin&&input.action==='join')){
      const name=clean(input.name,60), phone=phoneNumber(input.phone);
      const service=s.services.find(v=>v.id===input.serviceId);
      const minutes=service?.minutes;
      const chairId=s.mode==='individual'?input.chairId:null;
      if(s.mode==='individual'&&!s.chairs.some(c=>c.id===chairId))return fail('Selecciona un barbero.');
      if(!name||name.length>60||!minutes||((!admin||input.phone)&&!phone))return fail('Revisa el nombre, el WhatsApp y el servicio.');
      if(!admin&&(!s.open||input.consent!==true))return fail('La fila está cerrada o falta aceptar el aviso.',409);
      if(s.queue.length>=30)return fail('La fila está llena por ahora.',409);
      if(phone&&allTickets(s).some(t=>t.phone===phone))return fail('Ese WhatsApp ya tiene un turno activo.',409);
      resultToken=ticket();
      s.queue.push({id:crypto.randomUUID(),token:resultToken,name,phone,minutes,chairId,serviceId:service.id,joined:Date.now()});
    }else if(!admin && input.action==='leave'){
      if(!token||!s.queue.some(t=>t.token===token))return fail('Ese turno ya no está en espera.',409);
      s.queue=s.queue.filter(t=>t.token!==token);
      resultToken='';
    }else if(admin){
      switch(input.action){
        case 'toggle':s.open=!s.open;break;
        case 'next': {
          const chair=s.chairs.find(c=>c.id===input.chairId);
          const t=chair&&nextFor(s,chair);
          if(!t||s.active[chair.id])return fail('El sillón está ocupado o no hay turnos.',409);
          s.queue=s.queue.filter(v=>v.id!==t.id);
          s.active[chair.id]={...t,minutes:serviceMinutes(s,t.serviceId,chair.id,t.minutes),calledAt:Date.now(),deadline:Date.now()+s.noShowMinutes*60000};
          s.notices=s.notices.filter(n=>n.id!==t.id+':soon'||n.status==='sent');
          enqueueNotice(s,t,'called');break;
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
        case 'finish': {
          const t=s.active[input.chairId];
          if(!t||t.id!==input.id||!t.started)return fail('El turno cambió. Actualiza la agenda.',409);
          record(s,t,input.chairId,'served');
          delete s.active[input.chairId];break;
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
          const services=Array.isArray(input.services)?input.services.map((v,i)=>({
            id:s.services[i]?.id||crypto.randomUUID(),name:clean(v?.name,45),minutes:Number(v?.minutes),
            price:v?.price===''||v?.price==null?null:Number(v.price)
          })):[];
          const chairs=Array.isArray(input.chairs)?input.chairs.map((v,i)=>({id:s.chairs[i]?.id||crypto.randomUUID(),name:clean(v,35)})):[];
          if(services.length<1||services.length>12||services.some(v=>!v.name||v.name.length>45||!Number.isInteger(v.minutes)||v.minutes<5||v.minutes>180||(v.price!==null&&(!Number.isFinite(v.price)||v.price<0||v.price>100000))))return fail('Revisa el catálogo.');
          if(chairs.length<1||chairs.length>8||chairs.some(c=>!c.name||c.name.length>35)||!['shared','individual'].includes(input.mode))return fail('Revisa los sillones y el tipo de fila.');
          if((s.queue.length||activeTickets(s).length)&&(input.mode!==s.mode||chairs.length<s.chairs.length||services.length<s.services.length))return fail('Vacía la fila antes de quitar servicios, sillones o cambiar el tipo de fila.',409);
          const noShowMinutes=Number(input.noShowMinutes);
          if(!Number.isInteger(noShowMinutes)||noShowMinutes<1||noShowMinutes>30)return fail('La espera para presentarse debe ser de 1 a 30 minutos.');
          s.phone=phone;s.services=services;s.chairs=chairs;s.mode=input.mode;
          s.noShowMinutes=noShowMinutes;s.autoSkip=input.autoSkip===true;break;
        }
        default:return fail('Acción desconocida.');
      }
    }else return fail('Acción desconocida.');
    refreshNotices(s);
    s.notices=s.notices.filter(n=>allTickets(s).some(t=>n.id.startsWith(t.id+':')));
    s.revision=previous.revision+1;
    if(await store.write(s,previous.revision)){
      await dispatchNotices(store,provider);
      return json(admin?adminView(await store.read(),provider):{...publicView(s,resultToken),token:resultToken});
    }
  }
  return fail('La fila cambió. Intenta de nuevo.',409);
}
