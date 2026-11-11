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
const waitLabel=minutes=>minutes===0?'Sin espera':minutes+' min';
function publicRender(s){
 msg('shopName',s.name+' · Santo Domingo');
 const occupied=s.busy||s.waiting>0;
 msg('tag',!s.open?'Pausada':occupied?'Atendiendo':'Disponible');
 msg('headline',!s.open?'Por ahora no recibimos turnos':occupied?'Hay gente en turno':'Puedes pasar');
 msg('detail',!s.open?'Consulta más tarde o escríbenos por WhatsApp.':occupied?'Anótate y consulta tu posición desde aquí.':'Ahora mismo no hay nadie en la fila.');
 msg('count',s.waiting);msg('estimate',s.open?waitLabel(s.minutes):'—');
 $('join').hidden=!s.open||!!s.own;
 setOptions($('join').elements.serviceId,s.services.map(v=>[v.id,v.name]));
 $('own').hidden=!s.own;
 if(s.own)msg('ownText',s.own.status==='waiting'?'Posición '+s.own.position+' · '+waitLabel(s.own.minutes):'Ya estás en el sillón.');
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
 const card=element('div',null,'card');
 card.append(element('h2','En el sillón'),element('p',s.current?s.current.name:'Sillón libre'));
 const next=button('Llamar al siguiente',()=>change('next'));next.disabled=!!s.current||!s.queue.length;
 card.append(s.current?button('Terminar turno',()=>change('finish',{id:s.current.id})):next);
 $('chairs').replaceChildren(card);
 msg('queueHeading','En espera ('+s.queue.length+')');
 $('queue').replaceChildren(...s.queue.map((t,i)=>{
   const li=element('li',null,'row');li.append(element('span',(i+1)+'. '+t.name+' · '+t.minutes+' min'),button('Quitar',()=>change('remove',{id:t.id}),true));return li;
 }));
 if(!s.queue.length)$('queue').append(element('li','Nadie en espera.','quiet'));
 setOptions($('add').elements.serviceId,s.services.map(v=>[v.id,v.name]));
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
async function enter(){
 try{const s=await api(adminPath);render(s);$('settings').elements.phone.value=s.phone;sessionStorage.setItem('turno-key',key);$('login').reset();msg('error');}
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
 $('settings').onsubmit=async e=>{e.preventDefault();if(await change('settings',values($('settings'))))msg('shareStatus','Ajustes guardados.');};
 $('logout').onclick=()=>{sessionStorage.removeItem('turno-key');location.reload();};
 $('copyLink').onclick=async()=>{const link=$('customerLink').href;try{await navigator.clipboard.writeText(link);msg('shareStatus','Enlace copiado.');}catch{msg('shareStatus',link);}};
 if(key)enter();
}else{
 $('client').hidden=false;
 $('join').onsubmit=e=>{e.preventDefault();const data=values($('join'));publicChange({...data,consent:data.consent==='on',action:'join'});};
 $('leave').onclick=()=>publicChange({action:'leave'});
 refreshPublic();setInterval(refreshPublic,5000);
}
