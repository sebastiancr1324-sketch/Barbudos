-- ============================================================
--  Barbudo's Barbershop — base de datos de reservas (Supabase)
--
--  Cómo usarlo: Supabase → SQL Editor → New query → pegar todo
--  este archivo → Run. Se puede volver a ejecutar sin romper nada.
--
--  Seguridad:
--   · El público (rol anon) NO puede leer ni escribir tablas. Solo
--     puede llamar a dos funciones: turnos_disponibles y crear_reserva.
--   · El personal entra a /admin.html con email y contraseña; solo los
--     usuarios que estén en la tabla admins ven y gestionan reservas.
--
--  Zona horaria del negocio: America/Caracas (UTC-4).
-- ============================================================

-- ---------- Tablas ----------

create table if not exists public.barberos (
  id      smallint generated always as identity primary key,
  nombre  text not null unique,
  -- Sedes donde atiende. Un barbero nunca tiene dos turnos a la misma
  -- hora, aunque sea en sedes distintas.
  sedes   text[] not null default array['Valera'],
  activo  boolean not null default true,
  orden   smallint not null default 0
);

create table if not exists public.servicios (
  id      smallint generated always as identity primary key,
  nombre  text not null unique,
  activo  boolean not null default true,
  orden   smallint not null default 0
);

-- Horario de atención por día (1 = lunes … 7 = domingo, ISO).
-- Un día sin fila = cerrado (no se ofrecen turnos en línea).
-- anticipacion_horas: con cuánta anticipación mínima hay que reservar
-- los turnos de ese día (0 = hasta el momento del turno).
create table if not exists public.horario (
  dia_semana         smallint primary key check (dia_semana between 1 and 7),
  abre               time not null,
  cierra             time not null check (cierra > abre),
  anticipacion_horas smallint not null default 0 check (anticipacion_horas between 0 and 168)
);

-- Octubre 2026: columna nueva en bases ya creadas
alter table public.horario
  add column if not exists anticipacion_horas smallint not null default 0
  check (anticipacion_horas between 0 and 168);

-- Una sola fila con los ajustes generales.
create table if not exists public.ajustes (
  id                    boolean primary key default true check (id),
  duracion_turno_min    smallint not null default 45 check (duracion_turno_min between 10 and 240),
  dias_anticipacion_max smallint not null default 30 check (dias_anticipacion_max between 1 and 365),
  -- Turnos activos (futuros, no cancelados) que puede tener un mismo teléfono
  max_turnos_por_tel    smallint not null default 3 check (max_turnos_por_tel >= 1)
);

create table if not exists public.reservas (
  id              uuid primary key default gen_random_uuid(),
  creada_en       timestamptz not null default now(),
  nombre          text not null check (char_length(nombre) between 2 and 80),
  telefono        text not null check (telefono ~ '^\+?[0-9]{7,15}$'),
  sede            text not null check (sede in ('Valera', 'Carvajal')),
  barbero_id      smallint not null references public.barberos (id),
  -- true si el cliente eligió "Sin preferencia" y el sistema asignó barbero
  sin_preferencia boolean not null default false,
  servicio_id     smallint not null references public.servicios (id),
  fecha           date not null,
  hora            time not null,
  notas           text check (char_length(notas) <= 500),
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'confirmada', 'completada', 'cancelada', 'no_asistio'))
);

-- El corazón del sistema: un barbero no puede tener dos turnos activos
-- en la misma fecha y hora. Si dos personas reservan a la vez, la
-- segunda recibe el error "turno_ocupado".
create unique index if not exists reservas_sin_choques
  on public.reservas (barbero_id, fecha, hora)
  where estado <> 'cancelada';

create index if not exists reservas_por_fecha on public.reservas (fecha, sede);
create index if not exists reservas_por_tel on public.reservas (telefono, fecha);

-- Usuarios del panel. Se agregan a mano (ver README de supabase).
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nombre  text
);

-- ---------- Datos iniciales ----------

-- El equipo, en el orden del sitio. Los nombres tienen que coincidir
-- exactamente con las opciones de #f-barbero en index.html. Al volver a
-- ejecutar este archivo, los de la lista quedan activos y con este orden.
insert into public.barberos (nombre, orden) values
  ('Oswaldo Valecillos', 1),
  ('Gabriel Hidalgo', 2),
  ('Esteban Mendoza', 3),
  ('José Gregorio', 4),
  ('Asdrúbal Añez', 5),
  ('Carlos Barrueta', 6),
  ('Frank Artigas', 7),
  ('Jordan Rodríguez', 8),
  ('Jorge Luis Carrero', 9)
on conflict (nombre) do update set orden = excluded.orden, activo = true;

-- Octubre 2026: se cerró la sede Carvajal y todos atienden solo en Valera.
-- José Ojeda ya no está en el equipo: se da de baja (no se borra: sus
-- turnos pasados quedan en el historial).
alter table public.barberos alter column sedes set default array['Valera'];
update public.barberos set activo = false where nombre = 'José Ojeda';
update public.barberos set sedes = array['Valera'] where sedes <> array['Valera'];

-- Los del cartel del local, en el orden del sitio. Los nombres tienen que
-- coincidir con las opciones de #f-servicio en index.html.
insert into public.servicios (nombre, orden) values
  ('Corte Standard', 1),
  ('Corte Full', 2),
  ('Corte Premium', 3),
  ('Otro (consultar)', 4)
on conflict (nombre) do update set orden = excluded.orden, activo = true;

-- Lunes a sábado, 8:00 a 21:00 (cartel del local).
-- Domingo, 10:00 a 17:00, solo con reserva y con 24 h de anticipación:
-- el local abre ese día únicamente si hay turnos reservados.
-- Al volver a ejecutar este archivo, el horario queda como está aquí.
insert into public.horario (dia_semana, abre, cierra, anticipacion_horas) values
  (1, '08:00', '21:00', 0),
  (2, '08:00', '21:00', 0),
  (3, '08:00', '21:00', 0),
  (4, '08:00', '21:00', 0),
  (5, '08:00', '21:00', 0),
  (6, '08:00', '21:00', 0),
  (7, '10:00', '17:00', 24)
on conflict (dia_semana) do update
  set abre = excluded.abre,
      cierra = excluded.cierra,
      anticipacion_horas = excluded.anticipacion_horas;

insert into public.ajustes (id) values (true) on conflict (id) do nothing;

-- ---------- Seguridad (RLS) ----------

alter table public.barberos  enable row level security;
alter table public.servicios enable row level security;
alter table public.horario   enable row level security;
alter table public.ajustes   enable row level security;
alter table public.reservas  enable row level security;
alter table public.admins    enable row level security;

-- Nadie del público toca las tablas directamente
revoke all on public.barberos, public.servicios, public.horario,
              public.ajustes, public.reservas, public.admins from anon;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

-- Panel: el personal lee todo y solo puede cambiar el estado del turno
revoke all on public.barberos, public.servicios, public.horario,
              public.ajustes, public.reservas, public.admins from authenticated;
grant select on public.barberos, public.servicios, public.horario,
                public.ajustes, public.reservas, public.admins to authenticated;
grant update (estado) on public.reservas to authenticated;

drop policy if exists "admin lee barberos" on public.barberos;
create policy "admin lee barberos" on public.barberos
  for select to authenticated using (public.es_admin());

drop policy if exists "admin lee servicios" on public.servicios;
create policy "admin lee servicios" on public.servicios
  for select to authenticated using (public.es_admin());

drop policy if exists "admin lee horario" on public.horario;
create policy "admin lee horario" on public.horario
  for select to authenticated using (public.es_admin());

drop policy if exists "admin lee ajustes" on public.ajustes;
create policy "admin lee ajustes" on public.ajustes
  for select to authenticated using (public.es_admin());

drop policy if exists "admin lee reservas" on public.reservas;
create policy "admin lee reservas" on public.reservas
  for select to authenticated using (public.es_admin());

drop policy if exists "admin cambia estado" on public.reservas;
create policy "admin cambia estado" on public.reservas
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- Cada usuario puede comprobar si él mismo es admin
drop policy if exists "admin se ve a sí mismo" on public.admins;
create policy "admin se ve a sí mismo" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- ---------- Funciones públicas (RPC) ----------

-- Hora local del negocio
create or replace function public.ahora_local()
returns timestamp
language sql
stable
as $$
  select (now() at time zone 'America/Caracas');
$$;

-- Turnos de una fecha según el horario, sin mirar ocupación.
create or replace function public.turnos_del_dia(p_fecha date)
returns setof time
language sql
stable
set search_path = public
as $$
  select t::time
  from public.horario h
  cross join public.ajustes a
  cross join lateral generate_series(
    p_fecha + h.abre,
    p_fecha + h.cierra - make_interval(mins => a.duracion_turno_min),
    make_interval(mins => a.duracion_turno_min)
  ) as t
  where h.dia_semana = extract(isodow from p_fecha);
$$;

-- Barberos activos de una sede (y opcionalmente uno en particular)
create or replace function public.barberos_de(p_sede text, p_barbero text)
returns setof public.barberos
language sql
stable
set search_path = public
as $$
  select b.*
  from public.barberos b
  where b.activo
    and p_sede = any (b.sedes)
    and (p_barbero is null or b.nombre = p_barbero);
$$;

-- Turnos libres para una fecha, sede y barbero (null = sin preferencia:
-- el turno está libre si al menos un barbero de la sede lo tiene libre).
create or replace function public.turnos_disponibles(
  p_fecha   date,
  p_sede    text,
  p_barbero text default null
)
returns table (hora time)
language sql
stable
security definer
set search_path = public
as $$
  select distinct t.turno
  from public.turnos_del_dia(p_fecha) as t(turno)
  join public.horario h on h.dia_semana = extract(isodow from p_fecha)
  cross join public.barberos_de(p_sede, nullif(p_barbero, '')) b
  cross join public.ajustes a
  -- Futuro y con la anticipación mínima del día (domingo: 24 h)
  where p_fecha + t.turno > public.ahora_local() + make_interval(hours => h.anticipacion_horas)
    and p_fecha <= public.ahora_local()::date + a.dias_anticipacion_max
    and not exists (
      select 1 from public.reservas r
      where r.barbero_id = b.id
        and r.fecha = p_fecha
        and r.hora = t.turno
        and r.estado <> 'cancelada'
    )
  order by t.turno;
$$;

-- Crea la reserva. Devuelve el barbero asignado, fecha y hora.
-- Errores (en el mensaje): datos_invalidos, fuera_de_horario,
-- falta_anticipacion, turno_ocupado, demasiados_turnos.
create or replace function public.crear_reserva(
  p_nombre   text,
  p_telefono text,
  p_sede     text,
  p_barbero  text,
  p_servicio text,
  p_fecha    date,
  p_hora     time,
  p_notas    text default null
)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_tel       text := regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g');
  v_nombre    text := btrim(coalesce(p_nombre, ''));
  v_notas     text := nullif(btrim(coalesce(p_notas, '')), '');
  v_barbero   text := nullif(btrim(coalesce(p_barbero, '')), '');
  v_servicio  smallint;
  v_ajustes   public.ajustes;
  v_activos   int;
  v_cand      record;
  v_id        uuid;
begin
  if v_barbero = 'Sin preferencia' then v_barbero := null; end if;

  select * into v_ajustes from public.ajustes;
  select id into v_servicio from public.servicios where nombre = p_servicio and activo;

  if char_length(v_nombre) < 2 or char_length(v_nombre) > 80
     or v_tel !~ '^\+?[0-9]{7,15}$'
     or p_sede is distinct from 'Valera'
     or v_servicio is null
     or p_fecha is null or p_hora is null
     or char_length(coalesce(v_notas, '')) > 500 then
    raise exception 'datos_invalidos';
  end if;

  if v_barbero is not null and not exists (select 1 from public.barberos_de(p_sede, v_barbero)) then
    raise exception 'datos_invalidos';
  end if;

  -- La hora debe ser un turno real del horario, futuro y dentro del límite
  if p_hora not in (select public.turnos_del_dia(p_fecha))
     or p_fecha + p_hora <= public.ahora_local()
     or p_fecha > public.ahora_local()::date + v_ajustes.dias_anticipacion_max then
    raise exception 'fuera_de_horario';
  end if;

  -- Anticipación mínima del día (domingo: 24 h)
  if p_fecha + p_hora <= public.ahora_local() + make_interval(hours => (
       select h.anticipacion_horas from public.horario h
       where h.dia_semana = extract(isodow from p_fecha))) then
    raise exception 'falta_anticipacion';
  end if;

  -- Freno simple contra abuso: máximo de turnos activos por teléfono
  select count(*) into v_activos
  from public.reservas
  where telefono = v_tel
    and estado in ('pendiente', 'confirmada')
    and fecha + hora > public.ahora_local();
  if v_activos >= v_ajustes.max_turnos_por_tel then
    raise exception 'demasiados_turnos';
  end if;

  -- Candidatos: el barbero elegido, o los de la sede libres a esa hora,
  -- empezando por el que tiene menos turnos ese día.
  for v_cand in
    select b.id, b.nombre
    from public.barberos_de(p_sede, v_barbero) b
    order by (
      select count(*) from public.reservas r
      where r.barbero_id = b.id and r.fecha = p_fecha and r.estado <> 'cancelada'
    ), random()
  loop
    begin
      insert into public.reservas
        (nombre, telefono, sede, barbero_id, sin_preferencia, servicio_id, fecha, hora, notas)
      values
        (v_nombre, v_tel, p_sede, v_cand.id, v_barbero is null, v_servicio, p_fecha, p_hora, v_notas)
      returning id into v_id;

      return json_build_object(
        'id', v_id,
        'barbero', v_cand.nombre,
        'sede', p_sede,
        'fecha', p_fecha,
        'hora', to_char(p_hora, 'HH24:MI')
      );
    exception when unique_violation then
      -- Ese barbero ya está ocupado a esa hora: probar el siguiente
      null;
    end;
  end loop;

  raise exception 'turno_ocupado';
end;
$$;

-- Las funciones internas no se exponen al público
revoke all on function public.ahora_local() from public, anon;
revoke all on function public.turnos_del_dia(date) from public, anon;
revoke all on function public.barberos_de(text, text) from public, anon;

grant execute on function public.turnos_disponibles(date, text, text) to anon, authenticated;
grant execute on function public.crear_reserva(text, text, text, text, text, date, time, text) to anon, authenticated;
