const $=id=>document.getElementById(id);
const admin=location.pathname==='/barbero';
const publicSlug=location.pathname.split('/')[2]||'turno-listo';
const tokenKey='turno-ticket:'+publicSlug;
let key=sessionStorage.getItem('turno-key')||'', token=localStorage.getItem(tokenKey)||'', state, pending=false, renderedSlug;
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
async function api(path,body){
 const headers={};
 if(path===adminPath&&key)headers.Authorization='Bearer '+key;
 if(path.startsWith(publicPath)&&token)headers['X-Turno-Token']=token;
 if(body)headers['Content-Type']='application/json';
 const r=await fetch(path,{headers,cache:'no-store',method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});
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
function addChair(name=''){
 const row=element('div',null,'row'),[label,input]=field('Nombre del sillón',name);
 input.maxLength=35;row.append(label,button('Quitar sillón',()=>row.remove(),true));$('chairSettings').append(row);
}
function addService(service={}){
 const row=element('fieldset',null,'card'),[name,n]=field('Servicio',service.name),[time,t]=field('Minutos',service.minutes??30,'number'),[price,p]=field('Precio RD$ (opcional)',service.price,'number',false);
 n.maxLength=45;t.min=5;t.max=180;p.min=0;p.max=100000;p.step='.01';
 row.append(name,time,price,button('Quitar servicio',()=>row.remove(),true));$('serviceSettings').append(row);
}
function settings(s){
 const form=$('settings');form.elements.phone.value=s.phone;form.elements.mode.value=s.mode;
 form.elements.noShowMinutes.value=s.noShowMinutes;form.elements.autoSkip.checked=s.autoSkip;
 $('chairSettings').replaceChildren();s.chairs.forEach(c=>addChair(c.name));
 $('serviceSettings').replaceChildren();s.services.forEach(addService);
}
function publicRender(s){
 msg('shopName',s.name+' · Santo Domingo');
 const occupied=s.busy||s.waiting>0;
 msg('tag',!s.open?'Pausada':occupied?'Atendiendo':'Disponible');
 msg('headline',!s.open?'Por ahora no recibimos turnos':occupied?'Hay gente en turno':'Puedes pasar');
 msg('detail',!s.open?'Consulta más tarde o escríbenos por WhatsApp.':occupied?'Anótate y consulta tu posición desde aquí.':'Ahora mismo no hay nadie en la fila.');
 msg('count',s.waiting);msg('estimate',s.open?waitLabel(s.range):'—');
 $('join').hidden=!s.open||!!s.own;
 bookingOptions($('join'),s);
 $('own').hidden=!s.own;
 if(s.own)msg('ownText',s.own.status==='waiting'?'Posición '+s.own.position+' · '+waitLabel(s.own.range):s.own.status==='called'?'¡Te toca! Pasa a la barbería.':'Ya estás en el sillón.');
 $('leave').hidden=s.own?.status!=='waiting';
 $('wa').hidden=!s.phone;
 if(s.phone)$('wa').href='https://wa.me/'+s.phone+'?text='+encodeURIComponent('Hola, vi la fila de la barbería. ¿Puedo pasar?');
}
async function refreshPublic(){
 if(pending)return;
 pending=true;
 try {publicRender(await api(publicPath+'/estado'));}
 catch(e){msg('headline','No pudimos consultar la fila');msg('detail',e.message);$('join').hidden=true;}
 finally{pending=false;}
}
async function publicChange(data){
 if(pending)return;
 pending=true;msg('publicError');
 try{
  const s=await api(publicPath+'/fila',data);
  token=s.token||'';if(token)localStorage.setItem(tokenKey,token);else localStorage.removeItem(tokenKey);
  publicRender(s);if(data.action==='join')$('join').reset();
 }catch(e){msg('publicError',e.message);}
 finally{pending=false;}
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
 state=s;$('login').hidden=true;$('controls').hidden=false;
 msg('adminName',s.name);msg('shop',s.open?'Recibiendo turnos':'Recepción pausada');
 msg('toggle',s.open?'Pausar recepción':'Reabrir recepción');
 $('chairs').replaceChildren(...s.chairs.map(chair=>{
   const t=s.active[chair.id], card=element('div',null,'card');
   card.append(element('h2',chair.name),element('p',t?t.name:'Sillón libre'));
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
 renderQr(s.slug);
}
function refreshTimers(){
 for(const el of document.querySelectorAll('[data-deadline]')){
   const seconds=Math.max(0,Math.ceil((Number(el.dataset.deadline)-Date.now())/1000));
   el.textContent=seconds?'Esperando llegada · '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):'Tiempo de llegada vencido';
 }
}
async function refreshAdmin(){
 if(!state||pending)return;
 pending=true;
 try{const s=await api(adminPath);if(s.revision!==state.revision)render(s);}
 catch{}
 finally{pending=false;}
}
async function enter(){
 try{const s=await api(adminPath);render(s);settings(s);sessionStorage.setItem('turno-key',key);$('login').reset();msg('error');}
 catch(e){msg('error',e.message);}
}
async function change(action,fields={}){
 if(pending)return false;
 pending=true;msg('error');
 try{render(await api(adminPath,{action,...fields}));return true;}
 catch(e){msg('error',e.message);return false;}
 finally{pending=false;}
}
if(admin){
 $('admin').hidden=false;$('nav').href='/';msg('nav','Vista de clientes');
 $('login').onsubmit=e=>{e.preventDefault();key=values($('login')).password.trim();enter();};
 $('toggle').onclick=()=>change('toggle');
 $('add').onsubmit=async e=>{e.preventDefault();if(await change('add',values($('add'))))$('add').reset();};
 $('addChair').onclick=()=>addChair();
 $('addService').onclick=()=>addService();
 $('settings').onsubmit=async e=>{
   e.preventDefault();
   const chairs=[...$('chairSettings').querySelectorAll('input')].map(v=>v.value);
   const services=[...$('serviceSettings').children].map(row=>{const [name,minutes,price]=row.querySelectorAll('input');return {name:name.value,minutes:minutes.value,price:price.value};});
   if(await change('settings',{...values($('settings')),chairs,services,autoSkip:$('settings').elements.autoSkip.checked})){settings(state);msg('shareStatus','Ajustes guardados.');}
 };
 $('logout').onclick=()=>{sessionStorage.removeItem('turno-key');location.reload();};
 $('copyLink').onclick=async()=>{const link=$('customerLink').href;try{await navigator.clipboard.writeText(link);msg('shareStatus','Enlace copiado.');}catch{msg('shareStatus',link);}};
 if(key)enter();
 setInterval(refreshTimers,1000);setInterval(refreshAdmin,5000);
}else{
 $('client').hidden=false;
 $('join').onsubmit=e=>{e.preventDefault();const data=values($('join'));publicChange({...data,consent:data.consent==='on',action:'join'});};
 $('leave').onclick=()=>publicChange({action:'leave'});
 refreshPublic();setInterval(refreshPublic,5000);
}
