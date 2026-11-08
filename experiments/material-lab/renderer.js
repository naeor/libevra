import {Cache,blurPixels,VERSION} from './core.js';
export const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w));c.height=Math.max(1,Math.ceil(h));return c;};
const bytes=c=>c.width*c.height*4;
const HEADER=220,ROW=86;
export class Renderer{
 constructor(){this.glyphs=new Cache(2**21);this.rows=new Cache();this.tiles=new Cache();this.surfaces=new Cache();this.maps=new Cache(2**20);this.metrics={};this.resetMetrics();}
 resetMetrics(){this.metrics={proxyMs:0,blurMs:0,compositionMs:0,referenceMs:0,proxyUpdates:0,tileUpdates:0};}
 clear(){for(const c of [this.glyphs,this.rows,this.tiles,this.surfaces,this.maps])c.clear();}
 cache(){const names=['glyphs','rows','tiles','surfaces','maps'],all=names.map(k=>this[k].snapshot());const hits=all.reduce((s,x)=>s+x.hits,0),misses=all.reduce((s,x)=>s+x.misses,0);return {count:all.reduce((s,x)=>s+x.count,0),bytes:all.reduce((s,x)=>s+x.bytes,0),hits,misses,hitRate:hits+misses?hits/(hits+misses):null,breakdown:all,named:Object.fromEntries(names.map((k,i)=>[k,all[i]])),hitMeaning:'所有查询（含大量字形查询）的命中比例，不是整页复用比例；应结合分层 named 统计',byteMeaning:'RGBA/Float32/Float64 载荷估计；不含 JS 对象、浏览器纹理副本与真实显存'};}
 glyph(ch,font,n){const key=`${font}:${ch}:${n}`;let g=this.glyphs.get(key);if(g)return g;
  const c=canvas(80,60),ctx=c.getContext('2d',{willReadFrequently:true});ctx.font=font;const m=ctx.measureText(ch),w=Math.max(1,Math.ceil(m.width)),size=parseFloat(font.match(/(\d+)px/)[1]);ctx.fillStyle='#000';ctx.fillText(ch,2,40);const pixels=ctx.getImageData(2,40-size,w,size+5).data;const grid=[];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){let sum=0,count=0;for(let py=Math.floor(y*(size+5)/n);py<Math.floor((y+1)*(size+5)/n);py++)for(let px=Math.floor(x*w/n);px<Math.floor((x+1)*w/n);px++){sum+=pixels[(py*w+px)*4+3]/255;count++;}grid.push(count?sum/count:0);}
  g={width:m.width,height:size+5,ascent:size,descent:m.actualBoundingBoxDescent,grid};return this.glyphs.set(key,g,grid.length*8+32);
 }
 text(ctx,text,x,y,font,color,proxy,n,maxWidth){ctx.font=font;ctx.fillStyle=color;
  while(ctx.measureText(text).width>maxWidth&&text.length>1)text=text.slice(0,-2)+'…';
  if(!proxy){ctx.fillText(text,x,y);return;}
  const chars=Array.from(text);let offset=0,prior='';for(const ch of chars){const g=this.glyph(ch,font,n);const advance=ctx.measureText(prior+ch).width-ctx.measureText(prior).width;for(let gy=0;gy<n;gy++)for(let gx=0;gx<n;gx++){ctx.globalAlpha=g.grid[gy*n+gx];ctx.fillRect(x+offset+gx*advance/n,y-g.ascent+gy*g.height/n,advance/n,g.height/n);}offset+=advance;prior+=ch;}ctx.globalAlpha=1;
 }
 palette(theme){return theme==='dark'?{bg:'#273933',ink:'#e7ede7',muted:'#a4b7ac',line:'#3c5047',summary:'#426957'}:{bg:'#f4f6f2',ink:'#273d34',muted:'#7b8e84',line:'#dfe6df',summary:'#6b9581'};}
 base(ctx,w,h,theme){const p=this.palette(theme);ctx.fillStyle=p.bg;ctx.fillRect(0,0,w,h);const g=ctx.createLinearGradient(0,0,w,HEADER);g.addColorStop(0,p.summary);g.addColorStop(1,theme==='dark'?'#344c46':'#a9c3ac');ctx.fillStyle=g;ctx.fillRect(0,0,w,HEADER);}
 header(ctx,w,rows,o,proxy){const p=this.palette(o.theme),income=rows.filter(r=>r.income).reduce((s,r)=>s+r.amount,0),expense=rows.filter(r=>!r.income).reduce((s,r)=>s+r.amount,0);this.text(ctx,'Libevra · 家庭账本',22,39,'600 18px system-ui','#fff',proxy,o.precision,w-44);this.text(ctx,'2026年11月  ·  本月收支',22,73,'400 13px system-ui','#f1f6ef',proxy,o.precision,w-44);this.text(ctx,'支出',22,115,'400 13px system-ui','#fff',proxy,o.precision,w-44);this.text(ctx,'¥ '+expense.toFixed(2),22,151,'600 28px system-ui','#fff',proxy,o.precision,w-44);this.text(ctx,'收入 ¥ '+income.toFixed(2),22,188,'400 14px system-ui','#fff',proxy,o.precision,w-44);}
 row(ctx,w,row,o,proxy){const p=this.palette(o.theme);ctx.fillStyle=p.bg;ctx.fillRect(0,0,w,ROW);this.text(ctx,row.date,22,19,'400 11px system-ui',p.muted,proxy,o.precision,w-44);ctx.fillStyle=row.color;ctx.beginPath();ctx.arc(35,48,13+(row.id%3),0,Math.PI*2);ctx.fill();this.text(ctx,row.icon,28,53,'500 13px system-ui','#fff',proxy,o.precision,25);this.text(ctx,row.name,60,44,'500 14px system-ui',p.ink,proxy,o.precision,w-170);this.text(ctx,'支付方式 · Visa / 微信',60,64,'400 10px system-ui',p.muted,proxy,o.precision,w-170);const amount=(row.income?'+':'−')+'¥'+row.amount.toFixed(2);this.text(ctx,amount,w-105,51,'600 13px system-ui',row.income?'#66957e':p.ink,proxy,o.precision,99);ctx.fillStyle=p.line;ctx.fillRect(60,ROW-1,w-76,1);}
 reference(rows,o){const t=performance.now(),h=HEADER+rows.length*ROW,c=canvas(o.width*o.dpr,h*o.dpr),ctx=c.getContext('2d');ctx.scale(o.dpr,o.dpr);this.base(ctx,o.width,h,o.theme);this.header(ctx,o.width,rows,o,false);rows.forEach((r,i)=>{ctx.save();ctx.translate(0,HEADER+i*ROW);this.row(ctx,o.width,r,o,false);ctx.restore();});this.metrics.referenceMs+=performance.now()-t;return c;}
 proxy(rows,o,cached){const t=performance.now(),h=HEADER+rows.length*ROW,c=canvas(o.width*o.scale,h*o.scale),ctx=c.getContext('2d');ctx.scale(o.scale,o.scale);this.base(ctx,o.width,h,o.theme);this.header(ctx,o.width,rows,o,true);
  rows.forEach((r,i)=>{const key=JSON.stringify([VERSION,r,o.width,o.scale,o.precision,o.theme,'system-ui']);let rc=cached?this.rows.get(key):null;if(!rc){rc=canvas(o.width*o.scale,ROW*o.scale);const cx=rc.getContext('2d');cx.scale(o.scale,o.scale);this.row(cx,o.width,r,o,true);if(cached)this.rows.set(key,rc,bytes(rc));this.metrics.proxyUpdates++;}ctx.drawImage(rc,0,HEADER+i*ROW,o.width,ROW);});this.metrics.proxyMs+=performance.now()-t;return c;}
 blur(c,r){const t=performance.now(),ctx=c.getContext('2d',{willReadFrequently:true}),image=ctx.getImageData(0,0,c.width,c.height),out=canvas(c.width,c.height);image.data.set(blurPixels(image.data,c.width,c.height,r));out.getContext('2d').putImageData(image,0,0);this.metrics.blurMs+=performance.now()-t;return out;}
 render(mode,rows,o,reference){const h=HEADER+rows.length*ROW,r=Math.round(o.blur*o.scale);this.proxyCanvas=null;if(mode==='native')return null;
  // 先检查完整结果，避免热缓存仍重新拼接整张代理；原始背景仍单独更新。
  const surfaceKey=JSON.stringify([mode,rows,o.width,o.scale,o.precision,o.theme,o.blur]);
  if(mode!=='tiled'){const ready=this.surfaces.get(surfaceKey);if(ready)return ready;}
  const source=mode==='precomputed'?(()=>{const c=canvas(o.width*o.scale,h*o.scale);c.getContext('2d').drawImage(reference,0,0,c.width,c.height);return c;})():this.proxy(rows,o,mode==='tiled');if(mode!=='precomputed')this.proxyCanvas=source;
  if(mode!=='tiled'){const result=this.blur(source,r);this.surfaces.set(surfaceKey,result,bytes(result));return result;}
  const out=canvas(source.width,source.height),ctx=out.getContext('2d'),tile=128,halo=3*r;
  for(let y=0;y<source.height;y+=tile){const start=Math.max(0,y-halo),end=Math.min(source.height,y+tile+halo);const first=Math.max(0,Math.floor((start/o.scale-HEADER)/ROW)),last=Math.ceil((end/o.scale-HEADER)/ROW);const key=JSON.stringify([VERSION,y,end-start,o.width,o.scale,o.precision,o.theme,r,start<HEADER*o.scale?rows.map(x=>x.amount):null,rows.slice(first,Math.max(first,last))]);let tc=this.tiles.get(key);
   if(!tc){const segment=canvas(source.width,end-start);segment.getContext('2d').drawImage(source,0,start,source.width,end-start,0,0,source.width,end-start);const blurred=this.blur(segment,r);tc=canvas(source.width,Math.min(tile,source.height-y));tc.getContext('2d').drawImage(blurred,0,y-start,tc.width,tc.height,0,0,tc.width,tc.height);this.tiles.set(key,tc,bytes(tc));this.metrics.tileUpdates++;}ctx.drawImage(tc,0,y);
  }return out;
 }
 material(output,texture,rect,scroll,o){if(!texture)return;const start=performance.now(),scale=o.scale,w=Math.ceil(rect.w*scale),h=Math.ceil(rect.h*scale);if(output.width!==w||output.height!==h){output.width=w;output.height=h;}const ctx=output.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,w,h);ctx.drawImage(texture,rect.x*scale,(rect.y+scroll)*scale,rect.w*scale,rect.h*scale,0,0,w,h);
  if(o.refraction>0){const key=[w,h,o.refraction].join(':' );let map=this.maps.get(key);if(!map){map=new Int32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const edge=Math.max(0,1-Math.min(x,y,w-1-x,h-1-y)/(12*scale)),dx=(x<w/2?1:-1)*edge*edge*o.refraction*scale,dy=(y<h/2?1:-1)*edge*edge*o.refraction*scale;map[y*w+x]=(Math.max(0,Math.min(h-1,Math.round(y+dy)))*w+Math.max(0,Math.min(w-1,Math.round(x+dx))))*4;}this.maps.set(key,map,map.byteLength);}const src=ctx.getImageData(0,0,w,h),dest=ctx.createImageData(w,h);for(let i=0;i<map.length;i++)dest.data.set(src.data.subarray(map[i],map[i]+4),i*4);ctx.putImageData(dest,0,0);}
  this.metrics.compositionMs+=performance.now()-start;
 }
}
