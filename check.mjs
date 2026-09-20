import {readdir,readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
for(const file of (await readdir('dist')).filter(n=>n.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',path.join('dist',file)],{encoding:'utf8'});if(r.status)throw new Error(r.stderr);}
const html=await readFile('dist/index.html','utf8');
for(const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))await stat(path.join('dist',match[1]));
for(const name of ['arjuna-emblem.jpeg','arjuna-wordmark.png'])await stat(path.join('dist/assets',name));
console.log('PASS: all JavaScript syntax, local HTML assets and both supplied logos.');
