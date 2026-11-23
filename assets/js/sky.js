/* 샛별 · WebGL night-to-dawn sky.
   A single full-screen fragment shader: gradient sky, drifting nebula, three parallax star layers,
   the morning star with diffraction spikes (pulses with the voice level) and a sunrise bloom. */
(function () {
  'use strict';

  var hex = function (h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  };

  // one palette per [data-sky] index (cue order)
  var P = [
    { top: '#03051a', bot: '#0f1846', glow: '#3b2a72', ga: .22, stars: 1.00, neb: .90, sx: .52, sy: .84, sa: 1.0, sun: 0 }, // 0 hero
    { top: '#040720', bot: '#111a4e', glow: '#2c2a74', ga: .18, stars: .95, neb: .80, sx: .70, sy: .86, sa: .85, sun: 0 }, // 1 about
    { top: '#02031a', bot: '#0a1040', glow: '#2a1f66', ga: .14, stars: 1.15, neb: 1.1, sx: .88, sy: .90, sa: .55, sun: 0 }, // 2 voice
    { top: '#060a28', bot: '#1a2262', glow: '#4a2f80', ga: .30, stars: .90, neb: 1.0, sx: .80, sy: .86, sa: .80, sun: 0 }, // 3 range
    { top: '#050a26', bot: '#142058', glow: '#2e2c6c', ga: .22, stars: 1.00, neb: .75, sx: .84, sy: .88, sa: .85, sun: 0 }, // 4 official
    { top: '#0a0a28', bot: '#26205a', glow: '#6b4a78', ga: .30, stars: .90, neb: .85, sx: .80, sy: .86, sa: .90, sun: 0 }, // 5 culture · voice mc
    { top: '#0e1544', bot: '#33388a', glow: '#7f5cb0', ga: .45, stars: .70, neb: .90, sx: .76, sy: .82, sa: .80, sun: 0 }, // 6 vip
    { top: '#1b1650', bot: '#5c2f7c', glow: '#f2849c', ga: .38, stars: .45, neb: 1.0, sx: .72, sy: .80, sa: .85, sun: 0 }, // 7 team
    { top: '#251a5c', bot: '#a24a7e', glow: '#ffa08e', ga: .60, stars: .28, neb: .90, sx: .70, sy: .78, sa: .70, sun: 0 }, // 8 gallery
    { top: '#c78da8', bot: '#ffd3b0', glow: '#fff0d8', ga: .50, stars: .02, neb: .25, sx: .70, sy: .80, sa: .25, sun: .15 }, // 9 reviews
    { top: '#f1c1b4', bot: '#fff0de', glow: '#fff7ea', ga: .50, stars: 0, neb: .10, sx: .70, sy: .80, sa: .10, sun: .45 }, // 10 profile
    { top: '#ffdcbc', bot: '#fff6ea', glow: '#ffffff', ga: .30, stars: 0, neb: 0, sx: .50, sy: .30, sa: 0, sun: 1 } // 11 contact
  ].map(function (p) {
    return { top: hex(p.top), bot: hex(p.bot), glow: hex(p.glow), ga: p.ga, stars: p.stars, neb: p.neb, sx: p.sx, sy: p.sy, sa: p.sa, sun: p.sun };
  });

  var canvas = document.getElementById('sky');
  var api = {
    palettes: P,
    audio: 0,
    tension: 0,
    mouse: [0, 0],
    blend: function () {},
    ok: false
  };
  window.Sky = api;
  if (!canvas) return;

  var gl = null;
  try {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  } catch (e) { gl = null; }

  var VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var FS = [
    'precision highp float;',
    'uniform vec2 uRes;uniform float uTime;uniform vec2 uMouse;uniform float uScroll;',
    'uniform vec3 uTop;uniform vec3 uBot;uniform vec3 uGlow;',
    'uniform float uGlowAmt;uniform float uStars;uniform float uNebula;uniform vec2 uStarPos;uniform float uStarAmt;',
    'uniform float uAudio;uniform float uSun;uniform float uTension;',
    'float h12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}',
    'vec2 h22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}',
    'float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.-2.*f);',
    ' return mix(mix(h12(i),h12(i+vec2(1.,0.)),u.x),mix(h12(i+vec2(0.,1.)),h12(i+vec2(1.,1.)),u.x),u.y);}',
    'float fbm(vec2 p){float v=0.;float a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec2(17.1,9.2);a*=.5;}return v;}',
    'float stars(vec2 p,float cells,float density,float tw){',
    ' vec2 g=p*cells;vec2 id=floor(g);vec2 f=fract(g);float h=h12(id);',
    ' if(h>density)return 0.;',
    ' vec2 pos=h22(id+7.3)*.8+.1;float b=h12(id+3.1);',
    ' float dpx=length(f-pos)*(uRes.y/cells);',
    ' float rad=mix(.55,1.7,b*b);',
    ' float core=smoothstep(rad+.9,0.,dpx);',
    ' float glow=exp(-dpx*.32)*.22*b;',
    ' float t=.62+.38*sin(uTime*(.5+b*2.6)*tw+h*80.);',
    ' return (core+glow)*t*(.35+.65*b);}',
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float asp=uRes.x/uRes.y;vec2 p=vec2(uv.x*asp,uv.y);',
    ' vec3 col=mix(uBot,uTop,smoothstep(0.,1.,uv.y));',
    ' float hz=exp(-pow(uv.y*2.1,2.));col+=uGlow*hz*uGlowAmt;',
    ' vec2 q=p*1.15+vec2(uTime*.006,uScroll*.00003);',
    ' float n=fbm(q*1.4+fbm(q*2.1-uTime*.012)*1.25);',
    ' float neb=smoothstep(.42,.92,n);',
    ' vec3 nc=mix(vec3(.33,.38,.98),vec3(.98,.46,.74),smoothstep(.05,.95,uv.x*.75+n*.45));',
    ' col+=nc*neb*.15*uNebula*(1.+uAudio*1.2);',
    ' float band=exp(-pow((p.y-.58-(p.x-asp*.5)*.32)*3.2,2.));',
    ' col+=vec3(.42,.48,1.)*band*.045*uNebula;',
    ' vec2 m=uMouse*.012;',
    ' float s=stars(p+m*.4+vec2(0.,uScroll*.00004),64.,.075+band*.06,1.);',
    ' s+=stars(p+m*.9+vec2(0.,uScroll*.00009),30.,.11,1.4)*1.1;',
    ' s+=stars(p+m*1.6+vec2(0.,uScroll*.00016),13.,.09,.8)*1.5;',
    ' col+=vec3(1.,.96,.9)*s*uStars*(1.+uTension*.5);',
    ' vec2 sp=vec2(uStarPos.x*asp,uStarPos.y);vec2 d=p-sp-m*2.;',
    ' float r=length(d);float rpx=r*uRes.y;',
    ' float pulse=1.+uAudio*2.2+.06*sin(uTime*1.7);',
    ' float core=exp(-rpx*rpx/18.)*1.6;',
    ' float halo=(1./(1.+rpx*.055))*.22*pulse;',
    ' float bloom=exp(-r*6.5)*.22*pulse;',
    ' float sx=exp(-abs(d.y*uRes.y)*.75)*exp(-abs(d.x)*8.);',
    ' float sy=exp(-abs(d.x*uRes.y)*.75)*exp(-abs(d.y)*10.);',
    ' vec2 d2=mat2(.7071,-.7071,.7071,.7071)*d;',
    ' float sd=(exp(-abs(d2.y*uRes.y)*1.2)*exp(-abs(d2.x)*22.)+exp(-abs(d2.x*uRes.y)*1.2)*exp(-abs(d2.y)*22.))*.35;',
    ' col+=vec3(1.,.89,.68)*(core+halo+bloom+(sx+sy+sd)*.9*pulse)*uStarAmt;',
    ' vec2 sun=vec2(.5*asp,-.32+uSun*.3);float sdist=length(p-sun);',
    ' col+=vec3(1.,.74,.52)*smoothstep(1.2,0.,sdist)*uSun*.55;',
    ' col+=vec3(1.,.95,.86)*smoothstep(.45,0.,sdist)*uSun*.5;',
    ' float vig=smoothstep(1.3,.35,length((uv-.5)*vec2(asp*.85,1.)));',
    ' col*=mix(.8,1.,vig);',
    ' col+=(h12(gl_FragCoord.xy+fract(uTime)*100.)-.5)*(2.5/255.);',
    ' gl_FragColor=vec4(col,1.);',
    '}'
  ].join('\n');

  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[sky]', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  // builds the program; runs again when a lost context comes back, since every GL object dies with the context
  var U = {};
  function setup() {
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return false;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[sky] link', gl.getProgramInfoLog(prog)); return false; }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['uRes', 'uTime', 'uMouse', 'uScroll', 'uTop', 'uBot', 'uGlow', 'uGlowAmt', 'uStars', 'uNebula', 'uStarPos', 'uStarAmt', 'uAudio', 'uSun', 'uTension']
      .forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
    return true;
  }

  // current (smoothed) and target palette state
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var mix3 = function (a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; };
  var clone = function (p) { return { top: p.top.slice(), bot: p.bot.slice(), glow: p.glow.slice(), ga: p.ga, stars: p.stars, neb: p.neb, sx: p.sx, sy: p.sy, sa: p.sa, sun: p.sun }; };
  var cur = clone(P[0]), tgt = clone(P[0]);
  var mobile = Math.min(window.innerWidth, window.innerHeight) < 700;

  api.blend = function (i, j, t) {
    var a = P[i] || P[0], b = P[j] || a;
    tgt.top = mix3(a.top, b.top, t); tgt.bot = mix3(a.bot, b.bot, t); tgt.glow = mix3(a.glow, b.glow, t);
    tgt.ga = lerp(a.ga, b.ga, t); tgt.stars = lerp(a.stars, b.stars, t); tgt.neb = lerp(a.neb, b.neb, t);
    tgt.sx = lerp(a.sx, b.sx, t); tgt.sy = lerp(a.sy, b.sy, t); tgt.sa = lerp(a.sa, b.sa, t); tgt.sun = lerp(a.sun, b.sun, t);
    if (mobile && i === 0 && t < .5) { tgt.sx = .26; tgt.sy = .9; }
  };

  var quality = mobile ? .55 : .72, live = false;
  var W = 0, H = 0, lastCssW = 0, lastCssH = 0;
  function resize(force) {
    if (!live) return;
    var cw = canvas.clientWidth || window.innerWidth, ch = canvas.clientHeight || window.innerHeight;
    if (!force && Math.abs(cw - lastCssW) < 2 && Math.abs(ch - lastCssH) < 140) return;
    lastCssW = cw; lastCssH = ch;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    W = Math.max(2, Math.round(cw * dpr * quality));
    H = Math.max(2, Math.round(ch * dpr * quality));
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
  }

  // The light sections (reviews, profile, contact) use plum text because the sky turns to dawn behind them. With no
  // drawing context the dark #sky background stayed put and that text fell to about 1.1:1 contrast. So whenever the
  // shader can't draw, the same smoothed palette is painted as gradients on a layer just above the canvas.
  // The layer has to be separate. The canvas's own CSS background only shows while it never had a context; once a
  // context is lost, its opaque (alpha: false) surface covers that background and the page went white.
  var veil = document.createElement('div');
  veil.id = 'sky-css'; veil.setAttribute('aria-hidden', 'true');
  canvas.parentNode.insertBefore(veil, canvas.nextSibling);
  var painted = '';
  var rgba = function (c, a) { return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a + ')'; };
  function paintCss() {
    var glow = Math.min(1, cur.ga + cur.sun * .4).toFixed(2);
    var bg = 'radial-gradient(130% 70% at 50% 100%,' + rgba(cur.glow, glow) + ',' + rgba(cur.glow, 0) + '),linear-gradient(' + rgba(cur.top, 1) + ',' + rgba(cur.bot, 1) + ')';
    if (bg !== painted) { painted = bg; veil.style.background = bg; }
  }
  function useGl(on) {
    live = on; api.ok = on;
    document.documentElement.classList.toggle('no-webgl', !on);
    veil.hidden = on;
    if (on) resize(true); else paintCss();
  }
  // every failure lands in the fallback: no context, a program that won't build, or a context lost later on
  if (gl) {
    // preventDefault is what allows the browser to restore the context at all
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); useGl(false); });
    canvas.addEventListener('webglcontextrestored', function () { if (setup()) useGl(true); });
  }
  // Start the shader after the first paint. Measuring the canvas here, while the page was still loading, forced its
  // first full layout inside this script: a 300ms task before anything showed, and the layout was done again once the
  // rest of the page had set up. Until then the fallback layer paints the same palette.
  veil.hidden = false; paintCss();
  var boot = function () { useGl(!!gl && setup()); };
  requestAnimationFrame(function () { setTimeout(boot, 0); });
  window.addEventListener('resize', function () { resize(false); });

  // reduced motion: the stars and nebula hold still (time stops) and the sky ignores the pointer; the palette still
  // follows the page from night to dawn
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mouse = [0, 0], mT = [0, 0];
  window.addEventListener('pointermove', function (e) {
    if (reduced) return;
    mT[0] = (e.clientX / window.innerWidth) * 2 - 1;
    mT[1] = -((e.clientY / window.innerHeight) * 2 - 1);
  }, { passive: true });

  var t0 = performance.now(), frames = 0, acc = 0, lastNow = t0, audioS = 0, tensionS = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    var dt = Math.min(64, now - lastNow); lastNow = now;
    var k = 1 - Math.pow(.92, dt / 16.7);
    cur.top = mix3(cur.top, tgt.top, k); cur.bot = mix3(cur.bot, tgt.bot, k); cur.glow = mix3(cur.glow, tgt.glow, k);
    cur.ga = lerp(cur.ga, tgt.ga, k); cur.stars = lerp(cur.stars, tgt.stars, k); cur.neb = lerp(cur.neb, tgt.neb, k);
    cur.sx = lerp(cur.sx, tgt.sx, k * .6); cur.sy = lerp(cur.sy, tgt.sy, k * .6); cur.sa = lerp(cur.sa, tgt.sa, k); cur.sun = lerp(cur.sun, tgt.sun, k);
    if (!live) { paintCss(); return; }
    // adaptive resolution: drop quality when frames run long
    acc += dt; frames++;
    if (frames === 90) {
      var avg = acc / frames;
      if (avg > 24 && quality > .4) { quality = Math.max(.4, quality - .12); resize(true); }
      else if (avg < 14 && quality < (mobile ? .6 : .82)) { quality = Math.min(mobile ? .6 : .82, quality + .06); resize(true); }
      frames = 0; acc = 0;
    }
    mouse[0] = lerp(mouse[0], mT[0], .05); mouse[1] = lerp(mouse[1], mT[1], .05);
    audioS = lerp(audioS, api.audio || 0, .35);
    tensionS = lerp(tensionS, api.tension || 0, .1);

    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uTime, reduced ? 0 : (now - t0) / 1000);
    gl.uniform2f(U.uMouse, mouse[0], mouse[1]);
    gl.uniform1f(U.uScroll, window.scrollY * (H / (canvas.clientHeight || 1)));
    gl.uniform3fv(U.uTop, cur.top); gl.uniform3fv(U.uBot, cur.bot); gl.uniform3fv(U.uGlow, cur.glow);
    gl.uniform1f(U.uGlowAmt, cur.ga); gl.uniform1f(U.uStars, cur.stars); gl.uniform1f(U.uNebula, cur.neb);
    gl.uniform2f(U.uStarPos, cur.sx, cur.sy); gl.uniform1f(U.uStarAmt, cur.sa);
    gl.uniform1f(U.uAudio, audioS); gl.uniform1f(U.uSun, cur.sun); gl.uniform1f(U.uTension, tensionS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(frame);
})();
