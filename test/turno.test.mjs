import test from 'node:test';
import {NotificationProvider,dispatchNotices} from '../notifications.mjs';
import {issueReset} from '../password-reset.mjs';
import {secureResponse} from '../security.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {route,newShop} from '../api.mjs';
import {localRepository} from '../local-db.mjs';
import {predict,range,serviceMinutes,record} from '../estimates.mjs';
import {validHours,reception,summarize} from '../stats.mjs';
import {makePassword,verifyPassword} from '../auth.mjs';

test('calcula en paralelo, limita la espera a su fila y aprende tras tres cortes',()=>{
 const now=Date.now(),s=newShop('prueba','Prueba');
 s.chairs.push({id:'dos',name:'Sillón 2'});
 s.active.principal={started:now-10*60000,minutes:30};
 const a={serviceId:'corte',minutes:30,chairId:'principal'}, b={serviceId:'corte',minutes:30,chairId:'dos'};
 s.queue=[a,b];
 assert.deepEqual(range(predict(s,a,now)),[0,0]);
 assert.deepEqual(range(predict(s,b,now)),[20,25]);
 s.mode='individual';
 assert.equal(predict(s,a,now),20);assert.equal(predict(s,b,now),0);
 for(const minutes of [15,20])s.history.push({chairId:'dos',serviceId:'corte',outcome:'served',minutes});
 assert.equal(serviceMinutes(s,'corte','dos',30),30);
 s.history.push({chairId:'dos',serviceId:'corte',outcome:'served',minutes:25});
 assert.equal(serviceMinutes(s,'corte','dos',30),20);
 assert.equal(serviceMinutes(s,'corte','principal',30),30);
});

test('hash de Cloudflare usa un secreto separado y mantiene compatibilidad local',async()=>{
 const password='clave larga de prueba';
 const v2=await makePassword(password,'pepper-de-prueba');
 assert.match(v2,/^v2:/);
 assert.equal(await verifyPassword(password,v2,'pepper-de-prueba'),true);
 assert.equal(await verifyPassword(password,v2,'otro-pepper'),false);
 const local=await makePassword(password);
 assert.equal(await verifyPassword(password,local,'otro-pepper'),true);
});

test('horario y resumen usan el día local de Santo Domingo',()=>{
 const s=newShop('prueba','Prueba');
 s.hours=validHours({enabled:true,days:[1],from:'09:00',to:'19:00'});
 const open=Date.parse('2026-11-09T13:00:00Z');
 assert.equal(reception(s,open-1),false);assert.equal(reception(s,open),true);
 assert.equal(reception(s,Date.parse('2026-11-09T23:00:00Z')),false);
 s.open=false;assert.equal(reception(s,open),false);
 s.history.push({outcome:'served',at:open,started:open,minutes:20,serviceId:'corte'},{outcome:'no-show',at:open+1},{outcome:'left',at:open+1});
 const stats=summarize(s,open+2);
 assert.equal(stats.today,1);assert.equal(stats.week,1);assert.equal(stats.peakHour,'lunes 09:00');
 assert.equal(stats.noShows,1);assert.equal(stats.exits,1);
});

test('alta, duplicados, aislamiento, concurrencia, avisos, ausencias y privacidad',async()=>{
 const dir=mkdtempSync(tmpdir()+'/turno-test-');
 const repo=localRepository(dir);
 const credentials={email:'uno@example.test',password:'una clave larga y de prueba'};
 const env={TURNO_RATE_SALT:'salt-for-local-test'};
 let cookie='';
 async function req(path,{body,token,session='',ip='192.0.2.1',origin}={}){
  const headers={};
  if(token)headers['X-Turno-Token']=token;
  if(session)headers.Cookie=session;
  if(origin)headers.Origin=origin;
  const result=await route(new Request('https://example.test'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),repo,env,ip);
  return {status:result.status,data:await result.json(),cookie:result.headers.get('Set-Cookie')};
 }
 async function action(action,extra={}){return req('/api/agenda',{session:cookie,body:{action,...extra}});}
 const register=await req('/api/auth/register',{body:{...credentials,slug:'uno',name:'Barbería Uno'}});
 assert.equal(register.status,200);assert.match(register.cookie,/HttpOnly; SameSite=Strict.*Secure/);
 cookie=register.cookie.split(';')[0];
 const hash=await makePassword('otra clave larga de prueba');
 assert.equal(await repo.createAccount({slug:'dos',email:'dos@example.test',hash},newShop('dos','Barbería Dos')),true);
 assert.equal((await req('/api/agenda')).status,401);
 assert.equal((await action('qr-shared')).data.qrShared,true);
 assert.equal((await req('/api/agenda',{session:cookie})).data.qrShared,true);
 assert.equal((await action('add',{name:' A ',serviceId:'corte'})).status,400);
 assert.equal((await req('/api/auth/login',{body:{...credentials,password:'no coincide'}})).status,401);
 const conflict=await req('/api/auth/register',{body:{...credentials,slug:'libre',name:'Otra barbería'}});
 assert.equal(conflict.status,409);assert.equal(conflict.data.error,'No pudimos crear la cuenta con esos datos.');
 const occupied=await req('/api/auth/register',{body:{...credentials,email:'otra@example.test',slug:'uno',name:'Otra barbería'}});
 assert.equal(occupied.status,409);assert.equal(occupied.data.error,'Ese enlace ya está en uso.');
 const login=await req('/api/auth/login',{body:credentials});assert.equal(login.status,200);
 assert.equal((await req('/api/agenda',{session:login.cookie.split(';')[0]})).data.slug,'uno');
 const join=(name,phone)=>req('/api/b/uno/fila',{body:{name,phone,action:'join',serviceId:'corte',consent:true}});
 assert.equal((await req('/api/b/uno/fila',{body:{action:'join',name:'Ax',phone:'8095550101',serviceId:'corte'}})).status,409);
 assert.equal((await join('A','8095550101')).status,400);
 const first=await join('Ana','809 555 0101'),second=await join('Juan','8295550102');
 assert.equal(first.status,200);assert.equal(second.data.own.position,2);
 assert.equal((await join('Duplicado','+1 (809) 555-0101')).status,409);
 assert.equal((await req('/api/b/dos/estado',{token:first.data.token})).data.own,null);
 assert.equal((await req('/api/b/dos/estado')).data.waiting,0);
 const publicView=await req('/api/b/uno/estado');
 assert.doesNotMatch(JSON.stringify(publicView.data),/Ana|Juan|18095550101/);
 const a=await Promise.all([action('next',{chairId:'principal'}),action('next',{chairId:'principal'})]);
 assert.deepEqual(a.map(x=>x.status).sort(),[200,409]);
 let current=a.find(x=>x.status===200).data.active.principal;
 assert.equal(current.name,'Ana');
 assert.match(a.find(x=>x.status===200).data.notices.find(n=>n.kind==='called').url,/wa\.me\/18095550101/);
 assert.equal((await req('/api/b/uno/estado',{token:first.data.token})).data.own.status,'called');
 const back=await action('no-show',{chairId:'principal',id:current.id,disposition:'back'});
 assert.deepEqual(back.data.queue.map(t=>t.name),['Juan','Ana']);assert.equal(back.data.stats.noShows,1);
 const called=await action('next',{chairId:'principal'});
 current=called.data.active.principal;
 assert.equal((await action('start',{chairId:'principal',id:current.id})).status,200);
 assert.equal((await action('finish',{chairId:'principal',id:current.id})).data.stats.today,1);
 const erase=await req('/api/b/uno/fila',{token:first.data.token,body:{action:'erase'}});
 assert.equal(erase.data.own,null);assert.equal((await req('/api/agenda',{session:cookie})).data.queue.length,0);
 assert.equal((await join('Persona expirada','8495550103')).status,200);
 const store=repo.shop('uno'),s=await store.read(),rev=s.revision++;
 s.queue[0].joined=Date.now()-86400001;
 assert.equal(await store.write(s,rev),true);
 assert.equal((await req('/api/b/uno/estado')).data.waiting,0);
 assert.doesNotMatch(JSON.stringify(await store.read()),/Persona expirada|18495550103/);
 const setup=await req('/api/agenda',{session:cookie});
 const settings=setup.data;
 assert.equal((await action('settings',{...settings,autoSkip:true})).status,200);
 assert.equal((await join('No llegó','8495550104')).status,200);
 assert.equal((await action('next',{chairId:'principal'})).status,200);
 const expired=await store.read(),old=expired.revision++;
 expired.active.principal.deadline=Date.now()-1;
 assert.equal(await store.write(expired,old),true);
 assert.equal((await req('/api/agenda',{session:cookie})).data.stats.noShows,2);
 assert.equal((await req('/api/agenda',{session:cookie,origin:'https://other.test',body:{action:'toggle'}})).status,403);
 let limited;
 for(let i=0;i<21;i++)limited=await req('/api/b/uno/fila',{body:{action:'invalid'},ip:'192.0.2.9'});
 assert.equal(limited.status,429);
 await req('/api/auth/logout',{session:cookie,body:{}});
 assert.equal((await req('/api/agenda',{session:cookie})).status,401);
});

test('avisa una sola vez con sillón ocupado y espera corta',async()=>{
 const repo=localRepository(mkdtempSync(tmpdir()+'/turno-notices-'));
 const s=newShop('avisos','Avisos');
 const now=Date.now();
 s.queue=[{id:'t',name:'Cliente',phone:'18095550101',joined:now,minutes:15,serviceId:'corte'}];
 await repo.createAccount({slug:'avisos',email:'avisos@example.test',hash:await makePassword(crypto.randomUUID())},s);
 const get=()=>route(new Request('http://localhost/api/b/avisos/estado'),repo);
 const store=repo.shop('avisos');
 await get();
 let shop=await store.read();assert.equal(shop.notices.length,0);
 shop.active.principal={id:'active',joined:now,started:now-20*60000,minutes:30};
 assert.equal(await store.write({...shop,revision:shop.revision+1},shop.revision),true);
 await get();await get();
 shop=await store.read();
 assert.deepEqual(shop.notices.map(n=>n.id),['t:soon']);
 shop.notices=[];
 assert.equal(await store.write({...shop,revision:shop.revision+1},shop.revision),true);
 await get();assert.equal((await store.read()).notices.length,0);
});
test('Worker sin invitación bloquea el registro',async()=>{
 const response=await route(new Request('https://example.test/api/auth/register',{method:'POST'}),{}, {TURNO_RUNTIME:'worker'});
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'El registro no está habilitado');
});

test('las cabeceras protegen HTML, assets y API sin quitar cookies',()=>{
 for(const type of ['text/html','text/css','application/json']){
  const response=secureResponse(new Response('ok',{headers:{'Content-Type':type,'Set-Cookie':'example=1'}}),true);
  assert.equal(response.headers.get('Content-Type'),type);
  assert.equal(response.headers.get('Set-Cookie'),'example=1');
  assert.match(response.headers.get('Content-Security-Policy'),/script-src 'self';.*frame-ancestors 'none'/);
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(response.headers.get('X-Frame-Options'),'DENY');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.match(response.headers.get('Strict-Transport-Security'),/max-age=/);
 }
 assert.equal(secureResponse(new Response()).headers.has('Strict-Transport-Security'),false);
});

test('un enlace de recuperación cambia la contraseña e invalida las sesiones',async()=>{
 const repo=localRepository(mkdtempSync(tmpdir()+'/turno-reset-'));
 const env={TURNO_MAINTENANCE_KEY:crypto.randomUUID(),TURNO_PASSWORD_PEPPER:crypto.randomUUID()};
 const password=crypto.randomUUID(), next=crypto.randomUUID(), email='reset@example.test';
 const req=(path,body,headers={})=>route(new Request('https://example.test'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers}),repo,env);
 const register=await req('/api/auth/register',{slug:'reset',name:'Reset',email,password});
 assert.equal(register.status,200);
 const session=register.headers.get('Set-Cookie').split(';')[0];
 assert.equal((await req('/api/admin/reset',{email})).status,404);
 const issue=await req('/api/admin/reset',{email},{Authorization:'Bearer '+env.TURNO_MAINTENANCE_KEY});
 const {link,expires}=await issue.json();
 assert.ok(expires-Date.now()>29*60000);
 const token=new URLSearchParams(new URL(link).hash.slice(1)).get('t');
 assert.equal((await req('/api/auth/reset',{token,password:next})).status,200);
 assert.equal((await req('/api/agenda',null,{Cookie:session})).status,401);
 assert.equal((await req('/api/auth/login',{email,password})).status,401);
 assert.equal((await req('/api/auth/login',{email,password:next})).status,200);
});
test('ingresos estimados usan el precio al atender y el historial no conserva datos personales',()=>{
 const now=Date.parse('2026-11-10T15:00:00Z'), s=newShop('cortes','Cortes');
 const t={id:crypto.randomUUID(),name:'Cliente Privado',phone:'18095550101',token:crypto.randomUUID(),serviceId:'corte',started:now-30*60000,joined:now-40*60000};
 record(s,t,'principal','served',now-86400000);
 assert.equal(summarize(s,now).week_revenue,null);
 assert.doesNotMatch(summarize(s,now).message,/Ingresos/);
 s.services[0].price=350.25;
 record(s,t,'principal','served',now);
 s.services[0].price=900;
 record(s,t,'principal','no-show',now);
 const result=summarize(s,now);
 assert.equal(result.today_revenue,350.25);assert.equal(result.week_revenue,350.25);
 assert.match(result.message,/Ingresos estimados: RD\$ 350.25/);
 assert.equal(s.history[1].serviceName,'Corte');
 for(const entry of s.history)for(const key of ['name','phone','token','id'])assert.equal(Object.hasOwn(entry,key),false);
});

test('WhatsApp automático confirma éxito y ofrece modo manual ante rechazo o timeout',async()=>{
 const env={WA_ACCESS_TOKEN:crypto.randomUUID(),WA_PHONE_NUMBER_ID:'123',WA_API_VERSION:'v1.0',WA_TEMPLATE_SOON:'turno_pronto',WA_TEMPLATE_CALLED:'turno_listo'};
 for(const [status,expected] of [[200,'sent'],[403,'manual'],['timeout','manual']]){
  let s={revision:0,notices:[{id:'turno:called',kind:'called',status:'pending',phone:'18095550101'}]},calls=0;
  const store={
   read:()=>structuredClone(s),
   write:(next,revision)=>{if(s.revision!==revision)return false;s=structuredClone(next);return true;}
  };
  const provider=new NotificationProvider(env,async(url,options)=>{
   calls++;
   assert.match(url,/^https:\/\/graph\.facebook\.com\//);
   assert.equal(JSON.parse(options.body).template.name,env.WA_TEMPLATE_CALLED);
   assert.ok(options.signal instanceof AbortSignal);
   if(status==='timeout')throw new DOMException('Tiempo agotado','TimeoutError');
   return new Response(null,{status});
  });
  await Promise.all([dispatchNotices(store,provider),dispatchNotices(store,provider)]);
  assert.equal(s.notices[0].status,expected);
  assert.equal(calls,1);
 }
});

test('rechaza ajustes inválidos y evita perder servicios con turnos activos',async()=>{
 const repo=localRepository(mkdtempSync(tmpdir()+'/turno-settings-'));
 const env={TURNO_PASSWORD_PEPPER:crypto.randomUUID()};
 const call=(path,body,cookie)=>route(new Request('https://example.test'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers:cookie?{Cookie:cookie}:{}}),repo,env);
 const registered=await call('/api/auth/register',{slug:'ajustes',name:'Ajustes',email:'ajustes@example.test',password:crypto.randomUUID()});
 const cookie=registered.headers.get('Set-Cookie').split(';')[0];
 const shop=await (await call('/api/agenda',null,cookie)).json();
 const settings=fields=>call('/api/agenda',{...shop,action:'settings',...fields},cookie);
 for(const fields of [
  {services:[]},{services:[{name:'Corte',minutes:181}]},{services:[{name:'Corte',minutes:30,price:-1}]},
  {services:Array.from({length:13},(_,i)=>({name:'Servicio '+i,minutes:30}))},
  {chairs:[]},{chairs:Array.from({length:9},(_,i)=>({name:'Sillón '+i}))},
  {mode:'invalido'},{hours:{enabled:true,days:[1],from:'19:00',to:'09:00'}},
  {hours:{enabled:true,days:[7],from:'09:00',to:'19:00'}},{noShowMinutes:31},{phone:'123'}
 ])assert.equal((await settings(fields)).status,400,JSON.stringify(fields));
 assert.equal((await settings({services:[{...shop.services[0],price:'350.25'}]})).status,200);
 assert.equal((await call('/api/agenda',{action:'add',name:'Cliente',serviceId:shop.services[0].id},cookie)).status,200);
 assert.equal((await settings({services:[{name:'Servicio nuevo',minutes:30}]})).status,409);
});

test('caducan turnos y avisos sin exponer datos de otras personas',async()=>{
 const repo=localRepository(mkdtempSync(tmpdir()+'/turno-privacy-'));
 const s=newShop('privado','Barbería privada'), now=Date.now(), old=now-86400001;
 const privateToken=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const turn=(id,name,phone,joined)=>({id,name,phone,joined,minutes:30,serviceId:'corte',token:privateToken(),soonNotified:true});
 const first=turn('first','Persona Uno','18095550101',now);
 const second=turn('second','Persona Dos','18295550102',now);
 const expired=turn('expired','Persona Vieja','18495550103',old);
 const called=turn('called','Persona Ausente','18495550104',old);
 s.queue=[first,second,expired];
 s.active.principal={...called,deadline:old+300000};
 s.notices=[
  {id:'first:soon',kind:'soon',status:'manual',created:old,name:first.name,phone:first.phone},
  {id:'second:soon',kind:'soon',status:'manual',created:now,name:second.name,phone:second.phone}
 ];
 await repo.createAccount({slug:s.slug,email:'privado@example.test',hash:await makePassword(crypto.randomUUID())},s);
 const view=async token=>route(new Request('http://localhost/api/b/privado/estado',{headers:token?{'X-Turno-Token':token}:{}}),repo);
 for(const token of ['',first.token]){
  const response=await view(token), body=await response.text();
  for(const t of [first,second,expired,called])for(const value of [t.name,t.phone,t.token])assert.equal(body.includes(value),false);
  assert.equal(JSON.parse(body).own?.position,token?1:undefined);
 }
 const remaining=await repo.shop(s.slug).read();
 assert.deepEqual(remaining.queue.map(t=>t.id),['first','second']);
 assert.deepEqual(Object.keys(remaining.active),[]);
 assert.deepEqual(remaining.notices.map(n=>n.id),['second:soon']);
});

test('restablecimiento caduca, es atómico al reusar y limita intentos',async()=>{
 const repo=localRepository(mkdtempSync(tmpdir()+'/turno-reset-limits-'));
 const env={TURNO_PASSWORD_PEPPER:crypto.randomUUID()};
 const s=newShop('recuperar','Recuperar'), email='recuperar@example.test';
 await repo.createAccount({slug:s.slug,email,hash:await makePassword(crypto.randomUUID(),env.TURNO_PASSWORD_PEPPER)},s);
 const origin='https://example.test';
 const code=async now=>new URLSearchParams(new URL((await issueReset(repo,email,origin,now)).link).hash.slice(1)).get('t');
 const reset=(token,ip)=>route(new Request(origin+'/api/auth/reset',{method:'POST',body:JSON.stringify({token,password:crypto.randomUUID()})}),repo,env,ip);
 const expired=await code(Date.now()-30*60000-1);
 assert.equal((await reset(expired,'192.0.2.1')).status,410);
 const active=await code(Date.now());
 const statuses=(await Promise.all([reset(active,'192.0.2.1'),reset(active,'192.0.2.1')])).map(r=>r.status).sort();
 assert.deepEqual(statuses,[200,410]);
 for(let i=0;i<8;i++)assert.equal((await reset(expired,'192.0.2.2')).status,410);
 assert.equal((await reset(expired,'192.0.2.2')).status,429);
});
