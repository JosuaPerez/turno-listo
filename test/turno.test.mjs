import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {route,newShop} from '../api.mjs';
import {localRepository} from '../local-db.mjs';
import {predict,range,serviceMinutes} from '../estimates.mjs';
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
 assert.equal((await req('/api/auth/login',{body:{...credentials,password:'no coincide'}})).status,401);
 const login=await req('/api/auth/login',{body:credentials});assert.equal(login.status,200);
 assert.equal((await req('/api/agenda',{session:login.cookie.split(';')[0]})).data.slug,'uno');
 const join=(name,phone)=>req('/api/b/uno/fila',{body:{name,phone,action:'join',serviceId:'corte',consent:true}});
 assert.equal((await req('/api/b/uno/fila',{body:{action:'join',name:'x',phone:'8095550101',serviceId:'corte'}})).status,409);
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
