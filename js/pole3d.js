/* ============================================================
   Barbudo's Barbershop — poste de barbero en 3D (separador)

   Lo carga js/fx.js con import() cuando el separador se acerca a la
   pantalla, y solo si el techo del hero pudo con el 3D. Si algo falla,
   queda el SVG de respaldo.

   Un cilindro corto con franjas en diagonal (rojo, marfil y negro) y
   tapas cromadas. La luz y los reflejos son "matcaps": una esfera
   pintada en un canvas que da el color según hacia dónde mira cada
   punto. Sin luces ni entorno que calcular (antes: RoomEnvironment +
   PMREM, que pedían un módulo más y varias pasadas de GPU al cargar).
   Gira con el scroll: la rotación va atada al recorrido del separador
   por la pantalla (scrub). Solo dibuja cuando gira y con el poste en
   pantalla.
   ============================================================ */

import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh,
  CylinderGeometry, SphereGeometry, TorusGeometry, MeshMatcapMaterial,
  CanvasTexture, RepeatWrapping, SRGBColorSpace, NeutralToneMapping
} from 'three';
import { gsap } from 'gsap';

const RED = '#e24234';
const IVORY = '#ece6dc';
const BLACK = '#0a0909';
const TURNS = 2; // vueltas mientras el separador cruza la pantalla

// Textura de las franjas: bandas diagonales que, enrolladas en el cilindro,
// forman la espiral. Rojo, marfil, negro, marfil en cada período.
function stripes() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = IVORY;
  ctx.fillRect(0, 0, size, size);
  // Se dibujan en diagonal (45°) y se repiten sin cortes en los bordes
  const band = (color, from, width) => {
    ctx.fillStyle = color;
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      const o = from + k * size;
      ctx.moveTo(o, 0);
      ctx.lineTo(o + width, 0);
      ctx.lineTo(o + width - size, size);
      ctx.lineTo(o - size, size);
      ctx.closePath();
      ctx.fill();
    }
  };
  band(RED, 0, size * 0.36);
  band(BLACK, size * 0.5, size * 0.16);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 3);
  texture.anisotropy = 4;
  return texture;
}

// Matcap: una esfera iluminada pintada en 2D. paint(ctx, size) dibuja
// sobre el círculo ya recortado.
function matcap(paint) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  paint(ctx, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// Acrílico: blanco que cae a gris en los bordes y un brillo arriba a la izquierda
const acrylic = () => matcap((ctx, s) => {
  const base = ctx.createRadialGradient(s * 0.45, s * 0.4, 0, s / 2, s / 2, s / 2);
  base.addColorStop(0, '#ffffff');
  base.addColorStop(0.7, '#d8d4ce');
  base.addColorStop(1, '#6f6b66');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  const spot = ctx.createRadialGradient(s * 0.32, s * 0.28, 0, s * 0.32, s * 0.28, s * 0.18);
  spot.addColorStop(0, 'rgba(255,255,255,0.9)');
  spot.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, s, s);
});

// Cromo: cielo claro arriba, horizonte oscuro, piso medio y un reflejo duro
const chromeCap = () => matcap((ctx, s) => {
  const sky = ctx.createLinearGradient(0, 0, 0, s);
  sky.addColorStop(0, '#f4f1ec');
  sky.addColorStop(0.42, '#a9a59f');
  sky.addColorStop(0.5, '#2a2725');
  sky.addColorStop(0.6, '#56524d');
  sky.addColorStop(1, '#bdb8b1');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, s, s);
  const rim = ctx.createRadialGradient(s / 2, s / 2, s * 0.36, s / 2, s / 2, s / 2);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(s * 0.34, s * 0.26, s * 0.1, s * 0.05, -0.5, 0, Math.PI * 2);
  ctx.fill();
});

export async function createPole(container, { pixelRatio = 1.5 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'pole__canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, failIfMajorPerformanceCaveat: true });
  renderer.debug.checkShaderErrors = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatio));
  renderer.toneMapping = NeutralToneMapping;
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 0.15, 9.5);
  camera.lookAt(0, 0, 0);

  const chrome = new MeshMatcapMaterial({ matcap: chromeCap() });
  const pole = new Group();

  // Cuerpo con las franjas (y un toque de brillo, como el acrílico del poste)
  const body = new Mesh(
    new CylinderGeometry(0.55, 0.55, 3, 48, 1, true),
    new MeshMatcapMaterial({ map: stripes(), matcap: acrylic() })
  );
  pole.add(body);

  // Tapas cromadas: aro, cilindro y una cúpula arriba
  [1.5, -1.5].forEach((y) => {
    const cap = new Mesh(new CylinderGeometry(0.7, 0.7, 0.32, 48), chrome);
    cap.position.y = y + Math.sign(y) * 0.16;
    pole.add(cap);
    const ring = new Mesh(new TorusGeometry(0.62, 0.05, 12, 48), chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    pole.add(ring);
  });
  const dome = new Mesh(new SphereGeometry(0.45, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), chrome);
  dome.position.y = 1.82;
  pole.add(dome);
  pole.rotation.z = 0.04;
  scene.add(pole);

  /* ----- Tamaño ----- */
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  };

  // Dibuja un cuadro (solo cuando cambia algo: el giro o el tamaño)
  let queued = false;
  let visible = false;
  const render = () => {
    if (queued || !visible) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderer.render(scene, camera);
    });
  };

  /* ----- Giro atado al scroll ----- */
  gsap.to(pole.rotation, {
    y: Math.PI * 2 * TURNS,
    ease: 'none',
    onUpdate: render,
    scrollTrigger: { trigger: container, start: 'top bottom', end: 'bottom top', scrub: 0.6 }
  });

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    render();
  }).observe(container);
  new ResizeObserver(resize).observe(canvas);

  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    container.classList.remove('is-3d');
    canvas.remove();
  });

  // Compila los shaders en segundo plano y dibuja el primer cuadro
  await renderer.compileAsync(scene, camera);
  visible = true;
  resize();
  renderer.render(scene, camera);
}
