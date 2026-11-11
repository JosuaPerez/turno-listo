import {makePassword,slugPattern,emailPattern} from './auth.mjs';
import {newShop} from './api.mjs';
import {localRepository} from './local-db.mjs';
const {DEMO_EMAIL:email,DEMO_PASSWORD:password,DEMO_SLUG:slug='turno-listo',DEMO_NAME:name='Barbería de ejemplo'}=process.env;
if(!emailPattern.test(email||'')||!password||password.length<12||password.length>128||!slugPattern.test(slug)||slug.length>48)throw Error('Configura DEMO_EMAIL y DEMO_PASSWORD (12+ caracteres).');
const repo=localRepository();
const created=await repo.createAccount({slug,email:email.toLowerCase(),hash:await makePassword(password,process.env.TURNO_PASSWORD_PEPPER)},newShop(slug,name));
console.log(created?'Barbería de ejemplo creada.':'El enlace o el correo ya está en uso.');
