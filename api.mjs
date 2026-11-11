export const initial = {
  open:true, phone:'', name:'Barbería Turno Listo', slug:'turno-listo',
  duration:30, queue:[], current:null,
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
const queueWait = (s, count) => {
  const left = s.current ? Math.max(0, Math.ceil((s.current.started+s.current.minutes*60000-Date.now())/60000)) : 0;
  return left+s.queue.slice(0,count).reduce((sum,t)=>sum+t.minutes,0);
};
function publicView(s,token) {
  const i=token?s.queue.findIndex(t=>t.token===token):-1;
  const own=i>=0?{position:i+1,minutes:queueWait(s,i),status:'waiting'}:
    token&&s.current?.token===token?{status:'serving'}:null;
  return {name:s.name,slug:s.slug,services:s.services,open:s.open,busy:!!s.current,waiting:s.queue.length,minutes:queueWait(s,s.queue.length),phone:s.phone,own};
}
export async function route(request, store, key) {
  const {pathname}=new URL(request.url);
  const match=pathname.match(/^\/api\/b\/([a-z0-9-]{1,48})\/(estado|fila)$/);
  const admin=pathname==='/api/agenda';
  if(!match&&!admin) return fail('Ruta no encontrada.',404);
  if(admin && (!key || request.headers.get('Authorization')!=='Bearer '+key)) return fail('Clave incorrecta.',401);
  const token=request.headers.get('X-Turno-Token')||'';
  if(request.method==='GET'){
    const s=await store.read();
    if(match && match[1]!==s.slug) return fail('Barbería no encontrada.',404);
    return json(admin?s:publicView(s,token));
  }
  if(request.method!=='POST'||(match&&match[2]!=='fila')) return fail('Método inválido.',405);
  let input;
  try{input=await request.json();}catch{return fail('Solicitud inválida.');}
  if(!input||typeof input!=='object')return fail('Solicitud inválida.');
  for(let attempt=0;attempt<5;attempt++){
    const previous=await store.read(), s=structuredClone(previous);
    if(match && match[1]!==s.slug)return fail('Barbería no encontrada.',404);
    let resultToken=token;
    if((admin&&input.action==='add')||(!admin&&input.action==='join')){
      const name=clean(input.name,60), phone=phoneNumber(input.phone);
      const service=s.services.find(v=>v.id===input.serviceId);
      const minutes=service?.minutes;
      if(!name||name.length>60||!minutes||((!admin||input.phone)&&!phone))return fail('Revisa el nombre, el WhatsApp y el servicio.');
      if(!admin&&(!s.open||input.consent!==true))return fail('La fila está cerrada o falta aceptar el aviso.',409);
      if(s.queue.length>=30)return fail('La fila está llena por ahora.',409);
      if(phone&&[...s.queue,s.current].some(t=>t?.phone===phone))return fail('Ese WhatsApp ya tiene un turno activo.',409);
      resultToken=ticket();
      s.queue.push({id:crypto.randomUUID(),token:resultToken,name,phone,minutes,serviceId:service.id,joined:Date.now()});
    }else if(!admin && input.action==='leave'){
      if(!token||!s.queue.some(t=>t.token===token))return fail('Ese turno ya no está en espera.',409);
      s.queue=s.queue.filter(t=>t.token!==token);
      resultToken='';
    }else if(admin){
      switch(input.action){
        case 'toggle':s.open=!s.open;break;
        case 'next':
          if(s.current||!s.queue.length)return fail('Termina el turno actual o agrega a alguien.',409);
          s.current={...s.queue.shift(),started:Date.now()};break;
        case 'finish':
          if(!s.current||s.current.id!==input.id)return fail('El turno cambió. Actualiza la agenda.',409);
          s.current=null;break;
        case 'remove':
          if(!s.queue.some(t=>t.id===input.id))return fail('Ese turno ya no está en espera.',409);
          s.queue=s.queue.filter(t=>t.id!==input.id);break;
        case 'settings': {
          const phone=phoneNumber(input.phone);
          if(input.phone&&!phone)return fail('Escribe un WhatsApp dominicano válido.');
          s.phone=phone;break;
        }
        default:return fail('Acción desconocida.');
      }
    }else return fail('Acción desconocida.');
    s.revision=previous.revision+1;
    if(await store.write(s,previous.revision))return json(admin?s:{...publicView(s,resultToken),token:resultToken});
  }
  return fail('La fila cambió. Intenta de nuevo.',409);
}
