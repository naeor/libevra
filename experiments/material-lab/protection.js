// 所有阈值是 Lab 实验参数，不是生产默认值。
export class Protection {
 constructor(){this.level=0;this.bad=0;this.stableSince=null;this.lastChange=0;this.enabled=true;this.config={frameMs:40,inputMs:120,badWindows:2,recoverMs:12000};this.history=[];}
 change(level,reason,now){if(level===this.level)return false;this.history.push({at:now,from:this.level,to:level,reason,config:{...this.config}});this.level=level;this.lastChange=now;this.bad=0;this.stableSince=null;return true;}
 sample({p95,input=0},now){if(!this.enabled)return false;
  const pressure=p95>this.config.frameMs||input>this.config.inputMs;
  if(pressure){this.stableSince=null;this.bad++;if(this.bad>=this.config.badWindows&&this.level<2)return this.change(this.level+1,'连续帧时间 / 输入延迟超阈值',now);}
  else {this.bad=0;if(this.stableSince===null)this.stableSince=now;if(this.level>0&&now-this.stableSince>=this.config.recoverMs&&now-this.lastChange>=this.config.recoverMs)return this.change(this.level-1,'稳定窗口后尝试恢复一级',now);}
  return false;
 }
}
export const abortError=()=>new DOMException('任务已取消','AbortError');
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
// MessageChannel 避免嵌套 timer 的等待累积；仍严格分批，不提高后台预算。
export function yieldTask(){if(typeof window==='undefined'||typeof MessageChannel==='undefined')return delay(0);return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(0);});}
/** 每个任务检查预算；Canvas / typed array 单个调用不可抢占，实际超额如实统计。 */
export class Budget {
 constructor(signal,{budgetMs=3,busy=()=>false,hidden=()=>document.hidden}={}){this.signal=signal;this.budgetMs=budgetMs;this.busy=busy;this.hidden=hidden;this.sliceStart=performance.now();this.metrics={yields:0,maxSliceMs:0,overruns:0,cpuMs:0};}
 check(){if(this.signal.aborted)throw abortError();}
 async gate(){this.check();while(this.hidden()||this.busy()){await delay(25);this.check();}this.sliceStart=performance.now();}
 async step(fn){this.check();if(this.hidden()||this.busy()||performance.now()-this.sliceStart>=this.budgetMs){this.metrics.yields++;await yieldTask();await this.gate();}const t=performance.now(),v=fn(),dt=performance.now()-t;this.metrics.cpuMs+=dt;const slice=performance.now()-this.sliceStart;this.metrics.maxSliceMs=Math.max(this.metrics.maxSliceMs,slice);if(dt>this.budgetMs)this.metrics.overruns++;return v;}
 /** 在同一预算批次内消费细粒度迭代器，避免每几百像素都创建 Promise。 */
 async consume(iterator){let next;do{next=await this.step(()=>{let part;do{this.check();part=iterator.next();}while(!part.done&&performance.now()-this.sliceStart<this.budgetMs);return part;});}while(!next.done);return next.value;}
}
