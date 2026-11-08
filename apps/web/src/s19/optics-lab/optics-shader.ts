// i18n-ignore-file Shader 内中文仅为算法注释，不是界面文案。
/** Snell 方向计算是真实公式；高度场、背平面、背景深度与环境反光都是受控近似。 */
export const OPTICS_VERTEX = `
attribute vec2 a_position;
uniform vec2 u_size;
uniform vec4 u_rect;
varying vec2 v_screen;
void main(){v_screen=mix(u_rect.xy,u_rect.zw,(a_position+1.0)*.5);gl_Position=vec4(v_screen.x/u_size.x*2.0-1.0,1.0-v_screen.y/u_size.y*2.0,0,1);}`;
export const OPTICS_FRAGMENT = `
varying vec2 v_screen;
uniform sampler2D u_scene;
uniform vec2 u_size, u_center, u_half, u_sceneOrigin;
uniform vec4 u_optics, u_geometry;
uniform float u_radius, u_kind, u_refraction, u_shift, u_angle, u_magnification, u_simple;
float smoother(float v){float t=clamp(v,0.0,1.0);return t*t*t*(t*(t*6.0-15.0)+10.0);}
float sdf(vec2 p){vec2 q=abs(p)-u_half+u_radius;return length(max(q,0.0))+min(max(q.x,q.y),0.0)-u_radius;}
float heightAt(vec2 p){
  float edge=smoother(-sdf(p)/min(u_geometry.y,min(u_half.x,u_half.y)*.55));
  float cap=max(0.0,1.0-dot(p/u_half,p/u_half));
  return u_geometry.x*edge+step(1.5,u_kind)*min(u_half.x,u_half.y)*u_geometry.w*u_optics.z*cap*cap*cap*edge;
}
vec2 sceneUV(vec2 pixel){return vec2((pixel.x-u_sceneOrigin.x)/u_size.y,1.0-(pixel.y-u_shift)/u_size.y);}
vec3 scene(vec2 pixel){return texture2D(u_scene,sceneUV(pixel)).rgb;}
void main(){
  vec2 p=v_screen-u_center;float d=sdf(p);float alpha=1.0-smoothstep(-.65,.65,d);if(alpha<=0.0)discard;
  float e=min(.1,max(.005,-d*.5));vec2 gradient=vec2(heightAt(p+vec2(e,0))-heightAt(p-vec2(e,0)),heightAt(p+vec2(0,e))-heightAt(p-vec2(0,e)))/(2.0*e);
  vec3 normal=normalize(vec3(-gradient,1.0));
  float ior=1.0+(u_optics.x-1.0)*u_optics.w;
  vec2 offset=vec2(0);bool tir=false;
  if(u_simple>.5){offset=p*(1.0/u_magnification-1.0)*smoother(-d/(min(u_half.x,u_half.y)*.45));}
  else{
    vec3 t1=refract(vec3(0,0,-1),normal,1.0/ior);
    vec3 t2=refract(t1,vec3(0,0,1),ior);tir=dot(t2,t2)<.1;
    if(!tir){offset=t1.xy*heightAt(p)/max(.1,-t1.z)+t2.xy*u_geometry.z/max(.1,-t2.z);}
  }
  vec2 samplePoint=v_screen+offset*u_refraction;
  // 所有运行时片元只查询一个位置。磨砂查询预先连续卷积后的纹理，不再混入九份错位的清晰副本。
  vec3 color=scene(samplePoint);
  if(u_kind<.5){color=mix(color,vec3(1),u_optics.y*.045);}
  float f0=pow((ior-1.0)/(ior+1.0),2.0);
  float fresnel=tir?1.0:f0+(1.0-f0)*pow(1.0-normal.z,5.0);
  vec2 direction=vec2(cos(u_angle),sin(u_angle));
  vec2 edgeNormal=normalize(vec2(sdf(p+vec2(e,0))-sdf(p-vec2(e,0)),sdf(p+vec2(0,e))-sdf(p-vec2(0,e)))+vec2(.00001));
  float lit=dot(edgeNormal,direction),rim=exp(-pow((d+1.2)/1.25,2.0));
  float reflection=exp(-pow((dot(p,direction)-min(u_half.x,u_half.y)*.55)/(u_kind<.5?24.0:9.0),2.0));
  color=mix(color,vec3(1),clamp(fresnel*(.3+reflection*1.7)+rim*max(lit,0.0)*.2,0.0,1.0));
  color*=1.0-rim*max(-lit,0.0)*.09;
  gl_FragColor=vec4(color*alpha,alpha);
}`;
