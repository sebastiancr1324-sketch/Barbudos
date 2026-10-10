/* ============================================================
   Barbudo's Barbershop — panel de reservas
   Entra con Supabase Auth. Solo los usuarios de la tabla admins
   pueden leer reservas (lo controla la base de datos, no este JS).
   ============================================================ */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const notice = $('admin-notice');
  const showNotice = (msg) => {
    notice.textContent = msg;
    notice.hidden = !msg;
  };

  const cfg = window.BARBUDOS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
    showNotice(!window.supabase
      ? 'No se pudo cargar la librería de Supabase. Revisa tu conexión y recarga.'
      : 'Falta configurar Supabase en js/config.js.');
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  const views = { login: $('view-login'), app: $('view-app') };
  const show = (name) => {
    Object.entries(views).forEach(([k, el]) => (el.hidden = k !== name));
  };

  // localStorage puede fallar (modo privado): nunca debe romper el panel
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* sin memoria */ } }
  };

  /* ---------- Fechas (hora local del navegador) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (value) => new Date(value + 'T00:00:00');
  const todayISO = () => iso(new Date());
  const shiftDay = (value, days) => {
    const d = parse(value);
    d.setDate(d.getDate() + days);
    return iso(d);
  };
  // Lunes de la semana de esa fecha
  const weekStart = (value) => shiftDay(value, -((parse(value).getDay() + 6) % 7));
  const isoDow = (value) => ((parse(value).getDay() + 6) % 7) + 1; // 1 = lunes … 7 = domingo
  const fechaLarga = (value) =>
    parse(value).toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });
  const toMin = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
  const fromMin = (m) => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const horaCorta = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());

  /* ---------- Datos fijos ---------- */
  // Precios del cartel del local (los mismos de index.html). Solo sirven
  // para el estimado del día: si cambian, actualizarlos aquí también.
  const PRECIOS = { 'Corte Standard': 10, 'Corte Full': 12, 'Corte Premium': 15 };

  const ESTADOS = {
    pendiente: 'Por confirmar',
    confirmada: 'Confirmado',
    completada: 'Atendido',
    no_asistio: 'No vino',
    cancelada: 'Cancelado'
  };

  // Qué botones ofrece cada estado: [estado nuevo, texto, estilo]
  const ACCIONES = {
    pendiente: [['confirmada', 'Confirmar', 'primary'], ['cancelada', 'Cancelar', 'quiet']],
    confirmada: [['completada', 'Atendido', 'primary'], ['no_asistio', 'No vino', 'ghost'], ['cancelada', 'Cancelar', 'quiet']],
    completada: [['confirmada', 'Deshacer', 'quiet']],
    no_asistio: [['confirmada', 'Deshacer', 'quiet']],
    cancelada: []
  };

  // Lo que dice el aviso después de cada cambio
  const HECHO = {
    confirmada: 'confirmado',
    completada: 'marcado como atendido',
    no_asistio: 'marcado como "no vino"',
    cancelada: 'cancelado: la hora quedó libre',
    pendiente: 'vuelto a "por confirmar"'
  };

  // Filtros del resumen (en este orden)
  const FILTROS = [
    ['todos', 'Turnos', (r) => r.estado !== 'cancelada'],
    ['pendiente', 'Por confirmar', (r) => r.estado === 'pendiente'],
    ['confirmada', 'Confirmados', (r) => r.estado === 'confirmada'],
    ['completada', 'Atendidos', (r) => r.estado === 'completada'],
    ['no_asistio', 'No vinieron', (r) => r.estado === 'no_asistio'],
    ['cancelada', 'Cancelados', (r) => r.estado === 'cancelada']
  ];
  const filtroDe = (key) => (FILTROS.find((f) => f[0] === key) || FILTROS[0])[2];

  /* ---------- Utilidades ---------- */
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const SVG = {
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.2-4A8 8 0 1 1 8.4 19z"/><path d="M9 9.5c.3 2.2 2.3 4.3 4.6 4.8l1.2-1.2 1.7.9-.5 1.6c-3.6.3-7.6-3.6-7.5-7.3l1.6-.5.9 1.7z"/></svg>',
    tel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5l2.6.4 1.1 4-1.8 1.4a12 12 0 0 0 6.2 6.2l1.4-1.8 4 1.1.4 2.6c-.2 1.5-1.4 2.6-2.9 2.6C10 20 4 14 4 6.4c0-1.5 1.1-2.7 2.6-2.9z"/></svg>'
  };
  const icon = (name) => {
    const span = el('span', 'icon');
    span.innerHTML = SVG[name];
    return span;
  };

  // "José Gregorio" → "jose-gregorio" (nombre de su foto en assets/img/barberos)
  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
  const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const iniciales = (s) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const primerNombre = (s) => s.trim().split(/\s+/)[0];

  // Foto del barbero; si no está, sus iniciales
  const avatar = (nombre, className) => {
    const wrap = el('span', 'avatar ' + (className || ''));
    wrap.setAttribute('aria-hidden', 'true');
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 48;
    img.height = 48;
    img.src = 'assets/img/barberos/' + slug(nombre) + '.webp';
    img.addEventListener('error', () => {
      img.remove();
      wrap.textContent = iniciales(nombre);
    });
    wrap.append(img);
    return wrap;
  };

  // Teléfono del cliente: 0412… → 58412…
  const telDigits = (tel) => {
    let n = tel.replace(/[^0-9]/g, '');
    if (n.startsWith('0')) n = '58' + n.slice(1);
    return n;
  };
  const telBonito = (tel) => {
    const n = tel.replace(/[^0-9]/g, '');
    return n.length === 11 && n.startsWith('0') ? n.slice(0, 4) + '-' + n.slice(4, 7) + '-' + n.slice(7) : tel;
  };

  // WhatsApp con el mensaje ya escrito según el estado del turno
  const waLink = (r) => {
    const futuro = r.fecha > todayISO() || (r.fecha === todayISO() && toMin(r.hora) > nowMin());
    let txt = 'Hola ' + primerNombre(r.nombre) + ', te escribimos de Barbudo\'s Barbershop.';
    if ((r.estado === 'pendiente' || r.estado === 'confirmada') && futuro) {
      txt += ' Te confirmamos tu turno del ' + fechaLarga(r.fecha) + ' a las ' + r.hora.slice(0, 5) +
        ' con ' + barberoNombre(r) + ' (' + servicioNombre(r) + '). ¡Te esperamos!';
    }
    return 'https://wa.me/' + telDigits(r.telefono) + '?text=' + encodeURIComponent(txt);
  };

  const barberoNombre = (r) => (r.barberos && r.barberos.nombre) || 'Barbero';
  const servicioNombre = (r) => (r.servicios && r.servicios.nombre) || 'Servicio';

  /* ---------- Estado del panel ---------- */
  const KEY_BARBERO = 'barbudos.panel.barbero';
  const state = {
    fecha: '',
    barbero: 'todos', // id del barbero (texto) o 'todos'
    filtro: 'todos',
    q: '',
    rows: [], // turnos de la semana de state.fecha
    rowsWeek: '', // lunes de esa semana
    loaded: false,
    barberos: [],
    horario: new Map(), // dia_semana → { abre, cierra, anticipacion_horas }
    duracion: 45,
    syncedAt: null
  };

  /* ---------- Sesión ---------- */
  const loginForm = $('login-form');
  const loginError = $('login-error');
  const loginBtn = $('login-submit');
  const pass = $('l-pass');

  $('l-peek').addEventListener('click', (ev) => {
    const visible = pass.type === 'password';
    pass.type = visible ? 'text' : 'password';
    ev.currentTarget.textContent = visible ? 'Ocultar' : 'Mostrar';
    ev.currentTarget.setAttribute('aria-pressed', String(visible));
  });

  loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('l-email').value.trim();
    const password = pass.value;
    if (!email || !password) {
      loginError.textContent = 'Escribe tu correo y contraseña.';
      return;
    }
    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Entrando…';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';
    if (error) {
      loginError.textContent = error.message.includes('Invalid login')
        ? 'Correo o contraseña incorrectos.'
        : 'No se pudo entrar: ' + error.message;
    }
  });

  $('admin-logout').addEventListener('click', () => sb.auth.signOut());

  let current; // id del usuario con sesión (undefined hasta el primer evento)
  sb.auth.onAuthStateChange((_event, session) => {
    const userId = session ? session.user.id : null;
    if (userId === current) return;
    current = userId;
    // Fuera del callback: supabase-js no permite llamadas que esperen aquí
    setTimeout(() => enter(session), 0);
  });

  const enter = async (session) => {
    showNotice('');
    $('admin-user').hidden = !session;
    if (!session) {
      stopPolling();
      show('login');
      pass.value = '';
      return;
    }
    $('admin-hello').textContent = session.user.email;
    const { data: isAdmin, error } = await sb.rpc('es_admin');
    if (error || !isAdmin) {
      show(null);
      showNotice(error
        ? 'No se pudo comprobar tu acceso: ' + error.message
        : 'Tu usuario no tiene acceso al panel. Pide al administrador que te agregue.');
      return;
    }
    show('app');
    if (!state.fecha) state.fecha = todayISO();
    dayInput.value = state.fecha;
    if (!state.loaded) listStatus.textContent = 'Cargando turnos…';
    await loadCatalog(session.user.id);
    load();
    startPolling();
  };

  /* ---------- Barberos, horario y duración del turno ---------- */
  const loadCatalog = async (userId) => {
    const [b, h, a, me] = await Promise.all([
      sb.from('barberos').select('id, nombre, activo, orden').order('orden'),
      sb.from('horario').select('dia_semana, abre, cierra, anticipacion_horas'),
      sb.from('ajustes').select('duracion_turno_min').maybeSingle(),
      sb.from('admins').select('nombre').eq('user_id', userId).maybeSingle()
    ]);
    if (me.data && me.data.nombre) $('admin-hello').textContent = 'Hola, ' + me.data.nombre;
    if (!h.error) state.horario = new Map((h.data || []).map((d) => [d.dia_semana, d]));
    if (!a.error && a.data) state.duracion = a.data.duracion_turno_min;
    state.barberos = b.error ? [] : (b.data || []).filter((x) => x.activo);

    // Barbero elegido: el del enlace (?barbero=gabriel-hidalgo) o el que
    // quedó guardado en este equipo
    const fromUrl = new URLSearchParams(location.search).get('barbero');
    const byUrl = fromUrl && state.barberos.find((x) => slug(x.nombre) === fromUrl);
    const saved = store.get(KEY_BARBERO);
    const bySaved = state.barberos.find((x) => String(x.id) === saved);
    state.barbero = byUrl ? String(byUrl.id) : bySaved ? saved : 'todos';
    renderBarbers();
  };

  /* ---------- Elementos ---------- */
  const dayInput = $('day-input');
  const list = $('list');
  const listStatus = $('list-status');
  const weekEl = $('week');
  const statsEl = $('stats');
  const barbersEl = $('barbers');
  const searchEl = $('search');
  const syncText = $('sync-text');

  const barberoActual = () => state.barberos.find((x) => String(x.id) === state.barbero) || null;
  const delBarbero = (r) => state.barbero === 'todos' || String(r.barbero_id) === state.barbero;
  const delDia = (fecha) => state.rows.filter((r) => r.fecha === fecha && delBarbero(r));

  /* ---------- Render: barberos ---------- */
  const renderBarbers = () => {
    const opciones = [{ id: 'todos', nombre: 'Todos' }].concat(state.barberos);
    barbersEl.replaceChildren(...opciones.map((b) => {
      const id = String(b.id);
      const btn = el('button', 'chip' + (id === 'todos' ? ' chip--all' : ''));
      btn.type = 'button';
      btn.dataset.id = id;
      btn.setAttribute('aria-pressed', String(id === state.barbero));
      if (id === 'todos') {
        const ic = el('span', 'avatar avatar--all');
        ic.setAttribute('aria-hidden', 'true');
        ic.textContent = state.barberos.length || '·';
        btn.append(ic, el('span', 'chip__name', 'Todos'));
      } else {
        btn.append(avatar(b.nombre), el('span', 'chip__name', primerNombre(b.nombre)));
        btn.title = b.nombre;
        btn.setAttribute('aria-label', b.nombre);
      }
      btn.addEventListener('click', () => setBarbero(id));
      return btn;
    }));
    barbersEl.closest('.barbers').hidden = !state.barberos.length;
  };

  const setBarbero = (id) => {
    state.barbero = id;
    store.set(KEY_BARBERO, id === 'todos' ? null : id);
    // El enlace sirve de marcador: "admin.html?barbero=gabriel-hidalgo"
    const b = barberoActual();
    const url = new URL(location.href);
    if (b) url.searchParams.set('barbero', slug(b.nombre));
    else url.searchParams.delete('barbero');
    history.replaceState(null, '', url);
    barbersEl.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === id)));
    const sel = barbersEl.querySelector('[aria-pressed="true"]');
    if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    render();
  };

  /* ---------- Render: semana ---------- */
  const renderWeek = () => {
    const start = weekStart(state.fecha);
    const hoy = todayISO();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const f = shiftDay(start, i);
      const d = parse(f);
      const n = delDia(f).filter((r) => r.estado !== 'cancelada').length;
      const pend = delDia(f).filter((r) => r.estado === 'pendiente').length;
      const cerrado = state.horario.size && !state.horario.has(isoDow(f));

      const li = el('li');
      const btn = el('button', 'week__day');
      btn.type = 'button';
      if (f === state.fecha) btn.setAttribute('aria-current', 'date');
      if (f === hoy) btn.classList.add('is-today');
      if (f < hoy) btn.classList.add('is-past');
      if (cerrado) btn.classList.add('is-closed');
      btn.append(
        el('span', 'week__dow', d.toLocaleDateString('es-VE', { weekday: 'short' }).replace('.', '')),
        el('span', 'week__num', String(d.getDate())),
        el('span', 'week__count' + (pend ? ' has-pending' : ''), cerrado && !n ? 'Cerrado' : n ? (n === 1 ? '1 turno' : n + ' turnos') : '—')
      );
      btn.setAttribute('aria-label', fechaLarga(f) + ': ' + (cerrado && !n ? 'cerrado' : n + (n === 1 ? ' turno' : ' turnos')) +
        (pend ? ', ' + pend + ' por confirmar' : ''));
      btn.addEventListener('click', () => goTo(f));
      li.append(btn);
      days.push(li);
    }
    weekEl.replaceChildren(...days);

    // En el celular la semana se desliza: que el día elegido quede a la vista
    // (moviendo solo la tira, no la página)
    const sel = weekEl.querySelector('[aria-current="date"]');
    if (sel && weekEl.scrollWidth > weekEl.clientWidth) {
      const li = sel.parentElement;
      weekEl.scrollLeft = li.offsetLeft - (weekEl.clientWidth - li.offsetWidth) / 2;
    }
  };

  /* ---------- Render: resumen (también son los filtros) ---------- */
  const renderStats = (dia) => {
    statsEl.replaceChildren(...FILTROS.map(([key, label, fn]) => {
      const n = dia.filter(fn).length;
      const btn = el('button', 'stat stat--' + key);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(state.filtro === key));
      if (!n && key !== 'todos') btn.classList.add('is-zero');
      btn.append(el('span', 'stat__num mono', String(n)), el('span', 'stat__label', label));
      btn.addEventListener('click', () => {
        state.filtro = state.filtro === key ? 'todos' : key;
        render();
      });
      return btn;
    }));
  };

  /* ---------- Render: un turno ---------- */
  const renderTurno = (r, ctx) => {
    const card = el('article', 'turno turno--' + r.estado);
    card.dataset.id = r.id;
    const ini = toMin(r.hora);
    if (ctx.esHoy && ini <= ctx.ahora && ctx.ahora < ini + state.duracion && r.estado !== 'cancelada') card.classList.add('is-now');
    // Ya pasó y nadie marcó si vino: pide acción
    const pasado = ctx.fecha < ctx.hoy || (ctx.esHoy && ini + state.duracion <= ctx.ahora);
    if (pasado && (r.estado === 'pendiente' || r.estado === 'confirmada')) card.classList.add('needs-action');
    if (ctx.nuevos.has(r.id)) card.classList.add('is-new');

    const top = el('div', 'turno__top');
    if (state.barbero === 'todos') top.append(avatar(barberoNombre(r), 'turno__avatar'));

    const who = el('div', 'turno__who');
    const name = el('h3', 'turno__nombre', r.nombre);
    who.append(name);
    const meta = el('p', 'turno__meta');
    const serv = servicioNombre(r);
    meta.append(el('span', 'turno__serv', serv));
    if (PRECIOS[serv]) meta.append(el('span', 'turno__precio mono', '$' + PRECIOS[serv]));
    if (state.barbero === 'todos') meta.append(el('span', 'turno__barbero', 'con ' + primerNombre(barberoNombre(r))));
    who.append(meta);
    top.append(who);

    const tags = el('div', 'turno__tags');
    tags.append(el('span', 'pill pill--' + r.estado, ESTADOS[r.estado] || r.estado));
    if (card.classList.contains('is-now')) tags.append(el('span', 'pill pill--now', 'En curso'));
    else if (card.classList.contains('needs-action')) tags.append(el('span', 'pill pill--alert', '¿Vino?'));
    const creada = r.creada_en ? Date.now() - new Date(r.creada_en).getTime() : Infinity;
    if (r.estado === 'pendiente' && creada < 24 * 3600 * 1000) tags.append(el('span', 'pill pill--new', 'Nueva'));
    if (r.sin_preferencia) {
      const p = el('span', 'pill pill--soft', 'Asignado');
      p.title = 'El cliente eligió "Sin preferencia" y el sistema le asignó este barbero';
      tags.append(p);
    }
    top.append(tags);
    card.append(top);

    if (r.notas) card.append(el('p', 'turno__notas', r.notas));

    const foot = el('div', 'turno__foot');
    const contact = el('div', 'turno__contact');
    const wa = el('a', 'link-btn link-btn--wa');
    wa.href = waLink(r);
    wa.target = '_blank';
    wa.rel = 'noopener noreferrer';
    wa.append(icon('wa'), el('span', null, 'WhatsApp'));
    wa.setAttribute('aria-label', 'Escribir por WhatsApp a ' + r.nombre);
    const tel = el('a', 'link-btn');
    tel.href = 'tel:+' + telDigits(r.telefono);
    tel.append(icon('tel'), el('span', 'mono', telBonito(r.telefono)));
    tel.setAttribute('aria-label', 'Llamar a ' + r.nombre + ', ' + telBonito(r.telefono));
    contact.append(wa, tel);
    foot.append(contact);

    const acciones = el('div', 'turno__acciones');
    (ACCIONES[r.estado] || []).forEach(([estado, label, tone]) => {
      // Antes de la hora, "Atendido" no es lo principal
      const t = tone === 'primary' && estado === 'completada' && !pasado && !card.classList.contains('is-now') ? 'ghost' : tone;
      const b = el('button', 'btn btn--sm btn--' + t, label);
      b.type = 'button';
      b.setAttribute('aria-label', label + ': ' + r.nombre + ', ' + r.hora.slice(0, 5));
      b.addEventListener('click', () => setEstado(r, estado));
      acciones.append(b);
    });
    if (r.estado === 'cancelada') acciones.append(el('span', 'turno__freed', 'Hora liberada'));
    foot.append(acciones);
    card.append(foot);
    return card;
  };

  /* ---------- Render: todo ---------- */
  let nuevos = new Set(); // turnos que llegaron en la última actualización

  const render = () => {
    const f = state.fecha;
    const hoy = todayISO();
    const esHoy = f === hoy;
    const b = barberoActual();

    $('app-eyebrow').textContent = b ? 'Agenda de ' + b.nombre : 'Agenda de todo el equipo';
    $('app-title').textContent = (esHoy ? 'Hoy, ' : f === shiftDay(hoy, 1) ? 'Mañana, ' : '') + fechaLarga(f);
    document.title = (b ? primerNombre(b.nombre) + ' · ' : '') + 'Panel de reservas · Barbudo\'s';

    renderWeek();
    if (!state.loaded) return;

    const dia = delDia(f);
    renderStats(dia);

    // Subtítulo: horario del día y estimado
    const h = state.horario.get(isoDow(f));
    const sub = [];
    if (state.horario.size) {
      sub.push(h ? 'Abierto ' + h.abre.slice(0, 5) + ' a ' + h.cierra.slice(0, 5) + (h.anticipacion_horas ? ' · solo con reserva' : '') : 'Cerrado: no se ofrecen turnos en línea');
    }
    const cobrables = dia.filter((r) => r.estado !== 'cancelada' && r.estado !== 'no_asistio');
    const total = cobrables.reduce((s, r) => s + (PRECIOS[servicioNombre(r)] || 0), 0);
    if (total) sub.push('Estimado $' + total);
    $('app-sub').textContent = sub.join(' · ');

    // Lista filtrada
    const q = sinTildes(state.q.trim());
    const qTel = q.replace(/[^0-9]/g, '');
    const orden = new Map(state.barberos.map((x, i) => [x.id, i]));
    const visibles = dia
      .filter(filtroDe(state.filtro))
      .filter((r) => !q || sinTildes(r.nombre).includes(q) || (qTel.length >= 3 && r.telefono.replace(/[^0-9]/g, '').includes(qTel)))
      .sort((x, y) => x.hora.localeCompare(y.hora) || (orden.get(x.barbero_id) ?? 99) - (orden.get(y.barbero_id) ?? 99));

    // Mensaje cuando no hay nada que mostrar
    if (!visibles.length) {
      const quien = b ? primerNombre(b.nombre) + ' no tiene' : 'No hay';
      const estado = state.filtro !== 'todos' ? ' con el estado "' + FILTROS.find((x) => x[0] === state.filtro)[1].toLowerCase() + '"' : '';
      listStatus.textContent = q
        ? 'Ningún turno coincide con "' + state.q.trim() + '".'
        : quien + ' turnos' + estado + ' para este día.';
      // Atajo al próximo día de la semana con turnos
      const prox = !q && state.filtro === 'todos' &&
        state.rows.find((r) => r.fecha > f && r.estado !== 'cancelada' && delBarbero(r));
      if (prox) {
        const n = delDia(prox.fecha).filter((r) => r.estado !== 'cancelada').length;
        const go = el('button', 'btn btn--ghost btn--sm agenda__next',
          'Ver el ' + fechaLarga(prox.fecha) + ' (' + n + (n === 1 ? ' turno' : ' turnos') + ')');
        go.type = 'button';
        go.addEventListener('click', () => goTo(prox.fecha));
        listStatus.append(el('br'), go);
      }
    } else {
      listStatus.textContent = '';
    }

    // Agrupados por hora; la línea "Ahora" separa lo que ya pasó
    const ctx = { fecha: f, hoy, esHoy, ahora: nowMin(), nuevos };
    const grupos = new Map();
    visibles.forEach((r) => {
      const k = r.hora.slice(0, 5);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(r);
    });
    const items = [];
    let ahoraPuesta = !esHoy || state.filtro === 'cancelada';
    grupos.forEach((rows, hora) => {
      const ini = toMin(hora);
      if (!ahoraPuesta && ini > ctx.ahora) {
        items.push(nowLine(ctx.ahora));
        ahoraPuesta = true;
      }
      const li = el('li', 'slot');
      const time = el('div', 'slot__time');
      time.append(el('span', 'slot__start mono', hora), el('span', 'slot__end mono', fromMin(ini + state.duracion)));
      if (rows.length > 1) time.append(el('span', 'slot__n', rows.length + ' turnos'));
      const cards = el('div', 'slot__cards');
      rows.forEach((r) => cards.append(renderTurno(r, ctx)));
      li.append(time, cards);
      items.push(li);
    });
    if (!ahoraPuesta && grupos.size) items.push(nowLine(ctx.ahora));
    list.replaceChildren(...items);
  };

  const nowLine = (min) => {
    const li = el('li', 'now');
    li.setAttribute('aria-label', 'Ahora, ' + fromMin(min));
    li.append(el('span', 'now__label mono', 'Ahora · ' + fromMin(min)));
    return li;
  };

  /* ---------- Carga ---------- */
  let loadReq = 0;
  let prevIds = null; // para detectar reservas nuevas al actualizar
  let prevWeek = '';

  const load = async () => {
    const start = weekStart(state.fecha);
    const req = ++loadReq;
    if (!state.loaded || state.rowsWeek !== start) list.setAttribute('aria-busy', 'true');
    syncText.textContent = 'Actualizando…';
    const { data, error } = await sb
      .from('reservas')
      .select('id, nombre, telefono, fecha, hora, notas, estado, sin_preferencia, creada_en, barbero_id, barberos(nombre), servicios(nombre)')
      .gte('fecha', start)
      .lte('fecha', shiftDay(start, 6))
      .order('fecha')
      .order('hora');
    if (req !== loadReq) return;
    list.removeAttribute('aria-busy');
    if (error) {
      syncText.textContent = 'Sin conexión';
      listStatus.textContent = 'No se pudieron cargar los turnos: ' + error.message;
      return;
    }

    // Reservas que no estaban en la carga anterior (misma semana)
    nuevos = new Set();
    if (prevIds && prevWeek === start) {
      data.forEach((r) => { if (!prevIds.has(r.id)) nuevos.add(r.id); });
      const mias = data.filter((r) => nuevos.has(r.id) && delBarbero(r));
      if (mias.length) toast(mias.length === 1 ? 'Llegó una reserva nueva: ' + mias[0].nombre + ', ' + fechaLarga(mias[0].fecha) + ' a las ' + mias[0].hora.slice(0, 5) : 'Llegaron ' + mias.length + ' reservas nuevas');
    }
    prevIds = new Set(data.map((r) => r.id));
    prevWeek = start;

    state.rows = data;
    state.rowsWeek = start;
    state.loaded = true;
    state.syncedAt = new Date();
    syncText.textContent = 'Actualizado ' + horaCorta(state.syncedAt);
    render();
  };

  const goTo = (fecha) => {
    if (!fecha) return;
    state.fecha = fecha;
    dayInput.value = fecha;
    // Misma semana: se ve al instante con lo que ya está cargado
    if (state.loaded && weekStart(fecha) === state.rowsWeek) render();
    else {
      state.loaded = false;
      list.replaceChildren();
      statsEl.replaceChildren();
      listStatus.textContent = 'Cargando turnos…';
      render();
    }
    load();
  };

  /* ---------- Cambiar estado (con Deshacer) ---------- */
  const dialog = $('confirm');
  const confirmar = (r) => new Promise((resolve) => {
    const texto = r.nombre + ', ' + fechaLarga(r.fecha) + ' a las ' + r.hora.slice(0, 5) + ' con ' + barberoNombre(r) +
      '. La hora queda libre para que otra persona la reserve.';
    if (!dialog.showModal) {
      resolve(window.confirm('¿Cancelar el turno de ' + texto));
      return;
    }
    $('confirm-text').textContent = texto;
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'si'), { once: true });
    dialog.showModal();
  });

  const setEstado = async (r, estado, { undo = false } = {}) => {
    if (estado === 'cancelada' && !undo && !(await confirmar(r))) return;
    const antes = r.estado;
    // Se ve al instante; si la base de datos lo rechaza, vuelve atrás
    r.estado = estado;
    render();
    const { error } = await sb.from('reservas').update({ estado }).eq('id', r.id);
    if (error) {
      r.estado = antes;
      render();
      const ocupado = /reservas_sin_choques|duplicate/i.test(error.message);
      toast(ocupado
        ? 'No se pudo: esa hora ya la reservó otra persona.'
        : 'No se pudo actualizar: ' + error.message);
      return;
    }
    showNotice('');
    toast('Turno de ' + primerNombre(r.nombre) + ' ' + (HECHO[estado] || 'actualizado') + '.', undo ? null : () => setEstado(r, antes, { undo: true }));
  };

  /* ---------- Aviso breve ---------- */
  const toastEl = $('toast');
  const toastUndo = $('toast-undo');
  let toastTimer = null;
  let toastAction = null;
  const toast = (msg, action) => {
    clearTimeout(toastTimer);
    $('toast-text').textContent = msg;
    toastAction = action || null;
    toastUndo.hidden = !action;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('is-in'));
    toastTimer = setTimeout(hideToast, action ? 7000 : 5000);
  };
  const hideToast = () => {
    toastEl.classList.remove('is-in');
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 250);
  };
  toastUndo.addEventListener('click', () => {
    const fn = toastAction;
    toastAction = null;
    hideToast();
    if (fn) fn();
  });

  /* ---------- Controles ---------- */
  dayInput.addEventListener('change', () => goTo(dayInput.value));
  $('day-prev').addEventListener('click', () => goTo(shiftDay(state.fecha, -1)));
  $('day-next').addEventListener('click', () => goTo(shiftDay(state.fecha, 1)));
  $('day-today').addEventListener('click', () => goTo(todayISO()));
  $('refresh').addEventListener('click', load);
  searchEl.addEventListener('input', () => { state.q = searchEl.value; render(); });

  // Teclado (computadora): ← → cambian de día, T vuelve a hoy
  document.addEventListener('keydown', (ev) => {
    if (views.app.hidden || ev.altKey || ev.ctrlKey || ev.metaKey || dialog.open) return;
    if (ev.target.closest('input, textarea, select, [contenteditable]')) return;
    if (ev.key === 'ArrowLeft') goTo(shiftDay(state.fecha, -1));
    else if (ev.key === 'ArrowRight') goTo(shiftDay(state.fecha, 1));
    else if (ev.key === 't' || ev.key === 'T') goTo(todayISO());
    else return;
    ev.preventDefault();
  });

  // Las reservas nuevas aparecen solas: se recarga cada minuto con la
  // pestaña visible (y la línea "Ahora" avanza)
  let timer = null;
  const startPolling = () => {
    stopPolling();
    timer = setInterval(() => { if (!document.hidden && !views.app.hidden) load(); }, 60000);
  };
  const stopPolling = () => clearInterval(timer);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !views.app.hidden) load(); });
})();
