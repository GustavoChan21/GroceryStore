# POSTROBBU · Hotel POS (demo estática)

Basado en la estrategia de **GroceryStore**: `index.html`, `style.css` y JavaScript plano desde la raíz, **sin Node, Vite, React, npm ni Supabase** para operar esta versión de demostración.

## GitHub Pages
1. Sube **el contenido** de esta carpeta directamente a la raíz de `GustavoChan21/POSTROBBU` (no subas la carpeta contenedora).
2. Conservar la única subcarpeta obligatoria: `.github/workflows/pages.yml`.
3. Configura `Settings > Pages > Build and deployment > GitHub Actions`.
4. El push a `main` publica automáticamente en `https://gustavochan21.github.io/POSTROBBU/`.
5. Comprueba en la pestaña Actions que la ejecución terminó correctamente. No se requiere `npm install`.

## Vista previa en local
Abre `index.html` directamente en tu navegador. También puedes usar `python3 -m http.server 8080` y abrir `http://localhost:8080`.

## Prueba guiada
- POS: selecciona Restaurante Arbequina, toca Chilaquiles, elige extras, agrega a comanda y envía.
- KDS: mueve Nueva > Preparando > Lista > Entregada.
- Mesas y cuentas: cobra el pedido con tarjeta o cargo a habitación (simulados).
- Inventario: comprueba el consumo de recetas y los movimientos de respaldo. Cambia a Pool Bar para transferir tequila desde Almacén general.
- Dashboard: revisa ventas por punto de venta.
- Configuración: crea 3 comandas de prueba, exporta respaldo o restablece la demo.

## Base demo
`seed.js` contiene el catálogo, puntos de venta, almacenes, insumos, recetas y modificadores. `app.js` guarda los movimientos en `localStorage` bajo `postrobbu-local-v3`. Los movimientos no se comparten entre dispositivos y no son contabilidad real.

## Importante
Las operaciones de caja, PMS y habitación son simulaciones; no existe conexión con terminal bancaria ni bases remotas. Las validaciones de inventario son demostrativas. Para producción hace falta backend transaccional, permisos, auditoría y sincronización multi-dispositivo.
