import { writeFileSync } from "node:fs";
import { APP_VERSION } from "../../packages/shared/src/version.ts";
import { localCandidate } from "./local-candidate.mjs";
import { assert, openPage } from "./cdp.mjs";
const config=localCandidate();if(!config)throw Error("只允许统一候选环境");
const health=await (await fetch(config.api+"/health")).json();
assert(health.version===APP_VERSION&&health.database==="up","运行的 API 并非统一候选");
writeFileSync(config.outputRoot+"/health.json",JSON.stringify(health,null,2));
const page=await openPage(config.port,config.web);
try{
 await page.setViewport(390,844,true);
 await page.navigate(config.web+"/about");
 await page.waitFor(`document.body.innerText.includes(${JSON.stringify(APP_VERSION)})`,15000);
 await page.screenshot(config.outputRoot+"/00-about-version.png");
 await page.navigate(config.web+"/stats");
 await page.waitFor("document.querySelector('[data-fx-stats]')?.innerText.includes('885.75 CNY')",15000);
 await page.screenshot(config.outputRoot+"/00-unified-preview.png");
 console.log(`API 与真实页面版本一致：${APP_VERSION}，统一预览 885.75 CNY`);
}finally{page.close();}
