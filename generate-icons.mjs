import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const executablePath=process.env.TURNO_BROWSER_EXECUTABLE||(process.platform==='win32'&&existsSync(edge)?edge:undefined);
const browser=await chromium.launch({executablePath});
try{
 const svg=await readFile(new URL('favicon.svg',import.meta.url),'utf8');
 for(const [size,maskable] of [[192,false],[512,false],[512,true]]){
  const page=await browser.newPage({viewport:{width:size,height:size}});
  const side=maskable?Math.floor(size*.56):size;
  await page.setContent('<body style="margin:0;display:grid;place-items:center;height:100vh;background:'+(maskable?'#171915':'transparent')+'"><img width="'+side+'" height="'+side+'" src="data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')+'"></body>');
  await page.locator('img').evaluate(img=>img.decode());
  await page.screenshot({path:fileURLToPath(new URL('icon-'+(maskable?'maskable-':'')+size+'.png',import.meta.url)),omitBackground:!maskable});
  await page.close();
 }
}finally{await browser.close();}
