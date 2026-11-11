import {initial} from './api.mjs';
export function repository(db){
  const stmt=(sql,...params)=>db.prepare(sql).bind(...params);
  return {
    account:email=>stmt('SELECT slug, password_hash FROM shops WHERE email=?',email).first(),
    async createAccount(account,shop){
      const result=await stmt('INSERT OR IGNORE INTO shops(slug,email,password_hash,data,revision) VALUES(?,?,?,?,0)',account.slug,account.email,account.hash,JSON.stringify(shop)).run();
      return result.meta.changes===1;
    },
    createSession:(hash,slug,expires)=>stmt('INSERT INTO sessions(hash,slug,expires) VALUES(?,?,?)',hash,slug,expires).run(),
    session:(hash,now)=>stmt('SELECT slug FROM sessions WHERE hash=? AND expires>?',hash,now).first(),
    deleteSession:hash=>stmt('DELETE FROM sessions WHERE hash=?',hash).run(),
    async rate(bucket,expires){
      return (await stmt('INSERT INTO rate_limits(bucket,hits,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits',bucket,expires).first()).hits;
    },
    async sweep(now=Date.now()){
      await stmt('DELETE FROM rate_limits WHERE expires<=?',now).run();
      await stmt('DELETE FROM sessions WHERE expires<=?',now).run();
    },
    async shops(){
      return (await db.prepare('SELECT slug FROM shops ORDER BY slug').bind().all()).results.map(row=>row.slug);
    },
    shop(slug){
      return {
        async read(){
          const row=await stmt('SELECT data,revision FROM shops WHERE slug=?',slug).first();
          return row?{...structuredClone(initial),...JSON.parse(row.data),slug,revision:row.revision}:null;
        },
        async write(next,revision){
          const result=await stmt('UPDATE shops SET data=?,revision=? WHERE slug=? AND revision=?',JSON.stringify(next),next.revision,slug,revision).run();
          return result.meta.changes===1;
        }
      };
    }
  };
}
