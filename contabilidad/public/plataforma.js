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
    <div class="actions"><button class="btn" id="new">Nuevo negocio</button><button class="btn sec" id="pw">Mi contraseña</button><button class="btn sec" id="out">Salir</button><a class="btn sec" href="#" id="emp">Ingreso de empresas</a></div></div><div id="list">Cargando…</div></main></div>`;
  $('#emp').onclick = (e) => { e.preventDefault(); location.hash = ''; };
  $('#out').onclick = async () => { try { await papi('POST', 'logout'); } catch (_) {} PT = null; try { localStorage.removeItem('ptoken'); } catch (_) {} renderPlatform(app); };
  $('#pw').onclick = () => modal('Mi contraseña', `<form id="g"><p><label>Actual</label><input name="current" type="password" required></p><p><label>Nueva (10+)</label><input name="password" type="password" minlength="10" required></p><button class="btn">Guardar</button></form>`, { small: true, onMount: (m, close) => { $('#g', m).onsubmit = async (e) => { e.preventDefault(); try { await papi('POST', 'password', formData(e.target)); toast('Actualizada'); close(); } catch (er) { fail(er); } }; } });
  $('#new').onclick = () => newTenant(load);
  async function load() {
    const rows = await papi('GET', 'tenants');
    $('#list').innerHTML = table([
      { h: 'Negocio', k: (t) => `<b>${esc(t.name)}</b><div class="help">código: ${esc(t.slug)} · admin: ${esc(t.admin_user || '')}</div>`, raw: 1 },
      { h: 'Estado', k: (t) => `<span class="tag ${t.status === 'activo' ? 'ok' : t.status === 'suspendido' ? 'warn' : 'err'}">${esc(t.status)}</span>`, raw: 1 },
      { h: 'Creado', k: (t) => (t.created_at || '').slice(0, 10) }, { h: 'Último ingreso', k: (t) => (t.last_login ? t.last_login.replace('T', ' ').slice(0, 16) : '—') }, { h: 'Datos', k: (t) => t.size_kb + ' KB', n: 1 },
      { h: '', raw: 1, k: (t) => (t.status === 'archivado' ? '' : `<div class="actions"><button class="btn sm sec" data-a="link" data-s="${esc(t.slug)}">Enlace</button><button class="btn sm sec" data-a="estado" data-s="${esc(t.slug)}" data-v="${t.status === 'activo' ? 'suspendido' : 'activo'}">${t.status === 'activo' ? 'Suspender' : 'Activar'}</button><button class="btn sm sec" data-a="reset" data-s="${esc(t.slug)}">Clave admin</button><button class="btn sm sec" data-a="bk" data-s="${esc(t.slug)}">Copia</button><button class="btn sm danger" data-a="arch" data-s="${esc(t.slug)}">Archivar</button></div>`) },
    ], rows, { empty: 'Aún no hay negocios. Cree el primero con "Nuevo negocio".' });
    $$('#list [data-a]').forEach((b) => (b.onclick = async () => {
      const slug = b.dataset.s;
      try {
        if (b.dataset.a === 'link') copyText(`${location.origin}/?e=${slug}`);
        else if (b.dataset.a === 'estado') { if (b.dataset.v === 'suspendido' && !confirm(`¿Suspender "${slug}"? Nadie de ese negocio podrá entrar hasta reactivarlo.`)) return; await papi('POST', `tenants/${slug}/estado`, { status: b.dataset.v }); load(); }
        else if (b.dataset.a === 'reset') { if (!confirm(`¿Generar una clave nueva para el administrador de "${slug}"? Se cerrarán sus sesiones.`)) return; const r = await papi('POST', `tenants/${slug}/reset-admin`, {}); credentials({ slug, admin_user: r.username, password: r.password }, 'Clave nueva del administrador'); }
        else if (b.dataset.a === 'bk') {
          const r = await fetch(`/api/plataforma/tenants/${slug}/backup`, { headers: { Authorization: 'Bearer ' + PT } });
          if (!r.ok) throw new Error((await r.json()).error);
          const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${slug}-${todayStr()}.db`; a.click();
        } else if (b.dataset.a === 'arch') {
          const c = prompt(`Archivar saca "${slug}" de servicio y mueve sus datos a la carpeta de archivo (no se borran).\\nEscriba el código "${slug}" para confirmar:`);
          if (c === null) return; await papi('POST', `tenants/${slug}/archivar`, { confirm: c.trim() }); toast('Archivado'); load();
        }
      } catch (er) { fail(er); }
    }));
  }
  load().catch(fail);
}

function credentials(t, title) {
  const url = `${location.origin}/?e=${t.slug}`;
  const txt = `Ingreso: ${url}\nCódigo de empresa: ${t.slug}\nUsuario: ${t.admin_user}\nContraseña: ${t.password}`;
  modal(title || 'Negocio creado', `<p class="help">Entregue estos datos al dueño del negocio. <b>La contraseña solo se muestra ahora</b>; si se pierde, se genera una nueva.</p><pre style="background:var(--bg);padding:12px;border-radius:8px;white-space:pre-wrap;user-select:all">${esc(txt)}</pre><button class="btn" id="cp">Copiar todo</button>`, { small: true, onMount: (m) => { $('#cp', m).onclick = () => copyText(txt); } });
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
