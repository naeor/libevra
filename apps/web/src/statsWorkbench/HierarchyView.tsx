import { useContext, useState } from "react";
import { UNSAFE_LocationContext, UNSAFE_NavigationContext } from "react-router";
import { buildHierarchy, buildHierarchySankey, sankeyIsConserved, type AdvancedRecord, type DraftHierarchyNode } from "@libellum/shared/analysis/advanced";
import { categoryTreeRows, type Category, type DateRange } from "@libellum/shared";
import { useI18n } from "../i18n/index.js";
import { displayCategoryName } from "../lib/presetNames.js";
import { moneyText } from "./ui.js";
import { ratio } from "./cAnalyses.js";

export function HierarchyView({records,categories,currency,range,detail,sankey,complete,height}:{readonly records:readonly AdvancedRecord[];readonly categories:readonly Category[];readonly currency:string;readonly range:DateRange;readonly detail:boolean;readonly sankey:boolean;readonly complete:boolean;readonly height:number}):React.JSX.Element {
  const {t}=useI18n();const [collapsed,setCollapsed]=useState<readonly string[]>([]);
  /**
   * S18：用所在工作区自己的地址与导航（两个工作区可以各开一份分析）。不在路由里（静态渲染、预设预览）时
   * 退回浏览器地址与普通链接，行为与以前相同。
   */
  const routerLocation=useContext(UNSAFE_LocationContext);const routerNavigation=useContext(UNSAFE_NavigationContext);
  let result:ReturnType<typeof buildHierarchy>,flow:ReturnType<typeof buildHierarchySankey>;
  try{result=buildHierarchy(records,categories.filter(c=>c.kind==="expense").map(c=>({categoryId:c.id,parentCategoryId:c.parentId??null,categoryLabel:displayCategoryName(c.name)})));flow=buildHierarchySankey(result);}
  catch{return <p role="alert" className="text-helper text-muted">{t("statsWorkbench.advanced.unavailable")}</p>;}
  if(!sankeyIsConserved(flow)) return <p role="alert">{t("statsWorkbench.cAnalysis.notConserved")}</p>;
  const orders=new Map(categories.map(c=>[c.id,c.sortOrder]));
  const nodes=categoryTreeRows(result.nodes.filter(n=>n.kind==="category").map(n=>({...n,id:n.nodeId,name:n.label,sortOrder:orders.get(n.nodeId)??0}))).map(row=>row.node);const byId=new Map(result.nodes.map(n=>[n.nodeId,n]));
  const hidden=(n:DraftHierarchyNode)=>{let parent=n.parentId;while(parent){if(collapsed.includes(parent))return true;parent=byId.get(parent)?.parentId??null;}return false;};
  const visible=nodes.filter(n=>!hidden(n)&&(detail||n.depth===1));
  const shown=detail?visible:visible.slice(0,Math.max(1,Math.floor(height/38)));
  const href=(id:string)=>{const p=new URLSearchParams(routerLocation!==null?routerLocation.location.search:typeof window === "undefined" ? "" : window.location.search);p.delete("category");p.delete("categoryBranch");p.delete("month");p.set("categoryBranch",id);p.set("range","custom");p.set("from",range.from);p.set("to",range.to);return `/stats?${p}`;};
  const money=(n:bigint)=>moneyText(n.toString(),currency);
  const percent=(n:bigint)=>`${(ratio(n,result.totalAmountMinor)*100).toFixed(1)}%`;
  return <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
    {detail?<p className="text-helper-relaxed text-muted">{t("manage.tree.currentTree")}</p>:null}
    {sankey&&complete&&result.totalAmountMinor>0n?<HierarchyFlow result={flow} money={money} detail={detail} height={Math.max(80,height-45)}/>:null}
    {detail&&sankey&&complete&&result.totalAmountMinor>0n?<p className="text-helper text-muted">{t("manage.treePan")}</p>:null}
    {!sankey||detail||!complete?<ul className={detail?"divide-y divide-line":"min-h-0 overflow-hidden"}>{shown.map(n=><li key={n.nodeId} className="flex min-w-0 items-center gap-2 py-2 text-helper" style={{paddingLeft:detail?Math.min(n.depth-1,5)*12:0}}>
      {detail&&nodes.some(child=>child.parentId===n.nodeId)?<button type="button" className="min-h-11 min-w-8" aria-label={t("manage.tree.toggle",{name:n.label})} aria-expanded={!collapsed.includes(n.nodeId)} onClick={()=>setCollapsed(value=>value.includes(n.nodeId)?value.filter(id=>id!==n.nodeId):[...value,n.nodeId])}>{collapsed.includes(n.nodeId)?"›":"⌄"}</button>:null}
      <a className="min-w-0 flex-1 truncate text-brand-dark" href={href(n.nodeId)} onClick={event=>{if(routerNavigation===null||event.metaKey||event.ctrlKey||event.shiftKey||event.button!==0)return;event.preventDefault();routerNavigation.navigator.push(href(n.nodeId));}}>{n.label}</a><span className="shrink-0 tabular-nums" title={`${t("manage.tree.total")} · ${t("manage.treeRecords",{count:n.subtreeCount})}`}>{money(n.subtreeAmountMinor)}{complete&&result.totalAmountMinor>0n?` · ${percent(n.subtreeAmountMinor)}`:""}{detail?<span className="block text-right text-muted">{t("manage.tree.direct")} {money(n.directAmountMinor)} · {t("manage.treeRecords",{count:n.directCount})}</span>:null}</span>
    </li>)}</ul>:null}
    {!detail&&nodes.length>shown.length?<p className="text-helper text-muted">{t("statsWorkbench.values.more",{count:nodes.length-shown.length})}</p>:null}
  </div>;
}
function HierarchyFlow({result,money,detail,height}:{readonly result:ReturnType<typeof buildHierarchySankey>;readonly money:(n:bigint)=>string;readonly detail:boolean;readonly height:number}):React.JSX.Element {
  const {t}=useI18n();
  // 完整层级图可在自身区域横向滚动；卡片只展示根分支摘要，详情中的树可下钻任意深度。
  const maxDepth=detail?5:1;
  const nodes=result.nodes.filter(n=>n.depth<=maxDepth&&n.inflowMinor+n.outflowMinor>0n).slice(0,100);
  const ids=new Set(nodes.map(n=>n.nodeId)), columns=new Map<number,typeof nodes>();
  for(const n of nodes)columns.set(n.depth,[...(columns.get(n.depth)??[]),n]);
  const h=detail?Math.max(280,...[...columns.values()].map(a=>a.length*38)):Math.max(80,height);
  const w=detail?(Math.max(1,...columns.keys())+1)*180:360;
  const positions=new Map<string,{x:number;y:number;size:number}>();
  const usable=h-20-Math.max(...[...columns.values()].map(list=>list.length))*5;
  for(const [depth,list]of columns){let y=10;for(const n of list){const size=ratio(n.depth===0?result.totalMinor:n.inflowMinor,result.totalMinor)*usable;positions.set(n.nodeId,{x:depth*(w/(Math.max(1,...columns.keys())+1))+8,y,size});y+=size+5;}}
  const outgoing=new Map<string,number>(),incoming=new Map<string,number>();
  const ribbons=result.links.filter(l=>ids.has(l.fromId)&&ids.has(l.toId)).map(l=>{const a=positions.get(l.fromId)!,b=positions.get(l.toId)!,size=ratio(l.amountMinor,result.totalMinor)*usable;const topA=a.y+(outgoing.get(l.fromId)??0),topB=b.y+(incoming.get(l.toId)??0);outgoing.set(l.fromId,(outgoing.get(l.fromId)??0)+size);incoming.set(l.toId,(incoming.get(l.toId)??0)+size);const left=a.x+8,right=b.x,middle=(left+right)/2;return {link:l,d:`M${left},${topA} C${middle},${topA} ${middle},${topB} ${right},${topB} L${right},${topB+size} C${middle},${topB+size} ${middle},${topA+size} ${left},${topA+size} Z`};});
  return <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" tabIndex={0} role="img" aria-label={t("statsWorkbench.cards.AN-P07.title")}><svg width={detail?w:"100%"} height={h} viewBox={`0 0 ${w} ${h}`}>
    {ribbons.map(({link,d})=><path key={`${link.fromId}:${link.toId}`} d={d} fill="var(--color-brand)" fillOpacity={0.22}><title>{money(link.amountMinor)}</title></path>)}
    {nodes.map(n=>{const p=positions.get(n.nodeId)!;return <g key={n.nodeId}><title>{`${n.kind==="direct"?t("manage.tree.direct"):n.label} · ${money(n.depth===0?result.totalMinor:n.inflowMinor)}`}</title><rect x={p.x} y={p.y} width={8} height={p.size} rx={3} fill="var(--color-brand)"/><text x={p.x+12} y={p.y+Math.min(p.size/2+4,14)} fontSize={11} fill="var(--color-ink)">{n.kind==="direct"?t("manage.tree.direct"):n.kind==="root"?t("manage.tree.total"):n.label.slice(0,10)}</text></g>;})}
  </svg></div>;
}
