import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { api, apiLogin } from "./cdp.mjs";
const preview=JSON.parse(readFileSync("_backups/fx-d4/preview.json","utf8"));
if(preview.url!=="http://127.0.0.3:5189")throw Error("预览来源不符");
const endpoint="http://127.0.0.1:3021/api/v1";
const member=await apiLogin(endpoint,"fx_member",preview.password);
const books=(await api(endpoint,"/books",{cookie:member})).data.books;
const own=books.find(book=>book.isCreator&&book.id!==preview.bookId);
if(!own)throw Error("缺少成员个人账本");
const shared={username:"fx_preview",password:preview.password,bookId:preview.bookId,bookName:"汇率验收共享账本"};
const solo={username:"fx_member",password:preview.password,bookId:own.id,bookName:own.name};
const owner=await apiLogin(endpoint,shared.username,shared.password);
const messages=(await api(endpoint,"/books/messages?limit=200",{cookie:owner,bookId:shared.bookId})).data.messages;
if(!Array.isArray(messages))throw Error("留言夹具响应形状异常");
const existing=messages.filter(message=>message.body.startsWith("统一验收滚动基线")).length;
for(let index=existing;index<20;index++){
  const result=await api(endpoint,"/books/messages",{method:"POST",cookie:owner,bookId:shared.bookId,body:{body:`统一验收滚动基线 ${index+1} · 仅合成测试数据`}});
  if(result.status!==201)throw Error(`合成留言失败 ${result.status}`);
}
const outputRoot="_backups/unified/e2e";mkdirSync(outputRoot+"/screenshots",{recursive:true});
writeFileSync("_backups/unified/e2e-config.json",JSON.stringify({web:preview.url,api:endpoint,port:9246,outputRoot,shared,solo,avatar:shared},null,2));
writeFileSync(outputRoot+"/state.json",JSON.stringify({users:{a:shared,b:solo},books:{a:{id:shared.bookId,name:shared.bookName}}},null,2));
console.log("统一浏览器夹具已保存到 ignored 配置，无凭据回显");
