import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const html=JSON.stringify(readFileSync('index.html','utf8'));
const api=readFileSync('api.mjs','utf8');
const worker=`
const html=${html};
export default {async fetch(request,env) {
  const path=new URL(request.url).pathname;
  if(path==='/'||path==='/barbero') return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  const store={
    async read() {
      const row=await env.DB.prepare('SELECT data, revision FROM queue_state WHERE id=1').first();
      return row?{...JSON.parse(row.data),revision:row.revision}:{...structuredClone(initial),revision:0};
    },
    async write(next,revision) {
      const result=await env.DB.prepare('INSERT INTO queue_state(id,data,revision) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, revision=excluded.revision WHERE queue_state.revision=?').bind(JSON.stringify(next),next.revision,revision).run();
      return result.meta.changes===1;
    }
  };
  return route(request,store,env.TURNO_KEY);
}};
`;
mkdirSync('dist/server',{recursive:true});
mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/server/index.js',api+'\n'+worker);
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
