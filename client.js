import {$,msg,api,values,element,money,waitLabel,bookingOptions,saves} from './shared.js';

const publicSlug=location.pathname.split('/')[2]||'turno-listo';
const publicPath='/api/v1/b/'+encodeURIComponent(publicSlug);
const tokenKey='turno-ticket:'+publicSlug;
let token='', previousPublic, publicState, choiceOptions;
const savedKey='turno-remember:'+publicSlug;
const chairKey='turno-chair:'+publicSlug;
const queueSaves=saves($('client'),'publicSaving');
function remembered(){
 try{return JSON.parse(localStorage.getItem(savedKey));}catch{return null;}
}
function forgetRemembered(){
 try{localStorage.removeItem(savedKey);localStorage.removeItem(chairKey);}catch{}
 $('rememberActions').hidden=true;
 $('join').elements.remember.checked=false;
}
function personalLink(){
 const url=new URL('/b/'+publicSlug,location.origin);url.searchParams.set('t',token);return url.href;
}
const weekdays=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
function priceLabel(v){return v.price==null?'':money.format(v.price);}
function renderChoices(s){
 const options=[...(s.mode==='shared'?[{id:'any',name:'Cualquiera disponible',range:s.anyRange}]:[]),...s.chairs];
 const list=$('chairOptions'), signature=JSON.stringify(options);
 $('chairChoices').hidden=s.chairs.length<2;
 if(s.chairs.length<2){list.replaceChildren();choiceOptions=null;return;}
 if(signature===choiceOptions)return;
 choiceOptions=signature;
 let chosen=list.querySelector(':checked')?.value;
 if(!chosen)try{chosen=localStorage.getItem(chairKey);}catch{}
 if(!options.some(c=>c.id===chosen))chosen=s.mode==='shared'?'any':null;
 list.replaceChildren(...options.map(c=>{
  const label=element('label',null,'chair-choice'),radio=element('input');
  radio.type='radio';radio.name='chairId';radio.value=c.id;radio.required=true;radio.checked=c.id===chosen;
  const caption=element('span'), status={libre:'Libre ahora',ocupado:'Ocupado',pausa:'En pausa'}[c.state];
  caption.append(element('strong',c.name));
  if(c.specialty)caption.append(element('small',c.specialty));
  if(status)caption.append(element('small',status,'choice-state'));
  caption.append(element('small',waitLabel(c.range)));
  label.append(radio,caption);return label;
 }));
}
function publicRender(s){
 publicState=s;
 previousPublic=publicStamp(s);
 document.title=s.name+' · Turno Listo';msg('shopName',s.name);
 msg('publicHours',s.hours.enabled?s.hours.days.map(d=>weekdays[d]).join(', ')+' · '+s.hours.from+' a '+s.hours.to:'Consulta la disponibilidad de hoy en la fila.');
 $('publicServices').replaceChildren(...s.services.map(v=>{
   const li=element('li',null,'row');li.append(element('span',v.name+' · '+v.minutes+' min'),element('strong',priceLabel(v)));return li;
 }));
 $('locationCard').hidden=!s.address&&!s.mapsUrl&&!s.payments?.length;
 $('addressText').hidden=!s.address;msg('addressText',s.address||'');
 const maps=$('mapsLink');maps.hidden=!s.mapsUrl;
 if(s.mapsUrl)maps.href=s.mapsUrl;else maps.removeAttribute('href');
 const labels={efectivo:'Efectivo',tarjeta:'Tarjeta',transferencia:'Transferencia'};
 $('publicPayments').replaceChildren(...(s.payments||[]).filter(p=>labels[p]).map(p=>element('span',labels[p],'queue-badge')));
 const occupied=s.busy||s.waiting>0;
 msg('tag',!s.open?'Pausada':occupied?'Atendiendo':'Disponible');
 msg('headline',!s.open?'Por ahora no recibimos turnos':s.range[1]>0?'Hay '+s.ahead+' antes que tú'+' · espera aprox. '+waitLabel(s.range):'Puedes pasar ahora');
 msg('detail',!s.open?'Consulta más tarde o escríbenos por WhatsApp.':occupied?'Anótate y consulta tu posición desde aquí.':'Ahora mismo no hay nadie en la fila.');
 $('join').hidden=!s.open||!!s.own;
 bookingOptions($('join'),s);renderChoices(s);
 $('own').hidden=!s.own;
 for(const [id,value] of [['ownNote',s.own?.note],['ownPromo',s.own?.firstVisitMessage]]){$(id).hidden=!value;msg(id,value||'');}
 if(s.own)msg('ownText',s.own.status==='waiting'?'Esperando · Posición '+s.own.position+' · '+waitLabel(s.own.range):s.own.status==='called'?(s.chairs.length>1&&s.own.barber?'¡Te toca con '+s.own.barber+'! Pasa por favor.':'¡Te toca! Pasa a la barbería.'):'En el sillón');
 $('ownBarber').hidden=s.chairs.length<2||!s.own||s.own.status==='called';
 if(s.own)msg('ownBarber','Con '+(s.own.barber||'el primero disponible'));
 const changeForm=$('ownReassign');
 changeForm.hidden=s.chairs.length<2||s.own?.status!=='waiting';
 if(!changeForm.hidden){
  const select=changeForm.elements.chairId, selected=select.value;
  const choices=[...(s.mode==='shared'?[new Option('Cualquiera disponible','any')]:[]),...s.chairs.map(c=>new Option(c.name,c.id))];
  if(JSON.stringify([...select.options].map(c=>[c.value,c.text]))!==JSON.stringify(choices.map(c=>[c.value,c.text]))){
   select.replaceChildren(...choices);select.value=choices.some(c=>c.value===selected)?selected:s.own.chairId||'any';
  }
 }
 if(s.own&&token)$('saveTicket').href='https://wa.me/?text='+encodeURIComponent('Mi turno: '+personalLink());
 $('leave').hidden=s.own?.status!=='waiting';
 $('wa').hidden=!s.phone;
 if(s.phone)$('wa').href='https://wa.me/'+s.phone+'?text='+encodeURIComponent('Hola, vi la fila de la barbería. ¿Puedo pasar?');
}
const publicStamp=s=>JSON.stringify([s.revision,s.open,s.range,s.own,s.chairs,s.anyRange]);
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
  if((data.action==='join'||data.action==='reassign')&&data.chairId)try{localStorage.setItem(chairKey,data.chairId);}catch{}
  if(data.action==='join'&&data.remember){
   try{const {name,phone,serviceId,chairId}=data;localStorage.setItem(savedKey,JSON.stringify({name,phone,serviceId,chairId}));}catch{}
  }
  if(data.action==='erase')forgetRemembered();
  $('rememberActions').hidden=!remembered();
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
 $('join').onsubmit=e=>{e.preventDefault();const data=values($('join'));publicChange({...data,remember:data.remember==='on',firstVisit:data.firstVisit==='on',consent:data.consent==='on',action:'join'});};
 $('rememberActions').hidden=!remembered();
 $('forgetRemembered').onclick=e=>{e.preventDefault();forgetRemembered();};
 $('useRemembered').onclick=()=>{
  const saved=remembered();if(!saved)return;
  const form=$('join');
  form.elements.name.value=saved.name;form.elements.phone.value=saved.phone;
  if([...form.elements.serviceId.options].some(o=>o.value===saved.serviceId))form.elements.serviceId.value=saved.serviceId;
  for(const radio of $('chairOptions').querySelectorAll('input'))if(radio.value===saved.chairId)radio.checked=true;
  form.elements.remember.checked=true;
 };
 $('ownReassign').onsubmit=e=>{e.preventDefault();publicChange({action:'reassign',chairId:e.currentTarget.elements.chairId.value,revision:publicState.revision});};
 $('leave').onclick=()=>publicChange({action:'leave'});
 $('copyTicket').onclick=async()=>{
  try{await navigator.clipboard.writeText(personalLink());msg('ticketFeedback','Enlace copiado. Guárdalo para abrir tu turno en otro celular.');}
  catch{msg('ticketFeedback',personalLink());}
 };
 $('erase').onclick=()=>publicChange({action:'erase'});
 refreshPublic();setInterval(refreshPublic,5000);

}
