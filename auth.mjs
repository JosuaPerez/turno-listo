import {clean,fail,json} from './http.mjs';
import {newShop} from './shop.mjs';
const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
const bytes=length=>crypto.getRandomValues(new Uint8Array(length));
const fromHex=value=>Uint8Array.from(value.match(/../g).map(v=>parseInt(v,16)));
export const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export const slugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function passwordHash(password,salt,pepper=''){
  let material=encoder.encode(password);
  if(pepper){
    const secret=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    material=await crypto.subtle.sign('HMAC',secret,material);
  }
  const key=await crypto.subtle.importKey('raw',material,'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:fromHex(salt),iterations:pepper?100000:600000},key,256));
}
export async function makePassword(password,pepper=''){
  const salt=hex(bytes(16));
  return (pepper?'v2:':'')+salt+':'+await passwordHash(password,salt,pepper);
}
export async function verifyPassword(password,stored,pepper=''){
  const versioned=stored?.startsWith('v2:')??Boolean(pepper);
  if(versioned&&!pepper)return false;
  const [salt,expected]=(stored?.replace(/^v2:/,'')||'00000000000000000000000000000000:'+('0'.repeat(64))).split(':');
  const actual=await passwordHash(password,salt,versioned?pepper:'');
  let diff=0;
  for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^actual.charCodeAt(i);
  return Boolean(stored)&&diff===0;
}
const sessionLife=60*60*24*7;
function sessionCookie(token,maxAge,secure){
  return 'turno_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(secure?'; Secure':'');
}
export function readSession(request){
  return (request.headers.get('Cookie')||'').match(/(?:^|;\s*)turno_session=([a-f0-9]{64})(?:;|$)/)?.[1]||'';
}
export function readBearer(request){
  return (request.headers.get('Authorization')||'').match(/^Bearer ([a-f0-9]{64})$/i)?.[1]||'';
}
function sessionToken(request){
  // An explicit Authorization header takes precedence, even if invalid.
  return request.headers.has('Authorization')?readBearer(request):readSession(request);
}
export async function getAccount(request,repo){
  const token=sessionToken(request);
  return token?repo.session(await digest(token),Date.now()):null;
}
export async function parseBody(request){
  const reader=request.body?.getReader();
  if(!reader)return null;
  const decoder=new TextDecoder();
  let size=0, body='';
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>8192){await reader.cancel();return null;}
      body+=decoder.decode(value,{stream:true});
    }
    const input=JSON.parse(body+decoder.decode());
    return input&&typeof input==='object'&&!Array.isArray(input)?input:null;
  }catch{return null;}
}
export async function allowed(repo,env,request,scope,limit,period,ip){
  const bucket=Math.floor(Date.now()/period);
  const id=await digest((env.TURNO_RATE_SALT||'turno')+'\n'+bucket+'\n'+scope+'\n'+ip);
  return await repo.rate(id,(bucket+2)*period)<=limit;
}
export async function authRoute(request,repo,env,ip,path){
  if(request.method!=='POST')return fail('Método inválido.',405);
  if(path==='register'&&env.TURNO_RUNTIME==='worker'&&!env.TURNO_INVITE)return fail('El registro no está habilitado',503);
  const secure=new URL(request.url).protocol==='https:';
  if(path==='logout'){
    const bearer=request.headers.has('Authorization'), t=sessionToken(request);
    if(bearer&&!t)return fail('Token de sesión inválido.',401);
    if(t)await repo.deleteSession(await digest(t));
    return json({ok:true},200,bearer?{}:{'Set-Cookie':sessionCookie('',0,secure)});
  }
  if(!['login','register'].includes(path))return fail('Ruta no encontrada.',404);
  if(!await allowed(repo,env,request,'auth:'+path,path==='login'?10:4,15*60000,ip))return fail('Demasiados intentos. Intenta más tarde.',429);
  const data=await parseBody(request);
  if(!data)return fail('Solicitud inválida.');
  const email=clean(data.email,150).toLowerCase(), password=typeof data.password==='string'?data.password:'';
  if(!emailPattern.test(email)||email.length>150||password.length>128||password.length<1)return fail('Revisa el correo y la contraseña.');
  let account;
  if(path==='register'){
    const slug=clean(data.slug,48), name=clean(data.name,60);
    if(env.TURNO_INVITE && data.invite!==env.TURNO_INVITE)return fail('El código de registro no es válido.',403);
    if(password.length<12||!slugPattern.test(slug)||slug.length>48||!name||name.length>60)return fail('Usa un nombre, una dirección válida y una contraseña de 12 caracteres o más.');
    const hash=await makePassword(password,env.TURNO_PASSWORD_PEPPER);
    const inserted=await repo.createAccount({slug,email,hash},{...newShop(slug,name),onboarded:false});
    if(!inserted){
      if(await repo.shopExists(slug))return fail('Ese enlace ya está en uso.',409);
      return fail('No pudimos crear la cuenta con esos datos.',409);
    }
    account={slug,password_hash:hash};
  }else{
    account=await repo.account(email);
    if(!await verifyPassword(password,account?.password_hash,env.TURNO_PASSWORD_PEPPER))return fail('Correo o contraseña incorrectos.',401);
  }
  const token=hex(bytes(32));
  const expires=Date.now()+sessionLife*1000;
  if(!await repo.createSession(await digest(token),account.slug,expires,account.password_hash))return fail('Vuelve a iniciar sesión.',401);
  const result={ok:true,slug:account.slug};
  if(data.token===true)Object.assign(result,{token,expires});
  return json(result,200,{'Set-Cookie':sessionCookie(token,sessionLife,secure)});
}
