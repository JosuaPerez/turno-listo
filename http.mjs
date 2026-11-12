export const clean = (v,n) => typeof v==='string' ? v.trim().slice(0,n+1) : '';
export const json = (value,status=200,headers={}) => Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
export const fail = (error,status=400) => json({error},status);
export const ticket = () => crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
