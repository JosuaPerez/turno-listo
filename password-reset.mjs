import {allowed,digest,emailPattern,makePassword,parseBody} from './auth.mjs';
import {clean,fail,json,ticket} from './http.mjs';
export async function issueReset(repo,email,origin,now=Date.now()){
  const account=await repo.account(email);
  if(!account)return null;
  const token=ticket(), expires=now+30*60000;
  const link=new URL('/restablecer',origin);
  link.hash='t='+token;
  await repo.createReset(await digest(token),account.slug,expires);
  return {link:link.href,expires};
}
export async function resetRoute(request,repo,env,ip,operator){
  if(request.method!=='POST')return fail('Método inválido.',405);
  if(operator){
    if(!env.TURNO_MAINTENANCE_KEY||request.headers.get('Authorization')!=='Bearer '+env.TURNO_MAINTENANCE_KEY)return fail('Ruta no encontrada.',404);
    const data=await parseBody(request), email=clean(data?.email,150).toLowerCase();
    if(!emailPattern.test(email)||email.length>150)return fail('Revisa el correo.');
    const result=await issueReset(repo,email,env.TURNO_PUBLIC_ORIGIN||new URL(request.url).origin);
    return result?json(result):fail('No encontramos esa cuenta.',404);
  }
  if(!await allowed(repo,env,request,'auth:reset',8,15*60000,ip))return fail('Demasiados intentos. Intenta más tarde.',429);
  const data=await parseBody(request);
  if(!data||typeof data.token!=='string'||!(/^[a-f0-9]{64}$/).test(data.token)||typeof data.password!=='string'||data.password.length<12||data.password.length>128)return fail('Revisa el enlace y usa una contraseña de 12 a 128 caracteres.');
  const hash=await digest(data.token);
  if(!await repo.resetActive(hash,Date.now()))return fail('El enlace venció o ya se usó.',410);
  const passwordHash=await makePassword(data.password,env.TURNO_PASSWORD_PEPPER);
  if(!await repo.consumeReset(hash,passwordHash,Date.now()))return fail('El enlace venció o ya se usó.',410);
  return json({ok:true});
}
