export const securityHeaders={
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY'
};
export function secureResponse(response,production=false){
  const headers=new Headers(response.headers);
  for(const [name,value] of Object.entries(securityHeaders))headers.set(name,value);
  if(production)headers.set('Strict-Transport-Security','max-age=31536000');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
