import {describe,expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {categoryBranchIds,type Category} from "@libellum/shared";
import {applyLocale} from "../i18n/index.js";
import {HierarchyView} from "./HierarchyView.js";
import {CategoryPicker} from "../components/CategoryPicker.js";
import {filterIds,readFilters,sameFilters,writeFilters} from "./filters.js";
const category=(id:string,name:string,parentId:string|null):Category=>({id,name,parentId,kind:"expense",description:null,isSystem:false,isArchived:false,sortOrder:0});
const categories=[category("food","餐饮",null),category("take","外卖","food"),category("china","中餐","take"),category("hot","火锅","china"),{...category("dine","堂食","food"),sortOrder:1}];
const records=[{id:"1",categoryId:"food",categoryLabel:"餐饮",kind:"expense" as const,amountMinor:10000n,currency:"CNY",occurredLocalDate:"2026-10-01",paymentMethodId:null,paymentMethodLabel:null},{id:"2",categoryId:"hot",categoryLabel:"火锅",kind:"expense" as const,amountMinor:25000n,currency:"CNY",occurredLocalDate:"2026-10-01",paymentMethodId:null,paymentMethodLabel:null},{id:"3",categoryId:"dine",categoryLabel:"堂食",kind:"expense" as const,amountMinor:15000n,currency:"CNY",occurredLocalDate:"2026-10-01",paymentMethodId:null,paymentMethodLabel:null}];
const range={from:"2026-10-01",to:"2026-10-29"};
describe("W7 层级展示与分支条件",()=>{
 it("父节点归档后，仍可选择活跃子分类且完整路径不丢失",()=>{applyLocale("zh-CN");const child={...categories[3]!,parentId:"food"};const html=renderToStaticMarkup(<CategoryPicker categories={[child]} allCategories={[{...categories[0]!,isArchived:true},child]} onSelect={()=>{}}/>);expect(html).toContain("餐饮 / 火锅");expect(html).toContain("火锅");});
 it("精确旧链接不扩展，新分支往返保留，空集不同于不限",()=>{const exact=readFilters(new URLSearchParams("category=food")),branch=readFilters(new URLSearchParams("categoryBranch=food&categoryBranch=take"));expect(filterIds(exact).categoryIds).toEqual(["food"]);expect(categoryBranchIds(categories,branch.categoryBranchIds!)).toHaveLength(5);expect(sameFilters(branch,readFilters(writeFilters(new URLSearchParams(),branch)))).toBe(true);expect(sameFilters(exact,branch)).toBe(false);expect(filterIds(readFilters(new URLSearchParams("categoryBranch="))).categoryIds).toEqual([]);});
 it("深度优先展示，不把孙节点放到另一分支后；日期下钻与直接金额保留",()=>{applyLocale("zh-CN");const html=renderToStaticMarkup(<HierarchyView records={records} categories={categories} currency="CNY" range={range} detail sankey={false} complete height={240}/>);expect(html.indexOf('>火锅</a>')).toBeLessThan(html.indexOf('>堂食</a>'));expect(html).toContain("¥500.00");expect(html).toContain("直接归入");expect(html).toContain("¥100.00");expect(html).toContain("100.0%");expect(html).toContain("from=2026-10-01");expect(html).toContain("categoryBranch=hot");});
 it("不完整结果无百分比和面积；全空后代的父直接交易不触发误报",()=>{applyLocale("zh-CN");const partial=renderToStaticMarkup(<HierarchyView records={records} categories={categories} currency="CNY" range={range} detail sankey complete={false} height={240}/>);expect(partial).not.toContain("%");expect(partial).not.toContain("<svg");expect(partial).toContain("¥500.00");const direct=renderToStaticMarkup(<HierarchyView records={records.slice(0,1)} categories={categories} currency="CNY" range={range} detail sankey complete height={240}/>);expect(direct).not.toContain("核对不一致");expect(direct).toContain("¥100.00");});
});
