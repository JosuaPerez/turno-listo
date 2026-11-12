export function notificationUrl(phone,message){
  return 'https://wa.me/'+phone+'?text='+encodeURIComponent(message);
}
const messages={
  soon:'Te toca en ~15 min, ve saliendo hacia la barbería',
  called:'Es tu turno, pasa por favor'
};
export class NotificationProvider {
  constructor(env={},fetcher=fetch){this.env=env;this.fetcher=fetcher;}
  get automatic(){
    const e=this.env;
    return Boolean(e.WA_ACCESS_TOKEN&&e.WA_PHONE_NUMBER_ID&&/^v\d+\.\d+$/.test(e.WA_API_VERSION||'')&&e.WA_TEMPLATE_SOON&&e.WA_TEMPLATE_CALLED);
  }
  present(item){
    return {id:item.id,kind:item.kind,name:item.name,url:notificationUrl(item.phone,messages[item.kind]),status:item.status};
  }
  async send(item){
    if(!this.automatic)return false;
    const e=this.env;
    const result=await this.fetcher('https://graph.facebook.com/'+e.WA_API_VERSION+'/'+encodeURIComponent(e.WA_PHONE_NUMBER_ID)+'/messages',{
      method:'POST',headers:{Authorization:'Bearer '+e.WA_ACCESS_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',to:item.phone,type:'template',template:{name:item.kind==='soon'?e.WA_TEMPLATE_SOON:e.WA_TEMPLATE_CALLED,language:{code:e.WA_LANGUAGE||'es'}}}),
      signal:AbortSignal.timeout(3500)
    });
    return result.ok;
  }
}
export function enqueueNotice(s,t,kind,now=Date.now()){
  if(!t.phone)return;
  s.notices??=[];
  if(s.notices.some(n=>n.id===t.id+':'+kind))return;
  s.notices.push({id:t.id+':'+kind,kind,phone:t.phone,name:t.name,created:now,status:'pending'});
}
export async function dispatchNotices(store,provider){
  if(!provider.automatic)return;
  for(let i=0;i<3;i++){
    const s=await store.read();
    if(!s)return;
    const n=s.notices?.find(n=>n.status==='pending');
    if(!n)return;
    n.status='sending';
    const revision=s.revision++;
    if(!await store.write(s,revision))continue;
    let sent=false;
    try{sent=await provider.send(n);}catch{}
    for(let attempt=0;attempt<5;attempt++){
      const latest=await store.read(), current=latest?.notices?.find(v=>v.id===n.id);
      if(!current||current.status!=='sending')break;
      current.status=sent?'sent':'manual';
      const revision=latest.revision++;
      if(await store.write(latest,revision))break;
    }
  }
}
