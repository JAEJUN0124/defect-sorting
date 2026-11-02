// v3 합성기: 2D 캔버스로 그린 층과 3D로 기울인 카드를 WebGL로 겹치고, 밝은 곳에 빛 번짐(블룸)을 더한다.
// 쓰는 법: begin() → layer(canvas) / card(canvas, 네 꼭짓점의 클립 좌표) → end(번짐 세기) → canvas를 drawImage
export function createCompositor(W, H) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2를 쓸 수 없습니다');
  const half = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');

  function program(vs, fs) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  // 카드: 꼭짓점마다 클립 좌표(x, y, z, w)와 uv. w가 있어 원근에 맞게 늘어난다
  const cardProg = program(
    `#version 300 es
    in vec4 aClip; in vec2 aUV; out vec2 vUV;
    void main() { vUV = aUV; gl_Position = aClip; }`,
    `#version 300 es
    precision highp float;
    in vec2 vUV; uniform sampler2D uTex; uniform float uAlpha; out vec4 o;
    void main() { o = texture(uTex, vUV) * uAlpha; }`,
  );
  const fsVS = `#version 300 es
    in vec2 aPos; out vec2 vUV;
    void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const brightProg = program(fsVS, `#version 300 es
    precision highp float;
    in vec2 vUV; uniform sampler2D uTex; uniform float uThreshold; uniform vec2 uTexel; out vec4 o;
    void main() {
      // 네 점을 평균해 반으로 줄이면서 밝은 부분만 남긴다
      vec3 c = vec3(0.0);
      c += texture(uTex, vUV + uTexel * vec2(-0.5, -0.5)).rgb;
      c += texture(uTex, vUV + uTexel * vec2(0.5, -0.5)).rgb;
      c += texture(uTex, vUV + uTexel * vec2(-0.5, 0.5)).rgb;
      c += texture(uTex, vUV + uTexel * vec2(0.5, 0.5)).rgb;
      c *= 0.25;
      float l = max(c.r, max(c.g, c.b));
      float k = smoothstep(uThreshold, uThreshold + 0.25, l);
      o = vec4(c * k, 1.0);
    }`);
  const blurProg = program(fsVS, `#version 300 es
    precision highp float;
    in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
    void main() {
      // 9탭 가우시안 (선형 보간을 이용해 5번 읽음)
      vec3 c = texture(uTex, vUV).rgb * 0.2270270270;
      c += texture(uTex, vUV + uDir * 1.3846153846).rgb * 0.3162162162;
      c += texture(uTex, vUV - uDir * 1.3846153846).rgb * 0.3162162162;
      c += texture(uTex, vUV + uDir * 3.2307692308).rgb * 0.0702702703;
      c += texture(uTex, vUV - uDir * 3.2307692308).rgb * 0.0702702703;
      o = vec4(c, 1.0);
    }`);
  const finalProg = program(fsVS, `#version 300 es
    precision highp float;
    in vec2 vUV;
    uniform sampler2D uScene; uniform sampler2D uB1; uniform sampler2D uB2; uniform sampler2D uB3;
    uniform vec3 uBloom; uniform float uVignette; out vec4 o;
    void main() {
      vec3 c = texture(uScene, vUV).rgb;
      c += texture(uB1, vUV).rgb * uBloom.x + texture(uB2, vUV).rgb * uBloom.y + texture(uB3, vUV).rgb * uBloom.z;
      // 밝은 곳이 하얗게 날아가지 않도록 부드럽게 눌러 준다
      c = c / (1.0 + max(c - 1.0, 0.0));
      vec2 d = vUV - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.35, 0.85, length(d * vec2(1.0, 0.85)));
      o = vec4(c, 1.0);
    }`);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const cardBuf = gl.createBuffer();
  const vaoFS = gl.createVertexArray();
  gl.bindVertexArray(vaoFS);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  for (const pr of [brightProg, blurProg, finalProg]) {
    const loc = gl.getAttribLocation(pr.p, 'aPos');
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
  }
  const vaoCard = gl.createVertexArray();
  gl.bindVertexArray(vaoCard);
  gl.bindBuffer(gl.ARRAY_BUFFER, cardBuf);
  const aClip = gl.getAttribLocation(cardProg.p, 'aClip'), aUV = gl.getAttribLocation(cardProg.p, 'aUV');
  gl.enableVertexAttribArray(aClip);
  gl.vertexAttribPointer(aClip, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 24, 16);
  gl.bindVertexArray(null);

  function target(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, half ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  // 장면은 4× 다중 표본으로 그려 가장자리를 매끄럽게 한 뒤 내려 받는다
  const msaa = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, msaa);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Math.min(4, gl.getParameter(gl.MAX_SAMPLES)), half ? gl.RGBA16F : gl.RGBA8, W, H);
  const msaaFB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFB);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaa);
  const scene = target(W, H);
  const b1 = [target(W >> 1, H >> 1), target(W >> 1, H >> 1)];
  const b2 = [target(W >> 2, H >> 2), target(W >> 2, H >> 2)];
  const b3 = [target(W >> 3, H >> 3), target(W >> 3, H >> 3)];

  const textures = new WeakMap();
  function upload(src, mip) {
    let tex = textures.get(src);
    if (!tex) {
      tex = gl.createTexture();
      textures.set(src, tex);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return tex;
  }

  const FULL = [[-1, 1, 0, 1], [1, 1, 0, 1], [-1, -1, 0, 1], [1, -1, 0, 1]];
  function drawTex(tex, clip, alpha) {
    // clip: [왼위, 오른위, 왼아래, 오른아래]의 (x, y, z, w)
    const uv = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const data = new Float32Array(24);
    for (let i = 0; i < 4; i++) data.set([...clip[i], ...uv[i]], i * 6);
    gl.useProgram(cardProg.p);
    gl.bindVertexArray(vaoCard);
    gl.bindBuffer(gl.ARRAY_BUFFER, cardBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(cardProg.u.uTex, 0);
    gl.uniform1f(cardProg.u.uAlpha, alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function pass(pr, dst, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : W, dst ? dst.h : H);
    gl.useProgram(pr.p);
    gl.bindVertexArray(vaoFS);
    setup(pr.u);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  const bind = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  return {
    canvas,
    begin() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFB);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    },
    // 화면 전체를 덮는 층 (1:1)
    layer(src, alpha = 1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFB);
      drawTex(upload(src, false), FULL, alpha);
    },
    // 3D 카드: clip은 네 꼭짓점의 클립 좌표
    card(src, clip, alpha = 1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFB);
      drawTex(upload(src, true), clip, alpha);
    },
    end({ bloom = [0.55, 0.45, 0.35], threshold = 0.62, vignette = 0.35 } = {}) {
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaaFB);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.fb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      pass(brightProg, b1[0], u => {
        bind(0, scene.tex, u.uTex);
        gl.uniform1f(u.uThreshold, threshold);
        gl.uniform2f(u.uTexel, 1 / W, 1 / H);
      });
      const blur = (pair, n) => {
        for (let i = 0; i < n; i++) {
          pass(blurProg, pair[1], u => {
            bind(0, pair[0].tex, u.uTex);
            gl.uniform2f(u.uDir, 1 / pair[0].w, 0);
          });
          pass(blurProg, pair[0], u => {
            bind(0, pair[1].tex, u.uTex);
            gl.uniform2f(u.uDir, 0, 1 / pair[0].h);
          });
        }
      };
      blur(b1, 1);
      pass(blurProg, b2[0], u => {
        bind(0, b1[0].tex, u.uTex);
        gl.uniform2f(u.uDir, 0, 0);
      });
      blur(b2, 2);
      pass(blurProg, b3[0], u => {
        bind(0, b2[0].tex, u.uTex);
        gl.uniform2f(u.uDir, 0, 0);
      });
      blur(b3, 3);
      pass(finalProg, null, u => {
        bind(0, scene.tex, u.uScene);
        bind(1, b1[0].tex, u.uB1);
        bind(2, b2[0].tex, u.uB2);
        bind(3, b3[0].tex, u.uB3);
        gl.uniform3f(u.uBloom, bloom[0], bloom[1], bloom[2]);
        gl.uniform1f(u.uVignette, vignette);
      });
      return canvas;
    },
  };
}
