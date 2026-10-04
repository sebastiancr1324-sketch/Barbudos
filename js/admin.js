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

  /* ---------- Fechas (hora local del navegador) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayISO = () => iso(new Date());
  const shiftDay = (value, days) => {
    const d = new Date(value + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return iso(d);
  };
  const fechaLarga = (value) =>
    new Date(value + 'T00:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });

  /* ---------- Sesión ---------- */
  const loginForm = $('login-form');
  const loginError = $('login-error');
  const loginBtn = $('login-submit');

  loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('l-email').value.trim();
    const password = $('l-pass').value;
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
      $('l-pass').value = '';
      return;
    }
    $('admin-email').textContent = session.user.email;
    const { data: isAdmin, error } = await sb.rpc('es_admin');
    if (error || !isAdmin) {
      show(null);
      showNotice(error
        ? 'No se pudo comprobar tu acceso: ' + error.message
        : 'Tu usuario no tiene acceso al panel. Pide al administrador que te agregue.');
      return;
    }
    show('app');
    if (!dayInput.value) dayInput.value = todayISO();
    load();
    startPolling();
  };

  /* ---------- Turnos del día ---------- */
  const dayInput = $('day-input');
  const showCancelled = $('show-cancelled');
  const list = $('list');
  const listStatus = $('list-status');

  const ESTADOS = {
    pendiente: 'Pendiente',
    confirmada: 'Confirmada',
    completada: 'Completada',
    no_asistio: 'No asistió',
    cancelada: 'Cancelada'
  };

  // Qué botones ofrece cada estado
  const ACCIONES = {
    pendiente: [['confirmada', 'Confirmar'], ['cancelada', 'Cancelar']],
    confirmada: [['completada', 'Atendido'], ['no_asistio', 'No vino'], ['cancelada', 'Cancelar']],
    completada: [['confirmada', 'Deshacer']],
    no_asistio: [['confirmada', 'Deshacer']],
    cancelada: []
  };

  // WhatsApp del cliente: 0412… → 58412…
  const waLink = (tel) => {
    let n = tel.replace(/[^0-9]/g, '');
    if (n.startsWith('0')) n = '58' + n.slice(1);
    return 'https://wa.me/' + n;
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const render = (rows) => {
    const visibles = showCancelled.checked ? rows : rows.filter((r) => r.estado !== 'cancelada');
    const activas = rows.filter((r) => r.estado !== 'cancelada').length;
    $('app-count').textContent = activas === 1 ? '1 turno' : activas + ' turnos';
    listStatus.textContent = visibles.length ? '' : 'No hay turnos para este día.';

    list.replaceChildren(...visibles.map((r) => {
      const li = el('li', 'turno turno--' + r.estado);

      li.append(el('p', 'turno__hora mono', r.hora.slice(0, 5)));

      const info = el('div', 'turno__info');
      info.append(el('p', 'turno__nombre', r.nombre));
      const meta = el('p', 'turno__meta');
      meta.append(
        (r.servicios && r.servicios.nombre) || 'Servicio',
        ' · ',
        (r.barberos && r.barberos.nombre) || 'Barbero',
        r.sin_preferencia ? ' (asignado)' : ''
      );
      info.append(meta);
      const tel = el('a', 'turno__tel mono', r.telefono);
      tel.href = waLink(r.telefono);
      tel.target = '_blank';
      tel.rel = 'noopener noreferrer';
      tel.setAttribute('aria-label', 'Escribir por WhatsApp a ' + r.nombre + ', ' + r.telefono);
      info.append(tel);
      if (r.notas) info.append(el('p', 'turno__notas', r.notas));
      li.append(info);

      const side = el('div', 'turno__side');
      side.append(el('span', 'turno__estado', ESTADOS[r.estado] || r.estado));
      const acciones = el('div', 'turno__acciones');
      (ACCIONES[r.estado] || []).forEach(([estado, label]) => {
        const b = el('button', 'btn btn--sm ' + (estado === 'confirmada' && r.estado === 'pendiente' ? 'btn--primary' : 'btn--ghost'), label);
        b.type = 'button';
        b.addEventListener('click', () => setEstado(r, estado, b));
        acciones.append(b);
      });
      side.append(acciones);
      li.append(side);
      return li;
    }));
  };

  let loadReq = 0;
  const load = async () => {
    const fecha = dayInput.value;
    if (!fecha) return;
    $('app-title').textContent = fecha === todayISO() ? 'Hoy, ' + fechaLarga(fecha) : fechaLarga(fecha);
    const req = ++loadReq;
    // Una sola sede (Valera): no hace falta filtrar ni mostrar la sede
    const { data, error } = await sb
      .from('reservas')
      .select('id, nombre, telefono, fecha, hora, notas, estado, sin_preferencia, barberos(nombre), servicios(nombre)')
      .eq('fecha', fecha)
      .order('hora');
    if (req !== loadReq) return;
    if (error) {
      listStatus.textContent = 'No se pudieron cargar los turnos: ' + error.message;
      return;
    }
    render(data);
  };

  const setEstado = async (r, estado, btn) => {
    if (estado === 'cancelada' &&
        !window.confirm('¿Cancelar el turno de ' + r.nombre + ' a las ' + r.hora.slice(0, 5) + '? El horario queda libre para otra persona.')) {
      return;
    }
    btn.disabled = true;
    const { error } = await sb.from('reservas').update({ estado }).eq('id', r.id);
    if (error) {
      btn.disabled = false;
      showNotice('No se pudo actualizar: ' + error.message);
      return;
    }
    showNotice('');
    load();
  };

  dayInput.addEventListener('change', load);
  showCancelled.addEventListener('change', load);
  $('day-prev').addEventListener('click', () => { dayInput.value = shiftDay(dayInput.value || todayISO(), -1); load(); });
  $('day-next').addEventListener('click', () => { dayInput.value = shiftDay(dayInput.value || todayISO(), 1); load(); });
  $('day-today').addEventListener('click', () => { dayInput.value = todayISO(); load(); });

  // Las reservas nuevas aparecen solas: se recarga cada minuto con la pestaña visible
  let timer = null;
  const startPolling = () => {
    stopPolling();
    timer = setInterval(() => { if (!document.hidden && !views.app.hidden) load(); }, 60000);
  };
  const stopPolling = () => clearInterval(timer);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !views.app.hidden) load(); });
})();
