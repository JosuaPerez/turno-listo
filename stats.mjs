const weekdays=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
// Santo Domingo uses UTC−4 all year.
const localDate=now=>new Date(now-4*3600000);
const timeFormat=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function validHours(v){
  if(!v||v.enabled!==true)return {enabled:false,from:'09:00',to:'19:00',days:[1,2,3,4,5,6]};
  if(!timeFormat.test(v.from)||!timeFormat.test(v.to)||v.from>=v.to||!Array.isArray(v.days)||!v.days.length||v.days.some(d=>!Number.isInteger(d)||d<0||d>6))return null;
  return {enabled:true,from:v.from,to:v.to,days:[...new Set(v.days)].sort()};
}
export function reception(s,now=Date.now()){
  if(!s.open)return false;
  if(!s.hours.enabled)return true;
  const d=localDate(now), time=String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');
  return s.hours.days.includes(d.getUTCDay())&&time>=s.hours.from&&time<s.hours.to;
}
function estimatedRevenue(entries){
  const priced=entries.filter(e=>Number.isFinite(e.price));
  return priced.length?priced.reduce((sum,e)=>sum+Math.round(e.price*100),0)/100:null;
}
const rd=new Intl.NumberFormat('es-DO',{minimumFractionDigits:2,maximumFractionDigits:2});
export function summarize(s,now=Date.now()){
  const today=localDate(now), start=today.getTime()-(today.getUTCHours()*3600000+today.getUTCMinutes()*60000+today.getUTCSeconds()*1000+today.getUTCMilliseconds())+4*3600000;
  const week=start-((today.getUTCDay()+6)%7)*86400000;
  const logs=s.history.filter(e=>e.at>=week&&e.at<=now), served=logs.filter(e=>e.outcome==='served');
  const todayEntries=served.filter(e=>e.at>=start);
  const todayServed=todayEntries.length;
  const today_revenue=estimatedRevenue(todayEntries), week_revenue=estimatedRevenue(served);
  const waits=todayEntries.filter(e=>Number.isFinite(e.waitMinutes));
  const todayWait=waits.length?Math.round(waits.reduce((sum,e)=>sum+e.waitMinutes,0)/waits.length):null;
  const services=s.services.map(service=>{
    const entries=served.filter(e=>e.serviceId===service.id);
    return {name:service.name,count:entries.length,avg:entries.length?Math.round(entries.reduce((sum,e)=>sum+e.minutes,0)/entries.length):null};
  });
  const peak=new Map();
  for(const e of served){
    const at=localDate(e.started||e.at), hour=at.getUTCHours(), day=at.getUTCDay();
    const label=weekdays[day]+' '+String(hour).padStart(2,'0')+':00';
    peak.set(label,(peak.get(label)||0)+1);
  }
  const peakHour=[...peak.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  const noShows=logs.filter(e=>e.outcome==='no-show').length, exits=logs.filter(e=>e.outcome==='left').length;
  const message='Esta semana atendiste '+served.length+' clientes. '+(peakHour?'Tu hora pico fue '+peakHour+'. ':'')+(week_revenue===null?'':'Ingresos estimados: RD$ '+rd.format(week_revenue)+'. ')+'Ausencias: '+noShows+'. Salidas de la fila: '+exits+'.';
  return {today:todayServed,todayWait,today_revenue,week_revenue,week:served.length,services,peakHour,noShows,exits,message};
}
