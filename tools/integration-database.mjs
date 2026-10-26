// 仅本轮独立测试环境；无 reset/drop/truncate，不接受任意数据库目标。
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root=resolve(import.meta.dirname,".."), require=createRequire(resolve(root,"apps/api/package.json"));
const {Pool}=require("pg"), {parse}=require("dotenv");
const folder=resolve(root,"_backups/unified");mkdirSync(folder,{recursive:true});
const names={preview:"libevra_integration_20261026_preview_test",test:"libevra_integration_20261026_test",restore:"libevra_integration_20261026_restore_test"};
const source=parse(readFileSync(resolve(root,"../记账程序v1/.env"),"utf8"));
const template=new URL(source.TEST_DATABASE_URL);
if(!["127.0.0.1","localhost"].includes(template.hostname)||!/test/.test(template.pathname))throw Error("需要本机测试连接");
const schemaCheckName="libevra_integration_20261026_schema_test";
const url=name=>{if(!Object.values(names).includes(name)&&name!=="postgres"&&name!==schemaCheckName)throw Error("库名拒绝");const u=new URL(template);u.pathname="/"+name;return u;};
function run(command,args,extra={}){const p=spawnSync(command,args,{cwd:root,env:{...process.env,CHECKPOINT_DISABLE:"1",PRISMA_HIDE_UPDATE_MESSAGE:"1",...extra},encoding:"utf8",shell:command==="pnpm"});if(p.status!==0)throw Error(`${command} 失败 ${p.stderr}`);return p.stdout;}
async function inPool(name,fn){const pool=new Pool({connectionString:url(name).toString()});try{return await fn(pool);}finally{await pool.end();}}
async function counts(pool){const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;const result={};for(const {tablename} of tables)result[tablename]=(await pool.query(`SELECT count(*)::text AS count FROM public."${tablename.replaceAll('"','""')}"`)).rows[0].count;return result;}
async function facts(pool){const rows=(await pool.query("SELECT to_jsonb(t) AS value FROM transactions t ORDER BY id")).rows;return createHash("sha256").update(JSON.stringify(rows)).digest("hex");}
const mode=process.argv[2];
if(mode==="init"){
 await inPool("postgres",async pool=>{for(const name of Object.values(names)){if(!(await pool.query("SELECT 1 FROM pg_database WHERE datname=$1",[name])).rowCount)await pool.query(`CREATE DATABASE ${name}`);console.log("已确认专用隔离库",name);}});
 const values={DATABASE_URL:url(names.preview).toString(),TEST_DATABASE_URL:url(names.test).toString(),NODE_ENV:"development",API_HOST:"127.0.0.1",API_PORT:"3021",WEB_ORIGIN:"http://127.0.0.3:5189",COOKIE_SECURE:"false",REGISTRATION_MODE:"open"};
 writeFileSync(resolve(root,".env"),Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join("\n")+"\n");
 const migrations=readdirSync(resolve(root,"prisma/migrations"),{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name!=="20261026120000_fx_public_rates");
 if(migrations.length!==58)throw Error("基线迁移链变化，停止重新核对");
 mkdirSync(resolve(folder,"baseline-migrations"),{recursive:true});
 for(const d of migrations)cpSync(resolve(root,"prisma/migrations",d.name),resolve(folder,"baseline-migrations",d.name),{recursive:true});
 cpSync(resolve(root,"prisma/migrations/migration_lock.toml"),resolve(folder,"baseline-migrations/migration_lock.toml"));
 console.log(run("pnpm",["exec","prisma","migrate","deploy","--config","tools/integration-baseline.config.ts"],{DATABASE_URL:url(names.preview).toString()}));
}else if(mode==="backup"){
 const before=await inPool(names.preview,async pool=>({counts:await counts(pool),facts:await facts(pool)}));
 if(before.counts._prisma_migrations!=="58"||before.counts.transactions==="0")throw Error("需要58迁移与合成交易基线");
 if(Object.keys(await inPool(names.restore,counts)).length)throw Error("恢复库非空，不覆盖");
 const connection=url(names.preview), pgEnv={PGHOST:connection.hostname,PGPORT:connection.port||"5432",PGUSER:decodeURIComponent(connection.username),PGPASSWORD:decodeURIComponent(connection.password)};
 run("C:/Program Files/PostgreSQL/17/bin/pg_dump.exe",["-Fc","-f",resolve(folder,"baseline-58.dump"),"--dbname",names.preview],pgEnv);
 run("C:/Program Files/PostgreSQL/17/bin/pg_restore.exe",["--no-owner","--dbname",names.restore,resolve(folder,"baseline-58.dump")],pgEnv);
 const after=await inPool(names.restore,async pool=>({counts:await counts(pool),facts:await facts(pool)}));
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error("恢复不一致");
 writeFileSync(resolve(folder,"database-proof.json"),JSON.stringify({createdAt:new Date().toISOString(),restoreOk:true,before,after},null,2));console.log("合成58基线备份恢复通过",Object.keys(before.counts).length,"表；交易全字段哈希一致");
}else if(mode==="upgrade"){
 const proof=JSON.parse(readFileSync(resolve(folder,"database-proof.json"),"utf8"));if(!proof.restoreOk)throw Error("缺少恢复证明");
 for(const name of Object.values(names))console.log(run("pnpm",["db:deploy"],{DATABASE_URL:url(name).toString()}));
 proof.upgraded={};
 for(const [kind,name] of Object.entries(names))proof.upgraded[kind]=await inPool(name,async pool=>({counts:await counts(pool),facts:await facts(pool)}));
 if(proof.upgraded.preview.facts!==proof.before.facts||proof.upgraded.restore.facts!==proof.before.facts)throw Error("升级改变原始交易");
 if(Object.values(proof.upgraded).some(p=>p.counts._prisma_migrations!=="59"))throw Error("迁移不全");
 writeFileSync(resolve(folder,"database-proof.json"),JSON.stringify(proof,null,2));console.log("58→59与空库→59通过，恢复副本同样升级；原始交易全字段哈希不变");
}else if(mode==="compare-drift"){
 await inPool("postgres",async pool=>{if(!(await pool.query("SELECT 1 FROM pg_database WHERE datname=$1",[schemaCheckName])).rowCount)await pool.query(`CREATE DATABASE ${schemaCheckName}`);});
 run("pnpm",["exec","prisma","migrate","deploy","--config","tools/integration-baseline.config.ts"],{DATABASE_URL:url(schemaCheckName).toString()});
 const schema=spawnSync("git",["show","b6ce25e:prisma/schema.prisma"],{cwd:root});if(schema.status!==0)throw Error("无法读取主线58模型");
 writeFileSync(resolve(folder,"schema-58.prisma"),schema.stdout);
 const diff=spawnSync("pnpm",["exec","prisma","migrate","diff","--from-config-datasource","--to-schema","_backups/unified/schema-58.prisma","--exit-code"],{cwd:root,shell:true,encoding:"utf8",env:{...process.env,CHECKPOINT_DISABLE:"1",DATABASE_URL:url(schemaCheckName).toString()}});
 if(diff.status!==2)throw Error("主线旧差异复现结果异常");
 writeFileSync(resolve(folder,"schema-diff-58.log"),diff.stdout);
 const normalize=s=>s.slice(s.indexOf("[*]")).replaceAll("\r\n","\n").trim();
 if(normalize(diff.stdout)!==normalize(readFileSync(resolve(folder,"schema-diff.log"),"utf8")))throw Error("整合新增了模型差异，需要检查");
 const proof=JSON.parse(readFileSync(resolve(folder,"database-proof.json"),"utf8"));proof.legacySchemaDriftUnchanged=true;writeFileSync(resolve(folder,"database-proof.json"),JSON.stringify(proof,null,2));
 console.log("58主线与59统一候选的既有模型差异完全相同；公共汇率表没有新增漂移。不执行自动修复或 db push。");
}else throw Error("仅支持 init / backup / upgrade / compare-drift");
