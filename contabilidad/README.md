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
- **Ventas, compras y gastos** con descuentos, IVA (19 %, 5 %, excluido), contado / crédito / abono, impresión y anulación.
- **Colombia listo para usar:** plan de cuentas PUC, pesos sin decimales, retenciones (retefuente, ReteIVA, ReteICA) en compras y ventas con sus cuentas, medios de pago Caja / Bancos / Nequi-Daviplata / Datáfono.
- **Productos para el cabello:** marca, código de barras (con lector: escanear agrega la línea y suma cantidad), notificación sanitaria INVIMA, **lotes y fechas de vencimiento con salida FEFO** (primero en vencer), alerta de vencidos y por vencer, **lista de precios detal y mayorista** por cliente (peluquerías), categorías típicas precargadas, informe por marca.
- **Inventario** con costo promedio, kardex, existencias valorizadas, stock mínimo, ajustes y mermas.
- **Contabilidad de partida doble automática**: libro diario, mayor, balance de prueba, estado de resultados, balance general; plan editable y asientos manuales.
- **Informes** de ventas/utilidad por producto, categoría, marca, cliente, día, mes o vendedor; cartera por edades; CSV.
- **Usuarios y roles** (administrador, contador, vendedor sin acceso a costos), cierre de período, copia de seguridad, importación CSV.

## Lo que NO hace (importante en Colombia)
- **No emite factura electrónica ante la DIAN.** Para eso hace falta un proveedor tecnológico autorizado (Siigo, Alegra, Factus, etc.) con credenciales propias. Hoy puede guardar el número de la factura electrónica en el campo de referencia y el documento impreso dice "control interno". Integrarlo con un proveedor es el siguiente paso natural.
- **Las tarifas de retención y el plan de cuentas son de ejemplo**: confírmelas con su contador (dependen del régimen: ordinario, simple, no responsable de IVA, y del municipio para ICA).
- No liquida nómina, ni declaraciones, ni cierre contable anual.

## Importar su Excel de inventario
Exporte las hojas *Productos* y *Clientes/Proveedores* a CSV y use el botón **Importar CSV**:
- Productos: `code;name;brand;category;unit;price;price2;iva;barcode;nso;min_stock;stock;cost;lot;expiry` (si trae `stock` y `cost` se carga el inventario inicial, con su lote y vencimiento AAAA-MM-DD; `iva` 19, 5 o 0, por defecto 19).
- Terceros: `name;company;doc_id;email;phone;address;kind`.

## Estructura
`src/core.js` (asientos, inventario, configuración) · `src/docs.js` (ventas/compras/pagos/anulaciones) · `src/reports.js` · `src/api.js` (REST) · `public/` (interfaz).
Todas las operaciones se ejecutan en transacciones: si algo falla, no queda nada a medias.
