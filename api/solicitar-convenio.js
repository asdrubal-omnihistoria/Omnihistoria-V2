const PROYECTO = 'omnih-beta';
const CLAVE = process.env.FIREBASE_API_KEY;
const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:';
const FS = 'https://firestore.googleapis.com/v1/projects/' + PROYECTO + '/databases/(default)/documents/convenios';

const TIPOS = ['university', 'archive', 'ngo', 'public', 'company', 'guild', 'other'];
const LIBRES = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com', 'yahoo.com', 'yahoo.es', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com', 'mail.com'];
LIBRES.length = 0; // PRUEBA TEMPORAL: BORRAR ESTA LINEA DESPUES
const reCorreo = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const reTel = /^\+\d[\d\s().-]{6,18}$/;
const reWeb = /^https:\/\/[^\s\/]+\.[^\s\/]{2,}(\/\S*)?$/i;
const rePais = /^[A-Z]{2}$/;

function texto(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function dominio(c) {
  return c.split('@')[1] || '';
}
function coincide(web, correo) {
  try {
    const h = new URL(web).hostname.toLowerCase().replace(/^www\./, '');
    const d = dominio(correo);
    return h === d || h.endsWith('.' + d) || d.endsWith('.' + h);
  } catch (e) { return false; }
}

function limpiar(b) {
  const i = b.institution || {};
  const l = b.location || {};
  const r = b.representative || {};
  const c = b.consents || {};
  const d = {
    institution: {
      name: texto(i.name, 150), type: texto(i.type, 20), legalId: texto(i.legalId, 40),
      website: texto(i.website, 200), email: texto(i.email, 120).toLowerCase(), phone: texto(i.phone, 30)
    },
    location: {
      country: texto(l.country, 2).toUpperCase(), region: texto(l.region, 80),
      city: texto(l.city, 80), address: texto(l.address, 200)
    },
    representative: {
      name: texto(r.name, 120), title: texto(r.title, 100),
      email: texto(r.email, 120).toLowerCase(), phone: texto(r.phone, 30)
    },
    consents: {
      protocol: c.protocol === true, authority: c.authority === true,
      request: c.request === true, terms: c.terms === true
    },
    language: texto(b.language, 10)
  };
  const I = d.institution, L = d.location, R = d.representative, C = d.consents;
  const ok =
    I.name.length >= 3 && TIPOS.indexOf(I.type) > -1 && I.legalId.length >= 4 &&
    reWeb.test(I.website) && reCorreo.test(I.email) && LIBRES.indexOf(dominio(I.email)) === -1 && coincide(I.website, I.email) &&
    reTel.test(I.phone) && rePais.test(L.country) && L.region.length >= 2 &&
    L.city.length >= 2 && L.address.length >= 5 && R.name.length >= 3 && R.title.length >= 2 &&
    reCorreo.test(R.email) && dominio(R.email) === dominio(I.email) && reTel.test(R.phone) &&
    C.protocol && C.authority && C.request && C.terms;
  return ok ? d : null;
}

function aFS(v) {
  if (typeof v === 'boolean') { return { booleanValue: v }; }
  if (typeof v === 'string') { return { stringValue: v }; }
  const campos = {};
  Object.keys(v).forEach(function (k) { campos[k] = aFS(v[k]); });
  return { mapValue: { fields: campos } };
}

async function llamar(url, cuerpo, cabeceras) {
  const r = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, cabeceras || {}),
    body: JSON.stringify(cuerpo)
  });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, j: j };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Método no permitido.' });
  }
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch (e) { b = null; }
  }
  if (!b || typeof b !== 'object') {
    return res.status(400).json({ message: 'Solicitud inválida.' });
  }

  /* robots: campo oculto lleno o formulario enviado demasiado rápido */
  if (texto(b.trap, 50) !== '' || !(Number(b.elapsed) >= 3000)) {
    return res.status(200).json({ ok: true });
  }

  const d = limpiar(b);
  if (!d) {
    return res.status(400).json({ message: 'Revise los datos del formulario.' });
  }
  const clave = typeof b.password === 'string' ? b.password : '';
  if (clave.length < 10 || clave.length > 128) {
    return res.status(400).json({ message: 'La contraseña debe tener entre 10 y 128 caracteres.' });
  }
  if (!CLAVE) {
    console.error('Falta la variable FIREBASE_API_KEY');
    return res.status(500).json({ message: 'Configuración incompleta. Avise a los administradores.' });
  }

  /* 1. cuenta de la institución, con la contraseña que ella eligió */
  const alta = await llamar(AUTH + 'signUp?key=' + CLAVE, {
    email: d.institution.email, password: clave, returnSecureToken: true
  });
  if (!alta.ok) {
    const cod = (alta.j.error && alta.j.error.message) || '';
    if (cod.indexOf('EMAIL_EXISTS') === 0) {
      return res.status(409).json({ message: 'Ese correo ya tiene una cuenta. Entre por el inicio de sesión.' });
    }
    if (cod.indexOf('TOO_MANY_ATTEMPTS') === 0) {
      return res.status(429).json({ message: 'Demasiados intentos. Intente más tarde.' });
    }
    console.error('signUp falló:', cod);
    return res.status(500).json({ message: 'No se pudo crear la solicitud. Intente más tarde.' });
  }
  const token = alta.j.idToken;
  const uid = alta.j.localId;

  /* 2. guardar la solicitud en Firestore: convenios/<uid> (sin la contraseña) */
  const registro = {
    status: 'pending',
    institution: d.institution,
    location: d.location,
    representative: d.representative,
    consents: d.consents,
    language: d.language
  };
  const campos = {};
  Object.keys(registro).forEach(function (k) { campos[k] = aFS(registro[k]); });
  campos.createdAt = { timestampValue: new Date().toISOString() };
  const guardado = await llamar(FS + '?documentId=' + uid, { fields: campos }, { Authorization: 'Bearer ' + token });
  if (!guardado.ok) {
    console.error('Firestore falló:', JSON.stringify(guardado.j.error || {}));
    await llamar(AUTH + 'delete?key=' + CLAVE, { idToken: token });
    return res.status(500).json({ message: 'No se pudo guardar la solicitud. Intente más tarde.' });
  }

  /* 3. correo de certificación: lo envía Firebase y su enlace lleva a /login */
  const idioma = (d.language || 'es').slice(0, 2).toLowerCase();
  const correo = await llamar(AUTH + 'sendOobCode?key=' + CLAVE, {
    requestType: 'VERIFY_EMAIL', idToken: token,
    continueUrl: 'https://' + req.headers.host + '/login'
  }, { 'X-Firebase-Locale': idioma });
  if (!correo.ok) {
    console.error('Correo falló:', JSON.stringify(correo.j.error || {}));
    return res.status(502).json({ message: 'Solicitud guardada, pero no se pudo enviar el correo. Avise a los administradores.' });
  }

  return res.status(200).json({ ok: true });
      }
