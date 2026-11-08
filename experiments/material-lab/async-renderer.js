import {Renderer,canvas} from './renderer.js';
import {blurSteps,VERSION} from './core.js';
const bytes=c=>c.width*c.height*4,HEADER=220,ROW=86;
export class AsyncRenderer extends Renderer {
 async measured(key,budget,fn){const before=budget.metrics.cpuMs;const result=await fn();this.metrics[key]+=budget.metrics.cpuMs-before;return result;}
 async referenceAsync(rows,o,b){return this.measured('referenceMs',b,async()=>{
  const h=HEADER+rows.length*ROW,c=await b.step(()=>canvas(o.width*o.dpr,h*o.dpr)),ctx=c.getContext('2d');
  await b.step(()=>{ctx.scale(o.dpr,o.dpr);this.base(ctx,o.width,h,o.theme);this.header(ctx,o.width,rows,o,false);});
  for(let i=0;i<rows.length;i++)await b.step(()=>{ctx.save();ctx.translate(0,HEADER+i*ROW);this.row(ctx,o.width,rows[i],o,false);ctx.restore();});return c;
 });}
 async proxyAsync(rows,o,cached,b){return this.measured('proxyMs',b,async()=>{
  const h=HEADER+rows.length*ROW,c=await b.step(()=>canvas(o.width*o.scale,h*o.scale)),ctx=c.getContext('2d');
  await b.step(()=>{ctx.scale(o.scale,o.scale);this.base(ctx,o.width,h,o.theme);this.header(ctx,o.width,rows,o,true);});
  for(let i=0;i<rows.length;i++)await b.step(()=>{const row=rows[i],key=JSON.stringify([VERSION,row,o.width,o.scale,o.precision,o.theme,'system-ui']);let rc=cached?this.rows.get(key):null;if(!rc){rc=canvas(o.width*o.scale,ROW*o.scale);const cx=rc.getContext('2d');cx.scale(o.scale,o.scale);this.row(cx,o.width,row,o,true);if(cached)this.rows.set(key,rc,bytes(rc));this.metrics.proxyUpdates++;}ctx.drawImage(rc,0,HEADER+i*ROW,o.width,ROW);});return c;
 });}
 async blurAsync(c,r,b){return this.measured('blurMs',b,async()=>{
  const image=await b.step(()=>c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height));
  const pixels=await b.consume(blurSteps(image.data,c.width,c.height,r));
  return b.step(()=>{const out=canvas(c.width,c.height);image.data.set(pixels);out.getContext('2d').putImageData(image,0,0);return out;});
 });}
 async renderAsync(mode,rows,o,reference,b){this.proxyCanvas=null;if(mode==='native')return null;
  const key=JSON.stringify([VERSION,mode,rows,o.width,o.scale,o.precision,o.theme,o.blur]);
  if(mode!=='tiled'){const ready=await b.step(()=>this.surfaces.get(key));if(ready)return ready;}
  const source=mode==='precomputed'?await b.step(()=>{const c=canvas(o.width*o.scale,(HEADER+rows.length*ROW)*o.scale);c.getContext('2d').drawImage(reference,0,0,c.width,c.height);return c;}):await this.proxyAsync(rows,o,mode==='tiled',b);
  if(mode!=='precomputed')this.proxyCanvas=source;
  const r=Math.round(o.blur*o.scale);
  if(mode!=='tiled'){const result=await this.blurAsync(source,r,b);b.check();this.surfaces.set(key,result,bytes(result));return result;}
  const out=await b.step(()=>canvas(source.width,source.height)),ctx=out.getContext('2d'),tile=128,halo=3*r;
  for(let y=0;y<source.height;y+=tile){
   const start=Math.max(0,y-halo),end=Math.min(source.height,y+tile+halo),first=Math.max(0,Math.floor((start/o.scale-HEADER)/ROW)),last=Math.ceil((end/o.scale-HEADER)/ROW);
   const k=JSON.stringify([VERSION,y,end-start,o.width,o.scale,o.precision,o.theme,r,start<HEADER*o.scale?rows.map(x=>[x.amount,x.income]):null,rows.slice(first,Math.max(first,last))]);
   let tc=await b.step(()=>this.tiles.get(k));
   if(!tc){const segment=await b.step(()=>{const c=canvas(source.width,end-start);c.getContext('2d').drawImage(source,0,start,source.width,end-start,0,0,source.width,end-start);return c;});
    const blurred=await this.blurAsync(segment,r,b);tc=await b.step(()=>{const c=canvas(source.width,Math.min(tile,source.height-y));c.getContext('2d').drawImage(blurred,0,y-start,c.width,c.height,0,0,c.width,c.height);return c;});b.check();this.tiles.set(k,tc,bytes(tc));this.metrics.tileUpdates++;
   }await b.step(()=>ctx.drawImage(tc,0,y));
  }return out;
 }
}
