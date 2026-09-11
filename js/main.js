/* ============================================================
   Barbudo's Barbershop — interacciones
   ============================================================ */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  /* ---------- Preloader ---------- */
  const preloader = document.getElementById('preloader');
  if (preloader) {
    const hide = () => preloader.classList.add('is-done');
    if (reduceMotion) {
      hide();
    } else {
      window.addEventListener('load', () => setTimeout(hide, 500));
      setTimeout(hide, 2200);
    }
  }

  /* ---------- Navegación : sombra al hacer scroll ---------- */
  const nav = document.getElementById('nav');
  const hero = document.getElementById('inicio');
  if (nav && hero) {
    const sentinel = new IntersectionObserver(
      ([entry]) => nav.classList.toggle('is-scrolled', !entry.isIntersecting),
      { rootMargin: '-72px 0px 0px 0px', threshold: 0 }
    );
    sentinel.observe(hero);
  }

  /* ---------- Menú móvil ---------- */
  const burger = document.getElementById('nav-burger');
  const links = document.getElementById('nav-links');
  if (burger && links) {
    const close = () => {
      links.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', 'Abrir menú');
    };
    burger.addEventListener('click', () => {
      const open = links.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    });
    links.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) close();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') close();
    });
  }

  /* ---------- Aparición al hacer scroll ---------- */
  const revealSelectors = [
    '.section__head',
    '.section__title',
    '.section__intro',
    '.feature',
    '.drinks',
    '.barber',
    '.branch',
    '.hours',
    '.ph',
    '.video-item',
    '.contact__row',
    '.contact__card',
    '.booking__info',
    '.form'
  ];

  const revealEls = [...document.querySelectorAll(revealSelectors.join(','))];

  revealEls.forEach((el) => {
    let rd = 0;
    const sib = el.parentElement ? [...el.parentElement.children] : [el];
    rd = Math.min(sib.indexOf(el), 6);
    el.style.setProperty('--rd', String(rd));
    el.classList.add('reveal');
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
  );
  revealEls.forEach((el) => io.observe(el));

  /* ---------- Videos: solo uno a la vez ---------- */
  const pageVideos = [...document.querySelectorAll('video')];
  if (pageVideos.length > 1) {
    pageVideos.forEach((video) => {
      video.addEventListener('play', () => {
        pageVideos.forEach((other) => {
          if (other !== video && !other.paused) other.pause();
        });
      });
    });
  }

  /* ---------- Formulario de turnos → WhatsApp ---------- */
  const form = document.getElementById('booking-form');
  if (form) {
    const WA_NUMBER = '584126938179';

    const field = (id) => document.getElementById(id);

    const setInvalid = (el, bad) => {
      el.classList.toggle('is-invalid', bad);
    };

    const validate = () => {
      const checks = [
        [field('f-nombre'), field('f-nombre').value.trim() !== '', 'Escribe tu nombre para poder reservar.'],
        [field('f-tel'), field('f-tel').value.trim().length >= 7, 'Escribe un teléfono válido para confirmarte el turno.'],
        [field('f-sede'), field('f-sede').value !== '', 'Selecciona la sede donde quieres el turno.'],
        [field('f-servicio'), field('f-servicio').value !== '', 'Selecciona el servicio que quieres.'],
        [field('f-fecha'), field('f-fecha').value !== '', 'Elige la fecha.'],
        [field('f-hora'), field('f-hora').value !== '', 'Elige la hora.']
      ];

      let firstBad = null;
      checks.forEach(([el, ok, msg]) => {
        setInvalid(el, !ok);
        if (!ok && !firstBad) firstBad = { el, msg };
      });

      const fecha = field('f-fecha');
      if (!firstBad && fecha.value) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const chosen = new Date(fecha.value + 'T00:00:00');
        const past = chosen < today;
        setInvalid(fecha, past);
        if (past) firstBad = { el: fecha, msg: 'La fecha no puede ser anterior a hoy.' };
      }

      return firstBad;
    };

    const buildMessage = () => {
      const val = (id) => field(id).value.trim();
      const lines = [
        'Hola Barbudo\u0027s Barbershop, quiero reservar un turno:',
        '',
        '• Nombre: ' + val('f-nombre'),
        '• Teléfono: ' + val('f-tel'),
        '• Sede: ' + val('f-sede'),
        '• Barbero: ' + val('f-barbero'),
        '• Servicio: ' + val('f-servicio'),
        '• Fecha: ' + val('f-fecha'),
        '• Hora: ' + val('f-hora')
      ];
      if (val('f-notas')) lines.push('• Notas: ' + val('f-notas'));
      return lines.join('\n');
    };

    const todayISO = new Date().toISOString().split('T')[0];
    const fechaInput = field('f-fecha');
    if (fechaInput) fechaInput.min = todayISO;

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      form.classList.remove('is-sent');
      const error = validate();
      const errorEl = document.getElementById('form-error');

      if (error) {
        errorEl.textContent = error.msg;
        error.el.focus();
        return;
      }

      errorEl.textContent = '';
      const msg = encodeURIComponent(buildMessage());
      window.open('https://wa.me/' + WA_NUMBER + '?text=' + msg, '_blank', 'noopener');
      form.classList.add('is-sent');
    });

    form.addEventListener('input', (ev) => {
      if (ev.target.classList.contains('is-invalid')) {
        ev.target.classList.remove('is-invalid');
      }
    });
  }

  /* ---------- Año en el footer ---------- */
  document.querySelectorAll('.footer__legal p').forEach((p) => {
    p.textContent = p.textContent.replace('© 2026', '© ' + new Date().getFullYear());
  });
})();