/* ============================================================
   Barbudo's Barbershop — poste de barbero en 3D (separador)

   Lo carga js/fx.js con import() cuando el separador se acerca a la
   pantalla, y solo si el equipo aguanta el 3D. Si algo falla, queda el
   SVG de respaldo.

   Un cilindro corto con franjas en diagonal (rojo, marfil y negro) y
   tapas cromadas (metal con un entorno simple, RoomEnvironment). Gira
   con el scroll: la rotación va atada al recorrido del separador por la
   pantalla (scrub). Solo dibuja cuando gira y con el poste en pantalla.
   ============================================================ */

import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, PMREMGenerator,
  CylinderGeometry, SphereGeometry, TorusGeometry, MeshStandardMaterial,
  CanvasTexture, RepeatWrapping, SRGBColorSpace, NeutralToneMapping
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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

export async function createPole(container) {
  const canvas = document.createElement('canvas');
  canvas.className = 'pole__canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, failIfMajorPerformanceCaveat: true });
  renderer.debug.checkShaderErrors = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = NeutralToneMapping;
  container.appendChild(canvas);

  const scene = new Scene();
  // Entorno simple para que el cromo tenga qué reflejar
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 0.15, 9.5);
  camera.lookAt(0, 0, 0);

  const chrome = new MeshStandardMaterial({ color: 0xdedad4, metalness: 1, roughness: 0.18 });
  const pole = new Group();

  // Cuerpo con las franjas (y un toque de brillo, como el acrílico del poste)
  const body = new Mesh(
    new CylinderGeometry(0.55, 0.55, 3, 64, 1, true),
    new MeshStandardMaterial({ map: stripes(), roughness: 0.32, metalness: 0 })
  );
  pole.add(body);

  // Tapas cromadas: aro, cilindro y una cúpula arriba
  [1.5, -1.5].forEach((y) => {
    const cap = new Mesh(new CylinderGeometry(0.7, 0.7, 0.32, 64), chrome);
    cap.position.y = y + Math.sign(y) * 0.16;
    pole.add(cap);
    const ring = new Mesh(new TorusGeometry(0.62, 0.05, 16, 64), chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    pole.add(ring);
  });
  const dome = new Mesh(new SphereGeometry(0.45, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), chrome);
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
