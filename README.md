# GroceryStore v2.0

Aplicación web responsive para tienda de abarrotes, preparada para **GitHub Pages** y sincronización opcional con **Supabase**.

## Funciones incluidas

- Catálogo CRUD de productos.
- Foto, categoría, unidad, precio, costo y código de barras opcional.
- **Stock opcional:** puedes crear y vender un producto sin capturar existencias.
- Al registrar después un stock base o una entrada, el sistema descuenta automáticamente **todas las ventas históricas acumuladas** del producto.
- Ventas oficiales/cobradas separadas de fiado.
- Caja física = fondo inicial + ventas en efectivo + abonos en efectivo.
- Clientes, fiado, abonos y cuentas por cobrar.
- **Badge permanente de FIADO en Resumen** mientras exista saldo pendiente, indicando cliente y saldo.
- Histórico de ventas por día o rango de fechas.
- Resumen diario de total, cobrado, fiado y tickets.
- Entradas de inventario y costo de compra.
- CRUD de productos, ventas, entradas, clientes y abonos.
- Respaldo JSON.
- Persistencia local (`localStorage`) y sincronización opcional con Supabase.

## Publicar en GitHub Pages

Sube **el contenido de esta carpeta directamente a la raíz** del repositorio:

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
└── supabase/
    └── schema.sql
```

En GitHub:

1. `Settings` → `Pages`.
2. `Source`: **Deploy from a branch**.
3. Branch: `main`.
4. Folder: `/ (root)`.
5. Guardar.

Los recursos usan rutas relativas (`./style.css`, `./app.js`, etc.), por lo que funcionan correctamente bajo `/GroceryStore/`.

## Conectar Supabase

La app funciona sin Supabase en **Modo local**. Para guardar el histórico en una base de datos y consultarlo desde distintos dispositivos:

### 1. Crear proyecto

Crea un proyecto de Supabase.

### 2. Crear tabla y políticas

En **SQL Editor**, ejecuta el archivo:

```text
supabase/schema.sql
```

Crea la tabla `store_state` y políticas RLS para que cada usuario solo pueda leer/escribir sus propios datos.

### 3. Configurar autenticación

En Supabase → Authentication → URL Configuration:

- **Site URL:** la URL de tu GitHub Pages, por ejemplo `https://gustavochan21.github.io/GroceryStore/`
- Agrega la misma URL a **Redirect URLs**.

Email/Password debe estar habilitado.

### 4. Completar `config.js`

En Supabase → Project Settings → API copia:

- Project URL
- anon/public key

Y colócalas en:

```js
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'TU_ANON_KEY';
```

> La anon key es pública por diseño. **Nunca** pongas la `service_role` key en GitHub o en este frontend. La seguridad se realiza con RLS + la sesión autenticada.

### 5. Iniciar sesión desde GroceryStore

En la barra superior pulsa **Base de datos** → crea/inicia sesión. La sesión queda persistida y los cambios se sincronizan automáticamente.

Si la cuenta todavía no tiene una fila en Supabase, la app sube el contenido local existente como estado inicial. Si ya existe información en la nube, se carga ese histórico.

## Comportamiento de stock diferido

Ejemplo:

1. Creas “Refresco” sin stock.
2. Registras 3 ventas durante el día.
3. Más tarde editas el producto y registras **Stock base = 10**.
4. La existencia calculada queda automáticamente en **7**.

También funciona mediante entradas: si registras una entrada de 10 unidades después de haber vendido 3, la existencia calculada será 7.

Si las ventas históricas superan el stock registrado, el sistema conserva la venta y mostrará stock negativo/faltante para que puedas corregir inventario posteriormente.


## Supabase ya conectado

- Proyecto: `GroceryStore`
- Región: `us-east-1`
- Project ref: `qydihqbqqimeqnosdglv`
- Tabla: `public.store_state`
- RLS: habilitado
- Credencial frontend: publishable key (`sb_publishable_...`)
- Security advisor: sin observaciones al momento de la configuración.

Para comenzar a sincronizar, abre la app, entra a **Base de datos / Nube**, crea una cuenta con correo y contraseña e inicia sesión. Los datos quedan aislados por usuario mediante RLS.

## Estado de conexión Supabase

Desde la versión 2.1.1 el indicador diferencia tres estados:

- **Supabase listo:** la instancia está configurada y responde, pero todavía no hay una sesión de usuario iniciada.
- **Nube activa:** el usuario inició sesión y los datos se sincronizan con `public.store_state`.
- **Modo local:** solo aparece si `config.js` no contiene una configuración válida de Supabase.

La versión 2.1.1 usa directamente las APIs HTTP de Supabase y ya no depende de `esm.sh`, lo cual mejora la compatibilidad con GitHub Pages y redes que bloquean CDNs de módulos.

En este proyecto Supabase actualmente no hay usuarios creados todavía. Desde la propia aplicación pulsa **Base de datos → Crear cuenta**, confirma el correo si Supabase lo solicita y después inicia sesión. Al quedar autenticado el estado cambiará a **Nube activa**.
