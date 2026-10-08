/* ============================================================
   Barbudo's Barbershop — interacciones
   ============================================================ */
(() => {
  'use strict';

  document.documentElement.classList.add('js');

  // El preloader, las animaciones y el 3D del hero van en js/fx.js (módulo aparte).

  /* ---------- Navegación: sólida (fondo con blur) pasados los 80 px ----------
     Arriba del todo va transparente. No es una animación: funciona también
     con "reducir movimiento". (Ocultarse al bajar y volver al subir lo hace
     js/fx.js.) Sin JS el nav queda sólido siempre (el CSS lo pide con .js). */
  const nav = document.getElementById('nav');
  if (nav) {
    let queued = false;
    const update = () => {
      queued = false;
      nav.classList.toggle('is-solid', window.scrollY > 80);
    };
    window.addEventListener('scroll', () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    }, { passive: true });
    update();

    // Foco de teclado nunca tapado por el nav fijo (WCAG 2.4.11): el
    // scroll-padding solo actúa cuando el navegador desplaza; si el
    // elemento ya estaba en pantalla pero debajo del nav, se baja lo justo.
    // Se cuenta siempre el alto del nav, aunque en ese momento esté oculto
    // (fx.js lo esconde al bajar y lo vuelve a mostrar al subir).
    // Con scroll suave (Lenis, en fx.js) lo hace fx.js a través de Lenis:
    // un scroll por fuera de Lenis puede deshacerse en el cuadro siguiente.
    document.addEventListener('focusin', (ev) => {
      const el = ev.target;
      if (document.documentElement.classList.contains('lenis')) return;
      if (!(el instanceof Element) || nav.contains(el)) return;
      const navBottom = nav.offsetHeight;
      const r = el.getBoundingClientRect();
      // (margen de 32 px: la tarjeta de barbero se inclina al recibir el foco)
      if (r.top < navBottom + 8 && r.bottom > 0) {
        window.scrollBy(0, r.top - navBottom - 32);
      }
    });
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

  /* ---------- Videos: póster diferido ----------
     El atributo poster se descarga siempre al cargar la página (~110 KB
     cada uno) aunque los videos estén muy abajo: se asigna recién cuando
     el video se acerca a la pantalla. */
  const pageVideos = [...document.querySelectorAll('video')];
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

    // Domingo: el local abre solo para los turnos reservados, de 10:00 a
    // 17:00 y con 24 h de anticipación. La regla la aplica Supabase (tabla
    // horario); aquí solo se explica.
    const esDomingo = (iso) => new Date(iso + 'T00:00:00').getDay() === 0;

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
        slotsStatus.textContent = 'Elige una fecha para ver los turnos libres.';
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
        const domingo = esDomingo(fecha);
        if (!rows.length) {
          slotsStatus.textContent = domingo
            ? 'No quedan turnos para ese domingo. Los domingos se reserva con al menos 24 horas de anticipación: prueba con otra fecha.'
            : 'No hay turnos disponibles ese día. Prueba con otra fecha u otro barbero.';
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
        slotsStatus.textContent = (domingo ? 'Domingo, solo con reserva. ' : '') +
          (rows.length === 1 ? 'Queda 1 turno libre:' : 'Quedan ' + rows.length + ' turnos libres:');
      } catch (err) {
        if (req !== slotsReq) return;
        slotsStatus.textContent = 'No pudimos cargar los turnos. Revisa tu conexión e inténtalo de nuevo.';
      } finally {
        if (req === slotsReq) slotsBox.removeAttribute('aria-busy');
      }
    };

    // La sede es un campo oculto (una sola sede): no cambia, no se escucha
    ['f-barbero', 'f-fecha'].forEach((id) => field(id).addEventListener('change', loadSlots));
    loadSlots();

    /* ----- Validación ----- */
    const validate = () => {
      const tel = field('f-tel').value.replace(/[^0-9]/g, '');
      const checks = [
        [field('f-nombre'), field('f-nombre').value.trim().length >= 2, 'Escribe tu nombre para poder reservar.'],
        [field('f-tel'), tel.length >= 7 && tel.length <= 15, 'Escribe un teléfono válido para contactarte.'],
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
      falta_anticipacion: 'Los domingos se reserva con al menos 24 horas de anticipación. Elige otro turno.',
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
        if (code === 'turno_ocupado' || code === 'fuera_de_horario' || code === 'falta_anticipacion') loadSlots();
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
      field('f-barbero').focus();
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

  /* ---------- Barberos: recorte o foto completa ----------
     Cada tarjeta pide el recorte (<slug>-cutout.webp). Si no carga, se
     cambia por la foto completa (<slug>.webp, en data-fallback) y la
     tarjeta pasa a modo foto entera (.is-full). Un navegador sin WebP
     carga directo el <img> .jpg, que también es la foto completa. */
  document.querySelectorAll('.barber__person picture').forEach((picture) => {
    const source = picture.querySelector('source[data-fallback]');
    const img = picture.querySelector('img');
    const card = picture.closest('.barber__card');
    if (!source || !img || !card) return;
    const markFull = () => card.classList.toggle('is-full', !img.currentSrc.includes('-cutout'));
    const useFull = () => {
      if (!source.dataset.fallback) return;
      source.srcset = source.dataset.fallback;
      source.removeAttribute('data-fallback');
      card.classList.add('is-full');
    };
    img.addEventListener('load', markFull);
    img.addEventListener('error', useFull);
    // Ya falló antes de que corriera este script
    if (img.complete && img.currentSrc && img.naturalWidth === 0) useFull();
  });

  /* ---------- Barberos: puntos del carrusel (celular) ----------
     En el celular la grilla es un carrusel con scroll-snap (CSS). Un punto
     por barbero: marca el que está a la vista y lleva a él al tocarlo.
     En pantallas grandes el CSS los oculta. */
  const teamList = document.querySelector('.team__grid');
  const teamDots = document.querySelector('.team__dots');
  if (teamList && teamDots) {
    const members = [...teamList.children];
    const dots = members.map((member, i) => {
      const name = member.querySelector('.barber__name');
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'team__dot';
      dot.setAttribute('aria-label', 'Barbero ' + (i + 1) + ' de ' + members.length + (name ? ': ' + name.textContent : ''));
      dot.addEventListener('click', () => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        teamList.scrollTo({
          left: member.offsetLeft - members[0].offsetLeft,
          behavior: reduceMotion ? 'auto' : 'smooth'
        });
      });
      teamDots.append(dot);
      return dot;
    });
    const setActive = (i) => dots.forEach((dot, j) => {
      if (j === i) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    setActive(0);
    const visibleMember = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(members.indexOf(entry.target));
      });
    }, { root: teamList, threshold: 0.6 });
    members.forEach((member) => visibleMember.observe(member));
    teamDots.hidden = false;
  }

  const thisYear = new Date().getFullYear();

  /* ---------- Año en el footer ---------- */
  document.querySelectorAll('.footer__legal p').forEach((p) => {
    p.textContent = p.textContent.replace('© 2026', '© ' + thisYear);
  });
})();