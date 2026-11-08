export const VERSION='LMPP 0.4.0';
export const MODES=['native','precomputed','uniform','tiled'];
export const NAMES={native:'A · 原生 backdrop-filter',precomputed:'B · 预计算背景',uniform:'C · SSPR 统一模糊',tiled:'D · SSPR Halo 分块'};
export function quantile(a,p){if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.max(0,Math.ceil(p*s.length)-1)];}
export function stats(a){return {n:a.length,mean:a.length?a.reduce((s,v)=>s+v,0)/a.length:null,p50:quantile(a,.5),p95:quantile(a,.95),p99:quantile(a,.99)};}
export function dataset(seed=198411,count=80){let v=seed>>>0;const random=()=>((v=(1664525*v+1013904223)>>>0)/4294967296);const names=['早餐','买咖啡','家庭聚餐','交通 Metro · Line 2','Coffee & croissant','iCloud 月度订阅','Water WWW iii','工资 Salary ¥','周末采购：水果、牛奶以及日用品（长名称测试）','午餐 12:30 / A&B'];const colors=['#6b9581','#bb9764','#6a89a0','#a28099','#b47d70'];return Array.from({length:count},(_,i)=>({id:i,version:0,name:names[i%names.length],amount:Math.round(random()*999999)/100,color:colors[i%5],income:i%9===0,date:`11月${String(28-Math.floor(i/5)%28).padStart(2,'0')}日`,icon:['餐','行','购','家','收'][i%5]}));}
export class Cache{
 constructor(limit=48*1024*1024){this.limit=limit;this.map=new Map();this.bytes=0;this.hits=0;this.misses=0;}
 get(k){const e=this.map.get(k);if(!e){this.misses++;return null;}this.hits++;this.map.delete(k);this.map.set(k,e);return e.value;}
 set(k,value,bytes){if(this.map.has(k)){this.bytes-=this.map.get(k).bytes;this.map.delete(k);}while(this.bytes+bytes>this.limit&&this.map.size){const [key,e]=this.map.entries().next().value;this.bytes-=e.bytes;this.map.delete(key);}if(bytes<=this.limit){this.map.set(k,{value,bytes});this.bytes+=bytes;}return value;}
 clear(){this.map.clear();this.bytes=0;this.hits=0;this.misses=0;}
 snapshot(){return {count:this.map.size,bytes:this.bytes,hits:this.hits,misses:this.misses,hitRate:this.hits+this.misses?this.hits/(this.hits+this.misses):null};}
}
/** 三次可分离盒式核，有限支持半径=3r。Float32 中间值避免逐轮取整引入分块差异。 */
export function* blurSteps(data,w,h,r){
 let a=new Float32Array(data);r=Math.max(0,Math.round(r));if(!r)return new Uint8ClampedArray(a);let scratch=new Float32Array(a.length);
 for(let pass=0;pass<3;pass++)for(const horizontal of [true,false]){
  const b=scratch,len=horizontal?w:h,lines=horizontal?h:w,span=2*r+1,stride=horizontal?4:w*4;
  for(let line=0;line<lines;line++)for(let c=0;c<4;c++){
   const base=(horizontal?line*w*4:line*4)+c;
   let sum=0;for(let n=-r;n<=r;n++)sum+=a[base+Math.min(len-1,Math.max(0,n))*stride];
   for(let n=0,index=base;n<len;n++,index+=stride){b[index]=sum/span;sum+=a[base+Math.min(len-1,n+r+1)*stride]-a[base+Math.max(0,n-r)*stride];if(n%256===255)yield;}
   yield;
  }scratch=a;a=b;
 }return new Uint8ClampedArray(a);
}
export function blurPixels(data,w,h,r){const steps=blurSteps(data,w,h,r);let next;do{next=steps.next();}while(!next.done);return next.value;}
export function affectedTiles(start,end,height,tile,halo){const out=[];for(let y=0;y<height;y+=tile)if(y-halo<end&&y+tile+halo>start)out.push(y);return out;}
