import { readFileSync } from "node:fs";
export function localCandidate() {
  const path=process.env.LIBEVRA_E2E_CONFIG;
  if(!path)return null;
  const config=JSON.parse(readFileSync(path,"utf8"));
  if(config.web!=="http://127.0.0.3:5189"||config.api!=="http://127.0.0.1:3021/api/v1"||config.port!==9246)throw Error("统一验收只允许专用回环预览");
  return config;
}
