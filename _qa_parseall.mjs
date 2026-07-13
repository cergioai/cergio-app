import { parse } from '@babel/parser';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
const dirs='src supabase/functions api scripts';
const files = execSync(`find ${dirs} -type f \\( -name "*.js" -o -name "*.jsx" -o -name "*.mjs" -o -name "*.ts" \\) 2>/dev/null`,{encoding:'utf8'}).trim().split('\n').filter(Boolean);
let fail=0, ok=0;
for (const f of files){
  const isTs=f.endsWith('.ts');
  try{ parse(readFileSync(f,'utf8'),{sourceType:'module',plugins:['jsx', isTs?'typescript':null].filter(Boolean)}); ok++; }
  catch(e){ fail++; console.log('FAIL:',f,'-',e.message); }
}
console.log(`\nParsed ${ok+fail} files: ${ok} OK, ${fail} FAIL`);
