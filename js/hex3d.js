/* ============================================================
   Barbudo's Barbershop — techo de hexágonos LED en 3D (hero)

   Lo carga js/fx.js con import() detrás del preloader, y solo si el
   equipo puede. Si algo falla (sin WebGL2, render por software, GPU
   lenta, contexto perdido), queda la foto de respaldo del hero.

   Escena: 7×5 anillos hexagonales en el techo (celular: 5×4), vistos
   desde abajo a ~35°, marfil emisivo con niebla. El brillo del neón no
   es postprocesado (bloom: varias pasadas a pantalla completa por
   cuadro, lo que trababa equipos medios): cada tubo lleva un halo, un
   anillo más ancho que se suma (blending aditivo) y se desvanece hacia
   los bordes. Son dos InstancedMesh: dos llamadas de dibujo en total.
   - Mouse (solo con puntero fino): la cámara se inclina ±4° y los
     tubos cercanos se encienden más; algunos parpadean en rojo 1 s.
   - ignite(): los tubos se encienden en cascada desde el centro.
   - Scroll: la cámara avanza y mira hacia arriba; el halo se apaga.
   Solo dibuja con el hero en pantalla y la pestaña visible, y solo
   cuando algo cambió (si todo está quieto, no gasta GPU).

   Fluidez: antes de mostrarse (detrás del preloader) dibuja unos
   cuadros y mira si el navegador mantiene el ritmo de la pantalla. Si
   no, baja la resolución; si aun así no, se rinde (queda la foto). Ya
   en pantalla, si los cuadros se arrastran (menos de ~25 fps), primero
   baja la resolución y después se retira.
   ============================================================ */

import {
  WebGLRenderer, NeutralToneMapping, Scene, Color, Fog, PerspectiveCamera,
  MathUtils, Shape, Path, Vector2, Vector3, Plane, Raycaster, Object3D,
  ShapeGeometry, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial,
  InstancedMesh, AdditiveBlending, DoubleSide
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
const FOG = { near: 6, far: 17 };

const BG = new Color('#0a0909');
const IVORY = new Color('#ece6dc');
const RED = new Color('#e24234');
const GLOW = 1.3; // intensidad base del tubo (más de 1: lo comprime el tone mapping)
const HOVER_GLOW = 1.3; // extra junto al cursor
const HALO = { width: 0.2, strength: 0.28 }; // ancho a cada lado del tubo y brillo

const RED_MS = 1000; // un tubo rojo dura 1 s
const RED_MAX = 3; // como mucho 3 rojos a la vez
const RED_CHANCE = 0.4; // al pasar sobre un tubo, probabilidad de que se ponga rojo
const RED_REST = 2500; // ms antes de que el mismo tubo pueda volver a ponerse rojo

// Prueba de fluidez: ms entre cuadros que se aceptan dibujando el techo
// (60 fps son 16,7 ms; 20 deja margen para pantallas de 50 Hz)
const FLUID = 20;
const SLOW_FRAME = 40; // en pantalla: mediana de cuadros por encima de esto (< 25 fps) → se retira

/* ---------- Geometría ---------- */

// Anillo hexagonal (vértice a la derecha, lado plano arriba) plano, en el
// techo. El ancho del tubo es parejo en los seis lados.
function hexRing() {
  const corners = (r) => Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return new Vector2(Math.cos(a) * r, Math.sin(a) * r);
  });
  const shape = new Shape(corners(RADIUS));
  shape.holes.push(new Path(corners(RADIUS - TUBE / Math.cos(Math.PI / 6))));
  const geometry = new ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

// Halo del tubo: franjas hexagonales concéntricas a ambos lados de la
// línea central del tubo, con color por vértice que cae como una campana
// (1 en el tubo, 0 en el borde). Multiplicado por el color de cada
// instancia y sumado a lo que hay detrás, parece el brillo del neón.
function hexHalo() {
  const center = RADIUS - TUBE / 2 / Math.cos(Math.PI / 6);
  const steps = [-1, -0.6, -0.3, -0.1, 0, 0.1, 0.3, 0.6, 1];
  const position = [];
  const color = [];
  const loop = (k) => {
    const d = steps[k] * HALO.width;
    const r = center + d / Math.cos(Math.PI / 6); // distancia perpendicular d a cada lado
    const v = Math.exp(-((steps[k] * 2.2) ** 2)); // campana; ~0 en los bordes
    return Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, v: k === 0 || k === steps.length - 1 ? 0 : v };
    });
  };
  const loops = steps.map((_, k) => loop(k));
  const push = (p) => {
    position.push(p.x, 0, p.z);
    color.push(p.v, p.v, p.v);
  };
  for (let k = 0; k < loops.length - 1; k++) {
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      const a = loops[k][i], b = loops[k][j], c = loops[k + 1][i], d = loops[k + 1][j];
      [a, b, c, b, d, c].forEach(push);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
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
  return cells.map((c) => {
    const x = c.x - midX;
    const z = NEAR_Z - c.z;
    // El halo no lleva niebla (sumaría el color del fondo en toda su
    // superficie): se apaga con la distancia a mano, igual que la niebla
    const depth = Math.hypot(x, CEILING, z);
    return {
      x,
      z,
      haze: 1 - MathUtils.smoothstep(depth, FOG.near, FOG.far),
      // distancia al centro de la grilla, para la cascada del encendido
      dist: Math.hypot(c.x - midX, c.z - midZ),
      power: 0, // 0 apagado → 1 encendido
      hover: 0, // brillo extra junto al cursor (0 → 1)
      redAt: -Infinity // cuándo se puso rojo por última vez
    };
  });
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

/* ---------- Fluidez ---------- */

const median = (list) => [...list].sort((a, b) => a - b)[list.length >> 1];

// Mediana del tiempo entre cuadros a lo largo de n cuadros; con draw,
// dibuja en cada uno. Si la GPU no da abasto, el navegador espacia los
// cuadros y esto sube. (Leer un píxel para cronometrar la GPU no sirve:
// en algunos equipos la lectura sola tarda más que un cuadro.)
function frameGap(n, draw) {
  return new Promise((resolve) => {
    const gaps = [];
    let last = null;
    const step = (time) => {
      if (draw) draw();
      if (last !== null) gaps.push(time - last);
      last = time;
      if (gaps.length < n) requestAnimationFrame(step);
      else resolve(median(gaps));
    };
    requestAnimationFrame(step);
  });
}

// ¿Dibujar el techo en cada cuadro mantiene el ritmo de la pantalla? Se
// compara con el ritmo sin dibujar: una pantalla de 120 Hz, un celular en
// ahorro de batería (30 fps) o una página ocupada cargando no cuentan en
// contra del 3D, salvo que no llegue ni a ~25 fps.
async function keepsUp(draw) {
  const idle = await frameGap(10);
  const busy = await frameGap(24, draw);
  return busy <= SLOW_FRAME && busy <= Math.max(idle * 1.25, FLUID);
}

/* ---------- Escena ---------- */

export async function createHexCeiling(container, { lite = false } = {}) {
  const section = container.closest('section') || container;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero__canvas';
  canvas.setAttribute('aria-hidden', 'true');

  // failIfMajorPerformanceCaveat: si solo hay render por software, falla y
  // queda la foto
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: true
  });
  // En producción no hace falta revisar errores de shader: esas consultas
  // al GPU son sincrónicas y traban el primer cuadro
  renderer.debug.checkShaderErrors = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.5));
  renderer.toneMapping = NeutralToneMapping;
  container.appendChild(canvas);

  // Si algo falla de aquí en adelante, se libera la GPU y vuelve la foto
  const destroy = () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };

  const scene = new Scene();
  scene.background = BG;
  scene.fog = new Fog(BG, FOG.near, FOG.far);

  const camera = new PerspectiveCamera(52, 1, 0.1, 40);
  camera.rotation.order = 'YXZ';
  camera.rotation.x = PITCH;

  const cells = honeycomb(lite ? GRID_LITE : GRID);
  const tubes = new InstancedMesh(hexRing(), new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide }), cells.length);
  const halos = new InstancedMesh(hexHalo(), new MeshBasicMaterial({
    vertexColors: true,
    side: DoubleSide,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false
  }), cells.length);
  const dummy = new Object3D();
  const color = new Color();
  cells.forEach((cell, i) => {
    dummy.position.set(cell.x, CEILING, cell.z);
    dummy.updateMatrix();
    tubes.setMatrixAt(i, dummy.matrix);
    halos.setMatrixAt(i, dummy.matrix);
    tubes.setColorAt(i, color.setRGB(0, 0, 0));
    halos.setColorAt(i, color);
  });
  halos.renderOrder = 1;
  scene.add(tubes, halos);

  const draw = () => renderer.render(scene, camera);

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
    camera.aspect = w / h;
    // En vertical (celular) se abre el ángulo para que entren más tubos
    camera.fov = w < h ? 68 : 52;
    camera.updateProjectionMatrix();
    wake();
  };

  // Compila los shaders sin trabar la página (KHR_parallel_shader_compile)
  // y prueba la fluidez antes de mostrar nada (el canvas sigue invisible):
  // si no mantiene el ritmo, baja a resolución 1×; si aun así no, se rinde
  try {
    resize();
    await renderer.compileAsync(scene, camera);
    if (!(await keepsUp(draw))) {
      if (renderer.getPixelRatio() <= 1) throw new Error('GPU lenta');
      renderer.setPixelRatio(1);
      resize();
      if (!(await keepsUp(draw))) throw new Error('GPU lenta');
    }
  } catch (err) {
    destroy();
    throw err;
  }
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
  const scroll = gsap.to(view, {
    travel: 1,
    ease: 'none',
    onUpdate: () => wake(200),
    scrollTrigger: { trigger: section, start: 'top top', end: 'bottom top', scrub: 0.8 }
  });

  /* ----- Retiro: vuelve la foto ----- */
  let retired = false;
  const retire = () => {
    if (retired) return;
    retired = true;
    scroll.scrollTrigger.kill();
    scroll.kill();
    container.classList.remove('is-3d');
    // La foto vuelve con su transición; el canvas se va cuando ya no se ve
    setTimeout(destroy, 1300);
  };

  // Cuadros seguidos (sin pausas de reposo entre medio): si la mediana se
  // arrastra, primero baja la resolución y después se retira
  const gaps = [];
  const watch = (gap) => {
    gaps.push(gap);
    if (gaps.length < 60) return;
    const typical = median(gaps);
    gaps.length = 0;
    if (typical > SLOW_FRAME) retire();
    else if (typical > 28 && renderer.getPixelRatio() > 1) {
      renderer.setPixelRatio(1);
      resize();
    }
  };

  /* ----- Cuadro a cuadro ----- */
  let drewLast = false;
  const frame = (time) => {
    const now = performance.now();
    const reds = cells.filter((c) => now - c.redAt < RED_MS).length;
    if (now > awakeUntil && !reds) {
      lastTime = time;
      drewLast = false;
      return;
    }
    const gap = time - lastTime;
    if (drewLast && gap > 0) watch(gap);
    const dt = Math.min(gap / 1000 || 0.016, 0.1);
    lastTime = time;
    const ease = 1 - Math.exp(-dt * 5);

    // Cámara: parallax suave + recorrido del scroll
    tilt.x += (tilt.tx - tilt.x) * ease;
    tilt.y += (tilt.ty - tilt.y) * ease;
    camera.rotation.y = tilt.x;
    camera.rotation.x = PITCH + tilt.y + view.travel * LOOK_UP;
    camera.position.set(0, view.travel * 0.6, -view.travel * TRAVEL);
    camera.updateMatrixWorld();
    const halo = HALO.strength * (1 - view.travel);

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
      tubes.setColorAt(i, color);
      halos.setColorAt(i, color.multiplyScalar(halo * cell.haze));
    });
    tubes.instanceColor.needsUpdate = true;
    halos.instanceColor.needsUpdate = true;

    // Al pasar sobre un tubo nuevo, a veces se pone rojo
    if (nearDist > RADIUS * 0.95) near = -1;
    if (near !== lastNear && near >= 0) {
      const cell = cells[near];
      if (reds < RED_MAX && now - cell.redAt > RED_REST && Math.random() < RED_CHANCE) cell.redAt = now;
    }
    lastNear = near;

    if (moving) wake(100);
    draw();
    drewLast = true;
  };

  // Dibuja solo con el hero en pantalla y la pestaña visible
  const sync = () => {
    const active = inView && !document.hidden && !retired;
    if (active === running) return;
    running = active;
    drewLast = false;
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
    if (retired) return;
    ev.preventDefault();
    retired = true;
    renderer.setAnimationLoop(null);
    container.classList.remove('is-3d');
    canvas.remove();
  });

  // Primer cuadro (todo apagado) antes de mostrar el canvas
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

  return { canvas, ignite, pixelRatio: () => renderer.getPixelRatio(), alive: () => !retired };
}
