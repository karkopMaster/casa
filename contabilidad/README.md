# Contabilidad

Software contable web para **cualquier empresa que venda** (tienda, distribuidora, ferretería, taller, restaurante, servicios…).
Sin dependencias externas: solo Node.js ≥ 22.13 (SQLite incluido).

## Iniciar
```bash
cd contabilidad
npm start            # http://127.0.0.1:3000
npm test             # pruebas del motor contable
```
Variables: `PORT`, `HOST` (por defecto 127.0.0.1; use `0.0.0.0` y un proxy HTTPS para acceso remoto), `DB_FILE` (por defecto `data/contabilidad.db`).

La primera vez se abre un asistente: nombre de empresa, tipo de negocio (con inventario / mixto / solo servicios), moneda, impuesto y usuario administrador. No hay usuarios ni claves por defecto.

## Qué incluye
- **Ventas, compras y gastos** con descuentos por línea, impuestos configurables, contado / crédito / abono, impresión de factura y anulación.
- **Cobros y pagos** contra cada documento (caja o bancos), con anulación.
- **Inventario** con costo promedio ponderado, kardex, existencias valorizadas, alertas de stock mínimo, ajustes e inventario inicial. Productos y servicios (sin inventario).
- **Contabilidad de partida doble automática**: cada operación genera su asiento; libro diario, mayor, balance de prueba, estado de resultados y balance general. Plan de cuentas editable y asientos manuales.
- **Informes**: ventas/compras y utilidad por producto, categoría, cliente, día, mes o vendedor; cartera por edades (cuentas por cobrar y por pagar); exportación a CSV.
- **Clientes y proveedores**, importación masiva desde CSV/Excel (guardar como CSV) de productos y terceros.
- **Usuarios y roles**: administrador, contador, vendedor (el vendedor no ve costos ni contabilidad).
- **Cierre de período** (bloquea fechas anteriores) y **descarga de copia de seguridad**.

## Adaptarlo a su negocio
Configuración → *Cuentas por defecto* asigna qué cuenta de su plan usa cada operación (caja, bancos, clientes, proveedores, inventario, impuestos, ingresos, costo de ventas…), de modo que puede usar cualquier plan contable. Impuestos y categorías se editan libremente; si no maneja inventario, desactívelo en Configuración → Empresa.

## Importar su Excel de inventario
Exporte las hojas *Productos* y *Clientes/Proveedores* a CSV y use el botón **Importar CSV**:
- Productos: `code;name;category;unit;price;min_stock;stock;cost` (si trae `stock` y `cost` se carga el inventario inicial).
- Terceros: `name;company;doc_id;email;phone;address;kind`.

## Estructura
`src/core.js` (asientos, inventario, configuración) · `src/docs.js` (ventas/compras/pagos/anulaciones) · `src/reports.js` · `src/api.js` (REST) · `public/` (interfaz).
Todas las operaciones se ejecutan en transacciones: si algo falla, no queda nada a medias.
