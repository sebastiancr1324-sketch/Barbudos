/* ============================================================
   Barbudo's Barbershop — interacciones
   ============================================================ */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  // El preloader es solo CSS (600 ms como máximo): no necesita JS.

  /* ---------- Hero: video de fondo y botón de pausa ----------
     Con "reducir movimiento" el <source> ya no aplica (media query) y el
     CSS oculta el video; aquí además se frena por si el navegador
     ignora el atributo media. */
  const heroVideo = document.getElementById('hero-video');
  const heroToggle = document.getElementById('hero-toggle');
  if (heroVideo) {
    if (reduceMotion) {
      heroVideo.removeAttribute('autoplay');
      heroVideo.pause();
    } else if (heroToggle) {
      const sync = () => {
        const paused = heroVideo.paused;
        heroToggle.classList.toggle('is-paused', paused);
        heroToggle.setAttribute('aria-label', paused ? 'Reproducir el video de fondo' : 'Pausar el video de fondo');
      };
      heroToggle.hidden = false;
      heroToggle.addEventListener('click', () => {
        if (heroVideo.paused) heroVideo.play().catch(() => {});
        else heroVideo.pause();
      });
      heroVideo.addEventListener('play', sync);
      heroVideo.addEventListener('pause', sync);
      sync();
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
      if (ev.key !== 'Escape' || !links.classList.contains('is-open')) return;
      const focusInside = links.contains(document.activeElement);
      close();
      // El menú se oculta: el foco no puede quedar en un enlace invisible
      if (focusInside) burger.focus();
    });
  }

  /* ---------- Aparición al hacer scroll ---------- */
  const revealSelectors = [
    '.section__head',
    '.section__title',
    '.section__intro',
    '.service',
    '.drinks',
    '.barber',
    '.branch',
    '.showcase__item',
    '.showcase__video',
    '.booking__aside',
    '.form'
  ];

  // El contenido solo se oculta cuando IntersectionObserver existe y quedó
  // listo (clase reveal-on en <html>). Si algo falla, todo queda visible.
  if (!reduceMotion && "IntersectionObserver" in window) {
    try {
      const revealEls = [...document.querySelectorAll(revealSelectors.join(","))];
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-in");
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
      );
      revealEls.forEach((el) => {
        const sib = el.parentElement ? [...el.parentElement.children] : [el];
        el.style.setProperty("--rd", String(Math.min(sib.indexOf(el), 6)));
        // Lo que ya está en pantalla al cargar no se esconde
        if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("is-in");
        el.classList.add("reveal");
        io.observe(el);
      });
      document.documentElement.classList.add("reveal-on");
      // Al imprimir, todo visible
      window.addEventListener("beforeprint", () => revealEls.forEach((el) => el.classList.add("is-in")));
    } catch (err) {
      document.documentElement.classList.remove("reveal-on");
    }
  }

  /* ---------- Videos: póster diferido ----------
     El atributo poster se descarga siempre al cargar la página (~110 KB
     cada uno) aunque los videos estén muy abajo: se asigna recién cuando
     el video se acerca a la pantalla. */
  // El video de fondo del hero va aparte: no tiene controles ni póster diferido
  const pageVideos = [...document.querySelectorAll('video:not(.hero__video)')];
  const posterIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.poster = entry.target.dataset.poster;
        posterIO.unobserve(entry.target);
      });
    },
    { rootMargin: '600px 0px' }
  );
  pageVideos.filter((v) => v.dataset.poster).forEach((v) => posterIO.observe(v));

  /* ---------- Videos: solo uno a la vez ---------- */
  if (pageVideos.length > 1) {
    pageVideos.forEach((video) => {
      video.addEventListener('play', () => {
        pageVideos.forEach((other) => {
          if (other !== video && !other.paused) other.pause();
        });
      });
    });
  }

  /* ---------- Formulario de turnos → Supabase ----------
     Sin librería: el sitio solo llama a dos funciones RPC públicas
     (turnos_disponibles y crear_reserva, en supabase/schema.sql). La
     base de datos impide que dos personas tomen el mismo turno. */
  const form = document.getElementById('booking-form');
  if (form) {
    const cfg = window.BARBUDOS_CONFIG || {};
    const apiKey = cfg.supabaseAnonKey || '';
    const apiBase = cfg.supabaseUrl && apiKey ? cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/' : null;

    const rpc = async (fn, body) => {
      const headers = { apikey: apiKey, 'Content-Type': 'application/json' };
      // Las claves anon antiguas son JWT y van también como Bearer; las
      // nuevas "publishable" (sb_publishable_…) solo en apikey
      if (apiKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + apiKey;
      const res = await fetch(apiBase + fn, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.message) || 'http_' + res.status);
      return data;
    };

    const field = (id) => document.getElementById(id);
    const slotsBox = field('f-hora');
    const slotsGrid = field('slots-grid');
    const slotsStatus = field('slots-status');
    const submitBtn = field('form-submit');
    const errorEl = field('form-error');
    const done = field('booking-done');

    const setInvalid = (el, bad) => {
      el.classList.toggle('is-invalid', bad);
      if (bad) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    };

    const barberoElegido = () => {
      const v = field('f-barbero').value;
      return v === 'Sin preferencia' ? null : v;
    };
    const horaElegida = () => {
      const r = slotsGrid.querySelector('input:checked');
      return r ? r.value : '';
    };

    // Fecha de hoy en hora local (toISOString usa UTC: en Venezuela,
    // desde las 20:00 ya daba el día siguiente)
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayISO = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    field('f-fecha').min = todayISO;

    const fechaLarga = (iso) =>
      new Date(iso + 'T00:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });

    /* ----- Turnos libres ----- */
    let slotsReq = 0;
    const loadSlots = async () => {
      const sede = field('f-sede').value;
      const fecha = field('f-fecha').value;
      const previa = horaElegida();
      const req = ++slotsReq;
      slotsGrid.replaceChildren();
      setInvalid(slotsBox, false);

      if (!apiBase) {
        slotsStatus.textContent = 'Las reservas en línea aún no están activas. Escríbenos por WhatsApp para apartar tu turno.';
        return;
      }
      if (!sede || !fecha) {
        slotsStatus.textContent = 'Elige sede y fecha para ver los turnos libres.';
        return;
      }
      if (fecha < todayISO) {
        slotsStatus.textContent = 'La fecha no puede ser anterior a hoy.';
        return;
      }

      slotsBox.setAttribute('aria-busy', 'true');
      slotsStatus.textContent = 'Buscando turnos libres…';
      try {
        const rows = await rpc('turnos_disponibles', { p_fecha: fecha, p_sede: sede, p_barbero: barberoElegido() });
        if (req !== slotsReq) return; // llegó tarde: ya se pidió otra combinación
        if (!rows.length) {
          slotsStatus.textContent = 'No hay turnos disponibles ese día. Prueba con otra fecha u otro barbero.';
          return;
        }
        rows.forEach(({ hora }, i) => {
          const value = hora.slice(0, 5); // "08:45:00" → "08:45"
          const id = 'slot-' + i;
          const input = document.createElement('input');
          Object.assign(input, { type: 'radio', name: 'hora', id, value, className: 'slots__input' });
          if (value === previa) input.checked = true;
          const label = document.createElement('label');
          label.htmlFor = id;
          label.className = 'slots__btn mono';
          label.textContent = value;
          slotsGrid.append(input, label);
        });
        slotsStatus.textContent = rows.length === 1 ? 'Queda 1 turno libre:' : 'Quedan ' + rows.length + ' turnos libres:';
      } catch (err) {
        if (req !== slotsReq) return;
        slotsStatus.textContent = 'No pudimos cargar los turnos. Revisa tu conexión e inténtalo de nuevo.';
      } finally {
        if (req === slotsReq) slotsBox.removeAttribute('aria-busy');
      }
    };

    ['f-sede', 'f-barbero', 'f-fecha'].forEach((id) => field(id).addEventListener('change', loadSlots));
    loadSlots();

    /* ----- Validación ----- */
    const validate = () => {
      const tel = field('f-tel').value.replace(/[^0-9]/g, '');
      const checks = [
        [field('f-nombre'), field('f-nombre').value.trim().length >= 2, 'Escribe tu nombre para poder reservar.'],
        [field('f-tel'), tel.length >= 7 && tel.length <= 15, 'Escribe un teléfono válido para contactarte.'],
        [field('f-sede'), field('f-sede').value !== '', 'Selecciona la sede donde quieres el turno.'],
        [field('f-servicio'), field('f-servicio').value !== '', 'Selecciona el servicio que quieres.'],
        [field('f-fecha'), field('f-fecha').value >= todayISO, field('f-fecha').value ? 'La fecha no puede ser anterior a hoy.' : 'Elige la fecha.'],
        [slotsBox, horaElegida() !== '', 'Elige uno de los turnos libres.']
      ];

      let firstBad = null;
      checks.forEach(([el, ok, msg]) => {
        setInvalid(el, !ok);
        if (!ok && !firstBad) firstBad = { el: el === slotsBox ? slotsGrid.querySelector('input') || field('f-fecha') : el, msg };
      });
      return firstBad;
    };

    const ERRORES = {
      turno_ocupado: 'Ese turno se acaba de ocupar. Elige otro de la lista.',
      fuera_de_horario: 'Ese turno ya no está disponible. Elige otro de la lista.',
      demasiados_turnos: 'Ya tienes varios turnos apartados con este teléfono. Escríbenos por WhatsApp si necesitas otro.',
      datos_invalidos: 'Revisa los datos del formulario e inténtalo de nuevo.'
    };

    const showDone = (r) => {
      const rows = [
        ['Sede', 'Sede ' + r.sede],
        ['Barbero', r.barbero],
        ['Servicio', field('f-servicio').value],
        ['Fecha', fechaLarga(r.fecha)],
        ['Hora', r.hora]
      ];
      field('booking-summary').replaceChildren(
        ...rows.map(([k, v]) => {
          const row = document.createElement('div');
          row.className = 'done__row';
          const dt = document.createElement('dt');
          dt.textContent = k;
          const dd = document.createElement('dd');
          dd.textContent = v;
          if (k === 'Hora') dd.className = 'mono';
          row.append(dt, dd);
          return row;
        })
      );
      form.hidden = true;
      done.hidden = false;
      done.focus();
    };

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const error = validate();
      if (error) {
        errorEl.textContent = error.msg;
        error.el.focus();
        return;
      }
      if (!apiBase) {
        errorEl.textContent = 'Las reservas en línea aún no están activas. Escríbenos por WhatsApp para apartar tu turno.';
        return;
      }

      errorEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Reservando…';
      try {
        const res = await rpc('crear_reserva', {
          p_nombre: field('f-nombre').value.trim(),
          p_telefono: field('f-tel').value.trim(),
          p_sede: field('f-sede').value,
          p_barbero: barberoElegido(),
          p_servicio: field('f-servicio').value,
          p_fecha: field('f-fecha').value,
          p_hora: horaElegida(),
          p_notas: field('f-notas').value.trim() || null
        });
        showDone(res);
      } catch (err) {
        const code = Object.keys(ERRORES).find((k) => err.message.includes(k));
        errorEl.textContent = code ? ERRORES[code] : 'No pudimos guardar la reserva. Revisa tu conexión e inténtalo de nuevo.';
        if (code === 'turno_ocupado' || code === 'fuera_de_horario') loadSlots();
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reservar turno';
      }
    });

    // Otra reserva: se conservan nombre y teléfono
    field('booking-again').addEventListener('click', () => {
      const keep = { nombre: field('f-nombre').value, tel: field('f-tel').value };
      form.reset();
      field('f-nombre').value = keep.nombre;
      field('f-tel').value = keep.tel;
      done.hidden = true;
      form.hidden = false;
      loadSlots();
      field('f-sede').focus();
    });

    form.addEventListener('input', (ev) => {
      const el = ev.target.name === 'hora' ? slotsBox : ev.target;
      if (el.classList.contains('is-invalid')) setInvalid(el, false);
    });

    /* "Reservar" de cada barbero y "Reservar este corte": el enlace baja
       al formulario (#reserva) y deja preseleccionado el barbero o el
       servicio. Sin JS, el enlace igual lleva al formulario. */
    const preselect = (select, value) => {
      if (!select || ![...select.options].some((o) => o.value === value)) return;
      const changed = select.value !== value;
      select.value = value;
      setInvalid(select, false);
      if (changed) select.dispatchEvent(new Event('change'));
    };
    document.addEventListener('click', (ev) => {
      const link = ev.target.closest('[data-barbero], [data-servicio]');
      if (!link) return;
      if (link.dataset.barbero) preselect(field('f-barbero'), link.dataset.barbero);
      if (link.dataset.servicio) preselect(field('f-servicio'), link.dataset.servicio);
    });
  }

  /* ---------- Mapas: foco de teclado visible ----------
     Al tabular dentro del iframe (otro dominio) la página pierde el foco y
     :focus-within no aplica: se marca el contenedor del mapa a mano. */
  const maps = document.querySelectorAll('.branch__map');
  const clearMaps = () => maps.forEach((m) => m.classList.remove('is-focused'));
  window.addEventListener('blur', () => setTimeout(() => {
    const active = document.activeElement;
    if (active && active.tagName === 'IFRAME' && active.parentElement.classList.contains('branch__map')) {
      clearMaps();
      active.parentElement.classList.add('is-focused');
    }
  }));
  window.addEventListener('focus', clearMaps);

  /* ---------- Años de experiencia (desde el año de inicio) ---------- */
  const thisYear = new Date().getFullYear();
  document.querySelectorAll('[data-desde]').forEach((el) => {
    const years = thisYear - Number(el.dataset.desde);
    if (years > 0) el.textContent = years + (years === 1 ? ' año' : ' años');
  });

  /* ---------- Año en el footer ---------- */
  document.querySelectorAll('.footer__legal p').forEach((p) => {
    p.textContent = p.textContent.replace('© 2026', '© ' + thisYear);
  });
})();