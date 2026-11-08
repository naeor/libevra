/** ABC Motion Lab 0.4.0 — 纯视觉适配器。调用者先提交导航，再传入真实视觉节点。
 * run({from,to,style:'a'|'b1'|'c',variant?:'pulse'|'depth'|'directional'|'directional-entry'|'pure-cover',direction:'push'|'pop',duration?,onProgress?})
 * 返回 {finished:Promise<{status,reason}>, seek(progress), cancel()}。
 * 不克隆节点、不调用 navigate、不修改滚动、不承担历史；节点 hidden/inert 由调用者管理。
 * A/B1 优先使用最多四个可见 [data-motion-group]；没有可测分组时使用 [data-motion-body]。
 */
export class ABCMotion {
  constructor(stage) {
    this.stage = stage; this.active = null; this.generation = 0; this.disposed = false;
    this.media = matchMedia('(prefers-reduced-motion: reduce)');
    this.interrupt = () => this.cancel('environment');
    this.visibility = () => { if (document.hidden) this.cancel('hidden'); };
    this.resize = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      const size = r && `${r.width}/${r.height}`;
      if (this.size && this.size !== size) this.cancel('resize');
      this.size = size;
    });
    this.resize.observe(stage);
    this.media.addEventListener('change', this.interrupt);
    document.addEventListener('visibilitychange', this.visibility);
    window.visualViewport?.addEventListener('resize', this.interrupt);
  }
  cancel(reason = 'cancelled') { this.active?.finish('cancelled', reason); }
  run({from, to, style = 'a', variant = 'depth', direction = 'push', duration = style === 'a' ? (variant === 'pulse' ? 250 : variant === 'directional-entry' ? 400 : variant === 'directional' ? 380 : 360) : style === 'b1' ? 320 : 200, onProgress = () => {}}) {
    if (this.disposed) throw new Error('ABCMotion 已释放');
    // 在取消前读取旧效果，反向操作从当前姿态继续，不闪回起点。
    const carry = new Map();
    for (const animation of this.active?.animations ?? []) {
      const node = animation.effect.target, c = getComputedStyle(node);
      carry.set(node, {transform:c.transform, opacity:c.opacity, filter:c.filter, clipPath:c.clipPath, boxShadow:c.boxShadow});
    }
    this.cancel('superseded');
    const token = ++this.generation, animations = [];
    let resolve, ended = false, frame = 0, timer = 0, layoutObserver;
    const finished = new Promise(r => { resolve = r; });
    const finish = (status, reason = null) => {
      if (ended) return; ended = true;
      cancelAnimationFrame(frame); clearTimeout(timer); layoutObserver?.disconnect();
      animations.forEach(a => a.cancel());
      if (this.generation === token) this.active = null;
      resolve({status, reason});
    };
    const handle = {finished, cancel:()=>finish('cancelled'), seek:p=>{
      for(const a of animations) { a.pause(); a.currentTime = Math.max(0,Math.min(1,p))*duration; }
      onProgress(Math.max(0,Math.min(1,p)));
    }};
    this.active = {animations, finish};
    if (from === to || this.media.matches || document.hidden || !from.animate) {
      onProgress(1); finish('completed', this.media.matches?'reduced-motion':'instant'); return handle;
    }
    const add = (node, keys) => {
      if (carry.has(node)) keys[0] = {...keys[0], ...carry.get(node)};
      animations.push(node.animate(keys,{duration,easing:style === 'b1' || (style === 'a' && variant !== 'pulse') ? 'cubic-bezier(.4,0,.2,1)' : 'cubic-bezier(.22,.68,.25,1)',fill:'both'}));
    };
    const groups = page => {
      const r = this.stage.getBoundingClientRect();
      const visible = [...page.querySelectorAll('[data-motion-group]')].filter(n=>{
        const b=n.getBoundingClientRect();return b.width>0 && b.height>0 && b.bottom>r.top && b.top<r.bottom;
      });
      // 大列表/异步空页面整组回退，避免几十次独立动画或不可测元素闪烁。
      return visible.length>0 && visible.length<=4 ? visible : [page.querySelector('[data-motion-body]') ?? page];
    };
    try {
      if (style === 'c') {
        if(direction==='push') {
          add(from,[{transform:'translateX(0)'},{transform:'translateX(-18%)'}]);
          add(to,[{transform:'translateX(100%)'},{transform:'translateX(0)'}]);
        } else {
          add(from,[{transform:'translateX(0)'},{transform:'translateX(100%)'}]);
          add(to,[{transform:'translateX(-18%)'},{transform:'translateX(0)'}]);
        }
      } else if (style === 'a' && variant === 'pure-cover') {
        // 父层只沿 Z 轴退远/恢复，X/Y 恒为 0；前景是独立的右侧覆盖平面。
        // 整体缩远保持卡片之间的空间关系，不把每张卡片分别向下挪动。
        const parent=direction==='push'?from:to, cover=direction==='push'?to:from;
        const front={transform:'perspective(900px) translate3d(0px,0px,0px)',filter:'blur(0px) contrast(1) saturate(1)',opacity:1};
        const middle={transform:'perspective(900px) translate3d(0px,0px,-120px)',filter:'blur(1.5px) contrast(.88) saturate(.9)',opacity:.9};
        const deep={transform:'perspective(900px) translate3d(0px,0px,-260px)',filter:'blur(4px) contrast(.72) saturate(.8)',opacity:0};
        add(parent,direction==='push'?[front,{...middle,offset:.5},deep]:[deep,{...middle,offset:.5},front]);
        for(const card of parent.querySelectorAll('.group')) {
          const shadow=getComputedStyle(card).boxShadow;
          add(card,direction==='push'?[{boxShadow:shadow},{boxShadow:'0 0 0 transparent'}]:[{boxShadow:'0 0 0 transparent'},{boxShadow:shadow}]);
        }
        // 前景带本风格的环境底色，真正遮住后方内容；完成/取消时随 WAAPI 一起释放。
        const environment=getComputedStyle(this.stage);
        const surface={backgroundColor:environment.backgroundColor,backgroundImage:environment.backgroundImage,opacity:1,filter:'none'};
        const outside={...surface,transform:'translateX(100%)'}, inside={...surface,transform:'translateX(0%)'};
        add(cover,direction==='push'?[outside,{...outside,offset:.1},inside]:[inside,outside]);
      } else if (style === 'b1') {
        // 两组内容沿同一轨道移动，始终间隔一个视口加 24px；不裁卡片、不淡出。
        // body 是透明的卡片陈列组，背景仍属于静止的 stage，而不是 C 的纸面。
        const sign=direction==='push'?1:-1, distance=this.stage.clientWidth+24;
        for(const [page,incoming] of [[from,false],[to,true]]) {
          const body=page.querySelector('[data-motion-body]');
          // 只移动透明正文组。顶栏、底栏是独立平面，不进入横向轨道。
          if(body) add(body,[
            {transform:`translateX(${incoming?sign*distance:0}px)`,opacity:1},
            {transform:`translateX(${incoming?0:-sign*distance}px)`,opacity:1},
          ]);
          const top=page.querySelector('[data-motion-header], .top');
          if(top) {
            const above={transform:`translateY(-${top.offsetHeight+2}px)`,opacity:1};
            const rest={transform:'translateY(0px)',opacity:1};
            // 先让旧栏完全离开上边界，再从上方送入新栏，避免标题叠印。
            add(top,incoming?[above,{...above,offset:.5},rest]:[rest,{...above,offset:.45},above]);
          }
          const tabs=page.querySelector('[data-motion-tabs], .tabs');
          if(tabs) {
            const below={transform:`translateY(${tabs.offsetHeight+2}px)`,opacity:1};
            const rest={transform:'translateY(0px)',opacity:1};
            add(tabs,incoming?[below,{...below,offset:.25},rest]:[rest,{...below,offset:.7},below]);
          }
        }
      } else {
        const sign=direction==='push'?1:-1;
        for(const [page,incoming] of [[from,false],[to,true]]) {
          groups(page).forEach((node,i)=>{
            const base=getComputedStyle(node), shadow=base.boxShadow;
            const rest={transform:'perspective(900px) translate3d(0,0,0) rotateX(0deg) scale(1)',opacity:1,filter:'blur(0px)',clipPath:'inset(0% 0% 0% 0% round 20px)',boxShadow:shadow};
            if(variant!=='pulse') {
              const x=variant==='directional'?sign:0;
              const pose=(dx,y,z,angle,opacity,blur,contrast,shade)=>({
                transform:`perspective(900px) translate3d(${dx}px,${y}px,${z}px) rotateX(${angle}deg)`,
                opacity,filter:`blur(${blur}px) contrast(${contrast}) saturate(${contrast})`,
                clipPath:'none',boxShadow:shade,
              });
              const front=pose(0,0,0,0,1,0,1,shadow);
              const farOut=pose(-x*24,66+i*4,-280,5,0,8,.65,'0 0 0 transparent');
              const farIn=pose(x*72,-60-i*3,-330,-3,0,7,.68,'0 0 0 transparent');
              // 旧组下沉，新组从更远且更高的层进入；中段开始交接，不在同一点弹回。
              const entryX=sign*this.stage.clientWidth*.95;
              add(node,incoming && variant==='directional-entry'?[
                pose(entryX,-28,-360,-3,0,7,.68,'0 0 0 transparent'),
                {...pose(entryX*.92,-25,-330,-3,.04,6,.7,'0 0 0 transparent'),offset:.3},
                {...pose(entryX*.62,-18,-230,-2,.32,4,.8,'0 1px 3px #244b3705'),offset:.56},
                {...pose(entryX*.18,-6,-75,-.7,.86,1.2,.96,'0 3px 10px #244b3709'),offset:.82},front,
              ]:incoming?[
                farIn,{...farIn,offset:.32+i*.015},
                {...pose(x*43,-34,-210,-2,.18,5,.76,'0 1px 3px #244b3705'),offset:.56},
                {...pose(x*15,-12,-75,-.7,.78,1.5,.94,'0 3px 10px #244b3709'),offset:.82},front,
              ]:[front,
                {...pose(-x*6,14,-55,1.5,.96,.6,.96,shadow),offset:.28},
                {...pose(-x*13,33,-135,3,.73,2.8,.82,'0 2px 6px #244b3708'),offset:.55},
                {...pose(-x*21,53,-225,4.5,.2,6,.7,'0 0 1px #244b3702'),offset:.83},farOut,
              ]);
            } else {
              // 上下边收拢模拟环境遮挡，俯仰/下沉/阴影消退共同表达距离。
              const depth={transform:`perspective(900px) translate3d(0,${18+i*3}px,-115px) rotateX(5deg) scale(.94)`,opacity:0,filter:'blur(6px)',clipPath:'inset(16% 3% 13% 3% round 24px)',boxShadow:'0 0 0 transparent'};
              const middle={transform:`perspective(900px) translate3d(0,${10+i*2}px,-60px) rotateX(3deg) scale(.98)`,opacity:.42,filter:'blur(3px)',clipPath:'inset(5% 1% 4% 1% round 22px)',boxShadow:'0 1px 3px #244b3705'};
              add(node,incoming?[depth,{...depth,offset:.18+i*.025}, {...middle,offset:.48},rest]:[rest,{...middle,offset:.32+i*.025},{...depth,offset:.76},depth]);
            }
          });
          for(const top of page.querySelectorAll('[data-motion-chrome]'))
            add(top,incoming?[{opacity:0},{opacity:0,offset:.25},{opacity:1}]:[{opacity:1},{opacity:0,offset:.55},{opacity:0}]);
        }
      }
      // 数据加载/字体或容器变高时落定目标，不让已经失效的卡片几何继续播放。
      const sizes=new WeakMap();
      layoutObserver=new ResizeObserver(entries=>{
        for(const e of entries){
          const size=`${e.contentRect.width}/${e.contentRect.height}`, previous=sizes.get(e.target);
          sizes.set(e.target,size);
          if(previous!==undefined && previous!==size){finish('cancelled','content-resize');break;}
        }
      });
      new Set(animations.map(a=>a.effect.target)).forEach(n=>layoutObserver.observe(n));
      const tick=()=>{
        if(ended)return;
        onProgress(Math.min(1,Number(animations[0]?.currentTime ?? 0)/duration));
        frame=requestAnimationFrame(tick);
      };
      frame=requestAnimationFrame(tick);
      Promise.all(animations.map(a=>a.finished)).then(()=>{if(ended || token!==this.generation)return;onProgress(1);finish('completed');}).catch(()=>finish('cancelled'));
      timer=setTimeout(()=>finish('cancelled','watchdog'),duration+500);
    } catch { finish('cancelled','animation-unavailable'); }
    return handle;
  }
  dispose() {
    this.cancel('disposed'); this.disposed=true; this.resize.disconnect();
    this.media.removeEventListener('change',this.interrupt);
    document.removeEventListener('visibilitychange',this.visibility);
    window.visualViewport?.removeEventListener('resize',this.interrupt);
  }
}
