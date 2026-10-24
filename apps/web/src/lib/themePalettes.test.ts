import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AVAILABLE_THEME_PALETTES, createThemeController, type ThemeMode } from "./theme.js";

const css=readFileSync(new URL("../index.css",import.meta.url),"utf8");
function block(marker:string):Record<string,string>{const start=css.indexOf(marker);expect(start,marker).toBeGreaterThanOrEqual(0);return Object.fromEntries([...css.slice(start,css.indexOf("}",start)).matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map(m=>[m[1]!,m[2]!]));}
const light=block("@theme {"),dark=block('html[data-theme-mode="dark"][data-theme-palette="green"] {');
const brandRoles=["brand","brand-dark","brand-soft","on-brand","category-ink","focus-ring","ocean-1","ocean-2","ocean-3","ocean-4","on-ocean"].sort();
const contrast=(a:string,b:string):number=>{const lum=(c:string)=>c.slice(1).match(/../g)!.map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i]!,0);return(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);};
describe("七主题正式接线",()=>{
 it("六套映射只覆盖11个品牌角色，财务图表与中性角色不随色盘变化",()=>{
  for(const palette of AVAILABLE_THEME_PALETTES.filter(p=>p!=="green"))for(const mode of ["light","dark"]){
   const overrides=block(`html[data-theme-mode="${mode}"][data-theme-palette="${palette}"],`);
   expect(Object.keys(overrides).sort()).toEqual(brandRoles);
   const full={...(mode==="dark"?dark:light),...overrides};expect(Object.keys(full)).toHaveLength(50);
   for(const[fg,bg,target]of [["on-brand","brand",4.5],["brand-dark","brand-soft",4.5],["category-ink","brand-soft",4.5],["on-ocean","ocean-1",4.5],["focus-ring","surface",3]] as const)expect(contrast(full[fg]!,full[bg]!),`${palette}/${mode}/${fg}`).toBeGreaterThanOrEqual(target);
  }
 });
 it("42种模式和色盘组合写入原key格式，刷新恢复不丢失任一维度",()=>{
  for(const palette of AVAILABLE_THEME_PALETTES)for(const mode of ["light","dark","system"] as ThemeMode[])for(const systemDark of [false,true]){
   let saved:string|null=null;
   const storage={getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}};
   const root={dataset:{} as Record<string,string>,style:{colorScheme:""}};
   const media={matches:systemDark,addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList;
   const controller=createThemeController(root,storage,media);controller.choose({mode,palette});controller.dispose();
   const restored=createThemeController(root,storage,media);expect(restored.getSnapshot()).toEqual({mode,palette});expect(root.dataset["themePalette"]).toBe(palette);expect(root.dataset["themeMode"]).toBe(mode==="system"?(systemDark?"dark":"light"):mode);restored.dispose();
  }
 });
 it("森林绿默认浅色品牌保留，深色海浪是浅色四层完整逆序并用黑字",()=>{
  expect(light.brand).toBe("#55997a");
  expect([1,2,3,4].map(i=>dark[`ocean-${i}`])).toEqual([4,3,2,1].map(i=>light[`ocean-${i}`]));
  expect(dark["on-ocean"]).toBe(dark.canvas);expect(contrast(dark["on-ocean"]!,dark["ocean-1"]!)).toBeGreaterThanOrEqual(4.5);
 });
});
