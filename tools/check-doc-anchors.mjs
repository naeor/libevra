// 检查仓库 Markdown 章节链接；只读、离线，补充 check-links 的文件存在检查。
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const files=[...new Set(execFileSync("git",["ls-files","--cached","--others","--exclude-standard","-z"],{cwd:root,encoding:"utf8",maxBuffer:16e6}).split("\0").filter(p=>p.endsWith(".md") && existsSync(resolve(root,p))))];
function withoutCode(text) {
  let fence=null;
  const lines=text.split(/\r?\n/).map((line,i)=>{
    const m=line.match(/^\s*(`{3,}|~{3,})/);
    if(m){if(!fence)fence={char:m[1][0],length:m[1].length,line:i+1};else if(m[1][0]===fence.char && m[1].length>=fence.length)fence=null;return "";}
    return fence?"":line;
  });
  return {text:lines.join("\n"),fence};
}
const strip=t=>withoutCode(t).text;
const slug=t=>t.toLowerCase().replace(/[\ufe0e\ufe0f]/g,"").replace(/<[^>]*>/g,"").replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu,"").replace(/\s/g,"-");
const cache=new Map();
function anchors(p){
  if(cache.has(p))return cache.get(p);
  const text=strip(readFileSync(p,"utf8")),ids=new Set(),seen=new Map();
  for(const m of text.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/g))ids.add(m[1]);
  for(const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)){const base=slug(m[1]),n=seen.get(base)||0;ids.add(base+(n?"-"+n:""));seen.set(base,n+1);}
  cache.set(p,ids);return ids;
}
const broken=[];let checked=0;
const structure=[];
for(const file of files){
  const parsed=withoutCode(readFileSync(resolve(root,file),"utf8"));
  if(parsed.fence && !file.includes("/archive/"))structure.push(`${file}:${parsed.fence.line} → 代码围栏未闭合`);
  const lines=parsed.text.split(/\r?\n/);
  lines.forEach((line,i)=>{
    for(const m of line.replace(/`[^`]*`/g,"").matchAll(/\]\(([^\s)]+)\)/g)){
      let link;try{link=decodeURIComponent(m[1]);}catch{continue;}
      if(/^[a-z]+:/i.test(link)||!link.includes("#"))continue;
      const [dest,fragment]=link.split("#");if(!fragment)continue;
      const target=dest?resolve(root,dirname(file),dest):resolve(root,file);
      if(!target.endsWith(".md")||!existsSync(target))continue;
      checked++;if(!anchors(target).has(fragment))broken.push({file,line:i+1,target:relative(root,target).replaceAll("\\","/"),fragment});
    }
  });
}
if(process.argv.includes("--json"))console.log(JSON.stringify(broken,null,2));
else if(broken.length)console.error(broken.map(b=>`${b.file}:${b.line} → ${b.target}#${b.fragment}`).join("\n"));
else console.log(`章节引用通过：${checked} 个。`);
if(structure.length)console.error(structure.join("\n"));
if(broken.length||structure.length)process.exitCode=1;
