import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {repository} from './repository.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
export function localRepository(dir=process.env.TURNO_DATA||join(root,'.data')){
  mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(join(dir,'turnos.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY);');
  for(const file of readdirSync(join(root,'drizzle')).filter(v=>v.endsWith('.sql')).sort()){
    db.exec('BEGIN IMMEDIATE');
    try{
      if(!db.prepare('SELECT name FROM _migrations WHERE name=?').get(file)){
        db.exec(readFileSync(join(root,'drizzle',file),'utf8'));
        db.prepare('INSERT INTO _migrations VALUES(?)').run(file);
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return repository({prepare(sql){return {bind(...params){
    const stmt=db.prepare(sql);
    return {first:()=>stmt.get(...params)||null,all:()=>({results:stmt.all(...params)}),run:()=>({meta:stmt.run(...params)})};
  }};},
  batch(statements){
    db.exec('BEGIN IMMEDIATE');
    try{
      const results=statements.map(statement=>statement.run());
      db.exec('COMMIT');return results;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }});

}
