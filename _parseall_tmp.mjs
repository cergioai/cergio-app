import { parse } from '@babel/parser';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
function walk(d){let o=[];for(const e of readdirSync(d)){const p=join(d,e);const s=statSync(p);if(s.isDirectory())o=o.concat(walk(p));else if(/\.(jsx?|tsx?)$/.test(e))o.push(p);}return o;}
let fail=0,ok=0;
for(const f of walk('src')){
  try{parse(readFileSync(f,'utf8'),{sourceType:'module',plugins:['jsx']});ok++;}
  catch(e){fail++;console.log('FAIL',f,'::',e.message.split('\n')[0]);}
}
console.log(`RESULT ok=${ok} fail=${fail}`);
