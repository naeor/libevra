import { useState } from "react";
import { categoryBranchIds, categoryPath, categoryTreeRows, validateCategoryTree, type Category, type CreateCategoryInput, type UpdateCategoryInput } from "@libellum/shared";
import { BottomSheet } from "./BottomSheet.js";
import { useI18n } from "../i18n/index.js";
import { displayCategoryName, displayCategoryDescription } from "../lib/presetNames.js";
import { errorMessage } from "../lib/api.js";
type Save = (id:string|null,input:CreateCategoryInput & UpdateCategoryInput)=>Promise<unknown>;
export function CategoryTreeList({items,allItems=items,readOnly,onArchive,onDelete,onSave}:{readonly items:readonly Category[];readonly allItems?:readonly Category[];readonly readOnly:boolean;readonly onArchive:(item:Category)=>void;readonly onDelete:(item:Category)=>void;readonly onSave:Save}):React.JSX.Element {
  const {t}=useI18n();const [collapsed,setCollapsed]=useState<readonly string[]>([]);
  const [editor,setEditor]=useState<{category:Category|null;parentId:string|null;kind:"expense"|"income"}|null>(null);
  const hidden=new Set(collapsed.flatMap(id=>categoryBranchIds(items,[id]).filter(child=>child!==id)));
  return <><ul className="rounded-card border border-line bg-surface divide-y divide-line">
    {categoryTreeRows(items).filter(row=>!hidden.has(row.node.id)).map(({node,depth})=><li key={node.id} className="flex min-w-0 items-center gap-2 px-5 py-3.5" style={{paddingLeft:20+Math.min(depth,4)*12}}>
      {items.some(c=>c.parentId===node.id)?<button type="button" className="min-h-11 min-w-8 text-muted" aria-label={t("manage.tree.toggle",{name:displayCategoryName(node.name)})} aria-expanded={!collapsed.includes(node.id)} onClick={()=>setCollapsed(value=>value.includes(node.id)?value.filter(id=>id!==node.id):[...value,node.id])}>{collapsed.includes(node.id)?"›":"⌄"}</button>:null}
      <span className="min-w-0 flex-1 break-words text-sm text-ink">{node.color?<span aria-hidden="true" className="mr-1 inline-block size-2 rounded-full" style={{backgroundColor:node.color}}/>:null}{node.icon?<span aria-hidden="true">{node.icon} </span>:null}{displayCategoryName(node.name)}{node.description?<span className="block text-helper-relaxed text-muted">{displayCategoryDescription(node.name,node.kind,node.description)}</span>:null}{node.isSystem?<span className="block text-helper text-muted">{t("manage.common.systemLocked")}</span>:null}</span>
      {!readOnly&&!node.isSystem?<details className="relative shrink-0" onClick={event=>{if(event.target instanceof Element&&event.target.closest("button"))event.currentTarget.open=false;}}><summary className="cursor-pointer list-none px-2 py-2 text-muted" aria-label={t("manage.tree.actions",{name:displayCategoryName(node.name)})}>•••</summary><div className="absolute right-0 z-10 flex min-w-36 flex-col rounded-field border border-line bg-surface p-1 shadow-lg">
        <button type="button" className="px-3 py-3 text-left text-sm" onClick={()=>setEditor({category:node,parentId:node.parentId??null,kind:node.kind})}>{t("manage.tree.edit")}</button>
        <button type="button" className="px-3 py-3 text-left text-sm" onClick={()=>setEditor({category:null,parentId:node.id,kind:node.kind})}>{t("manage.tree.addChild")}</button>
        <button type="button" className="px-3 py-3 text-left text-sm" onClick={()=>onArchive(node)}>{t("manage.common.archive")}</button>
        <button type="button" className="px-3 py-3 text-left text-sm text-warn-dark" onClick={()=>onDelete(node)}>{t("manage.common.deletePermanently")}</button>
      </div></details>:null}
    </li>)}
  </ul>{editor?<CategoryEditor key={`${editor.category?.id??"new"}:${editor.parentId}`} items={allItems} {...editor} onClose={()=>setEditor(null)} onSave={onSave}/>:null}</>;
}
function CategoryEditor({items,category,parentId:initialParent,kind,onClose,onSave}:{readonly items:readonly Category[];readonly category:Category|null;readonly parentId:string|null;readonly kind:"expense"|"income";readonly onClose:()=>void;readonly onSave:Save}):React.JSX.Element {
  const {t}=useI18n();const [name,setName]=useState(category?.name??""),[parentId,setParent]=useState(initialParent??"");
  const [icon,setIcon]=useState(category?.icon??""),[color,setColor]=useState(category?.color??""),[sortOrder,setSort]=useState(category?.sortOrder??0);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const excluded=new Set(category?categoryBranchIds(items,[category.id]):[]);
  const inputClass="min-w-0 w-full rounded-field border border-line bg-surface px-3 py-3 text-base text-ink";
  return <BottomSheet label={t(category?"manage.tree.edit":"manage.tree.addChild")} onClose={onClose} dialogClassName="w-full max-w-lg rounded-t-sheet bg-canvas p-6 sm:rounded-sheet max-h-[85dvh] overflow-y-auto">
    <form className="flex flex-col gap-4" onSubmit={event=>{event.preventDefault();const input={name:name.trim(),kind,parentId:parentId||null,icon:icon||null,color:color||null,sortOrder};
      try{validateCategoryTree([...items.filter(n=>n.id!==category?.id),{...input,id:category?.id??"new"}]);}catch{setError(t("manage.tree.invalid"));return;}
      setBusy(true);void onSave(category?.id??null,input).then(onClose).catch(caught=>setError(errorMessage(caught))).finally(()=>setBusy(false));}}>
      <h2 className="text-section-title text-ink">{t(category?"manage.tree.edit":"manage.tree.addChild")}</h2>
      {error?<p role="alert" className="text-sm text-warn-dark">{error}</p>:null}
      <label className="text-sm text-muted">{t("manage.tree.name")}<input className={inputClass} value={name} maxLength={20} required onChange={e=>setName(e.target.value)}/></label>
      <details open={initialParent!==null}><summary className="cursor-pointer text-sm text-muted">{t("manage.tree.organize")}</summary><div className="mt-3 flex flex-col gap-3">
        <label className="text-sm text-muted">{t("manage.tree.parent")}<select className="min-w-0 w-full rounded-field border border-line bg-surface px-3 py-3 text-base text-ink" value={parentId} onChange={e=>setParent(e.target.value)}><option value="">{t("manage.tree.root")}</option>{categoryTreeRows(items).filter(({node})=>!excluded.has(node.id)&&!node.isArchived&&!node.isSystem&&node.kind===kind).map(({node})=><option key={node.id} value={node.id}>{categoryPath(items,node.id).map(n=>displayCategoryName(n.name)).join(" / ")}</option>)}</select></label>
        <label className="text-sm text-muted">{t("manage.tree.order")}<input className={inputClass} type="number" min={0} max={9999} value={sortOrder} onChange={e=>setSort(Number(e.target.value))}/></label>
        <label className="text-sm text-muted">{t("manage.tree.icon")}<input className={inputClass} value={icon} maxLength={32} onChange={e=>setIcon(e.target.value)}/></label>
        <label className="text-sm text-muted">{t("manage.tree.color")}<input className={inputClass} value={color} pattern="#[0-9a-fA-F]{6}|" onChange={e=>setColor(e.target.value)}/></label>
      </div></details>
      <div className="flex justify-end gap-3"><button type="button" className="min-h-11 px-3 text-muted" onClick={onClose}>{t("common.action.cancel")}</button><button type="submit" disabled={busy} className="min-h-11 rounded-field bg-brand px-5 text-on-brand disabled:opacity-45">{t("common.action.save")}</button></div>
    </form>
  </BottomSheet>;
}
