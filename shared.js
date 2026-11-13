const $=id=>document.getElementById(id);
const values=form=>Object.fromEntries(new FormData(form));
const msg=(id,text='')=>{$(id).textContent=text;};
function button(label, action, secondary=false){
 const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;
 if(secondary)b.className='secondary';return b;
}
function element(tag,value,cls){
 const el=document.createElement(tag); if(value!=null)el.textContent=value;if(cls)el.className=cls;return el;
}
async function api(path,body,signal,token){
 const headers={};
 if(token)headers['X-Turno-Token']=token;
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
const clockLabel=m=>m<60?m+' min':Math.floor(m/60)+' h'+(m%60?' '+m%60+' min':'');
const waitLabel=([min,max])=>max===0?'Sin espera':clockLabel(min)+' a '+clockLabel(max);
const money=new Intl.NumberFormat('es-DO',{style:'currency',currency:'DOP',maximumFractionDigits:2});
const rd=new Intl.NumberFormat('es-DO',{minimumFractionDigits:2,maximumFractionDigits:2});
function bookingOptions(form,s){
 setOptions(form.elements.serviceId,s.services.map(v=>[v.id,v.name+' · '+v.minutes+' min'+(v.price==null?'':' · '+money.format(v.price))]));
 const chair=form.querySelector('select[name=chairId]');
 if(chair){setOptions(chair,[...(s.mode==='shared'?[['','Cualquiera']]:[]),...s.chairs.map(v=>[v.id,v.name])]);form.querySelector('.chairField').hidden=s.chairs.length<2;}
}

export {$,values,msg,button,element,api,waitLabel,money,rd,bookingOptions};
export function saves(root,status){
 let saving=false,polling;
 return {
  beginSave(){
   if(saving)return null;
   saving=true;polling?.abort();msg(status,'Guardando…');
   const buttons=[...root.querySelectorAll('button:not(:disabled)')];
   buttons.forEach(b=>b.disabled=true);
   return ()=>{saving=false;buttons.forEach(b=>b.disabled=false);msg(status);};
  },
  beginPoll(){
   if(saving||polling)return null;
   return polling=new AbortController();
  },
  endPoll(task){if(polling===task)polling=null;}
 };
}
