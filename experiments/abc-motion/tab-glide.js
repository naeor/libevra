/** A 专属视觉控制器：不导航。select() 立即通知调用者，视觉允许独立中断。
 * 槽位仅在初始化 / ResizeObserver 时测量，不订阅滚动、不在动画帧中读布局。
 */
export class DepthGlide {
  constructor(nav, {selected='mine', onSelect=()=>{}}={}) {
    this.nav=nav;this.track=nav.querySelector('.a-tab-track');
    this.buttons=[...nav.querySelectorAll('[data-tab]')];
    this.indicator=nav.querySelector('.a-capsule');this.body=nav.querySelector('.a-capsule-body');this.face=nav.querySelector('.a-capsule-face');
    this.selected=selected;this.onSelect=onSelect;this.duration=0;this.mode='capsule';this.generation=0;this.active=null;this.measurements=0;
    this.media=matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced=()=>this.snap();this.visibility=()=>{if(document.hidden)this.snap();};
    this.media.addEventListener('change',this.reduced);document.addEventListener('visibilitychange',this.visibility);
    this.observer=new ResizeObserver(()=>this.measure());this.observer.observe(this.track);this.buttons.forEach(b=>this.observer.observe(b));
    this.click=e=>{const b=e.target.closest('[data-tab]');if(b)this.select(b.dataset.tab);};
    this.key=e=>{
      const i=this.buttons.indexOf(e.target);if(i<0)return;
      const next=e.key==='ArrowRight'?(i+1)%4:e.key==='ArrowLeft'?(i+3)%4:e.key==='Home'?0:e.key==='End'?3:-1;
      if(next<0)return;e.preventDefault();this.buttons[next].focus();this.select(this.buttons[next].dataset.tab);
    };
    nav.addEventListener('click',this.click);nav.addEventListener('keydown',this.key);this.measure();
  }
  measure() {
    if(this.disposed||!this.track.offsetWidth)return;
    const signature=[this.track.offsetWidth,this.track.offsetHeight,...this.buttons.flatMap(b=>[b.offsetLeft,b.offsetWidth])].join('/');
    if(signature===this.signature)return;this.signature=signature;this.measurements++;
    const width=Math.min(82,...this.buttons.map(b=>b.offsetWidth-6)),height=Math.max(50,this.track.offsetHeight-14);
    this.width=width;this.indicator.style.width=width+'px';this.indicator.style.height=height+'px';this.indicator.style.top=(this.track.offsetHeight-height)/2+'px';
    this.targets=new Map(this.buttons.map(b=>[b.dataset.tab,b.offsetLeft+(b.offsetWidth-width)/2]));
    const plus=this.track.querySelector('.a-plus-slot');this.crossingX=plus.offsetLeft+(plus.offsetWidth-width)/2;
    const c=getComputedStyle(this.nav);this.colors={selected:c.getPropertyValue('--a-tab-selected').trim(),muted:c.getPropertyValue('--a-tab-muted').trim()};
    this.snap();
  }
  mark() {this.buttons.forEach(b=>{const yes=b.dataset.tab===this.selected;if(yes)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
  pose(x) {return `translate3d(${x}px,0px,0px)`;}
  snap() {
    this.active?.finish('cancelled','settled');
    if(!this.targets)return;
    this.indicator.style.transform=this.pose(this.targets.get(this.selected));this.body.style.transform='scale(1)';this.body.style.width='100%';this.face.style.opacity='1';
    this.buttons.forEach(b=>b.style.color=b.dataset.tab===this.selected?this.colors.selected:this.colors.muted);this.mark();
  }
  setMode(mode) {this.mode=mode;this.nav.dataset.indicator=mode;this.snap();}
  select(key,{animate=true}={}) {
    if(this.disposed||!this.buttons.some(b=>b.dataset.tab===key))return;
    if(key===this.selected)return this.active?.handle;
    // 先读取正在呈现的姿态，再取消。新目标从此处继续，不回到前一次起点。
    const surface=getComputedStyle(this.body);
    const state={x:getComputedStyle(this.indicator).transform,scale:surface.transform,width:surface.width,face:getComputedStyle(this.face).opacity,colors:this.buttons.map(b=>getComputedStyle(b).color)};
    this.active?.finish('cancelled','redirected');
    this.selected=key;this.mark();this.onSelect(key);
    if(!animate||this.mode==='circle'||this.media.matches||document.hidden||!this.targets||!this.indicator.animate){this.snap();return;}
    // 默认沿用 B1/B2 的距离计时：相邻 190ms 起，跨加号 210ms 起，最长 270ms。
    // 中途改向按当前呈现位置算剩余距离；实验面板仍可指定固定时长。
    const fromX=new DOMMatrixReadOnly(state.x==='none'?undefined:state.x).m41,toX=this.targets.get(key);
    const crosses=(fromX-this.crossingX)*(toX-this.crossingX)<0;
    const token=++this.generation,animations=[],duration=this.duration>0?this.duration:Math.round(Math.min(270,Math.max(crosses?210:190,150+Math.abs(toX-fromX)*.4)));
    const totalDuration=duration+56,dir=toX>=fromX?1:-1;
    let resolve,ended=false,timer;const finished=new Promise(r=>resolve=r);
    const finish=(status,reason=null)=>{
      if(ended)return;ended=true;clearTimeout(timer);
      if(this.generation===token){
        this.active=null;
        if(status==='completed'){
          this.indicator.style.transform=this.pose(this.targets.get(this.selected));this.body.style.transform='scale(1)';this.body.style.width='100%';this.face.style.opacity='1';
          this.buttons.forEach(b=>b.style.color=b.dataset.tab===this.selected?this.colors.selected:this.colors.muted);
        }
      }
      animations.forEach(a=>a.cancel());resolve({status,reason});
    };
    const handle={finished,cancel:()=>this.snap(),seek:progress=>animations.forEach(a=>{a.pause();a.currentTime=Math.max(0,Math.min(1,progress))*totalDuration;})};
    this.active={handle,finish,animations};
    this.indicator.style.transform=state.x;this.body.style.transform=state.scale;this.body.style.width=state.width;this.face.style.opacity=state.face;
    this.buttons.forEach((b,i)=>b.style.color=state.colors[i]);
    const add=(node,frames,time=duration)=>animations.push(node.animate(frames,{duration:time,fill:'both',easing:'linear'}));
    const glide='cubic-bezier(.4,0,.6,1)',out='cubic-bezier(0,0,.2,1)',target=this.pose(this.targets.get(key));
    // 宽度独立于均匀缩深变化，保持两端为圆弧；绝对定位表面不会推挤图标或点击区域。
    // 前缘分到更多伸展量。落位后仅多 56ms 衰减回弹，不改变已验收的横向行程。
    const shape=(time,ratio,depth,lead=0)=>{
      const width=this.width*ratio,extra=width-this.width;
      return {offset:time/totalDuration,width:width+'px',transform:`translate3d(${dir*extra*lead-extra/2}px,0,0) scale(${depth})`,easing:'ease-in-out'};
    };
    try {
      // 留出更完整的横向行程，采用对称加减速，避免前半程突然冲到目标附近。
      add(this.indicator,[{transform:state.x},{transform:state.x,offset:.06,easing:glide},{transform:target,offset:.94},{transform:target}]);
      add(this.body,[
        {offset:0,transform:state.scale,width:state.width,easing:out},
        shape(duration*.12,1.065,.975,.35),
        shape(duration*.32,1.14,.955,.18),
        shape(duration*.66,.955,.97),
        shape(duration*.92,.97,.99),
        shape(duration+18,1.075,1),
        shape(duration+38,.987,1),
        shape(totalDuration,1,1),
      ],totalDuration);
      // 明暗仍只动画 opacity，不动画阴影或模糊参数；局部宽度形变会触发表面重绘。
      // 下沉时保留可追踪的实体轮廓；不能把底栏同色衬底当成仍然可见的胶囊。
      add(this.face,[{opacity:state.face,easing:out},{opacity:.72,offset:.22},{opacity:.72,offset:.76,easing:out},{opacity:1}]);
      this.buttons.forEach((b,i)=>add(b,b.dataset.tab===key?
        [{color:state.colors[i]},{color:state.colors[i],offset:.65,easing:out},{color:this.colors.selected,offset:.95},{color:this.colors.selected}]:
        [{color:state.colors[i],easing:out},{color:this.colors.muted,offset:.55},{color:this.colors.muted}]));
      Promise.all(animations.map(a=>a.finished)).then(()=>finish('completed')).catch(()=>finish('cancelled'));
      timer=setTimeout(()=>{if(this.generation===token)this.snap();},totalDuration+500);
    } catch {this.snap();}
    return handle;
  }
  dispose() {
    if(this.disposed)return;this.snap();this.disposed=true;this.observer.disconnect();
    this.media.removeEventListener('change',this.reduced);document.removeEventListener('visibilitychange',this.visibility);
    this.nav.removeEventListener('click',this.click);this.nav.removeEventListener('keydown',this.key);
  }
}
