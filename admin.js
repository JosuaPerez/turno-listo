import {$,msg,api,values,element,button,rd,bookingOptions,saves} from './shared.js';

const adminPath='/api/v1/agenda';
const tabs=['fila','compartir','estadisticas','ajustes'];
const dayNames=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const localDay=new Intl.DateTimeFormat('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'short'});
const gate=saves($('admin'),'saving');
let state, selected='fila', settingsSnapshot, settingsDirty=false, qrPromise, qrSlug;
let audio, unread=0, noticeTimer;
const soundKey='turno-new-turn-sound';
function soundEnabled(){
 try{return localStorage.getItem(soundKey)!=='off';}catch{return true;}
}
function unlockAudio(){
 if(!soundEnabled())return;
 const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
 if(!Context)return;
 try{audio??=new Context();if(audio.state==='suspended')void audio.resume().catch(()=>{});}catch{}
}
function updateTitle(){
 if(selected==='fila'&&!document.hidden)unread=0;
 document.title=unread?'('+unread+') Turno Listo':'Turno Listo';
}
function announceTurns(added){
 if(!added.length)return;
 unread+=added.length;
 updateTitle();
 msg('newTurnNotice',added.length===1?'Se anotó '+added[0].name:'Se anotaron '+added.length+' clientes');
 $('newTurnNotice').hidden=false;
 clearTimeout(noticeTimer);
 noticeTimer=setTimeout(()=>{$('newTurnNotice').hidden=true;},4500);
 try{navigator.vibrate?.(100);}catch{}
 if(!soundEnabled()||audio?.state!=='running')return;
 const tone=audio.createOscillator(), volume=audio.createGain();
 tone.frequency.value=740;volume.gain.value=.12;
 tone.connect(volume);volume.connect(audio.destination);
 tone.start();tone.stop(audio.currentTime+.15);
}
const currency=value=>'RD$ '+rd.format(value??0);
const shareUrl=url=>'https://wa.me/?text='+encodeURIComponent('Anótate en la fila de la barbería: '+url);
const customerUrl=slug=>new URL('/b/'+slug,location.origin).href;
const serviceName=(s,id)=>s.services.find(service=>service.id===id)?.name||'Servicio';
const hasPrices=s=>s.services.some(v=>v.price!=null);
const dismissKey=()=> 'turno-qr-dismissed:'+state.slug;

function selectTab(){
 const key=location.hash.slice(1);
 const next=tabs.includes(key)?key:'fila';
 if(next!==key)history.replaceState(null,'','#fila');
 if(selected!==next)window.scrollTo(0,0);
 selected=next;
 updateTitle();
 for(const tab of tabs){
  $('panel-'+tab).hidden=tab!==selected;
  $('tab-'+tab).setAttribute('aria-selected',String(tab===selected));
  $('tab-'+tab).tabIndex=tab===selected?0:-1;
 }
 document.body.classList.toggle('with-dock',selected==='fila'&&!$('nextBar').hidden);
 syncSaveButton();
 if(selected==='compartir'&&state)void renderQr(state.slug);
}

function setupTabs(){
 $('panelTabs').onclick=event=>{
  const tab=event.target.closest('[role=tab]');
  if(tab)location.hash=tab.id.slice(4);
 };
 $('panelTabs').onkeydown=event=>{
  const index=tabs.indexOf(selected);
  const move={ArrowLeft:(index+3)%4,ArrowRight:(index+1)%4,Home:0,End:3}[event.key];
  if(move===undefined)return;
  event.preventDefault();
  location.hash=tabs[move];
  $('tab-'+tabs[move]).focus();
 };
 window.addEventListener('hashchange',selectTab);
 selectTab();
}

function loadQr(){
 if(globalThis.qrcode)return Promise.resolve();
 if(!qrPromise)qrPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src='/assets/qrcode.js';
  script.onload=()=>resolve();
  script.onerror=()=>{script.remove();qrPromise=null;reject(Error('No pudimos cargar el QR.'));};
  document.head.append(script);
 });
 return qrPromise;
}

async function renderQr(slug){
 if(qrSlug===slug)return;
 try{
  await loadQr();
  if(qrSlug===slug)return;
  const qr=globalThis.qrcode(0,'M');
  qr.addData(customerUrl(slug));qr.make();
  const canvas=$('qr'), pixels=10, margin=4, size=qr.getModuleCount();
  canvas.width=canvas.height=(size+2*margin)*pixels;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(qr.isDark(r,c))ctx.fillRect((c+margin)*pixels,(r+margin)*pixels,pixels,pixels);
  $('download').href=canvas.toDataURL('image/png');$('posterQr').src=$('download').href;$('download').download=slug+'-qr.png';
  qrSlug=slug;
 }catch(error){msg('shareStatus',error.message);}
}

function shareLink(label,url,primary=false){
 const link=element('a',label,primary?'btn':'btn secondary');
 link.href=url;link.target='_blank';link.rel='noopener noreferrer';
 return link;
}

function markQr(){
 if(state&&!state.qrShared)void change('qr-shared');
}

function tile(label,value){
 const node=element('div',null,'metric-tile');
 node.append(element('span',label),element('strong',value));return node;
}

function renderMetrics(s){
 const stats=s.stats;
 const wait=stats.todayWait==null?'—':stats.todayWait+' min';
 const revenue=hasPrices(s);
 $('todaySummary').replaceChildren(tile('Atendidos hoy',stats.today),tile('Espera promedio',wait),
  ...(revenue?[tile('Ingresos',currency(stats.today_revenue))]:[]));
 const today=localDay.format(Date.now()), todays=s.history.filter(entry=>localDay.format(entry.at)===today);
 const todayNoShows=todays.filter(entry=>entry.outcome==='no-show').length;
 const todayExits=todays.filter(entry=>entry.outcome==='left').length;
 function period(label,served,amount,noShows,exits){
  const card=element('section',null,'card'), tiles=element('div',null,'stats-tiles');
  tiles.append(tile('Atendidos',served),...(revenue?[tile('Ingresos',currency(amount))]:[]),tile('Ausencias',noShows),tile('Salidas',exits));
  card.append(element('h3',label),tiles);return card;
 }
 const serviceCard=element('section',null,'card'), table=element('table',null,'stats-table');
 const header=table.createTHead().insertRow();
 for(const label of ['Servicio','Atendidos','Min promedio'])header.append(element('th',label));
 const body=table.createTBody();
 for(const service of stats.services){
  const row=body.insertRow();
  for(const value of [service.name,service.count,service.avg??'—'])row.append(element('td',value));
 }
 serviceCard.append(element('h3','Por servicio'),table);
 const peak=element('section',null,'card');
 peak.append(element('h3','Hora pico'),element('p',stats.peakHour||'Por calcular'));
 $('stats').replaceChildren(
  period('Hoy',stats.today,stats.today_revenue,todayNoShows,todayExits),
  period('Esta semana',stats.week,stats.week_revenue,stats.noShows,stats.exits),peak,serviceCard
 );
 $('statsWa').href='https://wa.me/?text='+encodeURIComponent(stats.message);
}

function renderChairs(s){
 $('chairs').replaceChildren(...s.chairs.map(chair=>{
  const t=s.active[chair.id], card=element('section',null,'card chair-card'), top=element('div',null,'chair-top');
  top.append(element('h2',chair.name),element('span',!t?'Libre':t.started?'En el sillón':'Esperando llegada','chair-status'));
  card.append(top);
  if(!t)return card;
  card.append(element('p',t.name||'Cliente sin nombre','chair-client'));
  const timing=element('div',null,'chair-meta');
  timing.append(element('span',serviceName(s,t.serviceId),'quiet'));
  const timer=element('p',null,'chair-timer');
  if(t.started)timer.dataset.started=t.started;
  else timer.dataset.deadline=t.deadline;
  const fields={id:t.id,chairId:chair.id}, actions=element('div',null,'actions');
  if(t.started){
   const eligible=s.queue.some(v=>s.mode==='shared'||v.chairId===chair.id);
   if(eligible)actions.append(button('Terminar y llamar al siguiente',()=>change('finish-next',fields)));
   actions.append(button('Terminar corte',()=>change('finish',fields),eligible));
  }
  else actions.append(button('Llegó · Empezar corte',()=>change('start',fields)),
   button('Mandar al final',()=>change('no-show',{...fields,disposition:'back'}),true),
   button('Quitar',()=>change('no-show',{...fields,disposition:'remove'}),true));
  timing.append(timer);card.append(timing,actions);
  return card;
 }));
 const eligible=s.chairs.filter(chair=>!s.active[chair.id]&&s.queue.some(t=>s.mode==='shared'||t.chairId===chair.id));
 $('nextBar').replaceChildren(...eligible.map(chair=>button(s.chairs.length===1?'Llamar al siguiente':'Llamar · '+chair.name,()=>change('next',{chairId:chair.id}))));
 $('nextBar').hidden=eligible.length===0;
 refreshTimers();
}

function renderQueue(s){
 msg('queueHeading','En espera ('+s.queue.length+')');
 const rows=s.queue.map((t,i)=>{
  const row=element('li',null,'row'), info=element('div',null,'queue-info');
  info.append(element('strong',(i+1)+'. '+t.name),element('small',serviceName(s,t.serviceId)+' · '+t.minutes+' min'));
  const remove=button('Quitar',()=>change('remove',{id:t.id}),true);
  remove.setAttribute('aria-label','Quitar a '+t.name);
  row.append(info,remove);return row;
 });
 if(!rows.length){
  const empty=element('li','Comparte tu QR para que tus clientes se anoten.','quiet');
  const actions=element('div',null,'actions'), link=shareLink('Compartir por WhatsApp',shareUrl(customerUrl(s.slug)));
  link.onclick=markQr;actions.append(link);empty.append(actions);rows.push(empty);
 }
 $('queue').replaceChildren(...rows);
 bookingOptions($('add'),s);
 $('notices').replaceChildren(...s.notices.map(n=>{
  const row=element('li',null,'notice-row'), actions=element('div',null,'actions');
  actions.append(shareLink(n.kind==='soon'?'Avisar que vaya saliendo':'Avisar turno',n.url,true),
   button('Marcar enviado',()=>change('notice-done',{id:n.id}),true));
  row.append(element('strong',n.name),actions);
  return row;
 }));
 $('noticeCard').hidden=!s.notices.length;
}

function render(s){
 state=s;
 for(const id of ['accessHeading','login','registerCard','forgot'])$(id).hidden=true;
 $('controls').hidden=false;
 msg('adminName',s.name);msg('posterShop',s.name);msg('posterUrl',customerUrl(s.slug));

 msg('shop',s.receiving?'Recibiendo':s.open?'Fuera de horario':'Pausada');
 $('toggle').setAttribute('aria-pressed',String(s.open));
 $('toggle').classList.toggle('receiving',s.receiving);
 const url=customerUrl(s.slug);
 $('nav').href=url;$('customerLink').href=url;msg('customerLink',url);$('shareWa').href=shareUrl(url);
 $('qrBanner').hidden=s.qrShared||sessionStorage.getItem(dismissKey())==='true';
 renderMetrics(s);renderChairs(s);renderQueue(s);selectTab();
}

function refreshTimers(){
 for(const el of document.querySelectorAll('[data-deadline], [data-started]')){
  const now=Date.now(), started=Number(el.dataset.started);
  const delta=started?Math.floor((now-started)/1000):Math.ceil((Number(el.dataset.deadline)-now)/1000);
  const seconds=Math.max(0,delta);
  const clock=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
  el.textContent=started?'En atención · '+clock:seconds?'Llega en · '+clock:'Tiempo de llegada vencido';
 }
}

function input(label,value,type='text',required=true){
 const field=document.createElement('input');
 field.type=type;field.value=value??'';field.required=required;field.setAttribute('aria-label',label);
 return field;
}

function removableRow(className,id,label){
 const row=element('div',null,className);
 row.dataset.id=id||'';
 const remove=button('×',()=>{row.remove();updateDirty();},true);
 remove.classList.add('icon');remove.setAttribute('aria-label',label);
 return [row,remove];
}

function addChair(chair={}){
 const [row,remove]=removableRow('chair-editor',chair.id,'Quitar sillón');
 const name=input('Nombre del sillón',chair.name);
 name.maxLength=35;row.append(name,remove);$('chairSettings').append(row);
}

function addService(service={}){
 const [row,remove]=removableRow('service-editor',service.id,'Quitar servicio');
 const name=input('Nombre del servicio',service.name), time=input('Minutos del servicio',service.minutes??30,'number');
 const price=input('Precio RD$ del servicio',service.price,'number',false);
 name.maxLength=45;time.min=5;time.max=180;price.min=0;price.max=100000;price.step='.01';
 row.append(name,time,price,remove);$('serviceSettings').append(row);
}

function settingsPayload(){
 const form=$('settings'), f=form.elements;
 const {name,phone,mode,noShowMinutes}=values(form);
 const chairs=[...$('chairSettings').children].map(row=>({id:row.dataset.id,name:row.querySelector('input').value}));
 const services=[...$('serviceSettings').children].map(row=>{
  const [name,minutes,price]=row.querySelectorAll('input');
  return {id:row.dataset.id,name:name.value,minutes:minutes.value,price:price.value};
 });
 const hours={enabled:f.hoursEnabled.checked,from:f.hoursFrom.value,to:f.hoursTo.value,
  days:[...form.querySelectorAll('input[name=day]:checked')].map(v=>Number(v.value))};
 return {name,phone,mode,noShowMinutes,chairs,services,hours,autoSkip:f.autoSkip.checked};
}

function syncSaveButton(){
 const save=$('saveSettings');
 save.hidden=selected!=='ajustes'||!settingsDirty;
 $('panelBottom').classList.toggle('has-save',!save.hidden);
}

function updateDirty(){
 settingsDirty=JSON.stringify(settingsPayload())!==settingsSnapshot;
 $('saveSettings').disabled=!settingsDirty;
 syncSaveButton();
 msg('settingsStatus');
}

function fillSettings(s){
 const form=$('settings'), f=form.elements;
 f.name.value=s.name;f.phone.value=s.phone;f.mode.value=s.mode;f.noShowMinutes.value=s.noShowMinutes;f.autoSkip.checked=s.autoSkip;
 $('chairSettings').replaceChildren();s.chairs.forEach(addChair);
 $('serviceSettings').replaceChildren();s.services.forEach(addService);
 f.hoursEnabled.checked=s.hours.enabled;f.hoursFrom.value=s.hours.from;f.hoursTo.value=s.hours.to;
 $('dayChips').replaceChildren(...dayNames.map((name,i)=>{
  const label=element('label',null,'day-chip'), field=input(name,'','checkbox',false);
  field.name='day';field.value=i;field.checked=s.hours.days.includes(i);
  label.append(field,element('span',name[0]));return label;
 }));
 settingsSnapshot=JSON.stringify(settingsPayload());updateDirty();
}

async function refreshAdmin(){
 if(!state)return;
 const task=gate.beginPoll();if(!task)return;
 try{
  const s=await api(adminPath,undefined,task.signal);
  if(!task.signal.aborted&&(s.revision!==state.revision||s.receiving!==state.receiving||s.stats.message!==state.stats.message)){
   const known=new Set([...state.queue,...Object.values(state.active)].map(t=>t.id));
   const added=s.queue.filter(t=>!known.has(t.id));
   render(s);announceTurns(added);
  }
 }catch{}
 finally{gate.endPoll(task);}
}

async function enter(){
 try{
  const s=await api(adminPath);
  render(s);fillSettings(s);$('login').reset();msg('error');
 }catch(e){if(e.status!==401)msg('error',e.message);}
}

async function change(action,fields={}){
 const done=gate.beginSave();if(!done)return false;
 try{msg('error');render(await api(adminPath,{action,...fields}));return true;}
 catch(e){msg('error',e.message);return false;}
 finally{done();}
}

async function copy(value,status,onCopy){
 try{await navigator.clipboard.writeText(value);msg(status,'Copiado.');onCopy?.();}
 catch{msg(status,value);}
}

export function startAdmin(){
 $('admin').hidden=false;$('nav').hidden=false;$('barberFooter').hidden=true;
 document.body.classList.add('admin-page');setupTabs();
 for(const id of ['login','register']){
  const form=$(id);
  form.onsubmit=async e=>{
   e.preventDefault();const done=gate.beginSave();if(!done)return;
   try{msg('error');await api('/api/v1/auth/'+id,values(form));form.reset();await enter();}
   catch(error){msg('error',error.message);}
   finally{done();}
  };
 }
 $('toggle').onclick=()=>change('toggle');
 $('showQr').onclick=()=>{location.hash='compartir';};
 $('dismissQr').onclick=()=>{sessionStorage.setItem(dismissKey(),'true');$('qrBanner').hidden=true;};
 $('add').onsubmit=async e=>{e.preventDefault();if(await change('add',values($('add'))))$('add').reset();};
 $('addChair').onclick=()=>{addChair();updateDirty();};
 $('addService').onclick=()=>{addService();updateDirty();};
 $('settings').oninput=updateDirty;
 $('settings').onchange=updateDirty;
 $('settings').onsubmit=async e=>{
  e.preventDefault();if($('saveSettings').disabled)return;
  if(await change('settings',settingsPayload())){fillSettings(state);msg('settingsStatus','Guardado.');}
  else msg('settingsStatus',$('error').textContent);
 };
 $('logout').onclick=async()=>{try{await api('/api/v1/auth/logout',{});location.reload();}catch(e){msg('error',e.message);}};
 $('copyStats').onclick=()=>copy(state.stats.message,'statsStatus');
 $('printPoster').onclick=async()=>{await renderQr(state.slug);if(qrSlug===state.slug)window.print();};
 $('download').onclick=markQr;$('shareWa').onclick=markQr;
 $('copyLink').onclick=()=>copy($('customerLink').href,'shareStatus',markQr);
 $('turnSound').checked=soundEnabled();
 $('turnSound').onchange=()=>{
  try{localStorage.setItem(soundKey,$('turnSound').checked?'on':'off');}catch{}
  if($('turnSound').checked)unlockAudio();
 };
 document.addEventListener('click',unlockAudio);
 document.addEventListener('visibilitychange',updateTitle);
 enter();setInterval(refreshTimers,1000);setInterval(refreshAdmin,5000);
}
