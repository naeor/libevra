import {AsyncRenderer} from './async-renderer.js';
import {canvas} from './renderer.js';
import {Cache,VERSION} from './core.js';
const H=220,R=86,T=128,bytes=c=>c.width*c.height*4;
export const rowContent=r=>[r.id,r.name,r.amount,r.income,r.color,r.date,r.icon];
export function tilePlan(rows,o,top,height){const total=Math.ceil((H+rows.length*R)*o.scale),halo=3*Math.round(o.blur*o.scale),lo=Math.max(0,(Math.floor(top*o.scale/T)-1)*T),hi=Math.min(total,(Math.ceil((top+height)*o.scale/T)+1)*T),out=[];
 for(let y=lo;y<hi;y+=T){const start=Math.max(0,y-halo),end=Math.min(total,y+T+halo),first=Math.max(0,Math.floor((start/o.scale-H)/R)),last=Math.min(rows.length,Math.ceil((end/o.scale-H)/R));const sums=start<H*o.scale?rows.reduce((a,r)=>(a[r.income?0:1]+=r.amount,a),[0,0]):null;
 out.push({y,start,end,height:Math.min(T,total-y),first,last,key:JSON.stringify([VERSION,y,start,end,o.width,o.scale,o.precision,o.theme,o.blur,sums,rows.slice(first,last).map(rowContent)])});}return out;}
export class ViewportRenderer extends AsyncRenderer{
 constructor(){super();this.rows=new Cache(8*2**20);this.tiles=new Cache(16*2**20);this.surfaces=new Cache(8*2**20);this.referenceMemo=null;}
 clear(){super.clear();this.referenceMemo=null;}
 async referenceAsync(rows,o,b){const key=JSON.stringify([rows.map(rowContent),o.width,o.dpr,o.theme]);if(this.referenceMemo?.key===key)return this.referenceMemo.value;const value=await super.referenceAsync(rows,o,b);b.check();this.referenceMemo={key,value};return value;}
 async region(rows,o,p,b){return this.measured('proxyMs',b,async()=>{const c=await b.step(()=>canvas(o.width*o.scale,p.end-p.start)),ctx=c.getContext('2d');await b.step(()=>{ctx.scale(o.scale,o.scale);ctx.translate(0,-p.start/o.scale);this.base(ctx,o.width,H+rows.length*R,o.theme);if(p.start<H*o.scale)this.header(ctx,o.width,rows,o,true);});
 for(let i=p.first;i<p.last;i++)await b.step(()=>{const r=rows[i],key=JSON.stringify([rowContent(r),o.width,o.scale,o.precision,o.theme]);let rc=this.rows.get(key);if(!rc){rc=canvas(o.width*o.scale,R*o.scale);const cx=rc.getContext('2d');cx.scale(o.scale,o.scale);this.row(cx,o.width,r,o,true);this.rows.set(key,rc,bytes(rc));this.metrics.proxyUpdates++;}ctx.drawImage(rc,0,H+i*R,o.width,R);});return c;});}
 async viewport(rows,o,top,height,b){const plan=tilePlan(rows,o,top,height),key=JSON.stringify(plan.map(p=>p.key));const hit=await b.step(()=>this.surfaces.get(key));if(hit)return hit;
 const first=plan[0].y,last=plan.at(-1),out=await b.step(()=>canvas(o.width*o.scale,last.y+last.height-first)),ctx=out.getContext('2d');
 for(const p of plan){let c=await b.step(()=>this.tiles.get(p.key));if(!c){const source=await this.region(rows,o,p,b),blurred=await this.blurAsync(source,Math.round(o.blur*o.scale),b);c=await b.step(()=>{const c=canvas(out.width,p.height);c.getContext('2d').drawImage(blurred,0,p.y-p.start,c.width,c.height,0,0,c.width,c.height);return c;});b.check();this.tiles.set(p.key,c,bytes(c));this.metrics.tileUpdates++;}await b.step(()=>ctx.drawImage(c,0,p.y-first));}
 const result={canvas:out,originY:first/o.scale,range:[first/o.scale,(last.y+last.height)/o.scale],tileCount:plan.length};b.check();this.surfaces.set(key,result,bytes(out));return result;}
 material(output,texture,rect,scroll,o){return super.material(output,texture.canvas||texture,rect,scroll-(texture.originY||0),o);}
}
