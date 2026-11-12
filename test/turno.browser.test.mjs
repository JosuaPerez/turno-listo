import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const browserHelp='Ejecuta npm ci y npx playwright install chromium';
const bundledEdge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function startBrowser(t){
 let chromium;
 try{({chromium}=await import('playwright'));}
 catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;t.skip(browserHelp);return;}
 const paths=[process.env.TURNO_BROWSER_EXECUTABLE,process.platform==='win32'&&bundledEdge,chromium.executablePath()];
 for(const executablePath of new Set(paths.filter(path=>path&&existsSync(path)))){
  try{
   const browser=await chromium.launch({executablePath});
   t.after(()=>browser.close());
   return browser;
  }catch{}
 }
 t.skip(browserHelp);
}

async function startServer(t){
 const dir=await mkdtemp(join(tmpdir(),'turno-browser-'));
 const env={...process.env,PORT:'0',TURNO_HOST:'127.0.0.1',TURNO_DATA:dir,TURNO_INVITE:''};
 delete env.WA_ACCESS_TOKEN;
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','inherit']});
 t.after(async()=>{
  if(child.exitCode===null&&child.signalCode===null){
   const exited=once(child,'exit');child.kill();await exited;
  }
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 });
 const [line]=await Promise.race([
  once(child.stdout,'data'),
  once(child,'exit').then(([code])=>{throw Error('El servidor se cerró con código '+code);})
 ]);
 const port=line.toString().match(/localhost:(\d+)/)?.[1];
 assert.ok(Number(port),'El servidor debe anunciar el puerto asignado');
 return 'http://127.0.0.1:'+port;
}

async function text(page,selector,fragment){
 await page.waitForFunction(({selector,fragment})=>document.querySelector(selector)?.textContent.includes(fragment),{selector,fragment});
}

async function enabled(page,selector){
 await page.waitForFunction(selector=>{
  const button=document.querySelector(selector);
  return button&&!button.disabled;
 },selector,{timeout:3000});
}

async function observe(page,errors){
 page.setDefaultTimeout(12000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.cspViolations=[];
  document.addEventListener('securitypolicyviolation',event=>window.cspViolations.push(event.violatedDirective+': '+event.blockedURI));
 });
}

async function tab(page,name){
 const control=page.getByRole('tab',{name,exact:true});
 await control.click();
 await page.waitForFunction(id=>document.getElementById(id)?.getAttribute('aria-selected')==='true',await control.getAttribute('id'));
}

async function capturePanels(barber,browser,base){
 const output=process.env.TURNO_SCREENSHOTS_DIR;
 if(!output)return;
 await mkdir(output,{recursive:true});
 await barber.getByRole('button',{name:'Llegó · Empezar corte'}).click();
 await text(barber,'#chairs','En el sillón');
 for(const name of ['Joel Ramírez','Daniel Ortiz']){
  const r=await barber.request.post(base+'/api/v1/agenda',{data:{action:'add',name,serviceId:'corte-barba'}});
  assert.equal(r.status(),200);
 }
 await text(barber,'#queueHeading','En espera (3)');
 const visitor=await browser.newPage({viewport:{width:360,height:740}});
 await visitor.goto(base+'/b/barberia-prueba');
 await text(visitor,'#headline','espera aprox.');
 for(const [width,height] of [[360,740],[390,844]]){
  const size=width+'x'+height;
  await barber.setViewportSize({width,height});
  await visitor.setViewportSize({width,height});
  for(const [name,slug] of [['Fila','fila'],['Compartir','compartir'],['Resumen','estadisticas'],['Ajustes','ajustes']]){
   await tab(barber,name);
   if(slug==='compartir')await barber.waitForFunction(()=>document.getElementById('download').getAttribute('href')?.startsWith('data:image/png'));
   if(slug==='ajustes')await barber.locator('#panel-ajustes').evaluate(panel=>{
    panel.querySelector('details').open=false;
    panel.querySelector('#serviceSection').open=true;
    panel.querySelector('#hoursSection').open=true;
   });
   await barber.evaluate(()=>window.scrollTo(0,0));
   await barber.screenshot({path:join(output,size+'-'+slug+'.png'),animations:'disabled'});
  }
  await visitor.screenshot({path:join(output,size+'-cliente.png'),animations:'disabled'});
 }
}

test('barbero y cliente completan el flujo sin recargar y el polling se reanuda', {timeout:65000},async t=>{
 const browser=await startBrowser(t);
 if(!browser)return;
 const base=await startServer(t);

 const barber=await browser.newPage({viewport:{width:390,height:844}});
 const client=await browser.newPage({viewport:{width:360,height:740}});
 const clientAssets=[];
 client.on('request',request=>clientAssets.push(new URL(request.url()).pathname));
 const errors=[];
 await observe(barber,errors);await observe(client,errors);
 const response=await barber.goto(base+'/barbero');
 const login=barber.locator('#login');
 const initialDocument=await barber.evaluate(()=>performance.timeOrigin);
 const email='barbero@example.test', password=randomUUID();
 await login.getByLabel('Correo').fill(email);
 await login.getByLabel('Contraseña').fill(randomUUID());
 await login.getByRole('button',{name:'Entrar'}).click();
 await text(barber,'#error','Correo o contraseña incorrectos');
 await enabled(barber,'#login button');
 assert.equal(await barber.locator('#saving').textContent(),'');

 await barber.locator('#registerCard summary').click();
 const register=barber.locator('#register');
 await register.getByLabel('Nombre de la barbería').fill('Barbería Prueba');
 await register.getByLabel('Dirección del enlace').fill('barberia-prueba');
 await register.getByLabel('Correo').fill(email);
 await register.getByLabel('Contraseña').fill(password);
 await register.getByRole('button',{name:'Crear barbería'}).click();
 await barber.locator('#controls').waitFor();
 await enabled(barber,'#toggle');
 assert.equal(await barber.evaluate(()=>performance.timeOrigin),initialDocument);
 await barber.locator('#toggle').click();
 await text(barber,'#shop','Pausada');
 await barber.locator('#toggle').click();
 await text(barber,'#shop','Recibiendo');

 assert.equal(await barber.locator('#nextBar').isVisible(),false);
 assert.equal(await barber.locator('#qrBanner').isVisible(),true);
 assert.match(barber.url(),/#fila$/);
 await tab(barber,'Compartir');
 await barber.waitForFunction(()=>document.getElementById('download').getAttribute('href')?.startsWith('data:image/png'));
 await tab(barber,'Resumen');
 await text(barber,'#stats','Hora pico');
 await tab(barber,'Ajustes');
 assert.equal(await barber.locator('#saveSettings').isVisible(),false);
 await barber.locator('#serviceSection summary').click();
 await barber.locator('#serviceSettings input[aria-label="Precio RD$ del servicio"]').first().fill('450');
 await barber.locator('#hoursSection summary').click();
 assert.equal(await barber.locator('#dayChips input').count(),7);
 await barber.setViewportSize({width:360,height:740});
 const days=barber.locator('#dayChips');
 const chips=await days.locator('.day-chip span').evaluateAll(items=>items.map(item=>{
  const {width,height}=item.getBoundingClientRect(), css=getComputedStyle(item);
  return {width,height,border:css.borderTopWidth,borderColor:css.borderTopColor,background:css.backgroundColor};
 }));
 assert.ok(chips.every(chip=>chip.width>=44&&chip.height>=44&&chip.border==='1px'));
 assert.equal(chips[0].borderColor,'rgb(133, 139, 120)');
 assert.equal(chips[1].background,'rgb(218, 255, 135)');
 const sunday=days.locator('.day-chip').first();
 await sunday.click();
 assert.equal(await sunday.locator('input').isChecked(),true);
 assert.equal(await sunday.locator('span').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(218, 255, 135)');
 await sunday.click();
 await enabled(barber,'#saveSettings');
 await barber.setViewportSize({width:360,height:740});
 assert.ok(await barber.locator('#panelTabs button').evaluateAll(tabs=>tabs.every(tab=>parseFloat(getComputedStyle(tab).fontSize)>=12&&tab.scrollWidth<=tab.clientWidth+2)));
 const activeTab=await barber.locator('[role=tab][aria-selected=true]').evaluate(tab=>{
  const style=getComputedStyle(tab);return [style.backgroundColor,style.borderTopColor];
 });
 assert.deepEqual(activeTab,['rgba(0, 0, 0, 0)','rgb(218, 255, 135)']);
 if(process.env.TURNO_SCREENSHOTS_DIR){
  await mkdir(process.env.TURNO_SCREENSHOTS_DIR,{recursive:true});
  await barber.screenshot({path:join(process.env.TURNO_SCREENSHOTS_DIR,'0-barra.png')});
 }
 assert.equal(await barber.locator('#panelBottom #saveSettings').isVisible(),true);
 const tabsBox=await barber.locator('#panelTabs').boundingBox(), saveBox=await barber.locator('#saveSettings').boundingBox();
 assert.ok(Math.abs(tabsBox.y-saveBox.y)<=4,'Guardar comparte la fila de pestañas');
 await tab(barber,'Fila');
 assert.equal(await barber.locator('#saveSettings').isVisible(),false);
 await tab(barber,'Ajustes');
 assert.equal(await barber.locator('#saveSettings').isVisible(),true);
 await barber.locator('#saveSettings').click();
 await text(barber,'#settingsStatus','Guardado.');
 assert.equal(await barber.locator('#saveSettings').isVisible(),false);
 const saved=await (await barber.request.get(base+'/api/v1/agenda')).json();
 assert.equal(saved.services[0].price,450);
 await barber.reload();
 await barber.locator('#controls').waitFor();
 assert.equal(await barber.locator('#tab-ajustes').getAttribute('aria-selected'),'true');
 await barber.locator('#accountSection summary').click();
 await Promise.all([barber.waitForNavigation(),barber.getByRole('button',{name:'Cerrar sesión'}).click()]);
 const loginDocument=await barber.evaluate(()=>performance.timeOrigin);
 await login.getByLabel('Correo').fill(email);
 await login.getByLabel('Contraseña').fill(password);
 await login.getByRole('button',{name:'Entrar'}).click();
 await barber.locator('#controls').waitFor();
 await enabled(barber,'#toggle');
 assert.equal(await barber.evaluate(()=>performance.timeOrigin),loginDocument);

 await client.goto(base+'/b/barberia-prueba');
 await text(client,'#headline','Puedes pasar ahora');
 assert.deepEqual(await client.evaluate(()=>{
  const positions=['.hero','#join','#join button','#publicHours'].map(id=>document.querySelector(id).getBoundingClientRect().top);
  return [positions.every((y,i)=>!i||y>positions[i-1]),window.innerWidth,!!document.getElementById('count')];
 }),[true,360,false]);
 assert.equal(await client.getByRole('button',{name:'Anotarme',exact:true}).count(),1);
 assert.equal(await client.getByRole('link',{name:'Anotarme',exact:true}).count(),0);
 const iconPath=await client.locator('link[rel=icon]').getAttribute('href');
 assert.equal(iconPath,'/assets/favicon.svg');
 for(const path of [iconPath,'/favicon.ico']){
  const icon=await client.request.get(base+path);
  assert.equal(icon.status(),200);
  assert.match(icon.headers()['content-type'],/^image\/svg\+xml/);
 }
 assert.equal(clientAssets.some(path=>/\/(qrcode|admin)\.js$/.test(path)),false);
 const joinForm=client.locator('#join');
 await joinForm.getByLabel('Nombre',{exact:true}).fill('Cliente Prueba');
 await joinForm.getByLabel('WhatsApp',{exact:true}).fill('8095550101');
 await joinForm.locator('select[name=serviceId]').selectOption('corte');
 await joinForm.getByRole('checkbox').check();
 await joinForm.getByRole('button',{name:'Anotarme'}).click();
 await text(client,'#ownText','Posición 1');
 await tab(barber,'Fila');
 await text(barber,'#queue','Cliente Prueba');
 assert.equal(await barber.locator('#nextBar').isVisible(),true);
 await tab(barber,'Compartir');
 assert.equal(await barber.locator('#nextBar').isVisible(),false);
 await tab(barber,'Ajustes');
 assert.equal(await barber.locator('#nextBar').isVisible(),false);
 await tab(barber,'Resumen');
 assert.equal(await barber.locator('#nextBar').isVisible(),false);
 await tab(barber,'Fila');
 assert.equal(await barber.locator('#nextBar').isVisible(),true);

 // Hold a real GET from the refresh timer while the barber submits the POST.
 let resolvePoll, releasePoll;
 const pollSeen=new Promise(resolve=>{resolvePoll=resolve;});
 const hold=new Promise(resolve=>{releasePoll=resolve;});
 let held=false;
 await barber.route('**/api/v1/agenda',async route=>{
  if(route.request().method()==='GET'&&!held){
   held=true;resolvePoll();await hold;
   await route.abort().catch(()=>{});return;
  }
  await route.continue();
 });
 await pollSeen;
 try{
  await barber.getByRole('button',{name:'Llamar al siguiente'}).click();
  await barber.getByRole('button',{name:'Llegó · Empezar corte'}).waitFor();
  assert.equal(await barber.locator('#saving').textContent(),'');
 }finally{releasePoll();}
 await text(client,'#ownText','¡Te toca! Pasa a la barbería.');
 // A new entry on the customer side must reach the barber after the mutation.
 const second=await browser.newPage({viewport:{width:390,height:844}});
 await observe(second,errors);
 await second.goto(base+'/b/barberia-prueba');
 const nextForm=second.locator('#join');
 await nextForm.getByLabel('Nombre',{exact:true}).fill('Otra Persona');
 await nextForm.getByLabel('WhatsApp',{exact:true}).fill('8295550102');
 await nextForm.getByRole('checkbox').check();
 await nextForm.getByRole('button',{name:'Anotarme'}).click();
 await text(second,'#ownText','Posición 1');
 await text(barber,'#queue','Otra Persona');

 assert.equal(await barber.evaluate(()=>performance.timeOrigin),loginDocument);
 assert.match(await barber.locator('#download').getAttribute('href'),/^data:image\/png/);
 assert.equal(await barber.locator('#panelBottom').evaluate(el=>getComputedStyle(el).position),'fixed');
 assert.equal(await barber.locator('#nextBar').isVisible(),false);
 assert.equal(await client.locator('.hero').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(218, 255, 135)');
 assert.match(response.headers()['content-security-policy'],/style-src 'self';/);
 for(const page of [barber,client,second])assert.deepEqual(await page.evaluate(()=>window.cspViolations),[]);
 assert.deepEqual(errors,[]);
 await capturePanels(barber,browser,base);
});
