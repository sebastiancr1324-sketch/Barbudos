/* ============================================================
   Barbudo's Barbershop — techo de hexágonos LED en 3D (hero)

   Lo carga js/fx.js con import() cuando el navegador está libre, y
   solo si el equipo lo aguanta. Si algo falla (sin WebGL2, contexto
   perdido), queda la foto de respaldo del hero.

   Escena: 7×5 anillos hexagonales en el techo (un solo InstancedMesh),
   vistos desde abajo a ~35°, marfil emisivo con bloom y niebla.
   - Mouse (solo con puntero fino): la cámara se inclina ±4° y los
     tubos cercanos se encienden más; algunos parpadean en rojo 1 s.
   - ignite(): los tubos se encienden en cascada desde el centro.
   - Scroll: la cámara avanza y mira hacia arriba; el bloom se apaga.
   Solo dibuja con el hero en pantalla y la pestaña visible, y solo
   cuando algo cambió (si todo está quieto, no gasta GPU).

   Calidad baja (lite, celular/táctil): 5×4 hexágonos y sin bloom; los
   módulos de postprocesado ni se descargan.
   ============================================================ */

import {
  WebGLRenderer, WebGLRenderTarget, HalfFloatType, NeutralToneMapping,
  Scene, Color, Fog, PerspectiveCamera, OrthographicCamera, MathUtils,
  Shape, Path, Vector2, Vector3, Plane, Raycaster, Object3D,
  BufferGeometry, Float32BufferAttribute, ExtrudeGeometry,
  MeshBasicMaterial, Mesh, InstancedMesh
} from 'three';
import { gsap } from 'gsap';

const GRID = { cols: 7, rows: 5 }; // calidad completa
const GRID_LITE = { cols: 5, rows: 4 }; // celular
const RADIUS = 1; // del centro del hexágono al vértice
const GAP = 0.16; // entre lados vecinos
const TUBE = 0.05; // ancho del tubo
const CEILING = 3.4; // altura del techo sobre la cámara
const NEAR_Z = -1.4; // dónde empieza la grilla (casi encima de la cámara)
const PITCH = MathUtils.degToRad(35); // la cámara mira hacia arriba
const TILT = MathUtils.degToRad(4); // inclinación máxima con el mouse
const LOOK_UP = MathUtils.degToRad(38); // giro extra al salir del hero
const TRAVEL = 3.2; // cuánto avanza la cámara al salir del hero

const BG = new Color('#0a0909');
const IVORY = new Color('#ece6dc');
const RED = new Color('#e24234');
const GLOW = 1.3; // intensidad base del tubo (más de 1 es lo que "florece")
const HOVER_GLOW = 1.3; // extra junto al cursor
const BLOOM = { strength: 0.42, radius: 0.18, threshold: 0.9 };

const RED_MS = 1000; // un tubo rojo dura 1 s
const RED_MAX = 3; // como mucho 3 rojos a la vez
const RED_CHANCE = 0.4; // al pasar sobre un tubo, probabilidad de que se ponga rojo
const RED_REST = 2500; // ms antes de que el mismo tubo pueda volver a ponerse rojo

/* ---------- Geometría ---------- */

// Anillo hexagonal (vértice a la derecha, lado plano arriba) acostado en
// el plano del techo. El ancho del tubo es parejo en los seis lados.
function hexRing() {
  const corners = (r) => Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return new Vector2(Math.cos(a) * r, Math.sin(a) * r);
  });
  const shape = new Shape(corners(RADIUS));
  shape.holes.push(new Path(corners(RADIUS - TUBE / Math.cos(Math.PI / 6))));
  const geometry = new ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// Panal: columnas a 1,5·s y filas a √3·s, con las columnas impares
// corridas media fila. La grilla arranca casi encima de la cámara y se
// aleja hacia el fondo (−z).
function honeycomb({ cols, rows }) {
  const s = RADIUS + GAP / Math.sqrt(3);
  const cells = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      cells.push({
        x: col * 1.5 * s,
        z: row * Math.sqrt(3) * s + (col % 2 ? (Math.sqrt(3) / 2) * s : 0)
      });
    }
  }
  const midX = (cells[0].x + cells[cells.length - 1].x) / 2;
  const maxZ = Math.max(...cells.map((c) => c.z));
  const midZ = maxZ / 2;
  return cells.map((c) => ({
    x: c.x - midX,
    z: NEAR_Z - c.z,
    // distancia al centro de la grilla, para la cascada del encendido
    dist: Math.hypot(c.x - midX, c.z - midZ),
    power: 0, // 0 apagado → 1 encendido
    hover: 0, // brillo extra junto al cursor (0 → 1)
    redAt: -Infinity // cuándo se puso rojo por última vez
  }));
}

/* ---------- Neón rojo ---------- */

// Cuánto rojo tiene un tubo t ms después de ponerse rojo: entero 1 s y
// vuelve al marfil en los últimos 150 ms.
function redAmount(t) {
  if (t < 0 || t >= RED_MS) return 0;
  return t > RED_MS - 150 ? (RED_MS - t) / 150 : 1;
}

// Parpadeo al encenderse, como un neón: dos cortes en el primer cuarto de
// segundo (no más de 3 destellos por segundo, WCAG 2.3.1).
function neonFlicker(t) {
  if (t < 50) return 0.2;
  if (t < 110) return 1;
  if (t < 170) return 0.35;
  return 1;
}

/* ---------- Shaders ---------- */

// Sin esto, el primer cuadro compila de golpe los shaders de la escena y
// del bloom y traba la página cientos de ms (en Windows, con ANGLE, unos
// 400 ms). compileAsync los compila en segundo plano (KHR_parallel_shader_
// compile). Se compilan con el render target puesto, porque así dibujan
// RenderPass y el bloom: con otro destino Three arma otra variante del
// shader y la vuelve a compilar al usarla. (El de OutputPass, que dibuja
// a pantalla, se compila en el primer cuadro: es uno solo y es chico.)
async function prewarm(renderer, composer, scene, camera, bloom) {
  // Sin bloom se dibuja directo a pantalla: basta con la escena
  if (!composer) {
    await renderer.compileAsync(scene, camera);
    return;
  }
  // El mismo triángulo que usan las pasadas (FullScreenQuad de Three):
  // solo position y uv. Con otra geometría (p. ej. con normales) cambia
  // la variante del shader y no sirve.
  const quad = new BufferGeometry();
  quad.setAttribute('position', new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  quad.setAttribute('uv', new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const passes = new Scene();
  [bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.blendMaterial]
    .filter(Boolean)
    .forEach((material) => passes.add(new Mesh(quad, material)));
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(composer.renderTarget1);
  const jobs = [
    renderer.compileAsync(scene, camera),
    renderer.compileAsync(passes, new OrthographicCamera(-1, 1, 1, -1, 0, 1))
  ];
  renderer.setRenderTarget(previous);
  await Promise.all(jobs);
  quad.dispose();
}

/* ---------- Escena ---------- */

export async function createHexCeiling(container, { lite = false } = {}) {
  const section = container.closest('section') || container;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero__canvas';
  canvas.setAttribute('aria-hidden', 'true');

  // failIfMajorPerformanceCaveat: si solo hay render por software, falla y
  // queda la foto
  // Con bloom, el antialias lo hace el render target (MSAA); sin bloom, el canvas
  const renderer = new WebGLRenderer({ canvas, antialias: lite, failIfMajorPerformanceCaveat: true });
  // En producción no hace falta revisar errores de shader: esas consultas
  // al GPU son sincrónicas y traban el primer cuadro
  renderer.debug.checkShaderErrors = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.5));
  renderer.toneMapping = NeutralToneMapping;
  container.appendChild(canvas);

  const scene = new Scene();
  scene.background = BG;
  scene.fog = new Fog(BG, 6, 17);

  const camera = new PerspectiveCamera(52, 1, 0.1, 40);
  camera.rotation.order = 'YXZ';
  camera.rotation.x = PITCH;

  const cells = honeycomb(lite ? GRID_LITE : GRID);
  const mesh = new InstancedMesh(hexRing(), new MeshBasicMaterial({ color: 0xffffff }), cells.length);
  const dummy = new Object3D();
  const color = new Color();
  cells.forEach((cell, i) => {
    dummy.position.set(cell.x, CEILING, cell.z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.setRGB(0, 0, 0));
  });
  scene.add(mesh);

  // Calidad completa: render en HDR (half float) con MSAA, bloom y salida
  // con tone mapping. Lite: directo a pantalla, sin postprocesado.
  let composer = null;
  let bloom = null;
  if (!lite) {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js')
    ]);
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  const draw = (dt) => (composer ? composer.render(dt) : renderer.render(scene, camera));

  /* ----- Estado ----- */
  const view = { travel: 0 }; // 0 → 1 mientras el hero sale de pantalla
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 }; // parallax actual y objetivo
  const pointer = new Vector2();
  let hasPointer = false;
  let lastNear = -1;
  let awakeUntil = 0;
  let inView = true;
  let running = false;
  let lastTime = 0;

  // Pide dibujar durante los próximos ms (si nada pide, no se dibuja)
  const wake = (ms = 120) => {
    awakeUntil = Math.max(awakeUntil, performance.now() + ms);
  };

  /* ----- Tamaño ----- */
  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    }
    camera.aspect = w / h;
    // En vertical (celular) se abre el ángulo para que entren más tubos
    camera.fov = w < h ? 68 : 52;
    camera.updateProjectionMatrix();
    wake();
  };
  resize();
  new ResizeObserver(resize).observe(container);

  /* ----- Mouse: parallax y tubos que reaccionan ----- */
  const ceiling = new Plane(new Vector3(0, 1, 0), -CEILING);
  const raycaster = new Raycaster();
  const hit = new Vector3();

  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    window.addEventListener('pointermove', (ev) => {
      if (ev.pointerType !== 'mouse' || !inView) return;
      const r = container.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      hasPointer = inside;
      if (inside) {
        pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
        tilt.tx = -pointer.x * TILT;
        tilt.ty = pointer.y * TILT;
      } else {
        tilt.tx = 0;
        tilt.ty = 0;
      }
      wake(900);
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => {
      hasPointer = false;
      tilt.tx = 0;
      tilt.ty = 0;
      wake(900);
    });
  }

  /* ----- Scroll: la cámara avanza y mira hacia arriba ----- */
  gsap.to(view, {
    travel: 1,
    ease: 'none',
    onUpdate: () => wake(200),
    scrollTrigger: { trigger: section, start: 'top top', end: 'bottom top', scrub: 0.8 }
  });

  /* ----- Cuadro a cuadro ----- */
  const frame = (time) => {
    const now = performance.now();
    const reds = cells.filter((c) => now - c.redAt < RED_MS).length;
    if (now > awakeUntil && !reds) {
      lastTime = time;
      return;
    }
    const dt = Math.min((time - lastTime) / 1000 || 0.016, 0.1);
    lastTime = time;
    const ease = 1 - Math.exp(-dt * 5);

    // Cámara: parallax suave + recorrido del scroll
    tilt.x += (tilt.tx - tilt.x) * ease;
    tilt.y += (tilt.ty - tilt.y) * ease;
    camera.rotation.y = tilt.x;
    camera.rotation.x = PITCH + tilt.y + view.travel * LOOK_UP;
    camera.position.set(0, view.travel * 0.6, -view.travel * TRAVEL);
    camera.updateMatrixWorld();
    if (bloom) bloom.strength = BLOOM.strength * (1 - view.travel);

    // Dónde cae el cursor en el techo
    let point = null;
    if (hasPointer) {
      raycaster.setFromCamera(pointer, camera);
      point = raycaster.ray.intersectPlane(ceiling, hit);
    }

    let moving = Math.abs(tilt.tx - tilt.x) + Math.abs(tilt.ty - tilt.y) > 1e-4;
    let near = -1;
    let nearDist = Infinity;
    cells.forEach((cell, i) => {
      const d = point ? Math.hypot(point.x - cell.x, point.z - cell.z) : Infinity;
      if (d < nearDist) {
        nearDist = d;
        near = i;
      }
      const target = point ? 1 - MathUtils.smoothstep(d, 0.4, 2.6) : 0;
      cell.hover += (target - cell.hover) * ease;
      if (Math.abs(target - cell.hover) > 0.002) moving = true;

      const t = now - cell.redAt;
      const red = redAmount(t);
      const flicker = red > 0 ? neonFlicker(t) : 1;
      color.copy(IVORY).lerp(RED, red).multiplyScalar((GLOW + cell.hover * HOVER_GLOW) * cell.power * flicker);
      mesh.setColorAt(i, color);
    });
    mesh.instanceColor.needsUpdate = true;

    // Al pasar sobre un tubo nuevo, a veces se pone rojo
    if (nearDist > RADIUS * 0.95) near = -1;
    if (near !== lastNear && near >= 0) {
      const cell = cells[near];
      if (reds < RED_MAX && now - cell.redAt > RED_REST && Math.random() < RED_CHANCE) cell.redAt = now;
    }
    lastNear = near;

    if (moving) wake(100);
    draw(dt);
  };

  // Dibuja solo con el hero en pantalla y la pestaña visible
  const sync = () => {
    const active = inView && !document.hidden;
    if (active === running) return;
    running = active;
    renderer.setAnimationLoop(active ? frame : null);
    if (active) wake(200);
  };
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    sync();
  }).observe(section);
  document.addEventListener('visibilitychange', sync);

  // Si el navegador pierde el contexto WebGL, vuelve la foto
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    renderer.setAnimationLoop(null);
    container.classList.remove('is-3d');
    canvas.remove();
  });

  // Compila los shaders sin trabar la página y dibuja el primer cuadro
  // (todo apagado) antes de mostrar el canvas
  await prewarm(renderer, composer, scene, camera, bloom);
  draw();
  sync();

  /* ----- Encendido en cascada desde el centro ----- */
  const ignite = () => {
    const tl = gsap.timeline({ onUpdate: () => wake(120) });
    const center = cells.reduce((a, b) => (b.dist < a.dist ? b : a));
    // 3 tubos (ninguno el del centro) se encienden con un parpadeo
    const flickering = new Set(
      cells.filter((c) => c !== center).sort(() => Math.random() - 0.5).slice(0, 3)
    );
    cells.forEach((cell) => {
      const at = 0.15 + cell.dist * 0.11;
      if (flickering.has(cell)) {
        tl.to(cell, {
          keyframes: [
            { power: 0.9, duration: 0.04 },
            { power: 0.08, duration: 0.07 },
            { power: 0.7, duration: 0.05 },
            { power: 0.05, duration: 0.14 },
            { power: 1, duration: 0.1 }
          ],
          ease: 'none'
        }, at);
      } else {
        tl.to(cell, { power: 1, duration: 0.35, ease: 'power2.out' }, at);
      }
    });
    return tl;
  };

  return { canvas, ignite };
}
