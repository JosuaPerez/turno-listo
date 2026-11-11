export const firstChair={id:'principal',name:'Sillón 1'};
export function chairAccepts(s,t,chair){
  return s.mode==='shared'||t.chairId===chair.id;
}
export function nextFor(s,chair){
  return s.queue.find(t=>chairAccepts(s,t,chair));
}
export function serviceMinutes(s,serviceId,chairId,fallback){
  const last=s.history.filter(h=>h.serviceId===serviceId&&h.chairId===chairId&&h.outcome==='served'&&h.minutes>0).slice(-12);
  return last.length<3?fallback:Math.round(last.reduce((sum,h)=>sum+h.minutes,0)/last.length);
}
export function range(minutes){
  if(minutes<=0)return [0,0];
  const start=Math.floor(minutes/5)*5;
  return [start,Math.max(5,start+5)];
}
export function predict(s,target,now=Date.now()){
  const chairs=s.chairs.map(chair=>{
    const active=s.active[chair.id];
    return {chair,free:active?Math.max(0,Math.ceil(((active.started||Math.max(active.deadline||now,now))+active.minutes*60000-now)/60000)):0};
  });
  const ordered=target?s.queue.slice(0,s.queue.indexOf(target)):s.queue;
  for(const t of ordered){
    const seat=chairs.filter(c=>chairAccepts(s,t,c.chair)).sort((a,b)=>a.free-b.free)[0];
    if(seat)seat.free+=serviceMinutes(s,t.serviceId,seat.chair.id,t.minutes);
  }
  return Math.min(...chairs.filter(c=>!target||chairAccepts(s,target,c.chair)).map(c=>c.free));
}
export function record(s,t,chairId,outcome,now=Date.now()){
  s.history.push({chairId,serviceId:t.serviceId,outcome,at:now,minutes:t.started?Math.max(0.1,(now-t.started)/60000):0});
  s.history=s.history.slice(-3000);
}
