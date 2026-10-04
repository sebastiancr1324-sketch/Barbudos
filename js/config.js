/* ============================================================
   Conexión con Supabase
   Copia estos dos valores desde Supabase → Project Settings → API:
   · Project URL
   · anon / publishable key (es pública: va en el navegador; los datos
     los protegen las reglas de supabase/schema.sql)
   Nunca pongas aquí la service_role / secret key.
   ============================================================ */
window.BARBUDOS_CONFIG = {
  supabaseUrl: 'https://zmxarsxyrczdnkvmjpny.supabase.co',
  supabaseAnonKey: 'sb_publishable_INh5152-narJrdeUJKyxkw_Nz3q0WT_'
};
