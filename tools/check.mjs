import {readdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=(await readdir(new URL('../tests/',import.meta.url))).filter(f=>f.endsWith('.test.mjs')).sort();
const results=[];
for(const file of files){const start=performance.now(),r=spawnSync(process.execPath,[`tests/${file}`],{encoding:'utf8',timeout:60000});
  results.push({file,passed:r.status===0,ms:Math.round(performance.now()-start)});
  if(r.status!==0)console.error(file,(r.stderr||r.error?.message||r.stdout).slice(0,6000));
}
const report={date:new Date().toISOString(),passed:results.filter(r=>r.passed).length,total:files.length,results};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(`${report.passed}/${report.total} test scripts passed`);process.exitCode=report.passed===report.total?0:1;
