import { useState } from "react";
import { categoryPath, type Category } from "@libellum/shared";
import { useI18n } from "../i18n/index.js";
import { displayCategoryName } from "../lib/presetNames.js";
/** 仅有真实子分类时使用；名称按钮仍可直接选择父分类，箭头负责进入。 */
export function CategoryPicker({categories,allCategories=categories,onSelect}:{readonly categories:readonly Category[];readonly allCategories?:readonly Category[];readonly onSelect:(id:string|null)=>void}):React.JSX.Element {
  const {t}=useI18n();const [parent,setParent]=useState<string|null>(null),[query,setQuery]=useState("");
  const ids=new Set(categories.map(c=>c.id));
  const path=(id:string)=>categoryPath(allCategories,id).map(c=>displayCategoryName(c.name)).join(" / ");
  const visible=query.trim()?categories.filter(c=>path(c.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):categories.filter(c=>(c.parentId&&ids.has(c.parentId)?c.parentId:null)===parent);
  return <div className="flex min-w-0 flex-col gap-2 p-3">
    <input aria-label={t("manage.tree.search")} placeholder={t("manage.tree.search")} value={query} onChange={e=>setQuery(e.target.value)} className="min-w-0 rounded-field border border-line bg-surface px-3 py-2 text-base text-ink"/>
    {parent&&!query?<button type="button" className="min-h-11 text-left text-sm text-brand-dark" onClick={()=>setParent(categories.find(c=>c.id===parent)?.parentId??null)}>‹ {t("manage.tree.back")}</button>:null}
    <div className="max-h-64 overflow-y-auto divide-y divide-line">
      {parent===null&&!query?<button type="button" className="w-full px-2 py-3 text-left text-sm text-muted" onClick={()=>onSelect(null)}>{displayCategoryName("暂无分类")}</button>:null}
      {visible.map(c=><div key={c.id} className="flex min-w-0 items-stretch"><button type="button" className="min-w-0 flex-1 break-words px-2 py-3 text-left text-sm text-ink" onClick={()=>onSelect(c.id)}>{displayCategoryName(c.name)}{c.parentId&&(query||!ids.has(c.parentId))?<span className="block text-helper text-muted">{path(c.id)}</span>:null}</button>{categories.some(n=>n.parentId===c.id)?<button type="button" aria-label={t("manage.tree.toggle",{name:displayCategoryName(c.name)})} className="min-h-11 min-w-11 text-muted" onClick={()=>{setParent(c.id);setQuery("");}}>›</button>:null}</div>)}
    </div>
  </div>;
}
