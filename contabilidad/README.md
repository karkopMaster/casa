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

**Plataforma multi-empresa:** cada negocio tiene su propia base de datos (un archivo por empresa en `data/tenants/`), sin ver los datos de los demás. La primera vez, abra `/#plataforma`, escriba el código de instalación (se imprime en la consola o está en `SETUP_TOKEN`) y cree la cuenta del dueño de la plataforma. Desde ahí crea los negocios; cada uno entra con su **código de empresa**, usuario y contraseña (o con el enlace `/?e=codigo`). No hay usuarios ni claves por defecto.

## Qué incluye
- **Ventas, compras y gastos** con descuentos, IVA (19 %, 5 %, excluido), contado / crédito / abono, impresión y anulación.
- **Colombia listo para usar:** plan de cuentas PUC, pesos sin decimales, retenciones (retefuente, ReteIVA, ReteICA) en compras y ventas con sus cuentas, medios de pago Caja / Bancos / Nequi-Daviplata / Datáfono.
- **Productos para el cabello:** marca, código de barras (con lector: escanear agrega la línea y suma cantidad), notificación sanitaria INVIMA, **lotes y fechas de vencimiento con salida FEFO** (primero en vencer), alerta de vencidos y por vencer, **lista de precios detal y mayorista** por cliente (peluquerías), categorías típicas precargadas, informe por marca.
- **Inventario** con costo promedio, kardex, existencias valorizadas, stock mínimo, ajustes y mermas.
- **Contabilidad de partida doble automática**: libro diario, mayor, balance de prueba, estado de resultados, balance general; plan editable y asientos manuales.
- **Informes** de ventas/utilidad por producto, categoría, marca, cliente, día, mes o vendedor; cartera por edades; CSV.
- **Usuarios y roles** (administrador, contador, vendedor sin acceso a costos), cierre de período, copia de seguridad, importación CSV.

## Descuentos por vencimiento
Para los lotes próximos a vencer el sistema **sugiere el descuento y el precio** (Inicio y Inventario → Lotes y vencimientos) y, al vender, aplica solo el descuento al lote que saldrá primero. Escalones editables en Configuración → Empresa (por defecto ≤30 días 30 %, ≤60 días 20 %, ≤90 días 10 %). Nunca sugiere un precio por debajo del costo, y avisa si el lote ya está vencido.

## Pasarelas de pago (Configuración → Pasarelas de pago)
- **Wompi**: genera un enlace de pago por el saldo de una factura (botón *Enlace de pago* en la factura, con envío por WhatsApp) y, cuando el cliente paga, un evento firmado marca la factura como cobrada.
- **Otra pasarela (webhook genérico)**: plantilla de enlace con `{reference}` y `{amount}`, y confirmación por POST JSON `{reference, status, amount, transaction_id}` firmado con HMAC-SHA256 del cuerpo en la cabecera `X-Signature`.
- Los cobros entran a la cuenta "Datáfono / pasarela por liquidar"; **Registrar liquidación** cuando el banco recibe el depósito (descuenta la comisión a gastos).
- Llaves cifradas en reposo (AES-256-GCM). Defina `SECRET_KEY` en el entorno para que la llave de cifrado no viva en la misma base de datos.
- Eventos duplicados se ignoran, la firma inválida se rechaza y los pagos sin factura quedan registrados para revisión manual.
- Requiere que el sistema esté publicado con **https público** para recibir los eventos. PayU, ePayco, Mercado Pago y Bold se pueden conectar con el webhook genérico si permiten firmar eventos, o añadiendo su adaptador.

## Facturación electrónica DIAN (Configuración → Facturación electrónica)
- La DIAN exige emitir a través de un **proveedor tecnológico autorizado**. El sistema arma el documento normalizado con lo que se exige (NIT + DV, tipo de documento del cliente, IVA por línea, unidad de medida, forma y medio de pago, consumidor final 222222222222), lo valida antes de enviar y guarda estado, número, **CUFE** y enlace de verificación en cada venta.
- **Nota crédito automática:** al anular una venta con factura aceptada se emite primero la nota crédito; si no se acepta, la venta no se anula. Una factura "enviada" sin confirmar bloquea la anulación.
- Reintentos tras rechazo o error de conexión, aviso en Inicio de facturas por revisar, envío automático opcional y confirmación asíncrona por webhook firmado (HMAC-SHA256, cabecera `X-Signature`).
- Modos: **Simulador** (pruebas sin validez fiscal) y **API REST/JSON** configurable (URL, autenticación, rutas JSON de la respuesta). El adaptador nativo de un proveedor concreto (Factus, Alegra, Siigo, Facturatech…) se agrega en `src/einvoice.js` → `ADAPTERS` cuando se cuente con su documentación y credenciales de habilitación: no se incluyen porque no se pudo verificar su formato.
- Antes de producción: el contador debe habilitar al emisor ante la DIAN con el proveedor, obtener la resolución de numeración y completar datos de la empresa (NIT con DV, dirección, municipio DANE, correo).

## Lo que NO hace (importante en Colombia)
- **No hay aún adaptador nativo de un proveedor DIAN concreto** (ver sección anterior); sin proveedor configurado el documento impreso dice "control interno".
- **Las tarifas de retención y el plan de cuentas son de ejemplo**: confírmelas con su contador (dependen del régimen: ordinario, simple, no responsable de IVA, y del municipio para ICA).
- No liquida nómina, ni declaraciones, ni cierre contable anual.

## Importar su Excel de inventario
Exporte las hojas *Productos* y *Clientes/Proveedores* a CSV y use el botón **Importar CSV**:
- Productos: `code;name;brand;category;unit;price;price2;iva;barcode;nso;min_stock;stock;cost;lot;expiry` (si trae `stock` y `cost` se carga el inventario inicial, con su lote y vencimiento AAAA-MM-DD; `iva` 19, 5 o 0, por defecto 19).
- Terceros: `name;company;doc_id;email;phone;address;kind`.

## Estructura
`src/core.js` (asientos, inventario, configuración) · `src/docs.js` (ventas/compras/pagos/anulaciones) · `src/reports.js` · `src/api.js` (REST) · `public/` (interfaz).
Todas las operaciones se ejecutan en transacciones: si algo falla, no queda nada a medias.

## Instalar en un VPS que ya tiene otras apps (Ubuntu + pm2 + Caddy)
```bash
DOMINIO=contabilidad.midominio.co bash contabilidad/deploy/instalar-contabilidad.sh            # SIMULACIÓN: no cambia nada
DOMINIO=contabilidad.midominio.co bash contabilidad/deploy/instalar-contabilidad.sh --aplicar  # instala
```
Antes revise el servidor con `deploy/auditar-vps.sh` (solo lectura). El instalador comprueba Node ≥ 22.13, puerto libre, nombre de pm2, DNS del dominio y que el Caddyfile valide; respalda el Caddyfile, instala en `~/contabilidad` con datos en `~/contabilidad-data`, lanza **solo** el proceso `contabilidad` en 127.0.0.1, agrega un bloque al Caddyfile (validado antes, `reload`, nunca `restart`) y deja `volver-atras.sh`. No abre puertos ni toca otras apps.
Copia diaria opcional: `node src/backup.js ~/backups-contabilidad 30` (copia consistente con la app en marcha).

## Control de acceso
- **No hay registro público.** Solo el administrador crea usuarios (Configuración → Usuarios), les asigna rol (administrador, contador, vendedor) y puede desactivarlos o cambiarles la clave. Las sesiones duran 12 h y hay bloqueo tras intentos fallidos.
- **Código de instalación (`SETUP_TOKEN`).** El primer administrador solo se puede crear con un código secreto que genera el instalador y que solo ve quien lo ejecuta. Sin ese código, aunque alguien conozca la dirección, no puede apropiarse del sistema.
- Actualizar un VPS ya instalado: `bash contabilidad/deploy/actualizar-contabilidad.sh` (comprueba) y luego con `--aplicar`; verifica que la versión nueva realmente corre y si no, revierte.

## Multi-empresa: cómo funciona el aislamiento
- Una base SQLite por negocio + `platform.db` con el dueño y la lista de negocios. El token de sesión de un negocio solo existe en su base: no sirve en otro.
- El código de empresa se valida estrictamente (`a-z`, `0-9`, `-`) antes de formar cualquier ruta de archivo.
- El dueño de la plataforma **administra** (crear, suspender, restablecer la clave del admin del negocio, descargar copia, archivar) pero el panel no muestra datos contables.
- Un negocio suspendido no puede entrar; "archivar" mueve su base a `data/archivo/` (no se borra).
- `node src/backup.js <carpeta> 30` respalda la plataforma y cada negocio por separado.
- Los avisos de pasarelas y facturación electrónica usan la URL con el código: `/api/e/<codigo>/gateways/<id>/webhook` y `/api/e/<codigo>/einvoice/webhook`.

## Demos con datos de ejemplo
- En el panel de la plataforma, **🧪 Crear demo** genera en menos de un segundo un negocio ficticio de productos para el cabello: ~30 productos con marca, código de barras y lotes (algunos por vencer y uno vencido), 8 clientes (detal y mayoristas), 3 proveedores, ~200 ventas de 45 días con cobros por caja, bancos, Nequi y datáfono, cartera vencida, cuentas por pagar, gastos, una venta anulada y facturas electrónicas de prueba (simulador). Usuarios `demo` (administrador), `vendedor` y `contador`, con la misma contraseña generada.
- Cada demo tiene vigencia (1 a 60 días) y **se elimina sola** al vencer. Muestra un aviso permanente de "demostración".
- **Demo pública** (opcional, apagada por defecto): al activarla aparece en el ingreso el botón "Probar una demo con datos de ejemplo". Dura 24 h, máximo 25 simultáneas y 3 por hora por visitante.
- Las demos no permiten guardar llaves de pasarelas, conectar un proveedor real de facturación electrónica, cambiar la contraseña ni descargar copias.
- Seguridad: la facturación electrónica por API solo acepta URLs https públicas (puerto 443, sin IPs internas ni redirecciones), para que ningún negocio pueda usarla contra servicios internos del servidor.

## Modo fácil (para personas mayores y uso diario en computador)
La plataforma abre por defecto en **modo fácil**: pantalla de botones grandes y de colores, una acción por pantalla, letra ajustable (A− / A+) y confirmación grande antes de guardar cualquier dinero.
- **Inicio:** 9 botones, cada acción con su color: 🛒 Vender (verde), 💵 Cobrar (azul), 📦 Comprar (naranja), 🧾 Pagar a proveedor (morado), 💸 Registrar un gasto (rojo), 👥 Mis clientes (turquesa), 🏷️ Mis productos (ámbar), ⚠️ Avisos (rosa), 📊 ¿Cómo voy? (gris). Los medios de pago también tienen color: efectivo (verde), Nequi/Daviplata (fucsia), banco (azul), tarjeta (naranja), fiado (ámbar).
- **Vender:** ¿quién compra? → productos a la izquierda y lo que lleva el cliente a la derecha (con + / − grandes; admite lector de código de barras) → ¿cómo paga? → revisar → guardar. Aplica sola la lista mayorista y el descuento por vencimiento, y ofrece imprimir y enviar a la DIAN.
- **Cobrar / Pagar:** lista de lo pendiente (las vencidas primero) con un botón grande: "Recibí todo" u otro valor → cómo → confirmar.
- **Gasto:** categorías con botón (arriendo, luz y agua, internet, nómina, transporte, publicidad, otro) → valor → cómo pagó → confirmar.
- El **vendedor** solo ve Vender, Cobrar, Mis clientes y Mis productos.
- "Ver todas las opciones" abre el modo completo (contabilidad, informes, configuración); en el modo completo, "🔠 Modo fácil" vuelve. La pantalla por defecto de cada negocio se cambia en Configuración → Empresa.

## Panel de la plataforma: editar, eliminar y reenviar accesos
- **✏️ Editar:** nombre, NIT, dirección, teléfono y nota interna del negocio (el nombre se actualiza también dentro del negocio); en una demo, ampliar la vigencia. El código de empresa no cambia, porque es con lo que el negocio entra.
- **📋 Accesos:** las contraseñas se guardan cifradas de una vía y no pueden "verse" de nuevo, así que este botón genera una **contraseña nueva** (en una demo, para los tres usuarios) y deja los datos listos para copiar: **Copiar datos** o **Copiar mensaje listo para WhatsApp**. Cierra las sesiones abiertas de ese usuario.
- **🗑 Eliminar:** exige escribir el código del negocio. Los datos pasan a la **papelera durante 30 días** (se puede restaurar con todo, incluido el nombre editado); el código queda libre. Desde la papelera también se puede **borrar para siempre** (con confirmación) y se vacía sola a los 30 días.
