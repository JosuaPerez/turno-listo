if(location.pathname==='/barbero'){
 const {startAdmin}=await import('./admin.js');
 startAdmin();
}else{
 const {startClient,startReset}=await import('./client.js');
 if(location.pathname==='/restablecer')startReset();
 else startClient();
}
