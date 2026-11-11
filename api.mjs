export const initial = {open:true, duration:30, phone:'', queue:[], current:null};
const json = (value,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const publicView = s => {
  const left = s.current ? Math.max(0, Math.ceil((s.current.started+s.current.minutes*60000-Date.now())/60000)) : 0;
  const minutes = left+s.queue.reduce((sum,t)=>sum+t.minutes,0);
  return {open:s.open,busy:!!s.current,waiting:s.queue.length,minutes,phone:s.phone};
};
export async function route(request, store, key) {
  const url = new URL(request.url);
  if(url.pathname==='/api/estado' && request.method==='GET') return json(publicView(await store.read()));
  if(url.pathname!=='/api/agenda') return json({error:'Ruta no encontrada.'},404);
  if(!key || request.headers.get('Authorization')!=='Bearer '+key) return json({error:'Clave incorrecta.'},401);
  if(request.method==='GET') return json(await store.read());
  if(request.method!=='POST') return json({error:'Método inválido.'},405);
  let input;
  try { input=await request.json(); } catch { return json({error:'Solicitud inválida.'},400); }
  if(!input || typeof input!=='object') return json({error:'Solicitud inválida.'},400);
  for(let attempt=0;attempt<5;attempt++) {
    const current=await store.read();
    const s=structuredClone(current);
    switch(input.action) {
      case 'toggle': s.open=!s.open; break;
      case 'add': {
        const name=typeof input.name==='string'?input.name.trim():'';
        const minutes=Number(input.minutes);
        if(!name || name.length>60 || !Number.isInteger(minutes) || minutes<5 || minutes>180 || s.queue.length>=30) return json({error:'Revisa el nombre, la duración o el límite de 30 turnos.'},400);
        s.queue.push({id:crypto.randomUUID(),name,minutes}); break;
      }
      case 'next':
        if(s.current || !s.queue.length) return json({error:'Termina el turno actual o agrega a alguien a la fila.'},409);
        s.current={...s.queue.shift(),started:Date.now()}; break;
      case 'finish':
        if(!s.current || s.current.id!==input.id) return json({error:'El turno cambió. Actualiza la agenda.'},409);
        s.current=null; break;
      case 'remove':
        if(!s.queue.some(t=>t.id===input.id)) return json({error:'Ese turno ya no está en espera.'},409);
        s.queue=s.queue.filter(t=>t.id!==input.id); break;
      case 'settings': {
        const phone=typeof input.phone==='string'?input.phone.replace(/\D/g,''):'';
        const duration=Number(input.duration);
        if((phone && !/^1(?:809|829|849)\d{7}$/.test(phone)) || !Number.isInteger(duration) || duration<5 || duration>180) return json({error:'Usa un número dominicano con +1 y una duración entre 5 y 180 minutos.'},400);
        s.phone=phone; s.duration=duration; break;
      }
      default: return json({error:'Acción desconocida.'},400);
    }
    s.revision=current.revision+1;
    if(await store.write(s,current.revision)) return json(s);
  }
  return json({error:'La fila cambió en otro dispositivo. Intenta de nuevo.'},409);
}
