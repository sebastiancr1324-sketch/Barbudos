# Reservas con Supabase

El formulario de la web guarda los turnos en Supabase y el personal los
gestiona en `admin.html`. La base de datos impide que dos personas reserven
al mismo barbero a la misma hora.

## 1. Crear el proyecto

1. Entra a <https://supabase.com>, crea una cuenta y un **New project**.
   - Región: la más cercana (por ejemplo *East US*).
   - Guarda la contraseña de la base de datos en un lugar seguro.
2. Cuando termine de crearse, ve a **SQL Editor → New query**, pega todo el
   contenido de [`schema.sql`](schema.sql) y pulsa **Run**.
   Debe terminar en *Success. No rows returned*.

## 2. Conectar la web

1. En **Project Settings → API** (o **API Keys**) copia:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon / publishable key**
2. Pégalas en [`js/config.js`](../js/config.js).

La clave *anon/publishable* es pública a propósito: solo permite consultar
turnos libres y crear reservas. **Nunca** pongas la *service_role / secret key*
en el sitio.

## 3. Crear usuarios del panel

1. **Authentication → Sign In / Providers**: desactiva **Allow new users to
   sign up** (los usuarios los creas tú).
2. **Authentication → Users → Add user → Create new user**: correo y
   contraseña de cada persona del personal (marca *Auto Confirm User*).
3. Dale acceso al panel en **SQL Editor**:

   ```sql
   insert into public.admins (user_id, nombre)
   select id, 'Oswaldo' from auth.users where email = 'correo@ejemplo.com';
   ```

4. Entra a `https://<tu-sitio>/admin.html` con ese correo y contraseña.

## Ajustes frecuentes (Table Editor)

| Qué | Dónde |
| --- | --- |
| Duración de cada turno (45 min), días de anticipación (30), turnos activos por teléfono (3) | tabla `ajustes` |
| Horario por día (1 = lunes … 7 = domingo; sin fila = cerrado) | tabla `horario` |
| Dar de baja a un barbero o cambiar sus sedes | tabla `barberos` (`activo`, `sedes`) |
| Servicios | tabla `servicios` |

Si agregas un barbero o servicio nuevo, agrégalo también como opción en el
formulario de `index.html` con **el mismo nombre exacto**.
