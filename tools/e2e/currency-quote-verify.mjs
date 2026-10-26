import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { localCandidate } from "./local-candidate.mjs";
import { api, apiLogin, assert, openPage, runCase } from "./cdp.mjs";
const config=localCandidate();if(!config)throw Error("只允许统一候选隔离夹具");
const folder=config.outputRoot+"/cross-feature";mkdirSync(folder,{recursive:true});
const cookie=await apiLogin(config.api,config.shared.username,config.shared.password);
const options={cookie,bookId:config.shared.bookId}, id=randomUUID();
const created=await api(config.api,"/transactions",{...options,method:"POST",body:{id,idempotencyKey:id,kind:"expense",amountCents:2000,currency:"USD",occurredAt:"2026-10-23T04:00:00Z",occurredLocalDate:"2026-10-23",occurredTz:"Asia/Shanghai",note:"统一跨功能 · 20 USD 原币引用",tagIds:[]}});
assert(created.status===201,"创建合成原币账目失败");
const page=await openPage(config.port,config.web), results=[];
try{
 await page.setCookie("libellum_session",cookie,config.web);
 await page.navigate(config.web+"/settings/appearance");
 await page.waitFor("!!document.querySelector('[role=switch]')");
 await page.evaluate(`import('/src/lib/currentBook.ts').then(m=>m.selectBookForReload(${JSON.stringify(config.shared.bookId)}))`);
 await page.navigate(config.web+"/settings/appearance");
 await page.waitFor("!!document.querySelector('[role=switch]')");
 if(!(await page.evaluate("document.querySelector('[role=switch]').checked")))await page.evaluate("document.querySelector('[role=switch]').click()");
 await runCase(results,"折算显示与留言快照同时保留原币事实",async()=>{
  await page.navigate(config.web+"/transactions/"+id);
  await page.waitFor("document.body.innerText.includes('133.40 CNY')",15000);
  assert((await page.evaluate("document.body.innerText")).includes("20.00 USD"),"详情必须同时显示原币");
  await page.screenshot(folder+"/01-usd-converted.png");
  const quote=await api(config.api,"/books/messages",{...options,method:"POST",body:{body:"统一跨功能：20 USD 仍是原始账目",reference:{kind:"transaction",id}}});
  assert(quote.status===201,"发送引用失败");
  const stored=await api(config.api,"/transactions/"+id,options);
  assert(stored.data.amountCents===2000&&stored.data.currency==="USD","显示或引用不得改写原币金额");
  await page.navigate(config.web+"/ledger/messages");
  await page.waitFor("document.body.innerText.includes('统一跨功能：20 USD')",15000);
  assert((await page.evaluate("document.body.innerText")).includes("$20.00"),"引用卡片必须展示原币快照");
  await page.screenshot(folder+"/02-quote-original.png");
 });
}finally{writeFileSync(folder+"/results.json",JSON.stringify(results,null,2));page.close();}
if(results.some(row=>row.status!=="pass"))process.exitCode=1;
