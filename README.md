# GroceryStore v2.2.0

Aplicación web responsive para tienda de abarrotes, preparada para **GitHub Pages** y conectada directamente a **Supabase sin inicio de sesión**.

## Funciones incluidas

- CRUD de productos, ventas, entradas, clientes y abonos.
- Código de barras opcional.
- Stock opcional y cálculo diferido contra ventas históricas.
- Ventas cobradas separadas de fiado.
- Caja física = fondo inicial + ventas en efectivo + abonos en efectivo.
- Badge permanente de FIADO pendiente por cliente.
- Histórico de ventas por día o rango de fechas.
- Entradas de inventario y costos.
- Respaldo JSON.
- Copia local en `localStorage` + sincronización automática con Supabase.

## Estructura para GitHub Pages

Sube todos estos archivos directamente a la raíz del repositorio:

```text
GroceryStore/
├── .nojekyll
├── index.html
├── style.css
├── app.js
├── database.js
├── config.js
├── package.json
├── vercel.json
├── README.md
└── schema.sql
```

En GitHub: `Settings` → `Pages` → `Deploy from a branch` → `main` → `/ (root)`.

Los recursos usan rutas relativas (`./style.css`, `./app.js`, etc.), por lo que funcionan bajo `/GroceryStore/`.

## Supabase

Proyecto conectado:

- Proyecto: `GroceryStore`
- Project ref: `qydihqbqqimeqnosdglv`
- Región: `us-east-1`
- Tabla usada por la app: `public.store_state_shared`
- Registro compartido: `main`
- RLS: habilitado
- Conexión: directa, sin registro ni inicio de sesión
- Credencial frontend: publishable key pública en `config.js`

`schema.sql` está en la raíz y contiene el esquema de referencia ya aplicado a Supabase.

### Funcionamiento

Al abrir la aplicación:

1. Se carga primero la copia local del navegador.
2. La app consulta `store_state_shared/main` en Supabase.
3. Si ya existe información en nube, se usa ese histórico.
4. Si la nube está vacía, se sube el estado local inicial.
5. A partir de ahí, cada cambio se guarda localmente y se sincroniza automáticamente con Supabase.

No hay flujo de correo, contraseña, confirmación ni redirect de autenticación.

## Seguridad de esta modalidad

La publishable key de Supabase es segura para incluirla en frontend, pero **no es una contraseña**. Como se solicitó operar sin inicio de sesión, el rol `anon` tiene permiso para leer y actualizar el único registro `main` de esta tienda. Cualquier persona que obtenga la URL del proyecto y la publishable key podría intentar acceder a ese registro.

Para una instalación pública con datos sensibles o múltiples empleados, la opción más segura es volver a usar autenticación o colocar un backend/Edge Function con autorización. **Nunca** publiques una `service_role` o `sb_secret_*` en GitHub Pages.

## Stock diferido

Ejemplo: creas un producto sin stock, vendes 3 unidades y después registras stock base 10. El stock calculado pasa a 7. Si las ventas superan el stock registrado, se conserva la venta y se muestra faltante/stock negativo.
