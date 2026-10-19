'use strict';
/* ---------- administración de la plataforma (solo el dueño) ---------- */
let PT = null;
try { PT = localStorage.getItem('ptoken'); } catch (_) {}
async function papi(method, path, body) {
  const r = await fetch('/api/plataforma/' + path, { method, headers: { 'Content-Type': 'application/json', ...(PT ? { Authorization: 'Bearer ' + PT } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch (_) {}
  if (!r.ok) { if (r.status === 401 && PT) { PT = null; try { localStorage.removeItem('ptoken'); } catch (_) {} renderPlatform($('#app')); } throw new Error((data && data.error) || 'Error ' + r.status); }
  return data;
}
const copyText = (t) => { try { navigator.clipboard.writeText(t); toast('Copiado'); } catch (_) { toast('Copie manualmente', true); } };

async function renderPlatform(app) {
  let st;
  try { st = await papi('GET', 'status'); } catch (e) { app.innerHTML = '<div class="center"><div class="card">No se pudo conectar con el servidor.</div></div>'; return; }
  if (!st.setup) {
    app.innerHTML = `<div class="center"><form class="card auth" id="f"><h1>Plataforma 👋</h1><p class="help">Cree la cuenta del dueño de la plataforma. Desde aquí creará los negocios; cada uno tendrá su propia base de datos aislada.</p>
      <p><label>Código de instalación</label><input name="setup_token" required autocomplete="off"></p><p><label>Su nombre</label><input name="name"></p>
      <p><label>Usuario</label><input name="username" required autocomplete="username"></p><p><label>Contraseña (10 o más caracteres)</label><input name="password" type="password" minlength="10" required autocomplete="new-password"></p>
      <button class="btn" style="width:100%">Crear cuenta del dueño</button></form></div>`;
    $('#f').onsubmit = async (e) => { e.preventDefault(); try { await papi('POST', 'setup', formData(e.target)); toast('Listo. Ahora ingrese.'); renderPlatform(app); } catch (er) { fail(er); } };
    return;
  }
  if (!PT) {
    app.innerHTML = `<div class="center"><form class="card auth" id="f"><h1>Administrador de la plataforma</h1><p><label>Usuario</label><input name="username" required autofocus autocomplete="username"></p>
      <p><label>Contraseña</label><input name="password" type="password" required autocomplete="current-password"></p><p><button class="btn" style="width:100%">Entrar</button></p>
      <p class="help" style="text-align:center"><a href="#" id="back">← Ingreso de empresas</a></p></form></div>`;
    $('#back').onclick = (e) => { e.preventDefault(); location.hash = ''; };
    $('#f').onsubmit = async (e) => { e.preventDefault(); try { const r = await papi('POST', 'login', formData(e.target)); PT = r.token; try { localStorage.setItem('ptoken', PT); } catch (_) {} renderPlatform(app); } catch (er) { fail(er); } };
    return;
  }
  let me; try { me = await papi('GET', 'me'); } catch (_) { return; }
  app.innerHTML = `<div class="shell"><main class="main" style="max-width:1100px;margin:0 auto"><div class="top"><div><h1>Plataforma · negocios</h1><div class="help">Cada negocio tiene su propia base de datos. Usted no ve sus datos contables: solo los administra.</div></div>
    <div class="actions"><button class="btn" id="new">Nuevo negocio</button><button class="btn sec" id="newdemo">🧪 Crear demo</button><button class="btn sec" id="pw">Mi contraseña</button><button class="btn sec" id="out">Salir</button><a class="btn sec" href="#" id="emp">Ingreso de empresas</a></div></div><div class="card" id="pubdemo" style="margin-bottom:12px"></div><div id="list">Cargando…</div><div id="trash" style="margin-top:16px"></div></main></div>`;
  papi('GET', 'settings').then((st) => {
    $('#pubdemo').innerHTML = `<label style="font-weight:600;color:var(--ink)"><input type="checkbox" id="pd" style="width:auto" ${st.public_demo ? 'checked' : ''}> Permitir que cualquier visitante abra una demo desde la pantalla de ingreso</label>
      <div class="help">Aparece el botón "Probar una demo". Cada demo dura 24 horas, tiene datos ficticios y se elimina sola; máximo ${st.public_demo_max} a la vez y 3 por hora por visitante. Las demos no permiten guardar llaves ni conectar servicios externos.</div>`;
    $('#pd').onchange = async (e) => { try { await papi('PUT', 'settings', { public_demo: e.target.checked }); toast(e.target.checked ? 'Demo pública activada' : 'Demo pública desactivada'); } catch (er) { fail(er); e.target.checked = !e.target.checked; } };
  }).catch(() => {});
  $('#emp').onclick = (e) => { e.preventDefault(); location.hash = ''; };
  $('#out').onclick = async () => { try { await papi('POST', 'logout'); } catch (_) {} PT = null; try { localStorage.removeItem('ptoken'); } catch (_) {} renderPlatform(app); };
  $('#pw').onclick = () => modal('Mi contraseña', `<form id="g"><p><label>Actual</label><input name="current" type="password" required></p><p><label>Nueva (10+)</label><input name="password" type="password" minlength="10" required></p><button class="btn">Guardar</button></form>`, { small: true, onMount: (m, close) => { $('#g', m).onsubmit = async (e) => { e.preventDefault(); try { await papi('POST', 'password', formData(e.target)); toast('Actualizada'); close(); } catch (er) { fail(er); } }; } });
  $('#new').onclick = () => newTenant(load);
  $('#newdemo').onclick = () => newDemo(load);
  async function load() {
    const rows = await papi('GET', 'tenants');
    $('#list').innerHTML = table([
      { h: 'Negocio', k: (t) => `<b>${esc(t.name)}</b> ${t.is_demo ? `<span class="tag warn">demo${t.note === 'publica' ? ' pública' : ''} · vence ${esc((t.expires_at || '').slice(0, 10))}</span>` : ''}<div class="help">código: ${esc(t.slug)} · admin: ${esc(t.admin_user || '')}</div>`, raw: 1 },
      { h: 'Estado', k: (t) => `<span class="tag ${t.status === 'activo' ? 'ok' : t.status === 'suspendido' ? 'warn' : 'err'}">${esc(t.status)}</span>`, raw: 1 },
      { h: 'Creado', k: (t) => (t.created_at || '').slice(0, 10) }, { h: 'Último ingreso', k: (t) => (t.last_login ? t.last_login.replace('T', ' ').slice(0, 16) : '—') }, { h: 'Datos', k: (t) => t.size_kb + ' KB', n: 1 },
      { h: '', raw: 1, k: (t) => (t.status === 'archivado' ? `<button class="btn sm danger" data-a="rm" data-s="${esc(t.slug)}">Quitar de la lista</button>` : `<div class="actions"><button class="btn sm" data-a="edit" data-s="${esc(t.slug)}">✏️ Editar</button><button class="btn sm sec" data-a="link" data-s="${esc(t.slug)}">Enlace</button><button class="btn sm sec" data-a="estado" data-s="${esc(t.slug)}" data-v="${t.status === 'activo' ? 'suspendido' : 'activo'}">${t.status === 'activo' ? 'Suspender' : 'Activar'}</button><button class="btn sm sec" data-a="reset" data-s="${esc(t.slug)}">📋 Accesos</button><button class="btn sm sec" data-a="bk" data-s="${esc(t.slug)}">Copia</button><button class="btn sm danger" data-a="del" data-s="${esc(t.slug)}">🗑 Eliminar</button></div>`) },
    ], rows, { empty: 'Aún no hay negocios. Cree el primero con "Nuevo negocio".' });
    loadTrash(load).catch(() => {});
    $$('#list [data-a]').forEach((b) => (b.onclick = async () => {
      const slug = b.dataset.s;
      try {
        if (b.dataset.a === 'link') copyText(`${location.origin}/?e=${slug}`);
        else if (b.dataset.a === 'estado') { if (b.dataset.v === 'suspendido' && !confirm(`¿Suspender "${slug}"? Nadie de ese negocio podrá entrar hasta reactivarlo.`)) return; await papi('POST', `tenants/${slug}/estado`, { status: b.dataset.v }); load(); }
        else if (b.dataset.a === 'reset') resendAccess(slug, rows.find((x) => x.slug === slug));
        else if (b.dataset.a === 'bk') {
          const r = await fetch(`/api/plataforma/tenants/${slug}/backup`, { headers: { Authorization: 'Bearer ' + PT } });
          if (!r.ok) throw new Error((await r.json()).error);
          const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${slug}-${todayStr()}.db`; a.click();
        } else if (b.dataset.a === 'edit') editTenant(slug, load);
        else if (b.dataset.a === 'del' || b.dataset.a === 'rm') deleteTenantDialog(slug, rows.find((x) => x.slug === slug), load);
      } catch (er) { fail(er); }
    }));
  }
  load().catch(fail);
}

// Reenviar accesos: la contraseña no se puede "ver" de nuevo (se guarda cifrada de una vía), así que se genera una nueva y se deja lista para copiar.
function resendAccess(slug, t) {
  modal('Copiar los accesos otra vez', `<p>Para volver a enviarle los datos a <b>${esc(t ? t.name : slug)}</b> se genera una <b>contraseña nueva</b> para su administrador${t && t.is_demo ? ' (y para los usuarios vendedor y contador de la demo)' : ''}.</p><p class="help">La contraseña anterior deja de servir y se cierran sus sesiones abiertas. El enlace y el código de empresa siguen siendo los mismos.</p>
    <p><button class="btn" id="go">Generar contraseña nueva y copiar</button></p>`, { small: true, onMount: (m, close) => {
    $('#go', m).onclick = async (e) => { e.target.disabled = true; try { const r = await papi('POST', `tenants/${slug}/reset-admin`, {}); close(); credentials({ slug, admin_user: r.username, password: r.password, name: t && t.name, demo: !!(t && t.is_demo), users: r.users }, 'Accesos listos para copiar'); } catch (er) { fail(er); e.target.disabled = false; } };
  } });
}

function credentials(t, title) {
  const url = `${location.origin}/?e=${t.slug}`;
  const users = t.users && t.users.length > 1 ? t.users.join(', ') : t.admin_user;
  const datos = `Ingreso: ${url}\nCódigo de empresa: ${t.slug}\nUsuario${t.users && t.users.length > 1 ? 's' : ''}: ${users}\nContraseña: ${t.password}`;
  const mensaje = `Hola 👋 estos son sus datos para ingresar${t.name ? ' a ' + t.name : ''}:\n\n🔗 ${url}\n🏢 Código de empresa: ${t.slug}\n👤 Usuario${t.users && t.users.length > 1 ? 's' : ''}: ${users}\n🔑 Contraseña: ${t.password}\n\nLe recomiendo cambiar la contraseña al ingresar.`;
  modal(title || 'Negocio creado', `<p class="help">Entregue estos datos al dueño del negocio. La contraseña solo se ve ahora; si necesita enviarlos otra vez, use el botón <b>📋 Accesos</b> de la lista (genera una nueva).</p>
    <pre style="background:var(--bg);padding:12px;border-radius:8px;white-space:pre-wrap;user-select:all">${esc(datos)}</pre>
    <div class="actions"><button class="btn" id="cp">📋 Copiar datos</button><button class="btn sec" id="cw">💬 Copiar mensaje listo para WhatsApp</button></div>`, { small: true, onMount: (m) => { $('#cp', m).onclick = () => copyText(datos); $('#cw', m).onclick = () => copyText(mensaje); } });
}

async function loadTrash(done) {
  const rows = await papi('GET', 'papelera');
  const box = $('#trash'); if (!box) return;
  box.innerHTML = rows.length ? `<div class="card"><h2>🗑 Papelera</h2><p class="help">Los negocios eliminados se conservan 30 días. Puede restaurarlos con todos sus datos o borrarlos para siempre.</p>${table([
    { h: 'Negocio', k: (t) => `<b>${esc(t.name)}</b><div class="help">código: ${esc(t.slug)}</div>`, raw: 1 }, { h: 'Eliminado', k: (t) => (t.deleted_at || '').slice(0, 10) }, { h: 'Se borra solo el', k: (t) => (t.expires_at || '').slice(0, 10) },
    { h: '', raw: 1, k: (t) => `<div class="actions"><button class="btn sm" data-t="rest" data-id="${t.id}">↩ Restaurar</button><button class="btn sm danger" data-t="purge" data-id="${t.id}" data-s="${esc(t.slug)}">Borrar para siempre</button></div>` }], rows)}</div>` : '';
  $$('#trash [data-t]').forEach((b) => (b.onclick = async () => {
    try {
      if (b.dataset.t === 'rest') { await papi('POST', `papelera/${b.dataset.id}/restaurar`, {}); toast('Negocio restaurado'); done(); }
      else {
        const slug = b.dataset.s;
        modal('Borrar para siempre', `<form id="f"><p class="bad"><b>Esto no se puede deshacer.</b> Se borran todos los datos de este negocio, sin copia.</p><p>Escriba el código <b>${esc(slug)}</b> para confirmar:</p><input name="confirm" autocomplete="off" required><p><button class="btn danger">Borrar para siempre</button></p></form>`, { small: true, onMount: (m, close) => {
          $('#f', m).onsubmit = async (e) => { e.preventDefault(); try { await papi('POST', `papelera/${b.dataset.id}/borrar`, { confirm: formData(e.target).confirm.trim() }); close(); toast('Borrado'); done(); } catch (er) { fail(er); } };
        } });
      }
    } catch (er) { fail(er); }
  }));
}

async function editTenant(slug, done) {
  const t = await papi('GET', `tenants/${slug}`);
  modal('Editar negocio', `<form id="f"><div class="grid g2"><div style="grid-column:1/-1"><label>Nombre del negocio</label><input name="name" required value="${esc(t.name)}"></div>
    <div><label>NIT</label><input name="nit" value="${esc(t.nit)}"></div><div><label>Teléfono</label><input name="phone" value="${esc(t.phone)}"></div>
    <div style="grid-column:1/-1"><label>Dirección</label><input name="address" value="${esc(t.address)}"></div>
    <div style="grid-column:1/-1"><label>Nota interna (solo usted la ve)</label><input name="note" value="${esc(t.note || '')}"></div>
    ${t.is_demo ? `<div style="grid-column:1/-1"><label>Ampliar la vigencia de esta demo (vence el ${esc((t.expires_at || '').slice(0, 10))})</label><select name="extend_days"><option value="">No cambiar</option><option value="3">3 días más</option><option value="7">7 días más</option><option value="14">14 días más</option><option value="30">30 días más</option></select></div>` : ''}</div>
    <p class="help">Código de empresa: <b>${esc(t.slug)}</b> · administrador: <b>${esc(t.admin_user || '')}</b>. El código no se puede cambiar, porque el negocio entra con él.</p><p><button class="btn">Guardar cambios</button></p></form>`, { onMount: (m, close) => {
    $('#f', m).onsubmit = async (e) => { e.preventDefault(); try { await papi('PUT', `tenants/${slug}`, formData(e.target)); close(); toast('Cambios guardados'); done(); } catch (er) { fail(er); } };
  } });
}

function deleteTenantDialog(slug, t, done) {
  const archivado = t && t.status === 'archivado';
  modal(archivado ? 'Quitar de la lista' : 'Eliminar negocio', `<form id="f"><p><b>${esc(t ? t.name : slug)}</b> (${esc(slug)})</p>
    ${archivado ? '<p>Este negocio ya estaba archivado. Se quitará de la lista.</p>' : `<p>Se saca de servicio: <b>nadie de ese negocio podrá entrar</b>. Sus datos van a la <b>papelera durante 30 días</b>, y en ese tiempo puede restaurarlo tal como estaba. Pasado ese plazo se borran para siempre.</p><p class="help">Si quiere conservar una copia propia, use primero el botón <b>Copia</b>.</p>`}
    <p>Escriba el código <b>${esc(slug)}</b> para confirmar:</p><input name="confirm" autocomplete="off" required><p><button class="btn danger">🗑 Eliminar</button></p></form>`, { small: true, onMount: (m, close) => {
    $('#f', m).onsubmit = async (e) => { e.preventDefault(); try { await papi('POST', `tenants/${slug}/eliminar`, { confirm: formData(e.target).confirm.trim() }); close(); toast(archivado ? 'Quitado de la lista' : 'Negocio enviado a la papelera'); done(); } catch (er) { fail(er); } };
  } });
}

function newTenant(done) {
  modal('Nuevo negocio', `<form id="f"><div class="grid g2"><div style="grid-column:1/-1"><label>Nombre del negocio *</label><input name="name" required></div>
    <div><label>Código de empresa (opcional)</label><input name="slug" placeholder="se genera del nombre"></div><div><label>NIT</label><input name="nit"></div>
    <div><label>Tipo de negocio</label><select name="sector"><option value="cabello">Productos para el cabello y belleza</option><option value="general">Otro comercio</option></select></div>
    <div><label>Modalidad</label><select name="profile"><option value="comercio">Productos con inventario</option><option value="mixto">Productos y servicios</option><option value="servicios">Solo servicios</option></select></div>
    <div><label>Usuario administrador</label><input name="admin_user" value="admin"></div><div><label>Contraseña inicial (vacío = generar)</label><input name="password" minlength="8"></div>
    <div style="grid-column:1/-1"><label>Nota interna (solo usted la ve)</label><input name="note"></div></div><p><button class="btn">Crear negocio</button></p></form>`, { onMount: (m, close) => {
    $('#f', m).onsubmit = async (e) => { e.preventDefault(); try { const r = await papi('POST', 'tenants', formData(e.target)); close(); credentials(r); done(); } catch (er) { fail(er); } };
  } });
}

function newDemo(done) {
  modal('Crear demo con datos de ejemplo', `<form id="f"><p class="help">Crea un negocio de productos para el cabello con productos, lotes por vencer, clientes, ventas, cobros, gastos y facturas electrónicas de prueba. Se elimina solo al vencer.</p>
    <div class="grid g2"><div><label>Nombre (opcional)</label><input name="name" placeholder="Demo para Ana"></div><div><label>Vigencia</label><select name="days"><option value="3">3 días</option><option value="7">7 días</option><option value="14">14 días</option><option value="30">30 días</option></select></div></div>
    <p><button class="btn" id="go">Crear demo</button></p></form>`, { small: true, onMount: (m, close) => {
    $('#f', m).onsubmit = async (e) => {
      e.preventDefault(); const btn = $('#go', m); btn.disabled = true; btn.textContent = 'Generando datos…';
      try { const r = await papi('POST', 'tenants/demo', formData(e.target)); close(); demoCredentials(r); done(); } catch (er) { fail(er); btn.disabled = false; btn.textContent = 'Crear demo'; }
    };
  } });
}
function demoCredentials(d) {
  const s = d.summary;
  const url = `${location.origin}/?e=${d.slug}`;
  const datos = `DEMO (datos ficticios, vence el ${d.expires_at.slice(0, 10)})\nIngreso: ${url}\nCódigo de empresa: ${d.slug}\nUsuarios: demo (administrador), vendedor, contador\nContraseña (la misma para los tres): ${d.password}`;
  const mensaje = `Hola 👋 pruebe nuestra plataforma con datos de ejemplo:\n\n🔗 ${url}\n🏢 Código de empresa: ${d.slug}\n👤 Usuario: demo (también puede probar vendedor y contador)\n🔑 Contraseña: ${d.password}\n\n⏳ Disponible hasta el ${d.expires_at.slice(0, 10)}. Los datos son ficticios.`;
  modal('Demo lista', `<p class="help">${s.products} productos · ${s.clients} clientes · ${s.sales} ventas · ${s.purchases} compras · ${s.expenses} gastos · ${s.einvoices} facturas electrónicas de prueba. Si necesita enviar los accesos otra vez, use <b>📋 Accesos</b> en la lista.</p><pre style="background:var(--bg);padding:12px;border-radius:8px;white-space:pre-wrap;user-select:all">${esc(datos)}</pre>
    <div class="actions"><button class="btn" id="cp">📋 Copiar datos</button><button class="btn sec" id="cw">💬 Copiar mensaje listo para WhatsApp</button></div>`, { small: true, onMount: (m) => { $('#cp', m).onclick = () => copyText(datos); $('#cw', m).onclick = () => copyText(mensaje); } });
}
