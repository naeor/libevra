// i18n-ignore-file 独立实验的 GPU 预滤波，不读回像素、不抓取 DOM。
/** 65 个相邻纹素的高斯权重；利用线性过滤把相邻两点合成一次查询，避免稀疏清晰副本。 */
export function gaussianPairs(sigma: number): Float32Array {
  const weights = Array.from({ length: 33 }, (_, i) => Math.exp(-i * i / (2 * sigma * sigma)));
  const sum = weights[0]! + 2 * weights.slice(1).reduce((a, b) => a + b, 0);
  const pairs = new Float32Array(34); pairs[1] = weights[0]! / sum;
  for (let i = 1; i <= 16; i++) {
    const a = i * 2 - 1, b = a + 1, weight = weights[a]! + weights[b]!;
    pairs[i * 2] = weight > 1e-30 ? (a * weights[a]! + b * weights[b]!) / weight : a;
    pairs[i * 2 + 1] = weight / sum;
  }
  return pairs;
}

export function createScatterTexture(gl: WebGLRenderingContext, precision: string, size: number) {
  const shaders: WebGLShader[] = [], textures: WebGLTexture[] = [];
  let program: WebGLProgram | null = null, framebuffer: WebGLFramebuffer | null = null, previousSigma = -1, passes = 0;
  const dispose = () => { shaders.forEach(s => gl.deleteShader(s)); textures.forEach(t => gl.deleteTexture(t)); gl.deleteProgram(program); gl.deleteFramebuffer(framebuffer); };
  const compile = (kind: number, source: string) => {
    const shader = gl.createShader(kind); if (!shader) throw new Error("磨砂预滤波资源不足。");
    shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("此设备无法编译磨砂预滤波。"); return shader;
  };
  try {
    const vertex = compile(gl.VERTEX_SHADER, "attribute vec2 a_position;varying vec2 uv;void main(){uv=(a_position+1.0)*.5;gl_Position=vec4(a_position,0,1);}");
    const fragment = compile(gl.FRAGMENT_SHADER, `precision ${precision} float;
varying vec2 uv;uniform sampler2D scene;uniform vec2 axis;uniform vec2 taps[17];
void main(){vec3 color=texture2D(scene,uv).rgb*taps[0].y;
for(int i=1;i<17;i++){vec2 d=axis*taps[i].x;color+=(texture2D(scene,uv+d).rgb+texture2D(scene,uv-d).rgb)*taps[i].y;}
gl_FragColor=vec4(color,1.0);}`);
    program = gl.createProgram(); if (!program) throw new Error("无法创建磨砂预滤波程序。");
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.bindAttribLocation(program, 0, "a_position"); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("此设备无法连接磨砂预滤波程序。");
    framebuffer = gl.createFramebuffer(); if (!framebuffer) throw new Error("无法创建磨砂预滤波缓冲。");
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture(); if (!texture) throw new Error("磨砂纹理资源不足。"); textures.push(texture);
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const axis = gl.getUniformLocation(program, "axis"), taps = gl.getUniformLocation(program, "taps[0]");
    return {
      prepare(source: WebGLTexture, requestedSigma: number): WebGLTexture {
        const sigma = Math.min(12, requestedSigma);
        if (sigma < .15) return source;
        if (Math.abs(sigma - previousSigma) < .001) return textures[1]!;
        gl.useProgram(program); gl.uniform1i(gl.getUniformLocation(program!, "scene"), 0); gl.uniform2fv(taps, gaussianPairs(sigma));
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0, 0, size, size);
        try {
          for (let i = 0; i < 2; i++) {
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[i]!, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("磨砂预滤波缓冲不可用。");
            gl.bindTexture(gl.TEXTURE_2D, i === 0 ? source : textures[0]!); gl.uniform2f(axis, i === 0 ? 1 / size : 0, i === 1 ? 1 / size : 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); passes++;
          }
          previousSigma = sigma; return textures[1]!;
        } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
      },
      passes: () => passes, dispose,
    };
  } catch (error) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); dispose(); throw error; }
}
