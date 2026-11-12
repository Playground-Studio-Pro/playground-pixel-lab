import { depthCamera, ringLayout, type DepthWindow } from "@/engines/depth/camera";
import { hexToLinear, loopPhase, type DepthSceneConfig } from "@/engines/depth/config";
import { MAX_PARTICLES, PARTICLE_STRIDE, buildParticles } from "@/engines/depth/particles";
import { PARTICLE_FRAGMENT, PARTICLE_VERTEX, ROOM_FRAGMENT, ROOM_VERTEX } from "./shaders";

/**
 * Draws a depth scene with WebGL2. No rendering library: the scene is a box, a few ribs and one
 * instanced draw of particles, all shaded analytically.
 *
 * `renderFrame(frame)` is the whole interface to time. It reads no clock, so the preview, a scrub and
 * a frame-by-frame export all draw the same pixels for the same frame.
 */

export class DepthRendererError extends Error {}

interface Program {
  readonly program: WebGLProgram;
  readonly uniforms: Map<string, WebGLUniformLocation | null>;
}

const ROOM_STRIDE = 7;

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new DepthRendererError(`Shader failed to compile: ${gl.getShaderInfoLog(s) ?? "unknown error"}`);
    }
    return s;
  };
  const program = gl.createProgram()!;
  const vs = shader(gl.VERTEX_SHADER, vertex);
  const fs = shader(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new DepthRendererError(`Shader failed to link: ${gl.getProgramInfoLog(program) ?? "unknown error"}`);
  }
  return { program, uniforms: new Map() };
}

/** The room's inside faces and its ribs, as triangles of position, normal and kind. */
function buildRoom(window: DepthWindow, depthM: number): Float32Array {
  const hw = window.widthM / 2;
  const hh = window.heightM / 2;
  const out: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], kind: number) => {
    for (const v of [a, b, c, a, c, d]) out.push(...v, ...n, kind);
  };
  quad([-hw, -hh, 0], [hw, -hh, 0], [hw, -hh, -depthM], [-hw, -hh, -depthM], [0, 1, 0], 0);
  quad([-hw, hh, 0], [hw, hh, 0], [hw, hh, -depthM], [-hw, hh, -depthM], [0, -1, 0], 0);
  quad([-hw, -hh, 0], [-hw, hh, 0], [-hw, hh, -depthM], [-hw, -hh, -depthM], [1, 0, 0], 0);
  quad([hw, -hh, 0], [hw, hh, 0], [hw, hh, -depthM], [hw, -hh, -depthM], [-1, 0, 0], 0);
  quad([-hw, -hh, -depthM], [hw, -hh, -depthM], [hw, hh, -depthM], [-hw, hh, -depthM], [0, 0, 1], 0);

  // A rib at every ring: two pilasters and a beam, standing proud of the walls and ceiling.
  const { count, spacingM } = ringLayout(depthM);
  const { half, proud } = ribSize(window);
  for (let k = 0; k < count; k++) {
    const zc = -(k + 0.5) * spacingM;
    const zf = zc + half;
    const zb = zc - half;
    const top = hh - proud;
    for (const side of [-1, 1]) {
      const wall = side * hw;
      const inner = side * (hw - proud);
      quad([inner, -hh, zf], [inner, top, zf], [inner, top, zb], [inner, -hh, zb], [-side, 0, 0], 1);
      quad([wall, -hh, zf], [inner, -hh, zf], [inner, top, zf], [wall, top, zf], [0, 0, 1], 1);
    }
    quad([-hw, top, zf], [hw, top, zf], [hw, top, zb], [-hw, top, zb], [0, -1, 0], 1);
    quad([-hw, top, zf], [hw, top, zf], [hw, hh, zf], [-hw, hh, zf], [0, 0, 1], 1);
  }
  return new Float32Array(out);
}

function ribSize(window: DepthWindow): { half: number; proud: number } {
  const proud = Math.min(0.16, Math.max(0.05, 0.035 * Math.min(window.widthM, window.heightM)));
  return { half: 0.11, proud };
}

export class DepthRenderer {
  private readonly gl: WebGL2RenderingContext;
  private room: Program | null = null;
  private particles: Program | null = null;
  private roomVao: WebGLVertexArrayObject | null = null;
  private roomBuffer: WebGLBuffer | null = null;
  private roomVertices = 0;
  private particleVao: WebGLVertexArrayObject | null = null;
  private particleBuffer: WebGLBuffer | null = null;
  private cornerBuffer: WebGLBuffer | null = null;
  private config: DepthSceneConfig | null = null;
  private window: DepthWindow | null = null;
  private roomKey = "";
  private seedKey = -1;
  private disposed = false;

  /**
   * @param onContextChange Called with `true` when the GPU takes the context away, and `false` once it
   * is back and the scene has been rebuilt.
   */
  constructor(private readonly canvas: HTMLCanvasElement, private readonly onContextChange?: (lost: boolean) => void) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, depth: true, powerPreference: "high-performance" });
    if (!gl) throw new DepthRendererError("This browser or GPU doesn't provide WebGL 2, which Depth Studio needs.");
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.createResources();
  }

  /** Largest width or height this GPU can render. */
  get maxSize(): number {
    return Math.min(this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE) as number, (this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS) as Int32Array)[0]);
  }

  setScene(config: DepthSceneConfig, window: DepthWindow) {
    this.config = config;
    this.window = window;
  }

  /** Sets the size of the image in pixels. The scene always fills it exactly. */
  resize(widthPx: number, heightPx: number) {
    if (this.canvas.width !== widthPx) this.canvas.width = widthPx;
    if (this.canvas.height !== heightPx) this.canvas.height = heightPx;
  }

  renderFrame(frame: number) {
    const { gl, config, window } = this;
    if (this.disposed || !config || !window || !this.room || !this.particles || gl.isContextLost()) return;
    this.syncGeometry(config, window);

    const camera = depthCamera(window, config.viewer, config.room.depthM);
    const rings = ringLayout(config.room.depthM);
    const direction = (config.lighting.directionDeg * Math.PI) / 180;
    const phase = loopPhase(frame, config);

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    const common = (p: Program) => {
      gl.useProgram(p.program);
      gl.uniformMatrix4fv(this.uniform(p, "uViewProj"), false, camera.viewProjection as number[]);
      gl.uniform3f(this.uniform(p, "uRoom"), window.widthM, window.heightM, config.room.depthM);
      gl.uniform3f(this.uniform(p, "uEye"), camera.eye[0], camera.eye[1], camera.eye[2]);
      gl.uniform3fv(this.uniform(p, "uBg"), hexToLinear(config.palette.background));
      gl.uniform3fv(this.uniform(p, "uMid"), hexToLinear(config.palette.particle));
      gl.uniform3fv(this.uniform(p, "uAccent"), hexToLinear(config.palette.accent));
      gl.uniform1f(this.uniform(p, "uLight"), config.lighting.intensity);
      gl.uniform2f(this.uniform(p, "uSweepDir"), Math.cos(direction), Math.sin(direction));
      gl.uniform1f(this.uniform(p, "uSweepWidth"), config.lighting.sweepWidth);
      gl.uniform1f(this.uniform(p, "uPhase"), phase);
      gl.uniform1f(this.uniform(p, "uFog"), config.atmosphere.fogDensity);
      gl.uniform1f(this.uniform(p, "uRingSpacing"), rings.spacingM);
    };

    common(this.room);
    gl.uniform1f(this.uniform(this.room, "uGrid"), config.room.showGrid ? config.room.gridOpacity : 0);
    gl.uniform1f(this.uniform(this.room, "uRibHalf"), ribSize(window).half);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.roomVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.roomVertices);

    const count = config.particles.enabled ? Math.min(MAX_PARTICLES, config.particles.count) : 0;
    if (count > 0 && config.particles.opacity > 0) {
      common(this.particles);
      gl.uniform1f(this.uniform(this.particles, "uSpeed"), config.particles.speed);
      gl.uniform1f(this.uniform(this.particles, "uSize"), config.particles.size);
      gl.uniform1f(this.uniform(this.particles, "uOpacity"), config.particles.opacity);
      // Translucent leaves: tested against the room, but they don't hide each other.
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.particleVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    this.deleteResources();
  }

  private uniform(p: Program, name: string) {
    let location = p.uniforms.get(name);
    if (location === undefined) {
      location = this.gl.getUniformLocation(p.program, name);
      p.uniforms.set(name, location);
    }
    return location;
  }

  private createResources() {
    const gl = this.gl;
    this.room = compile(gl, ROOM_VERTEX, ROOM_FRAGMENT);
    this.particles = compile(gl, PARTICLE_VERTEX, PARTICLE_FRAGMENT);

    this.roomVao = gl.createVertexArray();
    this.roomBuffer = gl.createBuffer();
    gl.bindVertexArray(this.roomVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.roomBuffer);
    const bytes = ROOM_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, bytes, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, bytes, 24);

    this.particleVao = gl.createVertexArray();
    this.cornerBuffer = gl.createBuffer();
    this.particleBuffer = gl.createBuffer();
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(i + 1);
      gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, PARTICLE_STRIDE * 4, i * 16);
      gl.vertexAttribDivisor(i + 1, 1);
    }
    gl.bindVertexArray(null);
    this.roomKey = "";
    this.seedKey = -1;
  }

  private deleteResources() {
    const gl = this.gl;
    if (this.room) gl.deleteProgram(this.room.program);
    if (this.particles) gl.deleteProgram(this.particles.program);
    gl.deleteVertexArray(this.roomVao);
    gl.deleteVertexArray(this.particleVao);
    gl.deleteBuffer(this.roomBuffer);
    gl.deleteBuffer(this.cornerBuffer);
    gl.deleteBuffer(this.particleBuffer);
    this.room = this.particles = null;
  }

  /** Rebuilds geometry only when the room's shape or the seed changes. */
  private syncGeometry(config: DepthSceneConfig, window: DepthWindow) {
    const gl = this.gl;
    const roomKey = `${window.widthM}|${window.heightM}|${config.room.depthM}`;
    if (roomKey !== this.roomKey) {
      const data = buildRoom(window, config.room.depthM);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.roomBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this.roomVertices = data.length / ROOM_STRIDE;
      this.roomKey = roomKey;
    }
    if (config.seed !== this.seedKey) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, buildParticles(config.seed), gl.STATIC_DRAW);
      this.seedKey = config.seed;
    }
  }

  private readonly onLost = (event: Event) => {
    // Asks the browser to restore the context rather than leave the canvas dead.
    event.preventDefault();
    this.onContextChange?.(true);
  };

  private readonly onRestored = () => {
    if (this.disposed) return;
    this.createResources();
    this.onContextChange?.(false);
  };
}
