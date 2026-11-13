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
import {makePassword,verifyPassword,digest} from '../auth.mjs';

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

test('consultar una fila estable no escribe y devuelve la revisión',async()=>{
 const s={...newShop('poll','Poll'),revision:7};
 let reads=0, writes=0, rateWrites=0;
 const repo={
  rate:()=>{rateWrites++;return 1;},
  shop:()=>({read:()=>{reads++;return structuredClone(s);},write:()=>{writes++;return true;}})
 };
 const get=()=>route(new Request('https://example.test/api/b/poll/estado'),repo,{},'192.0.2.22');
 assert.equal((await (await get()).json()).revision,7);
 assert.equal((await (await get()).json()).revision,7);
 assert.equal(reads,2);assert.equal(writes,0);assert.equal(rateWrites,0);
});

test('v1 y el alias ejecutan la misma acción con cabeceras de transición',async()=>{
 const repo=localRepository(mkdtempSync(tmpdir()+'/turno-version-'));
 const env={TURNO_PASSWORD_PEPPER:crypto.randomUUID()};
 const call=(path,body,session)=>route(new Request('https://example.test'+path,{
  method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers:session?{Cookie:session}:{}
 }),repo,env);
 const registration=await call('/api/v1/auth/register',{slug:'version',name:'Versión',email:'version@example.test',password:crypto.randomUUID()});
 assert.equal(registration.status,200);
 const cookie=registration.headers.get('Set-Cookie').split(';')[0];
 for(const [path,deprecated,open] of [['/api/v1/agenda',null,false],['/api/agenda','true',true]]){
  const result=await call(path,{action:'toggle'},cookie);
  assert.equal(result.status,200);
  assert.equal(result.headers.get('X-Turno-API'),'1');
  assert.equal(result.headers.get('Deprecation'),deprecated);
  assert.equal((await result.json()).open,open);
 }
 const old=await call('/api/agenda');
 assert.equal(old.status,401);assert.equal(old.headers.get('X-Turno-API'),'1');assert.equal(old.headers.get('Deprecation'),'true');
 const future=await call('/api/v2/agenda');
 assert.equal(future.status,404);assert.equal(future.headers.get('X-Turno-API'),'1');assert.equal(future.headers.get('Deprecation'),null);
 const closed=await route(new Request('https://example.test/api/v1/auth/register',{method:'POST'}),{}, {TURNO_RUNTIME:'worker'});
 assert.equal(closed.status,503);assert.equal(closed.headers.get('X-Turno-API'),'1');
});

test('Bearer comparte expiración, revocación y aislamiento con la sesión de la barbería',async()=>{
 const repo=localRepository(mkdtempSync(tmpdir()+'/turno-bearer-'));
 const env={TURNO_PASSWORD_PEPPER:crypto.randomUUID()};
 const origin='https://example.test', outsider='https://otro.example.test';
 const email='bearer@example.test', password=crypto.randomUUID();
 const prefix='/api/v1';
 const call=(path,{body,cookie,bearer,from,turn,ip='192.0.2.11'}={})=>{
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(bearer!==undefined)headers.Authorization='Bearer '+bearer;
  if(from)headers.Origin=from;
  if(turn)headers['X-Turno-Token']=turn;
  return route(new Request(origin+prefix+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers}),repo,env,ip);
 };
 const registered=await call('/auth/register',{body:{slug:'bearer',name:'Barbería Bearer',email,password,token:true}});
 assert.equal(registered.status,200);
 const initial=await registered.json();
 assert.match(initial.token,/^[a-f0-9]{64}$/);
 assert.equal(typeof initial.expires,'number');
 assert.ok(initial.expires>Date.now());
 const web=await call('/auth/login',{body:{email,password}});
 assert.equal(web.status,200);
 assert.deepEqual(await web.json(),{ok:true,slug:'bearer'});
 const cookie=web.headers.get('Set-Cookie').split(';')[0];
 assert.equal((await call('/agenda',{cookie})).status,200);
 const native=await call('/auth/login',{body:{email,password,token:true}});
 assert.equal(native.status,200);
 const credentials=await native.json(), bearer=credentials.token;
 const agenda=await call('/agenda',{bearer});
 assert.equal(agenda.status,200);
 assert.equal((await agenda.json()).slug,'bearer');
 assert.equal((await call('/agenda',{cookie,body:{action:'toggle'},from:outsider})).status,403);
 assert.equal((await call('/agenda',{bearer,cookie,body:{action:'toggle'},from:outsider})).status,200);
 assert.equal((await call('/agenda',{bearer,cookie,body:{action:'toggle'},from:outsider})).status,200);
 assert.equal((await call('/auth/login',{bearer,body:{email,password,token:true},from:outsider})).status,403);
 const fake=crypto.randomUUID().replaceAll('-','').repeat(2);
 assert.equal((await call('/agenda',{bearer:'inválido',cookie})).status,401);
 assert.equal((await call('/agenda',{bearer:fake,cookie})).status,401);
 const account=await repo.account(email);
 assert.equal(await repo.createSession(await digest(fake),account.slug,Date.now()-1,account.password_hash),true);
 assert.equal((await call('/agenda',{bearer:fake})).status,401);
 const joined=await call('/b/bearer/fila',{body:{action:'join',name:'Cliente Prueba',phone:'8095550101',serviceId:'corte',consent:true}});
 assert.equal(joined.status,200);
 const {token:turn}=await joined.json();
 assert.equal((await call('/agenda',{bearer:turn})).status,401);
 assert.equal((await call('/b/bearer/estado',{bearer})).status,401);
 assert.equal((await (await call('/b/bearer/estado',{turn:bearer})).json()).own,null);
 assert.equal((await (await call('/b/bearer/estado',{turn})).json()).own.position,1);
 assert.equal((await call('/auth/logout',{bearer,cookie,body:{},from:outsider})).status,200);
 assert.equal((await call('/agenda',{bearer})).status,401);
 assert.equal((await call('/agenda',{cookie})).status,200);
 const issued=await issueReset(repo,email,origin);
 const reset=new URLSearchParams(new URL(issued.link).hash.slice(1)).get('t');
 assert.equal((await call('/auth/reset',{body:{token:reset,password:crypto.randomUUID()}})).status,200);
 assert.equal((await call('/agenda',{bearer:initial.token})).status,401);
 assert.equal((await call('/agenda',{cookie})).status,401);
 for(let i=0;i<10;i++){
  const attempt=await call('/auth/login',{body:{email,password,token:i%2===0},ip:'192.0.2.12'});
  assert.equal(attempt.status,401);
 }
 assert.equal((await call('/auth/login',{body:{email,password,token:true},ip:'192.0.2.12'})).status,429);
});

test('finish-next termina y llama con una sola revisión en cada modo',async()=>{
 for(const mode of ['shared','individual','empty']){
  const repo=localRepository(mkdtempSync(tmpdir()+'/turno-finish-'));
  const shop=newShop('prueba','Prueba'), now=Date.now();
  const hash=await makePassword(crypto.randomUUID(),crypto.randomUUID());
  const credential=crypto.randomUUID().replaceAll('-','').repeat(2);
  shop.mode=mode==='individual'?'individual':'shared';
  shop.chairs.push({id:'otro',name:'Otro'});
  shop.active.principal={id:'actual',name:'Actual',serviceId:'corte',started:now-12*60000,joined:now-14*60000};
  if(mode!=='empty')shop.queue=[
   {id:'primero',name:'Primero',chairId:'otro',serviceId:'corte',minutes:30,joined:now},
   {id:'segundo',name:'Segundo',chairId:'principal',serviceId:'corte',minutes:30,joined:now}];
  await repo.createAccount({slug:shop.slug,email:'prueba@example.test',hash},shop);
  await repo.createSession(await digest(credential),shop.slug,now+60000,hash);
  const finish=()=>route(new Request('https://example.test/api/v1/agenda',{method:'POST',headers:{Authorization:'Bearer '+credential},body:JSON.stringify({action:'finish-next',chairId:'principal',id:'actual'})}),repo);
  const responses=await Promise.all([finish(),finish()]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const after=await repo.shop(shop.slug).read();
  assert.equal(after.revision,1);
  assert.equal(after.active.principal?.id,mode==='empty'?undefined:mode==='shared'?'primero':'segundo');
  assert.equal(after.queue.length,mode==='empty'?0:1);
  assert.equal(after.history.length,1);
  assert.equal(after.history[0].outcome,'served');
  assert.ok(after.history[0].minutes>=12&&after.history[0].minutes<13);
 }
});

test('una barbería existente se considera configurada y el registro nuevo empieza pendiente',async()=>{
 const repo=localRepository(mkdtempSync(tmpdir()+'/turno-onboarding-'));
 const old=newShop('vieja','Vieja');delete old.onboarded;
 const pepper=crypto.randomUUID();
 await repo.createAccount({slug:old.slug,email:'vieja@example.test',hash:await makePassword(crypto.randomUUID(),pepper)},old);
 assert.equal((await repo.shop(old.slug).read()).onboarded,true);
 const register=await route(new Request('http://localhost/api/v1/auth/register',{method:'POST',body:JSON.stringify({slug:'nueva',name:'Nueva',email:'nueva@example.test',password:crypto.randomUUID()})}),repo,{TURNO_PASSWORD_PEPPER:pepper});
 assert.equal(register.status,200);
 assert.equal((await repo.shop('nueva').read()).onboarded,false);
});

test('pausas y reorden mantienen los límites del sillón, la revisión y el historial',async()=>{
 const repo=localRepository(mkdtempSync(tmpdir()+'/turno-pause-'));
 const shop=newShop('prueba','Prueba'), now=Date.now();
 const hash=await makePassword(crypto.randomUUID(),crypto.randomUUID());
 const credential=crypto.randomUUID().replaceAll('-','').repeat(2);
 shop.mode='individual';shop.chairs.push({id:'otro',name:'Otro'});
 const ticket=(id,chairId)=>({id,name:id,chairId,serviceId:'corte',minutes:30,joined:now});
 shop.queue=[ticket('uno','principal'),ticket('otro','otro'),ticket('dos','principal')];
 shop.queue[2].soonNotified=true;
 await repo.createAccount({slug:shop.slug,email:'pausa@example.test',hash},shop);
 await repo.createSession(await digest(credential),shop.slug,now+120000,hash);
 const call=body=>route(new Request('https://example.test/api/v1/agenda',{method:'POST',headers:{Authorization:'Bearer '+credential},body:JSON.stringify(body)}),repo);
 assert.equal((await call({action:'reorder',id:'uno',direction:'up',revision:0})).status,400);
 const moves=await Promise.all([
  call({action:'reorder',id:'dos',direction:'first',revision:0}),
  call({action:'reorder',id:'dos',direction:'up',revision:0})
 ]);
 assert.deepEqual(moves.map(r=>r.status).sort(),[200,409]);
 const store=repo.shop(shop.slug);
 let current=await store.read();
 assert.deepEqual(current.queue.map(t=>t.id),['dos','otro','uno']);
 assert.equal(current.queue[0].soonNotified,true);
 assert.equal((await call({action:'pause',chairId:'principal',minutes:10})).status,200);
 current=await store.read();
 assert.deepEqual(range(predict(current,current.queue[0],current.chairs[0].pausedUntil-10*60000)),[10,15]);
 assert.equal(predict(current,current.queue[1]),0);
 assert.equal((await call({action:'next',chairId:'principal'})).status,409);
 assert.equal((await call({action:'next',chairId:'otro'})).status,200);
 current=await store.read();
 assert.deepEqual(current.history.map(h=>h.outcome),['reorder','pause']);
 for(const h of current.history)assert.equal('name' in h||'phone' in h||'token' in h,false);
 const revision=current.revision;current.chairs[0].pausedUntil=Date.now()-1;current.revision++;
 assert.equal(await store.write(current,revision),true);
 assert.equal((await call({action:'next',chairId:'principal'})).status,200);
 assert.equal((await store.read()).active.principal.id,'dos');
});
