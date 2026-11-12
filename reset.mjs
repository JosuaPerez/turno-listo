import {localRepository} from './local-db.mjs';
import {emailPattern} from './auth.mjs';
import {issueReset} from './password-reset.mjs';
const email=process.argv[2]?.trim().toLowerCase();
if(!email||!emailPattern.test(email))throw Error('Uso: node reset.mjs correo@ejemplo.com');
const origin=process.env.TURNO_PUBLIC_ORIGIN||'http://localhost:'+(process.env.PORT||8787);
const result=await issueReset(localRepository(),email,origin);
if(!result){console.error('No encontramos esa cuenta.');process.exitCode=1;}
else console.log(result.link);
