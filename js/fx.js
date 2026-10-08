/* ============================================================
   Barbudo's Barbershop — animaciones (único punto de entrada)

   Módulo ES. GSAP, ScrollTrigger, SplitText y Lenis llegan por el
   importmap de index.html y se piden con import() dinámico:
   - el preloader arranca sin esperar al CDN;
   - con "reducir movimiento" no se descarga nada;
   - si el CDN falla o el navegador no tiene importmap, la página
     queda completa y quieta.
   Los estados ocultos (opacidad 0, máscaras) los pone este archivo
   justo antes de animar, nunca el CSS.

   Atributos que activan los efectos:
     data-fx="title"   título: palabras que suben dentro de su línea
       + data-fx-split="chars"  letra por letra en vez de por palabra
     data-fx="image"   imagen: barrido de abajo arriba + escala 1.15 → 1
     data-fx="fade"    párrafos y tarjetas: suben 40 px y aparecen
     data-fx-group     contenedor: sus data-fx aparecen todos a la vez
     data-fx-intro     sección (el hero): sus data-fx se animan en
                       secuencia al abrirse el preloader, no al scroll
     data-fx-count     cifra que cuenta desde data-fx-from (o 0) hasta
                       la del HTML (dentro de la intro)
     data-fx-neon      texto con brillo de neón (--neon en el CSS) que se
                       prende con parpadeo al terminar su título
     data-fx-magnetic  botón que sigue un poco al mouse (solo puntero fino)
     data-fx-parallax  foto que se corre de -10 % a 10 % dentro de su marco
     data-fx-gallery   galería horizontal (fijada en escritorio)
     data-fx-pole      separador con el poste de barbero (3D o SVG)

   Además: tarjetas apiladas de Servicios (.stack__item), tarjetas 3D de
   los barberos (.barber__card, inclinación con el mouse), cursor propio
   (solo mouse) y el nav que se oculta al bajar.

   El techo 3D del hero (js/hex3d.js) y el poste (js/pole3d.js) también
   se piden desde aquí.
   ============================================================ */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const preloaderEl = document.getElementById('preloader');

let gsap, ScrollTrigger, SplitText, Lenis;

const EASE = 'expo.out';
const START = 'top 85%'; // el efecto arranca cuando el borde de arriba pasa el 85 % de la pantalla

/* ---------- Utilidades ---------- */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Momento del primer pintado con contenido (FCP): ahí se ve el preloader.
// Las librerías se piden recién después, para no competir con el CSS, las
// fuentes y la foto del hero en la carga inicial. Si el navegador no lo
// informa, se sigue a los 1,5 s igual.
const firstPaint = new Promise((resolve) => {
  const fcp = (list) => list.getEntriesByName('first-contentful-paint')[0];
  const done = fcp(performance);
  if (done) {
    resolve(done.startTime);
    return;
  }
  try {
    new PerformanceObserver((list, observer) => {
      const entry = fcp(list);
      if (entry) {
        observer.disconnect();
        resolve(entry.startTime);
      }
    }).observe({ type: 'paint', buffered: true });
  } catch (err) {
    // sin Paint Timing: el respaldo de abajo
  }
  setTimeout(() => resolve(performance.now()), 1500);
});

// Título: SplitText por líneas y palabras; cada palabra (o cada letra, con
// data-fx-split="chars") sube desde abajo de su línea, que hace de
// máscara. Al terminar se deshace el split y el título vuelve a ser texto
// normal (lectores de pantalla, selección). autoSplit vuelve a partir las
// líneas si cambia el ancho o llega la fuente.
function revealTitle(el, vars = {}) {
  const byChar = el.dataset.fxSplit === 'chars';
  let tween;
  SplitText.create(el, {
    type: byChar ? 'lines,words,chars' : 'lines,words',
    mask: 'lines',
    linesClass: 'fx-line',
    autoSplit: true,
    onSplit(self) {
      tween = gsap.from(byChar ? self.chars : self.words, {
        // 110 % de su alto no alcanza: en Oswald la tilde de la Á y la Ñ
        // sobresale ~0,2em por encima de la letra y asomaba antes de tiempo
        yPercent: 130,
        duration: 1.2,
        ease: EASE,
        stagger: byChar ? 0.02 : 0.04,
        ...vars,
        onComplete: () => self.revert()
      });
      return tween;
    }
  });
  return tween;
}

// Cifra que cuenta hasta el número del HTML, de a 1.
function countUp(el, vars = {}) {
  const end = parseInt(el.textContent, 10);
  const counter = { value: Number(el.dataset.fxFrom) || 0 };
  if (Number.isNaN(end)) return null;
  el.textContent = counter.value;
  return gsap.to(counter, {
    value: end,
    duration: 1.6,
    ease: 'power2.out',
    snap: { value: 1 },
    onUpdate: () => { el.textContent = counter.value; },
    ...vars
  });
}

// Neón que se prende: --neon (0 → 1, lo usa el text-shadow del CSS) con dos
// cortes, como un tubo que arranca. Dos destellos en medio segundo (WCAG 2.3.1).
function neonOn(el) {
  gsap.set(el, { '--neon': 0 });
  return gsap.timeline()
    .to(el, { '--neon': 1, duration: 0.05 })
    .to(el, { '--neon': 0.15, duration: 0.07 })
    .to(el, { '--neon': 1, duration: 0.05 })
    .to(el, { '--neon': 0.35, duration: 0.12 })
    .to(el, { '--neon': 1, duration: 0.25, clearProps: '--neon' });
}

// Botón magnético: sigue al cursor mientras está encima (como mucho 12 px)
// y vuelve con rebote al salir. Solo con mouse (nada de efectos hover en táctil).
const MAGNET_MAX = 12;

function magnetic(el, strength = 0.35) {
  const clamp = gsap.utils.clamp(-MAGNET_MAX, MAGNET_MAX);
  el.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    gsap.to(el, {
      x: clamp((ev.clientX - (r.left + r.width / 2)) * strength),
      y: clamp((ev.clientY - (r.top + r.height / 2)) * strength),
      duration: 0.4,
      ease: 'power3.out',
      overwrite: true
    });
  });
  el.addEventListener('pointerleave', () => {
    gsap.to(el, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1, 0.4)', overwrite: true, clearProps: 'transform' });
  });
}

// Imagen: el contenedor se destapa de abajo arriba (clip-path), como la
// pasada de una navaja, y la foto de adentro se asienta de 1.15 a 1.
// Durante el efecto se apaga la transición CSS de la foto (hover) para
// que no pelee con GSAP; al terminar se limpia todo.
function revealImage(el, vars = {}) {
  const media = el.matches('img, video') ? null : el.querySelector('img, video');
  const tl = gsap.timeline(vars);
  tl.fromTo(el,
    { clipPath: 'inset(100% 0% 0% 0%)' },
    { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.2, ease: 'expo.inOut', clearProps: 'clipPath' },
    0
  );
  if (media) {
    gsap.set(media, { transition: 'none' });
    tl.fromTo(media,
      { scale: 1.15 },
      { scale: 1, duration: 1.6, ease: EASE, clearProps: 'transform,transition' },
      0
    );
  }
  return tl;
}

// Párrafos y tarjetas: suben 40 px mientras aparecen.
function fadeUp(targets, vars = {}) {
  return gsap.fromTo(targets,
    { y: 40, opacity: 0 },
    { y: 0, opacity: 1, duration: 1, ease: EASE, clearProps: 'transform,opacity', ...vars }
  );
}

const REVEAL = { title: revealTitle, image: revealImage, fade: fadeUp };

/* ---------- Efectos al hacer scroll ----------
   Al cargar solo se agrega una clase por elemento (.fx-pre-*, en el CSS:
   el estado antes de aparecer) y un ScrollTrigger. El SplitText y las
   animaciones se crean recién cuando el elemento se acerca: armar ~25
   animaciones de golpe obliga a GSAP a leer estilos de cada uno y trababa
   la carga. Al arrancar la animación (que fija sus propios valores de
   inicio) se quita la clase en el mismo instante: no hay parpadeo. */
const PRE = { title: 'fx-pre-title', image: 'fx-pre-image', fade: 'fx-pre-fade' };

function play(targets, vars) {
  const list = [].concat(targets);
  const anim = REVEAL[list[0].dataset.fx](list.length > 1 ? list : list[0], vars);
  list.forEach((el) => el.classList.remove(PRE[el.dataset.fx]));
  return anim;
}

// late: las librerías llegaron después de abrirse el preloader. Lo que ya
// está en pantalla no se esconde (sería un parpadeo); solo se anima lo de abajo.
function initReveals({ late = false } = {}) {
  const inView = (el) => el.getBoundingClientRect().top < window.innerHeight;
  const fades = [];

  document.querySelectorAll('[data-fx]').forEach((el) => {
    // El hero y la galería del local se animan por su cuenta
    if (el.closest('[data-fx-intro], [data-fx-gallery]')) return;
    const type = el.dataset.fx;
    if (!REVEAL[type]) return;
    const trigger = el.closest('[data-fx-group]') || el;
    if (late && inView(trigger)) return;
    el.classList.add(PRE[type]);
    // Los fade sueltos van en lote (abajo) para escalonar los que entran juntos
    if (type === 'fade' && trigger === el) {
      fades.push(el);
      return;
    }
    ScrollTrigger.create({ trigger, start: START, once: true, onEnter: () => play(el) });
  });

  if (fades.length) {
    ScrollTrigger.batch(fades, {
      start: START,
      once: true,
      onEnter: (batch) => play(batch, { stagger: 0.08 })
    });
  }

  // Al imprimir, todo visible: termina lo que esté animando y quita los estados previos
  window.addEventListener('beforeprint', () => {
    gsap.globalTimeline.getChildren(true, true, false).forEach((tween) => tween.progress(1));
    Object.values(PRE).forEach((cls) => document.querySelectorAll('.' + cls).forEach((el) => el.classList.remove(cls)));
  });
}

/* ---------- Intro del hero ----------
   Los data-fx de [data-fx-intro] en orden: cada uno arranca un poco
   después del anterior (el título deja más aire). Las cifras cuentan
   mientras aparece su bloque y el neón se prende cuando terminan de
   llegar las letras. Queda en pausa (y oculto) hasta que el preloader
   empieza a abrirse. Se arma de a un elemento por tarea (con una pausa
   entre medio) para no trabar la página en un solo bloque largo.
   Recibe la línea de tiempo ya creada: una animación de GSAP es
   "thenable", y devolverla desde una función async haría esperar a
   que termine (y en pausa, nunca termina). */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

async function buildIntro(section, tl) {
  let at = 0.1;
  for (const el of section.querySelectorAll('[data-fx]')) {
    const reveal = REVEAL[el.dataset.fx];
    const anim = reveal && reveal(el);
    if (!anim) continue;
    tl.add(anim, at);
    el.querySelectorAll('[data-fx-count]').forEach((n) => {
      const count = countUp(n);
      if (count) tl.add(count, at + 0.15);
    });
    if (el.querySelector('[data-fx-neon]')) tl.add(neonOn(el), at + anim.totalDuration() * 0.85);
    at += reveal === revealTitle ? 0.45 : 0.1;
    await nextTask();
  }
}

/* ---------- Techo 3D del hero ----------
   Solo si el equipo lo aguanta: WebGL2 y más de 4 núcleos y de 4 GB (si
   el navegador no informa la memoria, cuenta como suficiente). Se pide
   cuando el navegador está libre; mientras tanto, y si algo falla, queda
   la foto. Al estar listo, el canvas aparece sobre la foto y los tubos se
   encienden en cascada. */
function can3D() {
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  return !weak && 'WebGL2RenderingContext' in window;
}

function load3D(section) {
  const bg = section && section.querySelector('.hero__bg');
  if (!bg || !can3D()) return;
  const run = async () => {
    try {
      const { createHexCeiling } = await import('./hex3d.js?v=5');
      // Celular o pantalla táctil: calidad baja (menos hexágonos, sin bloom)
      const lite = window.matchMedia('(max-width: 540px), (pointer: coarse)').matches;
      const ceiling = await createHexCeiling(bg, { lite });
      bg.classList.add('is-3d');
      ceiling.ignite();
    } catch (err) {
      // sin 3D: queda la foto de respaldo
    }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1500 });
  else setTimeout(run, 200);
}

/* ---------- Servicios ---------- */

// La foto de cada tarjeta se corre de -10 % a 10 % mientras cruza la pantalla
function initParallax() {
  document.querySelectorAll('[data-fx-parallax]').forEach((el) => {
    gsap.fromTo(el, { yPercent: -10 }, {
      yPercent: 10,
      ease: 'none',
      scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true }
    });
  });
}

// Escritorio: las tarjetas son sticky (CSS). Mientras la siguiente sube y
// la tapa, la de abajo se achica a 0.94 y se oscurece (--shade).
function initStack(mm) {
  mm.add('(min-width: 861px)', () => {
    const items = gsap.utils.toArray('.stack__item');
    items.slice(0, -1).forEach((item, i) => {
      const top = () => parseFloat(getComputedStyle(item).top) || 0;
      gsap.to(item, {
        scale: 0.94,
        '--shade': 0.6,
        ease: 'none',
        scrollTrigger: {
          trigger: items[i + 1],
          start: 'top bottom',
          end: () => 'top ' + top() + 'px',
          scrub: true,
          invalidateOnRefresh: true
        }
      });
    });
  });
}

/* ---------- El local: galería ----------
   Escritorio: la galería se fija (pin) y la pista se corre de lado con el
   scroll (scrub). Celular: carrusel nativo con scroll-snap, sin pin. En los
   dos casos cada foto aparece con el barrido de navaja al entrar en
   pantalla (de costado). */
function initGallery(mm) {
  const gallery = document.querySelector('[data-fx-gallery]');
  if (!gallery) return;
  const track = gallery.querySelector('.gallery__track');
  const pending = new Set(gallery.querySelectorAll('[data-fx]'));
  pending.forEach((el) => el.classList.add(PRE[el.dataset.fx]));
  const reveal = (el) => {
    if (!pending.delete(el)) return;
    play(el);
  };

  mm.add({ desktop: '(min-width: 861px)', mobile: '(max-width: 860px)' }, (context) => {
    if (context.conditions.desktop) {
      gallery.classList.add('is-pinned');
      const distance = () => Math.max(0, track.scrollWidth - gallery.clientWidth);
      const scroll = gsap.to(track, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: {
          trigger: gallery,
          start: 'top top',
          end: () => '+=' + distance(),
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true
        }
      });
      // Las que ya se ven al fijarse aparecen cuando la galería entra;
      // las demás, cuando entran de costado
      pending.forEach((el) => {
        if (el.getBoundingClientRect().left < window.innerWidth) {
          ScrollTrigger.create({ trigger: gallery, start: 'top 70%', once: true, onEnter: () => reveal(el) });
        } else {
          ScrollTrigger.create({ trigger: el, containerAnimation: scroll, start: 'left 92%', once: true, onEnter: () => reveal(el) });
        }
      });

      // Con teclado (los controles del video): el navegador intenta correr
      // la galería para mostrar el foco; se anula y se lleva el scroll de
      // la página al punto donde ese elemento queda a la vista
      const keepLeft = () => { gallery.scrollLeft = 0; };
      const onFocus = (ev) => {
        const st = scroll.scrollTrigger;
        const item = ev.target.closest('.gallery__item');
        if (!st || !item || !distance()) return;
        const p = gsap.utils.clamp(0, 1, (item.offsetLeft - gallery.clientWidth / 3) / distance());
        window.scrollTo(0, st.start + p * (st.end - st.start));
      };
      gallery.addEventListener('scroll', keepLeft);
      track.addEventListener('focusin', onFocus);
      return () => {
        gallery.classList.remove('is-pinned');
        gallery.removeEventListener('scroll', keepLeft);
        track.removeEventListener('focusin', onFocus);
      };
    }

    // Celular: se observa el carrusel recién cuando la galería entra en
    // pantalla (si no, las primeras fotos aparecerían antes de verse). Se
    // observa la figura y no el marco: el recorte previo (clip-path) del
    // marco hace que el observador lo dé por invisible.
    let io;
    const st = ScrollTrigger.create({
      trigger: gallery,
      start: 'top 85%',
      once: true,
      onEnter: () => {
        io = new IntersectionObserver((entries) => entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.querySelectorAll('[data-fx]').forEach(reveal);
          io.unobserve(entry.target);
        }), { root: track, threshold: 0.25 });
        pending.forEach((el) => io.observe(el.closest('.gallery__item') || el));
      }
    });
    return () => {
      st.kill();
      if (io) io.disconnect();
    };
  });
}

/* ---------- Poste de barbero ----------
   El 3D (js/pole3d.js) se pide cuando el separador está por llegar a la
   pantalla, y solo si el equipo aguanta; si no, queda el SVG. */
function loadPole() {
  const el = document.querySelector('[data-fx-pole]');
  if (!el || !can3D()) return;
  const io = new IntersectionObserver(async ([entry]) => {
    if (!entry.isIntersecting) return;
    io.disconnect();
    try {
      const { createPole } = await import('./pole3d.js?v=2');
      await createPole(el);
      el.classList.add('is-3d');
    } catch (err) {
      // sin 3D: queda el SVG
    }
  }, { rootMargin: '600px 0px' });
  io.observe(el);
}

/* ---------- Cursor (solo escritorio con mouse) ----------
   Un punto de 10 px que sigue al mouse con retardo (lerp). Sobre enlaces y
   botones crece (CSS) e invierte colores; sobre fotos de barberos dice
   "Ver" y sobre los botones de reserva, "Reservar". El cursor del sistema
   se mantiene. */
const BOOKING = 'a[href="#reserva"], [data-barbero], [data-servicio], #form-submit';
const LINKS = 'a[href], button, label[for], select, summary, [role="button"]';

function initCursor() {
  const cursor = document.createElement('div');
  cursor.className = 'cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = '<div class="cursor__dot"><span class="cursor__label"></span></div>';
  document.body.append(cursor);
  const label = cursor.querySelector('.cursor__label');

  const target = { x: 0, y: 0 };
  const pos = { x: 0, y: 0 };
  const setX = gsap.quickSetter(cursor, 'x', 'px');
  const setY = gsap.quickSetter(cursor, 'y', 'px');
  let shown = false;

  const hide = () => {
    shown = false;
    cursor.classList.remove('is-visible');
  };

  window.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    target.x = ev.clientX;
    target.y = ev.clientY;
    if (!shown) {
      pos.x = target.x;
      pos.y = target.y;
      shown = true;
      cursor.classList.add('is-visible');
    }
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', hide);

  gsap.ticker.add((time, delta) => {
    if (!shown) return;
    // Lerp independiente de los fps: ~22 % del camino por cuadro a 60 fps
    const k = 1 - Math.pow(0.78, delta / 16.67);
    pos.x += (target.x - pos.x) * k;
    pos.y += (target.y - pos.y) * k;
    setX(pos.x);
    setY(pos.y);
  });

  document.addEventListener('pointerover', (ev) => {
    const el = ev.target;
    // Dentro de un iframe (el mapa) la página deja de recibir el mouse
    if (el.closest('iframe')) {
      hide();
      return;
    }
    const book = el.closest(BOOKING);
    const photo = !book && el.closest('.barber__card');
    const text = book ? 'Reservar' : photo ? 'Ver' : '';
    if (text) label.textContent = text;
    cursor.classList.toggle('is-label', Boolean(text));
    cursor.classList.toggle('is-link', !text && Boolean(el.closest(LINKS)));
  });
}

/* ---------- Barberos: inclinación 3D (solo mouse) ----------
   La tarjeta gira según dónde está el mouse (rotateX/rotateY, máx. 8°).
   Sus capas están a distinta profundidad (translateZ en el CSS), así que
   al girar se mueven distinto (parallax). El reflejo diagonal sigue al
   mouse (--shine-x / --shine-y). Al salir, vuelve a quedar derecha.
   Con teclado: cuando el botón de la tarjeta recibe el foco (Tab,
   :focus-visible), la tarjeta toma una inclinación fija. Esto corre en
   cualquier dispositivo (no solo con mouse). */
const TILT_MAX = 8;

function initTilt({ mouse = true } = {}) {
  document.querySelectorAll('.barber__card').forEach((card) => {
    const turnX = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3.out' });
    const turnY = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3.out' });
    if (mouse) card.addEventListener('pointermove', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const r = card.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width; // 0 → 1
      const y = (ev.clientY - r.top) / r.height;
      turnY((x - 0.5) * 2 * TILT_MAX);
      turnX((0.5 - y) * 2 * TILT_MAX);
      card.style.setProperty('--shine-x', (100 - x * 100).toFixed(1) + '%');
      card.style.setProperty('--shine-y', (100 - y * 100).toFixed(1) + '%');
    });
    card.addEventListener('pointerleave', () => {
      if (card.matches(':has(:focus-visible)')) return;
      turnX(0);
      turnY(0);
    });
    card.addEventListener('focusin', (ev) => {
      if (!ev.target.matches(':focus-visible')) return;
      turnX(TILT_MAX * 0.5);
      turnY(-TILT_MAX * 0.75);
      card.style.setProperty('--shine-x', '35%');
      card.style.setProperty('--shine-y', '65%');
    });
    card.addEventListener('focusout', () => {
      turnX(0);
      turnY(0);
    });
  });
}

/* ---------- Nav: se oculta al bajar y vuelve al subir ----------
   (Pasados los 80 px; el fondo sólido lo pone main.js. El CSS lo deja
   visible si el foco de teclado está adentro o el menú está abierto.) */
function initNavHide() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  let hidden = false;
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      const hide = self.direction === 1 && self.scroll() > 80;
      if (hide === hidden) return;
      hidden = hide;
      nav.classList.toggle('is-hidden', hide);
    }
  });
}

/* ---------- Scroll suave (Lenis + ScrollTrigger) ---------- */
function initScroll() {
  const lenis = new Lenis({ autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

// Enlaces con ancla (#reserva, #servicios…): Lenis baja hasta la sección
// dejando libre la altura del nav + 12 px. Lenis ya descuenta por su cuenta
// el scroll-padding-top del <html> (en el CSS vale eso mismo, y se queda:
// evita que el foco de teclado quede bajo el nav), así que el offset solo
// agrega lo que falte; hoy, 0. La URL se actualiza y el foco pasa a la
// sección para que Tab siga desde ahí.
function initAnchors(lenis) {
  const nav = document.getElementById('nav');
  const offset = () => {
    const navSpace = (nav ? nav.offsetHeight : 0) + 12;
    const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    return Math.min(0, padding - navSpace);
  };

  document.addEventListener('click', (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const link = ev.target.closest('a[href^="#"]');
    if (!link) return;
    const target = link.hash.length > 1 && document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (!target) return;

    ev.preventDefault();
    lenis.scrollTo(target, { offset: offset(), duration: 1.2 });
    if (location.hash !== link.hash) history.pushState(null, '', link.hash);

    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    }
    target.focus({ preventScroll: true });
  });

  // Foco de teclado nunca tapado por el nav fijo (WCAG 2.4.11). Igual que
  // en main.js, pero moviendo el scroll con Lenis para que no se deshaga.
  document.addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (!(el instanceof Element) || (nav && nav.contains(el))) return;
    const navBottom = nav ? nav.offsetHeight : 0;
    const r = el.getBoundingClientRect();
    if (r.top < navBottom + 8 && r.bottom > 0) {
      lenis.scrollTo(lenis.scroll + r.top - navBottom - 32, { immediate: true, force: true });
    }
  });
}

/* ---------- Preloader ----------
   El anillo y el contador avanzan de 0 a 100 en 1,4 s como máximo, contados
   desde que el preloader se pintó. Si la página está lista antes, terminan
   enseguida (nunca antes de 0,8 s, para que se lea); si vino de la caché,
   todo dura 0,4 s. Al llegar a 100 se abre la cortina (CSS). */

// ¿La página vino de la caché? Recarga, volver atrás o visita reciente: el
// documento llegó sin volver a bajar su contenido (0 bytes o un 304).
function fromCache() {
  const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  if (!nav) return false;
  return nav.type === 'back_forward' || nav.transferSize === 0 ||
    (nav.encodedBodySize > 0 && nav.transferSize < nav.encodedBodySize);
}

function startPreloader(el) {
  // fx.js llegó tan tarde que el respaldo del CSS ya lo está retirando
  if (parseFloat(getComputedStyle(el).opacity) < 1) {
    el.remove();
    return null;
  }
  el.classList.add('is-running');
  const cached = fromCache();
  if (cached) el.classList.add('is-fast');

  const bar = el.querySelector('.preloader__bar');
  const count = el.querySelector('.preloader__count');
  const length = bar ? 2 * Math.PI * bar.r.baseVal.value : 0;
  if (bar) bar.style.strokeDasharray = length;

  // Los tiempos se cuentan desde el primer pintado; hasta entonces, en 0
  let t0 = null;
  let minEnd = 0;
  let end = Infinity;
  let from = null;
  let p = 0;
  let ready = false;
  let onOpen;

  // La página está lista: terminar en 250 ms (sin bajar del mínimo ni pasar del máximo)
  const shorten = () => {
    const now = performance.now();
    const target = Math.min(end, Math.max(minEnd, now + 250));
    if (target < end) {
      from = { t: now, p };
      end = target;
    }
  };

  firstPaint.then((t) => {
    t0 = t;
    minEnd = t0 + (cached ? 400 : 800);
    end = t0 + (cached ? 400 : 1400);
    from = { t: t0, p: 0 };
    if (ready) shorten();
  });

  const state = {
    cached,
    opened: false,
    opening: new Promise((resolve) => { onOpen = resolve; }),
    finish() {
      ready = true;
      if (t0 !== null) shorten();
    }
  };

  const open = () => {
    state.opened = true;
    el.classList.add('is-open');
    onOpen();
    const panel = el.querySelector('.preloader__panel');
    const remove = () => el.remove();
    if (panel) {
      panel.addEventListener('transitionend', (ev) => {
        if (ev.target === panel && !ev.pseudoElement && ev.propertyName === 'transform') remove();
      });
    }
    setTimeout(remove, 2000); // por si transitionend no llega
  };

  const tick = (now) => {
    if (t0 !== null) {
      const linear = now >= end ? 1 : from.p + (1 - from.p) * ((now - from.t) / (end - from.t));
      p = Math.min(1, Math.max(p, linear));
      if (bar) bar.style.strokeDashoffset = length * (1 - p);
      if (count) count.textContent = Math.round(p * 100);
    }
    if (p < 1) requestAnimationFrame(tick);
    else open();
  };
  requestAnimationFrame(tick);

  return state;
}

/* ---------- Arranque ---------- */
async function start() {
  const preloader = preloaderEl ? startPreloader(preloaderEl) : null;
  await firstPaint;

  try {
    const [core, st, split, lenis] = await Promise.all([
      import('gsap'),
      import('gsap/ScrollTrigger'),
      import('gsap/SplitText'),
      import('lenis')
    ]);
    gsap = core.gsap || core.default;
    ScrollTrigger = st.ScrollTrigger || st.default;
    SplitText = split.SplitText || split.default;
    Lenis = lenis.default;
    gsap.registerPlugin(ScrollTrigger, SplitText);
    // SplitText mide las líneas con la fuente final; si tarda, se sigue igual
    // (autoSplit vuelve a partir cuando llegue)
    if (document.fonts) await Promise.race([document.fonts.ready, wait(1500)]);
  } catch (err) {
    // Sin librerías (CDN caído, navegador sin importmap): el preloader
    // termina enseguida y la página queda completa, sin animar
    if (preloader) preloader.finish();
    return;
  }

  initAnchors(initScroll());
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (finePointer) {
    document.querySelectorAll('[data-fx-magnetic]').forEach((el) => magnetic(el));
    initCursor();
  }
  initTilt({ mouse: finePointer });

  const hero = document.querySelector('[data-fx-intro]');
  if (preloader && !preloader.opened) {
    const intro = hero ? gsap.timeline({ paused: true }) : null;
    if (intro) await buildIntro(hero, intro);
    preloader.finish();
    await preloader.opening;
    // El hero arranca cuando la cortina empieza a correrse
    if (intro) gsap.delayedCall(preloader.cached ? 0.2 : 0.4, () => intro.play());
    initReveals();
  } else {
    initReveals({ late: true });
  }

  // Secciones. Los ScrollTrigger se ordenan por su posición en la página
  // antes de recalcular: así los que están debajo de la galería fijada
  // cuentan el espacio que agrega el pin.
  initParallax();
  const mm = gsap.matchMedia();
  initStack(mm);
  initGallery(mm);
  initNavHide();
  ScrollTrigger.sort();
  ScrollTrigger.refresh();

  // El 3D, después del contenido
  load3D(hero);
  loadPole();
}

if (reduceMotion) {
  // Sin animación: el CSS ya oculta el preloader; aquí se saca del DOM
  if (preloaderEl) preloaderEl.remove();
} else {
  start();
}
