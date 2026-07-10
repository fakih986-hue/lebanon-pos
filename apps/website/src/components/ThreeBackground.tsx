import { useEffect, useRef } from "react"
import { useLocation } from "react-router"
import * as THREE from "three"

/**
 * The Midnight Gold sky — a layered WebGL scene behind all content:
 *
 *  0. Nebula sky: fullscreen fragment shader, domain-warped fbm noise drifting
 *     like gold silk smoke through black. Scroll shifts it; time stirs it.
 *  1. Dust field: soft round bokeh motes (custom point shader) that twinkle on
 *     individual phases and drift, in gold / champagne / bronze.
 *  2. The emblem: the full-res logo lit live by a shader — a specular sheen
 *     travels across the metal, glints flare off the bevels, ambient light
 *     breathes over it. Product-shot lighting, not effects.
 *  3. Comets: a rare gold streak crossing the sky every ~10s.
 *
 * Camera lerps toward the cursor and drifts with scroll. Reduced-motion gets a
 * single static frame; mobile gets a lighter particle load.
 */
export function ThreeBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const targetRef = useRef({ x: 4.2, y: 0.5, scale: 0.92, opacity: 0.5, reform: 0 })
  const firstRouteRef = useRef(true)
  const location = useLocation()

  useEffect(() => {
    const t = targetRef.current
    if (location.pathname === "/") {
      t.x = 4.2; t.y = 0.5; t.scale = 0.92; t.opacity = 0.5
    } else if (location.pathname === "/pos" || location.pathname === "/payroll") {
      t.x = 4.6; t.y = 2.2; t.scale = 0.65; t.opacity = 0.32
    } else {
      t.x = -4.8; t.y = 2.4; t.scale = 0.55; t.opacity = 0.25
    }
    // navigation dips the emblem out, glides it, and re-lights it with a sweep
    if (firstRouteRef.current) firstRouteRef.current = false
    else t.reform++
  }, [location.pathname])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const isMobile = window.matchMedia("(max-width: 768px)").matches

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.autoClear = false

    // ── Layer 0: nebula sky (own scene, orthographic fullscreen quad) ──
    const skyScene = new THREE.Scene()
    const skyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const skyUniforms = {
      uTime: { value: Math.random() * 100 },
      uScroll: { value: 0 },
      uAspect: { value: window.innerWidth / window.innerHeight },
    }
    const skyMat = new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform float uTime;
        uniform float uScroll;
        uniform float uAspect;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.55; }
          return v;
        }

        void main() {
          vec2 uv = vUv;
          vec2 p = vec2(uv.x * uAspect, uv.y);
          float t = uTime * 0.018;
          p.y += uScroll * 0.00012;

          // domain-warped silk
          vec2 q = vec2(fbm(p * 1.6 + vec2(t, -t * 0.7)), fbm(p * 1.6 - vec2(t * 0.6, t)));
          float f = fbm(p * 2.4 + q * 1.2);
          float wisp = smoothstep(0.35, 0.95, f);

          // where the smoke is allowed to live: upper-left, mid-right, a whisper at the horizon
          float mask = 0.0;
          mask += smoothstep(0.9, 0.0, distance(uv, vec2(0.12, 0.85))) * 0.9;
          mask += smoothstep(0.85, 0.0, distance(uv, vec2(0.85, 0.72))) * 0.7;
          mask += smoothstep(1.2, 0.2, distance(uv, vec2(0.5, 0.08))) * 0.28;

          vec3 base = vec3(0.020, 0.016, 0.012);
          vec3 ember = vec3(0.45, 0.30, 0.10);
          vec3 gold = vec3(0.83, 0.69, 0.32);
          vec3 col = base + mix(ember, gold, f) * (wisp * mask * 0.11);

          // soft center-lift so pure black never feels flat
          col += vec3(0.016, 0.013, 0.007) * smoothstep(1.05, 0.0, distance(uv, vec2(0.5, 0.62)));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
    skyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat))

    // ── Main scene ──
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100)
    camera.position.z = 9

    // ── Layer 1: bokeh dust ──
    const COUNT = isMobile ? 900 : 2600
    const positions = new Float32Array(COUNT * 3)
    const colors = new Float32Array(COUNT * 3)
    const phases = new Float32Array(COUNT)
    const sizes = new Float32Array(COUNT)
    const gold = new THREE.Color("#d4af37")
    const champagne = new THREE.Color("#f2dd9b")
    const bronze = new THREE.Color("#8f6a14")
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 32
      positions[i * 3 + 1] = (Math.random() - 0.5) * 22
      positions[i * 3 + 2] = (Math.random() - 0.5) * 26
      const r = Math.random()
      const c = r < 0.55 ? gold : r < 0.85 ? bronze : champagne
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
      phases[i] = Math.random() * Math.PI * 2
      sizes[i] = Math.random() < 0.03 ? 4.5 + Math.random() * 3.5 : 1.2 + Math.random() * 2.2
    }
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    dustGeo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3))
    dustGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1))
    dustGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1))
    const dustUniforms = { uTime: { value: 0 } }
    const dustMat = new THREE.ShaderMaterial({
      uniforms: dustUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        varying vec3 vColor;
        varying float vTwinkle;
        varying float vDim;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.y += sin(uTime * 0.05 + aPhase) * 0.5;
          p.x += cos(uTime * 0.04 + aPhase * 1.7) * 0.35;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vTwinkle = 0.6 + 0.4 * sin(uTime * (0.5 + fract(aPhase) * 0.9) + aPhase * 7.0);
          vDim = mix(0.55, 0.10, smoothstep(3.0, 8.0, aSize));
          float sizeScale = 60.0 / max(-mv.z, 4.0);
          gl_PointSize = clamp(aSize * sizeScale, 1.0, 34.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vTwinkle;
        varying float vDim;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          float a = smoothstep(0.5, 0.06, d);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a * vTwinkle * vDim);
        }
      `,
    })
    const dust = new THREE.Points(dustGeo, dustMat)
    scene.add(dust)

    // ── Layer 2: the emblem — beauty-shot lighting on the real logo ──
    const core = new THREE.Group()
    core.position.set(4.2, 0.5, 0)
    scene.add(core)

    const EMBLEM_SIZE = 5.4
    const sigilTexture = new THREE.TextureLoader().load("/brand/titan-mark.png")
    sigilTexture.colorSpace = THREE.SRGBColorSpace
    sigilTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()

    const emblemUniforms = {
      uMap: { value: sigilTexture },
      uTime: { value: 0 },
      uOpacity: { value: 0.9 },
      uReveal: { value: 0 },
      uSweepT: { value: -1 }, // -1 = idle, 0..1 = sheen travelling
      uHeart: { value: 0 },   // heartbeat glow in the engraved grooves
      uForge: { value: 0 },   // surge: the grooves ignite
    }
    const emblemMat = new THREE.ShaderMaterial({
      uniforms: emblemUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uTime;
        uniform float uOpacity;
        uniform float uReveal;
        uniform float uSweepT;
        uniform float uHeart;
        uniform float uForge;
        varying vec2 vUv;

        void main() {
          vec4 tex = texture2D(uMap, vUv);
          if (tex.a < 0.02) discard;
          float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));

          vec3 col = tex.rgb;

          // ambient light breathing across the metal, top-lit bias
          col *= 0.92 + 0.10 * sin(uTime * 0.5 + vUv.y * 2.4) + 0.06 * vUv.y;

          // the titan inside: molten light living in the engraved grooves.
          // grooveMask picks the dark cuts of the shield, never the bright metal
          float grooveMask = tex.a * (1.0 - smoothstep(0.06, 0.4, lum));
          vec3 ember = vec3(1.0, 0.55, 0.18);
          float innerLife = uHeart + uForge * 1.7;
          // the fire rises from deeper cuts first (bottom-weighted while surging)
          innerLife *= 0.8 + 0.5 * (1.0 - vUv.y) * uForge;
          col += ember * grooveMask * innerLife;

          // travelling specular sheen — a diagonal band of light crossing the metal,
          // strongest where the metal is already bright (specular response)
          vec2 dir = normalize(vec2(0.82, -0.57));
          float proj = dot(vUv, dir);
          float c = mix(-0.35, 1.35, uSweepT);
          float band = exp(-pow((proj - c) * 7.0, 2.0));
          float bandCore = exp(-pow((proj - c) * 18.0, 2.0));
          vec3 sheen = vec3(1.0, 0.95, 0.80);
          col += sheen * band * (0.22 + 0.75 * pow(lum, 1.4));
          col += sheen * bandCore * (0.35 + 1.1 * pow(lum, 1.7));

          // reveal rises from the base upward, like the light finding it
          float edge = mix(-0.05, 1.35, uReveal);
          float reveal = smoothstep(edge, edge - 0.3, vUv.y);

          gl_FragColor = vec4(col, tex.a * uOpacity * reveal);
        }
      `,
    })
    const emblem = new THREE.Mesh(new THREE.PlaneGeometry(EMBLEM_SIZE, EMBLEM_SIZE), emblemMat)
    emblem.renderOrder = 2
    core.add(emblem)

    // soft radial halo behind the emblem — melts it into the dark
    const haloCv = document.createElement("canvas")
    haloCv.width = haloCv.height = 128
    const hctx = haloCv.getContext("2d")
    if (hctx) {
      const g = hctx.createRadialGradient(64, 64, 0, 64, 64, 64)
      g.addColorStop(0, "rgba(212,175,55,0.55)")
      g.addColorStop(0.45, "rgba(160,120,30,0.18)")
      g.addColorStop(1, "rgba(0,0,0,0)")
      hctx.fillStyle = g
      hctx.fillRect(0, 0, 128, 128)
    }
    const haloTex = new THREE.CanvasTexture(haloCv)
    const haloMat = new THREE.SpriteMaterial({ map: haloTex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
    const halo = new THREE.Sprite(haloMat)
    halo.scale.setScalar(9)
    halo.renderOrder = 1
    core.add(halo)

    // shockwave — a golden ring that rolls out when the titan surges
    const waveUniforms = {
      uWaveT: { value: -1 }, // -1 idle, 0..1 expanding
      uOpacity: { value: 1 },
    }
    const waveMat = new THREE.ShaderMaterial({
      uniforms: waveUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uWaveT;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          if (uWaveT < 0.0) discard;
          vec2 p = vUv - 0.5;
          float d = length(p) * 2.0;
          float ease = 1.0 - pow(1.0 - uWaveT, 2.0);
          float r = mix(0.22, 1.3, ease);
          float ring = exp(-pow((d - r) * 15.0, 2.0));
          // a fainter second ring trailing the first
          float ring2 = exp(-pow((d - r * 0.72) * 22.0, 2.0)) * 0.45;
          float fade = pow(1.0 - uWaveT, 1.7);
          vec3 col = vec3(1.0, 0.85, 0.5);
          gl_FragColor = vec4(col, (ring + ring2) * fade * 0.4 * uOpacity);
        }
      `,
    })
    const wave = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), waveMat)
    wave.position.z = -0.3
    wave.renderOrder = 1
    core.add(wave)

    // glints — star flares that spark off the bevels as the sheen passes them
    const glintCv = document.createElement("canvas")
    glintCv.width = glintCv.height = 96
    const gctx = glintCv.getContext("2d")
    if (gctx) {
      const rg = gctx.createRadialGradient(48, 48, 0, 48, 48, 20)
      rg.addColorStop(0, "rgba(255,250,235,1)")
      rg.addColorStop(1, "rgba(255,240,200,0)")
      gctx.fillStyle = rg
      gctx.fillRect(0, 0, 96, 96)
      gctx.globalCompositeOperation = "lighter"
      const arm = gctx.createLinearGradient(0, 48, 96, 48)
      arm.addColorStop(0, "rgba(255,245,215,0)")
      arm.addColorStop(0.5, "rgba(255,250,235,0.95)")
      arm.addColorStop(1, "rgba(255,245,215,0)")
      gctx.fillStyle = arm
      gctx.fillRect(0, 45.5, 96, 5)
      gctx.save()
      gctx.translate(48, 48); gctx.rotate(Math.PI / 2); gctx.translate(-48, -48)
      gctx.fillRect(0, 46.5, 96, 3)
      gctx.restore()
    }
    const glintTex = new THREE.CanvasTexture(glintCv)
    // local positions on the emblem where the bevels catch light
    const glintSpots = [
      new THREE.Vector3(1.95, 1.72, 0.15),
      new THREE.Vector3(-1.62, 1.86, 0.15),
      new THREE.Vector3(0.02, -2.28, 0.15),
    ]
    const glints = glintSpots.map((pos) => {
      const m = new THREE.SpriteMaterial({ map: glintTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      const s = new THREE.Sprite(m)
      s.position.copy(pos)
      s.scale.setScalar(0.7)
      s.renderOrder = 3
      core.add(s)
      return s
    })

    // a vast, barely-there shell around everything — the room you're standing in
    const shellMat = new THREE.LineBasicMaterial({ color: 0x9a7b2e, transparent: true, opacity: 0.05 })
    const shell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(11, 1)), shellMat)
    shell.position.set(0, 0, -6)
    scene.add(shell)

    // ── Layer 3: comet ──
    const TRAIL = 22
    const cometPositions = new Float32Array(TRAIL * 3)
    const cometColors = new Float32Array(TRAIL * 3)
    for (let i = 0; i < TRAIL; i++) {
      const k = 1 - i / (TRAIL - 1)
      cometColors[i * 3] = 1.0 * k
      cometColors[i * 3 + 1] = 0.88 * k
      cometColors[i * 3 + 2] = 0.55 * k
    }
    const cometGeo = new THREE.BufferGeometry()
    cometGeo.setAttribute("position", new THREE.BufferAttribute(cometPositions, 3))
    cometGeo.setAttribute("color", new THREE.BufferAttribute(cometColors, 3))
    const cometMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const comet = new THREE.Line(cometGeo, cometMat)
    scene.add(comet)
    const cometState = {
      active: false,
      nextAt: 4 + Math.random() * 6,
      bornAt: 0,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      trail: [] as THREE.Vector3[],
    }

    // ── Input ──
    let mouseX = 0, mouseY = 0, scrollY = window.scrollY
    const onMouse = (e: MouseEvent) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2
      mouseY = (e.clientY / window.innerHeight - 0.5) * 2
    }
    const onScroll = () => { scrollY = window.scrollY }
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
      skyUniforms.uAspect.value = window.innerWidth / window.innerHeight
    }
    if (!isMobile) window.addEventListener("mousemove", onMouse)
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onResize)

    let raf = 0
    let hidden = false
    const onVisibility = () => { hidden = document.hidden }
    document.addEventListener("visibilitychange", onVisibility)

    // ── Emblem lighting timeline ──
    let reformSeen = targetRef.current.reform
    let reformStart = -1
    let revealStart = -1
    let sweepStart = -1
    let lastSweepAt = 0
    let surgeStart = -1
    let lastSurgeAt = 0
    let lightsOn = false
    const onIntroDone = () => { lightsOn = true }
    window.addEventListener("titan:intro-done", onIntroDone)

    const clock = new THREE.Clock()

    const renderFrame = () => {
      renderer.clear()
      renderer.render(skyScene, skyCam)
      renderer.render(scene, camera)
    }

    const SWEEP_DUR = 1.7
    const glintDir = new THREE.Vector2(0.82, -0.57).normalize()

    const animate = () => {
      raf = requestAnimationFrame(animate)
      if (hidden) return
      const dt = clock.getDelta()
      const t = clock.getElapsedTime()
      const target = targetRef.current

      skyUniforms.uTime.value += dt
      skyUniforms.uScroll.value = scrollY
      dustUniforms.uTime.value = t
      emblemUniforms.uTime.value = t

      shell.rotation.y = -t * 0.015
      shell.rotation.x = t * 0.008

      if (!lightsOn && t > 3.0) lightsOn = true // failsafe
      if (lightsOn && revealStart < 0) {
        revealStart = t
        sweepStart = t + 0.55
        lastSweepAt = t + 0.55
        lastSurgeAt = t - 3.5 // first surge lands ~4s after arrival
      }

      // navigation: dip out, glide, re-light with a fresh sweep
      if (target.reform !== reformSeen) {
        reformSeen = target.reform
        reformStart = t
      }
      if (reformStart >= 0) {
        const tt = t - reformStart
        if (tt < 0.3) {
          emblemUniforms.uReveal.value = Math.max(0, 1 - tt / 0.3)
        } else {
          emblemUniforms.uReveal.value = Math.min(1, (tt - 0.3) / 0.9)
          if (tt > 0.55 && sweepStart < reformStart) { sweepStart = t; lastSweepAt = t }
          if (emblemUniforms.uReveal.value >= 1) reformStart = -1
        }
      } else if (revealStart >= 0) {
        emblemUniforms.uReveal.value = Math.min(1, (t - revealStart) / 1.1)
      }

      // the sheen: once on arrival, then a slow patrol every ~8s
      if (emblemUniforms.uReveal.value >= 1 && t - lastSweepAt > 8) {
        sweepStart = t
        lastSweepAt = t
      }
      if (sweepStart >= 0 && t >= sweepStart) {
        const st = (t - sweepStart) / SWEEP_DUR
        emblemUniforms.uSweepT.value = st <= 1 ? st : -1
      }

      // ── the titan's pulse ──
      // resting heartbeat, a slow lub-dub living in the engraved grooves
      const beat = (t % 3.4) / 3.4
      const lub = Math.exp(-Math.pow((beat - 0.1) * 13, 2))
      const dub = Math.exp(-Math.pow((beat - 0.28) * 15, 2)) * 0.55
      emblemUniforms.uHeart.value = (lub + dub) * 0.30

      // the surge: grooves ignite, the emblem thumps, a shockwave rolls out
      if (emblemUniforms.uReveal.value >= 1 && t - lastSurgeAt > 8) {
        surgeStart = t
        lastSurgeAt = t
      }
      let forge = 0
      if (surgeStart >= 0) {
        const ft = t - surgeStart
        forge = ft < 0.3 ? ft / 0.3 : Math.max(0, Math.exp(-(ft - 0.3) * 2.4))
        const wt = ft / 1.6
        waveUniforms.uWaveT.value = wt <= 1 ? wt : -1
        if (ft > 2.5) surgeStart = -1
      }
      emblemUniforms.uForge.value = forge
      waveUniforms.uOpacity.value = Math.min(1, target.opacity * 1.9) * emblemUniforms.uReveal.value

      // glints flare as the sheen band crosses their spot on the metal
      const sweepT = emblemUniforms.uSweepT.value
      for (const g of glints) {
        const mat = g.material as THREE.SpriteMaterial
        if (sweepT >= 0) {
          const uvx = g.position.x / EMBLEM_SIZE + 0.5
          const uvy = g.position.y / EMBLEM_SIZE + 0.5
          const proj = uvx * glintDir.x + uvy * glintDir.y
          const c = -0.35 + 1.7 * sweepT
          const flare = Math.exp(-Math.pow((proj - c) * 9, 2))
          mat.opacity = flare * 0.9 * emblemUniforms.uReveal.value * Math.min(1, target.opacity * 1.9)
          g.scale.setScalar(0.5 + flare * 0.55)
          mat.rotation = t * 0.6
        } else {
          mat.opacity *= 0.9
        }
      }

      // gentle float + lean toward the cursor
      core.rotation.y += (Math.sin(t * 0.14) * 0.13 + mouseX * 0.16 - core.rotation.y) * 0.04
      core.rotation.x += (Math.sin(t * 0.1) * 0.04 - mouseY * 0.09 - core.rotation.x) * 0.04
      core.position.x += (target.x - core.position.x) * 0.03
      core.position.y += (target.y + Math.sin(t * 0.5) * 0.18 - core.position.y) * 0.03
      const s = core.scale.x + (target.scale - core.scale.x) * 0.03
      core.scale.setScalar(s * (1 + forge * 0.022)) // the thump

      emblemUniforms.uOpacity.value += (Math.min(1, target.opacity * 1.9) - emblemUniforms.uOpacity.value) * 0.04
      haloMat.opacity = emblemUniforms.uOpacity.value * emblemUniforms.uReveal.value * (0.17 + forge * 0.2)

      dust.rotation.y = t * 0.01

      // comet lifecycle
      if (!cometState.active && t > cometState.nextAt && !isMobile) {
        cometState.active = true
        cometState.bornAt = t
        cometState.pos.set(-15 - Math.random() * 4, 4 + Math.random() * 5, -4 - Math.random() * 4)
        const dir = new THREE.Vector3(1, -(0.15 + Math.random() * 0.25), 0).normalize()
        cometState.vel.copy(dir).multiplyScalar(15 + Math.random() * 7)
        cometState.trail = Array.from({ length: TRAIL }, () => cometState.pos.clone())
      }
      if (cometState.active) {
        const life = t - cometState.bornAt
        cometState.pos.addScaledVector(cometState.vel, dt)
        cometState.trail.pop()
        cometState.trail.unshift(cometState.pos.clone())
        const posAttr = cometGeo.getAttribute("position") as THREE.BufferAttribute
        for (let i = 0; i < TRAIL; i++) {
          const p = cometState.trail[i]
          posAttr.setXYZ(i, p.x, p.y, p.z)
        }
        posAttr.needsUpdate = true
        cometMat.opacity = Math.min(1, life * 3) * Math.max(0, 1 - Math.max(0, life - 1.6) / 0.6) * 0.8
        if (life > 2.4 || cometState.pos.x > 18) {
          cometState.active = false
          cometMat.opacity = 0
          cometState.nextAt = t + 7 + Math.random() * 8
        }
      }

      if (!prefersReduced) {
        camera.position.x += (mouseX * 0.9 - camera.position.x) * 0.03
        camera.position.y += (-mouseY * 0.6 - scrollY * 0.0016 - camera.position.y) * 0.045
        camera.lookAt(0, -scrollY * 0.0016, 0)
      }

      renderFrame()
    }

    if (prefersReduced) {
      emblemUniforms.uReveal.value = 1
      skyUniforms.uScroll.value = scrollY
      renderFrame()
      const onStaticScroll = () => { skyUniforms.uScroll.value = window.scrollY; renderFrame() }
      window.addEventListener("scroll", onStaticScroll, { passive: true })
    } else {
      animate()
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("mousemove", onMouse)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("titan:intro-done", onIntroDone)
      document.removeEventListener("visibilitychange", onVisibility)
      dustGeo.dispose(); dustMat.dispose()
      skyMat.dispose()
      cometGeo.dispose(); cometMat.dispose()
      shell.geometry.dispose(); shellMat.dispose()
      emblem.geometry.dispose(); emblemMat.dispose()
      wave.geometry.dispose(); waveMat.dispose()
      sigilTexture.dispose(); haloTex.dispose(); glintTex.dispose()
      haloMat.dispose()
      glints.forEach((g) => (g.material as THREE.SpriteMaterial).dispose())
      renderer.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 -z-10 pointer-events-none"
      aria-hidden="true"
    />
  )
}
