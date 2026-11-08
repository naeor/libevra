// 阅读版仍由 md2pdf.py 生成；增量选择、指纹与验证由本入口协调。绝不自动删除孤立 PDF。
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),".."), DOCS=join(ROOT,"docs"), OUT=join(DOCS,"阅读版");
const args=process.argv.slice(2), sync=args.includes("--sync"), check=args.includes("--check");
const since=args.find(a=>a.startsWith("--since="))?.slice(8);
const manifestPath=join(OUT,".reading-manifest.json");
const manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,"utf8")):{schemaVersion:1,entries:{}};
const sha=b=>createHash("sha256").update(b).digest("hex");
const converter=join(ROOT,"tools/md2pdf.py"), validator=join(ROOT,"tools/verify-reading-pdf.py");
const converterHash=sha(Buffer.concat([readFileSync(converter),readFileSync(validator)]));
const git=(...a)=>execFileSync("git",a,{cwd:ROOT,encoding:"utf8",maxBuffer:16e6}).split("\0").filter(Boolean);
const visible=[...new Set(git("ls-files","--cached","--others","--exclude-standard","-z"))];
const sources=visible.filter(f=>f.startsWith("docs/") && f.endsWith(".md") && !f.startsWith("docs/阅读版/") && existsSync(join(ROOT,f)));
const target=f=>join(OUT,...f.slice(5).replace(/\.md$/, ".pdf").split("/"));
const changed=new Set(git("diff","--name-only","-z",since||"HEAD","--","docs"));
for(const f of git("ls-files","--others","--exclude-standard","-z","--","docs")) changed.add(f);
const explicit=args.filter(a=>!a.startsWith("--")).map(a=>relative(ROOT,resolve(ROOT,a)).split(sep).join("/"));
for(const f of explicit) if(!sources.includes(f)) throw Error("只转换仓库可见的 docs Markdown，不能读取私密/生成资料："+f);
const selected=sources.filter(f=>explicit.includes(f) || (!(sync||check) && !explicit.length) || ((sync||check) && existsSync(target(f)) && (changed.has(f) || manifest.entries[f] && (manifest.entries[f].sourceSha256!==sha(readFileSync(join(ROOT,f))) || manifest.entries[f].converterSha256!==converterHash))) || ((sync||check) && manifest.entries[f] && !existsSync(target(f))));
if(check) for(const f of sources) if(manifest.entries[f] && !selected.includes(f)) selected.push(f);
function pythonFor() {
  const candidates=[process.env.PYTHON,join(ROOT,"_backups/docs-pdf-runtime/Scripts/python.exe"),join(ROOT,"_backups/docs-pdf-runtime/bin/python"),process.env.DSH_HOME&&join(process.env.DSH_HOME,"dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe"),"py","python3","python"].filter(Boolean);
  for(const p of candidates) {try {execFileSync(p,[...(p==="py"?["-3"]:[]),"-c","import fpdf, fitz"],{stdio:"ignore"});return p;}catch{}}
  throw Error("找不到具有 fpdf2 与 PyMuPDF 的 Python；设置 PYTHON 指向已安装的解释器。Markdown 与旧 PDF 保留，未宣称同步。");
}
let python;
function run(script,...values) {
  python??=pythonFor();
  return execFileSync(python,[...(python==="py"?["-3"]:[]),"-X","utf8",script,...values],{cwd:ROOT,encoding:"utf8",maxBuffer:8e6,stdio:["ignore","pipe","pipe"]});
}
let ok=0, skipped=0;const failed=[];
mkdirSync(OUT,{recursive:true});
for(const f of selected.sort()) {
  const sourceHash=sha(readFileSync(join(ROOT,f))),dest=target(f),record=manifest.entries[f];
  const fresh=record?.sourceSha256===sourceHash && record.converterSha256===converterHash && existsSync(dest) && record.pdfSha256===sha(readFileSync(dest));
  try {
    if(check) {
      if(!fresh)throw Error("源、转换器或 PDF 指纹不匹配/尚未登记，请运行 docs:sync");
      const result=JSON.parse(run(validator,join(ROOT,f),dest));
      if(result.pages!==record.pages)throw Error("页数与登记不一致");
      ok++;continue;
    }
    if(fresh){skipped++;continue;}
    mkdirSync(dirname(dest),{recursive:true});
    const pending=dest+".pending";
    run(converter,join(ROOT,f),pending,"--title",f.slice(5).replace(/\.md$/, "").split("/").pop());
    const result=JSON.parse(run(validator,join(ROOT,f),pending));
    if(sha(readFileSync(join(ROOT,f)))!==sourceHash)throw Error("生成期间 Markdown 已变化，保留旧 PDF 后重试");
    if(sha(Buffer.concat([readFileSync(converter),readFileSync(validator)]))!==converterHash)throw Error("生成期间转换器/校验器已变化，保留旧 PDF 后重试");
    renameSync(pending,dest);
    manifest.entries[f]={sourceSha256:sourceHash,converterSha256:converterHash,pdfSha256:sha(readFileSync(dest)),pages:result.pages,verifiedAt:new Date().toISOString(),pdf:relative(ROOT,dest).split(sep).join("/")};
    writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
    ok++;console.log(`✓ ${f} → ${result.pages} 页`);
  }catch(error){failed.push(f);console.error(`✗ ${f}：${String(error.stderr||error.message).slice(0,700)}`);}
}
const orphan=[];
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith(".pdf")){const src="docs/"+relative(OUT,p).split(sep).join("/").replace(/\.pdf$/, ".md");if(!sources.includes(src))orphan.push(relative(ROOT,p));}}}
walk(OUT);
if(orphan.length)console.log(`孤立/非仓库源阅读版 ${orphan.length} 份：仅报告，不删除。`);
console.log(`阅读版${check?"检查":"生成"}：${ok} 成功，${skipped} 内容未变，${failed.length} 失败；未选中的旧 PDF 不在本次同步声明范围。`);
if(failed.length)process.exitCode=1;
