const $=id=>document.getElementById(id);
const admin=location.pathname==='/barbero';
const publicSlug=location.pathname.split('/')[2]||'turno-listo';
const tokenKey='turno-ticket:'+publicSlug;
let token=localStorage.getItem(tokenKey)||'', state, saving=false, polling, renderedSlug;
if(!admin){
 const url=new URL(location.href), personal=url.searchParams.get('t');
 if(/^[a-f0-9]{64}$/.test(personal||'')){
  token=personal;localStorage.setItem(tokenKey,token);
  url.searchParams.delete('t');history.replaceState(null,'',url);
 }
}
function beginSave(status){
 if(saving)return null;
 saving=true;polling?.abort();msg(status,'Guardando…');
 const root=$(admin?'admin':'client');
 const buttons=[...root.querySelectorAll('button:not(:disabled)')];
 buttons.forEach(b=>b.disabled=true);
 return ()=>{
  saving=false;
  buttons.forEach(b=>b.disabled=false);
  msg(status);
 };
}
function personalLink(){
 const url=new URL('/b/'+publicSlug,location.origin);url.searchParams.set('t',token);return url.href;
}
const adminPath='/api/agenda';
const publicPath='/api/b/'+encodeURIComponent(publicSlug);
const values=form=>Object.fromEntries(new FormData(form));
const msg=(id,text='')=>{$(id).textContent=text;};
function button(label, action, secondary=false){
 const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;
 if(secondary)b.className='secondary';return b;
}
function element(tag,value,cls){
 const el=document.createElement(tag); if(value!=null)el.textContent=value;if(cls)el.className=cls;return el;
}
async function api(path,body,signal){
 const headers={};
 if(path.startsWith(publicPath)&&token)headers['X-Turno-Token']=token;
 if(body)headers['Content-Type']='application/json';
 const r=await fetch(path,{headers,signal,cache:'no-store',method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});
 const data=await r.json().catch(()=>({error:'No pudimos conectar. Intenta de nuevo.'}));
 if(!r.ok){const e=new Error(data.error);e.status=r.status;throw e;}
 return data;
}
function setOptions(select,options){
 const selected=select.value;
 select.replaceChildren(...options.map(([id,label])=>new Option(label,id)));
 if(options.some(([id])=>id===selected))select.value=selected;
}
const waitLabel=([min,max])=>max===0?'Sin espera':min+' a '+max+' min';
const money=new Intl.NumberFormat('es-DO',{style:'currency',currency:'DOP',maximumFractionDigits:2});
function bookingOptions(form,s){
 setOptions(form.elements.serviceId,s.services.map(v=>[v.id,v.name+' · '+v.minutes+' min'+(v.price==null?'':' · '+money.format(v.price))]));
 setOptions(form.elements.chairId,s.chairs.map(v=>[v.id,v.name]));
 form.querySelector('.chairField').hidden=s.mode!=='individual';
}
function field(label,value,type='text',required=true){
 const el=element('label',label),input=document.createElement('input');
 input.type=type;input.value=value??'';input.required=required;el.append(input);return [el,input];
}
function addChair(chair={}){
 const row=element('div',null,'row'),[label,input]=field('Nombre del sillón',chair.name);row.dataset.id=chair.id||'';
 input.maxLength=35;row.append(label,button('Quitar sillón',()=>row.remove(),true));$('chairSettings').append(row);
}
function addService(service={}){
 const row=element('fieldset',null,'card'),[name,n]=field('Servicio',service.name),[time,t]=field('Minutos',service.minutes??30,'number'),[price,p]=field('Precio RD$ (opcional)',service.price,'number',false);
 row.dataset.id=service.id||'';
 n.maxLength=45;t.min=5;t.max=180;p.min=0;p.max=100000;p.step='.01';
 row.append(name,time,price,button('Quitar servicio',()=>row.remove(),true));$('serviceSettings').append(row);
}
function settings(s){
 const form=$('settings');form.elements.name.value=s.name;form.elements.phone.value=s.phone;form.elements.mode.value=s.mode;
 form.elements.noShowMinutes.value=s.noShowMinutes;form.elements.autoSkip.checked=s.autoSkip;
 $('chairSettings').replaceChildren();s.chairs.forEach(addChair);
 $('serviceSettings').replaceChildren();s.services.forEach(addService);
 form.elements.hoursEnabled.checked=s.hours.enabled;form.elements.hoursFrom.value=s.hours.from;form.elements.hoursTo.value=s.hours.to;
 const days=$('hoursDays');days.querySelectorAll('label').forEach(v=>v.remove());
 weekdays.forEach((day,i)=>{
   const label=element('label',null,'consent'),input=document.createElement('input');
   input.type='checkbox';input.name='day';input.value=i;input.checked=s.hours.days.includes(i);
   label.append(input,element('span',day));days.append(label);
 });
}
const weekdays=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
function priceLabel(v){return v.price==null?'':money.format(v.price);}
function publicRender(s){
 document.title=s.name+' · Turno Listo';msg('shopName',s.name);
 msg('publicHours',s.hours.enabled?s.hours.days.map(d=>weekdays[d]).join(', ')+' · '+s.hours.from+' a '+s.hours.to:'Consulta la disponibilidad de hoy en la fila.');
 $('publicServices').replaceChildren(...s.services.map(v=>{
   const li=element('li',null,'row');li.append(element('span',v.name+' · '+v.minutes+' min'),element('strong',priceLabel(v)));return li;
 }));
 const occupied=s.busy||s.waiting>0;
 msg('tag',!s.open?'Pausada':occupied?'Atendiendo':'Disponible');
 msg('headline',!s.open?'Por ahora no recibimos turnos':occupied?'Hay gente en turno':'Puedes pasar');
 msg('detail',!s.open?'Consulta más tarde o escríbenos por WhatsApp.':occupied?'Anótate y consulta tu posición desde aquí.':'Ahora mismo no hay nadie en la fila.');
 msg('count',s.waiting);msg('estimate',s.open?waitLabel(s.range):'—');
 $('join').hidden=!s.open||!!s.own;
 bookingOptions($('join'),s);
 $('own').hidden=!s.own;
 if(s.own)msg('ownText',s.own.status==='waiting'?'Posición '+s.own.position+' · '+waitLabel(s.own.range):s.own.status==='called'?'¡Te toca! Pasa a la barbería.':'Ya estás en el sillón.');
 if(s.own&&token)$('saveTicket').href='https://wa.me/?text='+encodeURIComponent('Mi turno: '+personalLink());
 $('leave').hidden=s.own?.status!=='waiting';
 $('wa').hidden=!s.phone;
 if(s.phone)$('wa').href='https://wa.me/'+s.phone+'?text='+encodeURIComponent('Hola, vi la fila de la barbería. ¿Puedo pasar?');
}
async function refreshPublic(){
 if(saving||polling)return;
 const task=polling=new AbortController();
 try{
  const s=await api(publicPath+'/estado',undefined,task.signal);
  if(!task.signal.aborted&&!saving)publicRender(s);
 }catch(e){
  if(task.signal.aborted)return;
  msg('headline',e.status===404?'Todavía no hay una barbería en este enlace':'No pudimos consultar la fila');
  msg('detail',e.message);$('join').hidden=true;
 }finally{if(polling===task)polling=null;}
}
async function publicChange(data){
 const done=beginSave('publicSaving');if(!done)return;
 msg('publicError');
 try{
  const s=await api(publicPath+'/fila',data);
  token=s.token||'';if(token)localStorage.setItem(tokenKey,token);else localStorage.removeItem(tokenKey);
  publicRender(s);if(data.action==='join')$('join').reset();if(data.action==='erase')msg('publicError','Borramos tus datos de la fila.');
 }catch(e){msg('publicError',e.message);}
 finally{done();}
}
function renderQr(slug){
 if(slug===renderedSlug)return;
 renderedSlug=slug;
 const url=new URL('/b/'+slug,location.origin).href;
 $('nav').href=url;$('customerLink').href=url;msg('customerLink',url);
 const qr=qrcode(0,'M');qr.addData(url);qr.make();
 const canvas=$('qr'), pixels=10, margin=4, size=qr.getModuleCount();
 canvas.width=canvas.height=(size+2*margin)*pixels;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';
 for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(qr.isDark(r,c))ctx.fillRect((c+margin)*pixels,(r+margin)*pixels,pixels,pixels);
 $('download').href=canvas.toDataURL('image/png');$('download').download=slug+'-qr.png';
}
function render(s){
 state=s;$('login').hidden=true;$('registerCard').hidden=true;$('controls').hidden=false;
 msg('adminName',s.name);msg('shop',s.receiving?'Recibiendo turnos':s.open?'Fuera de horario':'Recepción pausada');
 msg('toggle',s.open?'Pausar recepción':'Reabrir recepción');
 $('chairs').replaceChildren(...s.chairs.map(chair=>{
   const t=s.active[chair.id], card=element('div',null,'card');
   card.append(element('h2',chair.name),element('p',t?(t.name||'Cliente sin nombre'):'Sillón libre'));
   const next=button('Llamar al siguiente',()=>change('next',{chairId:chair.id}));
   next.disabled=!s.queue.some(v=>s.mode==='shared'||v.chairId===chair.id);
   if(!t)card.append(next);
   else if(t.started)card.append(button('Terminar corte',()=>change('finish',{id:t.id,chairId:chair.id})));
   else{
     const timer=element('p',null,'sub');timer.dataset.deadline=t.deadline;card.append(timer);
     const fields={id:t.id,chairId:chair.id}, actions=element('div',null,'actions');
     actions.append(button('Llegó · Empezar corte',()=>change('start',fields)),
       button('Mandar al final',()=>change('no-show',{...fields,disposition:'back'}),true),
       button('Quitar',()=>change('no-show',{...fields,disposition:'remove'}),true));
     card.append(actions);
   }
   return card;
 }));
 refreshTimers();
 msg('queueHeading','En espera ('+s.queue.length+')');
 $('queue').replaceChildren(...s.queue.map((t,i)=>{
   const li=element('li',null,'row');li.append(element('span',(i+1)+'. '+t.name+' · '+t.minutes+' min'),button('Quitar',()=>change('remove',{id:t.id}),true));return li;
 }));
 if(!s.queue.length)$('queue').append(element('li','Nadie en espera.','quiet'));
 bookingOptions($('add'),s);
 const notices=$('notices');notices.replaceChildren();
 for(const n of s.notices){
   const row=element('li',null,'row');
   const label=n.kind==='soon'?'Avisar que vaya saliendo':'Avisar que ya le toca';
   const a=element('a',label,'btn');a.href=n.url;a.target='_blank';a.rel='noopener';
   row.append(element('span',n.name),a,button('Marcar enviado',()=>change('notice-done',{id:n.id}),true));
   notices.append(row);
 }
 $('noticeCard').hidden=!s.notices.length;
 const st=s.stats;
 $('stats').replaceChildren(element('p','Atendidos hoy: '+st.today+' · Esta semana: '+st.week),
   element('p','Ausencias: '+st.noShows+' · Salieron de la fila: '+st.exits),
   element('p','Hora pico: '+(st.peakHour||'Por calcular')),
   ...st.services.map(v=>element('p',v.name+' · '+(v.avg==null?'Sin cortes registrados':v.avg+' min en promedio')+' · '+v.count+' atendidos')));
 $('statsWa').href='https://wa.me/?text='+encodeURIComponent(st.message);
 renderQr(s.slug);
}
function refreshTimers(){
 for(const el of document.querySelectorAll('[data-deadline]')){
   const seconds=Math.max(0,Math.ceil((Number(el.dataset.deadline)-Date.now())/1000));
   el.textContent=seconds?'Esperando llegada · '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):'Tiempo de llegada vencido';
 }
}
async function refreshAdmin(){
 if(!state||saving||polling)return;
 const task=polling=new AbortController();
 try{
  const s=await api(adminPath,undefined,task.signal);
  if(!task.signal.aborted&&!saving&&(s.revision!==state.revision||s.receiving!==state.receiving||s.stats.message!==state.stats.message))render(s);
 }catch{}
 finally{if(polling===task)polling=null;}
}
async function enter(){
 try{const s=await api(adminPath);render(s);settings(s);$('login').reset();msg('error');}
 catch(e){if(e.status!==401)msg('error',e.message);}
}
async function change(action,fields={}){
 const done=beginSave('saving');if(!done)return false;
 msg('error');
 try{render(await api(adminPath,{action,...fields}));return true;}
 catch(e){msg('error',e.message);return false;}
 finally{done();}
}
if(admin){
 $('admin').hidden=false;$('nav').href='/';msg('nav','Vista de clientes');
 for(const id of ['login','register']){
   const form=$(id);
   form.onsubmit=async e=>{
     e.preventDefault();const done=beginSave('saving');if(!done)return;
     msg('error');
     try{await api('/api/auth/'+id,values(form));form.reset();await enter();}
     catch(error){msg('error',error.message);}
     finally{pending=false;}
   };
 }
 $('toggle').onclick=()=>change('toggle');
 $('add').onsubmit=async e=>{e.preventDefault();if(await change('add',values($('add'))))$('add').reset();};
 $('addChair').onclick=()=>addChair();
 $('addService').onclick=()=>addService();
 $('settings').onsubmit=async e=>{
   e.preventDefault();
   const chairs=[...$('chairSettings').children].map(row=>({id:row.dataset.id,name:row.querySelector('input').value}));
   const services=[...$('serviceSettings').children].map(row=>{const [name,minutes,price]=row.querySelectorAll('input');return {id:row.dataset.id,name:name.value,minutes:minutes.value,price:price.value};});
   const form=$('settings'), f=form.elements;
   const hours={enabled:f.hoursEnabled.checked,from:f.hoursFrom.value,to:f.hoursTo.value,days:[...form.querySelectorAll('input[name=day]:checked')].map(v=>Number(v.value))};
   if(await change('settings',{...values(form),chairs,services,hours,autoSkip:f.autoSkip.checked})){settings(state);msg('shareStatus','Ajustes guardados.');}
 };
 $('logout').onclick=async()=>{try{await api('/api/auth/logout',{});location.reload();}catch(e){msg('error',e.message);}};
 $('copyStats').onclick=async()=>{try{await navigator.clipboard.writeText(state.stats.message);msg('statsStatus','Resumen copiado.');}catch{msg('statsStatus',state.stats.message);}};
 $('copyLink').onclick=async()=>{const link=$('customerLink').href;try{await navigator.clipboard.writeText(link);msg('shareStatus','Enlace copiado.');}catch{msg('shareStatus',link);}};
 enter();
 setInterval(refreshTimers,1000);setInterval(refreshAdmin,5000);
}else{
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
