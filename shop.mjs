import {firstChair} from './estimates.mjs';
import {validHours} from './stats.mjs';
export const initial = {
  onboarded:true, open:true, phone:'', name:'Barbería Turno Listo', slug:'turno-listo',
  duration:30, queue:[], current:null, notices:[], active:{}, chairs:[firstChair], mode:'shared', history:[], qrShared:false, noShowMinutes:5, autoSkip:false, hours:validHours(),
  services:[{id:'corte',name:'Corte',minutes:30},{id:'corte-barba',name:'Corte y barba',minutes:45},{id:'cejas',name:'Cejas',minutes:10}]
};
export function newShop(slug,name){return {...structuredClone(initial),slug,name};}
