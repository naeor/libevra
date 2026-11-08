// i18n-ignore-file 独立本机材质实验的中文错误提示。
import { DEFAULT_MAGNIFICATION, GEOMETRY, renderSize, type GlassGeometry, type StageConfig } from "./optics-model.js";
import { OPTICS_FRAGMENT, OPTICS_VERTEX } from "./optics-shader.js";
import { createScatterTexture } from "./scatter-texture.js";
export interface RendererStats { draws: number; width: number; height: number; requestedScale: number; actualScale: number; capped: boolean; pixels: number; precision: string; prefilterPasses?: number }
export interface OpticsRenderer {
  resize(width: number, height: number, config: StageConfig): void;
  render(config: StageConfig, glasses: GlassGeometry[], shift: number): void;
  stats(): RendererStats; dispose(): void;
}
export function createOpticsRenderer(canvas: HTMLCanvasElement, source: HTMLCanvasElement, failed: (message: string) => void): OpticsRenderer {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error("WebGL 不可用，已退回普通玻璃。");
  let disposed = false, width = 1, height = 1, draws = 0;
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null, texture: WebGLTexture | null = null;
  let size = renderSize(1, 1, 1, "half");
  let scatter: ReturnType<typeof createScatterTexture> | null = null;
  const precision = (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0) > 0 ? "highp" : "mediump";
  const maxDimension = Math.min(4096, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, ...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array));
  const lost = (event: Event) => { event.preventDefault(); if (!disposed) failed("WebGL 上下文丢失，已退回普通玻璃。"); };
  const dispose = () => {
    if (disposed) return; disposed = true;
    canvas.removeEventListener("webglcontextlost", lost);
    scatter?.dispose(); gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteProgram(program); shaders.forEach(shader => gl.deleteShader(shader));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  const compile = (kind: number, sourceCode: string) => {
    const shader = gl.createShader(kind); if (!shader) throw new Error("透镜着色器资源不足。");
    shaders.push(shader); gl.shaderSource(shader, sourceCode); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("此设备无法编译光学着色器。");
    return shader;
  };
  try {
    const vertex = compile(gl.VERTEX_SHADER, OPTICS_VERTEX), fragment = compile(gl.FRAGMENT_SHADER, `precision ${precision} float;\n${OPTICS_FRAGMENT}`);
    program = gl.createProgram(); if (!program) throw new Error("无法创建光学程序。");
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.bindAttribLocation(program, 0, "a_position"); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("此设备无法连接光学程序。");
    buffer = gl.createBuffer(); texture = gl.createTexture(); if (!buffer || !texture) throw new Error("光学绘制资源不足。");
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const names = ["size", "rect", "center", "half", "sceneOrigin", "optics", "geometry", "radius", "kind", "refraction", "shift", "angle", "magnification", "simple"] as const;
    const u = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program!, `u_${name}`)])) as Record<typeof names[number], WebGLUniformLocation | null>;
    gl.uniform1i(gl.getUniformLocation(program, "u_scene"), 0);
    gl.uniform4f(u.geometry, GEOMETRY.thickness, GEOMETRY.bevel, GEOMETRY.gap, GEOMETRY.capRatio);
    canvas.addEventListener("webglcontextlost", lost);
    return {
      resize(w, h, config) {
        width = w; height = h; size = renderSize(w, h, devicePixelRatio || 1, config.quality, maxDimension);
        if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height; gl.viewport(0, 0, size.width, size.height); }
      },
      render(config, glasses, shift) {
        if (disposed || gl.isContextLost() || width <= 0 || height <= 0) return;
        let sampledTexture = texture!;
        try {
          if (config.material === "frosted" && config.optics.roughness > 0) {
            scatter ??= createScatterTexture(gl, precision, source.width);
            // 仅纹理 / 粗糙度 / 场景尺寸变化时预滤波；平移镜片与背景不会重复这两遍。
            sampledTexture = scatter.prepare(texture!, config.optics.roughness * 7 * source.width / height);
          }
        } catch (error) { failed(error instanceof Error ? error.message : "磨砂绘制不可用，已退回普通玻璃。"); return; }
        gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D, sampledTexture); gl.viewport(0, 0, size.width, size.height);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(u.size, width, height); gl.uniform1f(u.shift, shift); gl.uniform1f(u.angle, config.optics.angle * Math.PI / 180);
        gl.uniform4f(u.optics, config.optics.ior, config.optics.roughness, config.optics.curvature, config.optics.strength);
        gl.uniform1f(u.kind, { frosted: 0, clear: 1, lens: 2 }[config.material]);
        gl.uniform1f(u.simple, config.mode === "magnify" ? 1 : 0); gl.uniform1f(u.magnification, config.magnification ?? DEFAULT_MAGNIFICATION[config.material]);
        const panelWidth = width / (config.compare ? 2 : 1);
        // 只画镜片包围盒；高成本法线 / 采样不铺满背景。
        for (const item of glasses) {
          gl.uniform4f(u.rect, item.x - item.halfWidth - 1, item.y - item.halfHeight - 1, item.x + item.halfWidth + 1, item.y + item.halfHeight + 1);
          gl.uniform2f(u.center, item.x, item.y); gl.uniform2f(u.half, item.halfWidth, item.halfHeight); gl.uniform1f(u.radius, item.radius);
          gl.uniform2f(u.sceneOrigin, item.panel * panelWidth + (panelWidth - height) / 2, 0);
          gl.uniform1f(u.refraction, item.reference ? 0 : 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); draws++;
        }
      },
      stats: () => ({ ...size, draws, precision, prefilterPasses: scatter?.passes() ?? 0 }), dispose,
    };
  } catch (error) { dispose(); throw error; }
}
