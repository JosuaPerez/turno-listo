import {$,msg,api,values,element,money,waitLabel,bookingOptions,saves} from './shared.js';

const publicSlug=location.pathname.split('/')[2]||'turno-listo';
const publicPath='/api/v1/b/'+encodeURIComponent(publicSlug);
const tokenKey='turno-ticket:'+publicSlug;
let token='', previousPublic;
const queueSaves=saves($('client'),'publicSaving');
function personalLink(){
 const url=new URL('/b/'+publicSlug,location.origin);url.searchParams.set('t',token);return url.href;
}
const weekdays=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
function priceLabel(v){return v.price==null?'':money.format(v.price);}
function publicRender(s){
 previousPublic=publicStamp(s);
 document.title=s.name+' · Turno Listo';msg('shopName',s.name);
 msg('publicHours',s.hours.enabled?s.hours.days.map(d=>weekdays[d]).join(', ')+' · '+s.hours.from+' a '+s.hours.to:'Consulta la disponibilidad de hoy en la fila.');
 $('publicServices').replaceChildren(...s.services.map(v=>{
   const li=element('li',null,'row');li.append(element('span',v.name+' · '+v.minutes+' min'),element('strong',priceLabel(v)));return li;
 }));
 const occupied=s.busy||s.waiting>0;
 msg('tag',!s.open?'Pausada':occupied?'Atendiendo':'Disponible');
 msg('headline',!s.open?'Por ahora no recibimos turnos':s.range[1]>0?'Hay '+s.ahead+' antes que tú'+' · espera aprox. '+waitLabel(s.range):'Puedes pasar ahora');
 msg('detail',!s.open?'Consulta más tarde o escríbenos por WhatsApp.':occupied?'Anótate y consulta tu posición desde aquí.':'Ahora mismo no hay nadie en la fila.');
 $('join').hidden=!s.open||!!s.own;
 bookingOptions($('join'),s);
 $('own').hidden=!s.own;
 if(s.own)msg('ownText',s.own.status==='waiting'?'Esperando · Posición '+s.own.position+' · '+waitLabel(s.own.range):s.own.status==='called'?'¡Te toca! Pasa a la barbería.':'En el sillón');
 if(s.own&&token)$('saveTicket').href='https://wa.me/?text='+encodeURIComponent('Mi turno: '+personalLink());
 $('leave').hidden=s.own?.status!=='waiting';
 $('wa').hidden=!s.phone;
 if(s.phone)$('wa').href='https://wa.me/'+s.phone+'?text='+encodeURIComponent('Hola, vi la fila de la barbería. ¿Puedo pasar?');
}
const publicStamp=s=>JSON.stringify([s.revision,s.open,s.range,s.own]);
async function refreshPublic(){
 const task=queueSaves.beginPoll();if(!task)return;
 try{
  const s=await api(publicPath+'/estado',undefined,task.signal,token);
  if(!task.signal.aborted&&publicStamp(s)!==previousPublic)publicRender(s);
 }catch(e){
  if(task.signal.aborted)return;
  previousPublic=null;
  msg('headline',e.status===404?'Todavía no hay una barbería en este enlace':'No pudimos consultar la fila');
  msg('detail',e.message);$('join').hidden=true;
 }finally{queueSaves.endPoll(task);}
}
async function publicChange(data){
 const done=queueSaves.beginSave();if(!done)return;
 try{
  msg('publicError');
  const s=await api(publicPath+'/fila',data,undefined,token);
  token=s.token||'';if(token)localStorage.setItem(tokenKey,token);else localStorage.removeItem(tokenKey);
  publicRender(s);if(data.action==='join')$('join').reset();if(data.action==='erase')msg('publicError','Borramos tus datos de la fila.');
 }catch(e){msg('publicError',e.message);}
 finally{done();}
}

export function startReset(){

 $('resetView').hidden=false;$('barberFooter').hidden=true;
 const url=new URL(location.href), code=new URLSearchParams(url.hash.slice(1)).get('t');
 url.hash='';history.replaceState(null,'',url);
 const form=$('resetForm'), submit=form.querySelector('button');
 if(!/^[a-f0-9]{64}$/.test(code||'')){form.hidden=true;msg('resetStatus','Pídele al operador un enlace nuevo.');}
 form.onsubmit=async event=>{
   event.preventDefault();if(submit.disabled)return;
   submit.disabled=true;msg('resetStatus','Guardando…');
   try{
    await api('/api/v1/auth/reset',{...values(form),token:code});
    form.reset();form.hidden=true;msg('resetStatus','Contraseña cambiada. Entra con tu nueva contraseña.');
   }catch(error){msg('resetStatus',error.message);submit.disabled=false;}
 };

}
export function startClient(){
 token=localStorage.getItem(tokenKey)||'';
 const url=new URL(location.href), personal=url.searchParams.get('t');
 if(/^[a-f0-9]{64}$/.test(personal||'')){
  token=personal;localStorage.setItem(tokenKey,token);
  url.searchParams.delete('t');history.replaceState(null,'',url);
 }
 $('client').hidden=false;
 $('join').onsubmit=e=>{e.preventDefault();const data=values($('join'));publicChange({...data,consent:data.consent==='on',action:'join'});};
 $('leave').onclick=()=>publicChange({action:'leave'});
 $('copyTicket').onclick=async()=>{
  try{await navigator.clipboard.writeText(personalLink());msg('ticketFeedback','Enlace copiado. Guárdalo para abrir tu turno en otro celular.');}
  catch{msg('ticketFeedback',personalLink());}
 };
 $('erase').onclick=()=>publicChange({action:'erase'});
 refreshPublic();setInterval(refreshPublic,5000);

}
