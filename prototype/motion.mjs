import { EASE, relativeRect, expandedRect, reliableTarget, surroundingPose, boxFrame } from './geometry.mjs';

/** 独立呈现器：不写 history，不请求业务数据。React 接入时可由 effect 持有并 dispose。 */
export class ContainerPresentation {
  constructor({ stage, list, overlay, onState, onClosed, reduced }) {
    Object.assign(this, { stage, list, overlay, onState, onClosed, reduced });
    this.animations = new Set(); this.generation = 0; this.state = 'list'; this.session = null;
  }
  animate(node, frames, options = {}) {
    if (!node.animate) { Object.assign(node.style, frames.at(-1)); return Promise.resolve(); }
    const animation = node.animate(frames, { duration: this.reduced() ? 1 : this.session.duration, easing: EASE, fill: 'both', ...options });
    this.animations.add(animation);
    return animation.finished.catch(() => {}).finally(() => { /* fill 效果在统一清理时取消。 */ });
  }
  cancelAnimations() { for (const animation of this.animations) animation.cancel(); this.animations.clear(); }
  setState(state, message) { this.state = state; this.onState(state, message); }
  async open(source, { style, duration, strength, content }) {
    if (this.state !== 'list') return false;
    const stageRect = this.stage.getBoundingClientRect();
    const sourceRect = relativeRect(source.getBoundingClientRect(), stageRect);
    const target = expandedRect(stageRect.width, stageRect.height);
    const neighbors = [...this.list.querySelectorAll('.record')].filter(node => node !== source).map(node => ({
      node, rect: relativeRect(node.getBoundingClientRect(), stageRect), transform: node.style.transform, opacity: node.style.opacity,
    }));
    const session = this.session = { source, sourceRect, target, neighbors, duration, style, strength, scrollTop: this.list.scrollTop,
      pageScroll: { x: window.scrollX, y: window.scrollY },
      viewport: { width: stageRect.width, height: stageRect.height }, changed: false, visibility: source.style.visibility };
    const token = ++this.generation;
    this.overlay.replaceChildren(); this.overlay.hidden = false;
    const shell = document.createElement('div');
    shell.className = 'morph-shell lv-material lv-material-effects'; shell.dataset.materialRole = 'display';
    shell.dataset.materialFinish = source.dataset.materialFinish;
    shell.setAttribute('aria-hidden', 'true');
    Object.assign(shell.style, boxFrame(sourceRect));
    const shadow = document.createElement('div'); shadow.className = 'lift-shadow'; shell.append(shadow);
    const detail = document.createElement('section'); detail.className = 'detail-content';
    detail.setAttribute('role', 'dialog'); detail.setAttribute('aria-modal', 'true'); detail.setAttribute('aria-label', '模拟账目详情'); detail.tabIndex = -1;
    detail.innerHTML = content;
    const ghost = document.createElement('div'); ghost.className = 'source-ghost'; ghost.setAttribute('aria-hidden', 'true');
    ghost.append(source.firstElementChild.cloneNode(true));
    Object.assign(ghost.style, { left: `${sourceRect.x}px`, top: `${sourceRect.y}px`, width: `${sourceRect.width}px`, height: `${sourceRect.height}px` });
    this.overlay.append(shell, detail, ghost); Object.assign(session, { shell, detail, ghost });
    source.style.visibility = 'hidden'; this.list.classList.add('locked'); this.list.inert = true;
    detail.focus({ preventScroll: true });
    this.setState('opening', '正在从点击位置展开…');
    const short = this.reduced();
    const d = short ? 1 : duration;
    if (short) {
      Object.assign(shell.style, boxFrame(target, 24)); detail.style.opacity = '1'; ghost.remove();
    } else {
      // 相同的几何时间线；A 的轻微前移单独叠加，不额外占用时间。
      const middle = { x: sourceRect.x + (target.x - sourceRect.x) * .42, y: sourceRect.y + (target.y - sourceRect.y) * .42,
        width: sourceRect.width + (target.width - sourceRect.width) * .42, height: sourceRect.height + (target.height - sourceRect.height) * .42 };
      const frames = [
        { ...boxFrame(sourceRect), offset: 0, easing: 'cubic-bezier(.25,.6,.4,1)' },
        { ...boxFrame(middle, 22, style === 'a' ? strength : 1), offset: .19, easing: EASE },
        { ...boxFrame(target, 24), offset: .85 }, { ...boxFrame(target, 24), offset: 1 },
      ];
      // 外层时间线线性，缓动放在各区间，确保 .85 真的是总时长的 85%。
      this.animate(shell, frames, { easing: 'linear' });
      if (style === 'a') this.animate(shadow, [{ opacity: 0, offset: 0 }, { opacity: 1, offset: .19 }, { opacity: .45, offset: 1 }]);
      this.animate(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: d * .1, easing: 'linear' }).then(() => { if (this.session === session) ghost.remove(); });
      this.animate(detail, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .83 }, { opacity: 1, offset: 1 }], { easing: 'linear' });
      for (const item of neighbors) {
        if (style === 'b2') continue; // 不创建后方动画或 opacity：玻璃背后保持原位。
        this.animate(item.node, [{ transform: 'none', opacity: 1 }, surroundingPose(style, item.rect, sourceRect, strength)]);
      }
    }
    // 单独的完成栅栏也被纳入取消管理；完成后释放所有 fill 动画。
    await this.animate(this.overlay, [{ opacity: 1 }, { opacity: 1 }], { duration: d, easing: 'linear' });
    if (token !== this.generation) return true;
    Object.assign(shell.style, boxFrame(target, 24)); detail.style.opacity = '1';
    for (const item of neighbors) if (style !== 'b2' && !short) Object.assign(item.node.style, surroundingPose(style, item.rect, sourceRect, strength));
    shadow.style.opacity = style === 'a' && !short ? '.45' : '0';
    this.cancelAnimations(); ghost.remove(); shell.style.willChange = 'auto';
    this.setState('detail', '详情已展开 · 可立即返回');
    return true;
  }
  async close() {
    if (this.state === 'list' || this.state === 'closing') return;
    const s = this.session, token = ++this.generation;
    // 只在中断时读当前姿态一次，随后 WAAPI 从此处接续，不先跳至展开终点。
    const stageRect = this.stage.getBoundingClientRect();
    const current = relativeRect(s.shell.getBoundingClientRect(), stageRect);
    const radius = getComputedStyle(s.shell).borderRadius;
    const detailOpacity = getComputedStyle(s.detail).opacity;
    const neighborFrames = s.neighbors.map(item => ({ item, transform: getComputedStyle(item.node).transform, opacity: getComputedStyle(item.node).opacity }));
    this.cancelAnimations(); s.ghost.remove();
    Object.assign(s.shell.style, boxFrame(current)); s.shell.style.borderRadius = radius; s.shell.style.willChange = 'transform,width,height';
    s.detail.style.opacity = detailOpacity;
    for (const frame of neighborFrames) Object.assign(frame.item.node.style, { transform: frame.transform, opacity: frame.opacity });
    this.list.scrollTop = s.scrollTop;
    const sourceNow = s.source.isConnected ? relativeRect(s.source.getBoundingClientRect(), stageRect) : null;
    const pageMoved = Math.abs(window.scrollX - s.pageScroll.x) > 1 || Math.abs(window.scrollY - s.pageScroll.y) > 1;
    const reliable = reliableTarget(s.sourceRect, sourceNow, { width: stageRect.width, height: stageRect.height }, s.changed || pageMoved);
    const d = this.reduced() ? 1 : s.duration;
    this.setState('closing', reliable ? '正在回到原记录…' : '原位置已变化 · 使用淡出返回');
    s.detail.inert = true;
    this.animate(s.detail, [{ opacity: detailOpacity }, { opacity: 0 }], { duration: d * .15, easing: 'linear' });
    if (reliable && !this.reduced()) {
      this.animate(s.shell, [
        { ...boxFrame(current), borderRadius: radius, offset: 0 },
        { ...boxFrame(current), borderRadius: radius, offset: .1, easing: EASE },
        { ...boxFrame(sourceNow), offset: .9 }, { ...boxFrame(sourceNow), offset: 1 },
      ], { easing: 'linear' });
      const restoreGhost = document.createElement('div');
      restoreGhost.className = 'source-ghost'; restoreGhost.setAttribute('aria-hidden', 'true');
      restoreGhost.append(s.source.firstElementChild.cloneNode(true));
      Object.assign(restoreGhost.style, { left: `${sourceNow.x}px`, top: `${sourceNow.y}px`, width: `${sourceNow.width}px`, height: `${sourceNow.height}px`, opacity: '0' });
      this.overlay.append(restoreGhost);
      this.animate(restoreGhost, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .9 }, { opacity: 1, offset: 1 }], { easing: 'linear' });
    } else this.animate(s.shell, [{ opacity: 1 }, { opacity: 0 }], { duration: d, easing: 'linear' });
    for (const frame of neighborFrames) {
      if (s.style === 'b2') continue;
      this.animate(frame.item.node, [{ transform: frame.transform, opacity: frame.opacity }, { transform: 'none', opacity: 1 }], { duration: d });
    }
    await this.animate(this.overlay, [{ opacity: 1 }, { opacity: 1 }], { duration: d, easing: 'linear' });
    if (token !== this.generation) return;
    this.cleanup(reliable ? '已返回原记录 · 滚动位置已保留' : '已淡出返回 · 未飞向错误位置');
  }
  refresh() {
    if (!this.session) return;
    this.session.changed = true;
    if (this.state === 'closing') { this.cleanup('视口已变化 · 已安全返回列表'); return; }
    ++this.generation; this.cancelAnimations();
    const s = this.session, r = this.stage.getBoundingClientRect();
    s.target = expandedRect(r.width, r.height);
    Object.assign(s.shell.style, boxFrame(s.target, 24)); s.shell.style.willChange = 'auto';
    s.detail.style.opacity = '1'; s.ghost.remove();
    this.setState('detail', '视口已变化 · 返回将使用淡出');
  }
  cleanup(message) {
    ++this.generation; this.cancelAnimations();
    const s = this.session;
    if (s) {
      s.source.style.visibility = s.visibility;
      for (const item of s.neighbors) Object.assign(item.node.style, { transform: item.transform, opacity: item.opacity });
      this.list.classList.remove('locked'); this.list.inert = false; this.list.scrollTop = s.scrollTop;
      // 防止浏览器 focus 隐式滚动已排序或已删除的来源。
      const focusTarget = !s.changed && s.source.isConnected ? s.source : this.list;
      focusTarget.focus({ preventScroll: true });
      window.scrollTo(s.pageScroll.x, s.pageScroll.y);
    }
    this.overlay.hidden = true; this.overlay.replaceChildren(); this.overlay.style.opacity = '';
    this.session = null; this.setState('list', message); this.onClosed();
  }
  dispose() { if (this.session) this.cleanup('原型已复位'); else this.cancelAnimations(); }
}
