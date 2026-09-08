import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const paths=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden=/(?:^|\/)(?:__pycache__|node_modules|auth\.json|\.env)(?:\/|$)|OpenAISans|\.(?:sqlite|pdf|wav|mp3|pyc)$/i;
const credentials=/(?:GOCSPX-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)/;
const failures=[];
for(const path of paths){
  if(forbidden.test(path)){failures.push(path+': non-distributable file');continue;}
  if(/\.(png|jpg|gif|ico|woff2?|ttf|eot)$/i.test(path))continue;
  if(credentials.test(fs.readFileSync(path,'utf8')))failures.push(path+': possible embedded credential');
}
if(failures.length)throw Error('Publication check failed (values intentionally omitted):\n'+failures.join('\n'));
console.log(`Publication allowlist/credential checks passed for ${paths.length} tracked files.`);
