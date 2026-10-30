import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROYECTO = 'omnih-beta';
const CLAVE = process.env.FIREBASE_API_KEY;
const CUENTA = process.env.FIREBASE_SERVICE_ACCOUNT;
const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:';

const TIPOS = ['university', 'archive', 'ngo', 'public', 'company', 'guild', 'other'];

/* correos comerciales o gratuitos: no se aceptan como correo oficial de una institución */
const LIBRES = [
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'hotmail.fr', 'hotmail.it', 'hotmail.co.uk',
  'outlook.com', 'outlook.es', 'outlook.fr', 'live.com', 'live.com.mx', 'msn.com',
  'yahoo.com', 'yahoo.es', 'yahoo.fr', 'yahoo.com.mx', 'yahoo.com.ar', 'yahoo.com.br', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  'gmx.com', 'gmx.net', 'gmx.es', 'gmx.de', 'web.de', 'mail.com', 'zoho.com', 'zohomail.com',
  'yandex.com', 'yandex.ru', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru',
  'qq.com', '163.com', '126.com', 'sina.com',
  'tutanota.com', 'tuta.io', 'hey.com', 'fastmail.com', 'fastmail.fm',
  'terra.com', 'terra.com.br', 'uol.com.br', 'bol.com.br', 'ig.com.br', 'libero.it', 'orange.fr', 'free.fr', 'laposte.net'
];

const reCorreo = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const reTel = /^\+\d[\d\s().-]{6,18}$/;
const reWeb = /^https:\/\/[^\s\/]+\.[^\s\/]{2,}(\/\S*)?$/i;
const rePais = /^[A-Z]{2}$/;

function texto(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function dominio(c) {
  return (c.split('@')[1] || '').toLowerCase();
}
function esLibre(correo) {
  return LIBRES.indexOf(dominio(correo)) > -1;
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
    reWeb.test(I.website) && reCorreo.test(I.email) && !esLibre(I.email) && coincide(I.website, I.email) &&
    reTel.test(I.phone) && rePais.test(L.country) && L.region.length >= 2 &&
    L.city.length >= 2 && L.address.length >= 5 && R.name.length >= 3 && R.title.length >= 2 &&
    reCorreo.test(R.email) && !esLibre(R.email) && dominio(R.email) === dominio(I.email) && reTel.test(R.phone) &&
    C.protocol && C.authority && C.request && C.terms;
  return ok ? d : null;
}

/* Firestore con permisos de servidor (Firebase Admin): salta las reglas, solo se usa aquí */
function baseDatos() {
  if (!getApps().length) {
    const cred = JSON.parse(CUENTA);
    if (cred.private_key) { cred.private_key = cred.private_key.replace(/\\n/g, '\n'); }
    initializeApp({ credential: cert(cred), projectId: PROYECTO });
  }
  return getFirestore();
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
  if (!CLAVE || !CUENTA) {
    console.error('Falta la variable FIREBASE_API_KEY o FIREBASE_SERVICE_ACCOUNT');
    return res.status(500).json({ message: 'Configuración incompleta. Avise a los administradores.' });
  }

  /* se prepara la base de datos ANTES de crear la cuenta, para no dejar cuentas a medias */
  let db;
  try {
    db = baseDatos();
  } catch (e) {
    console.error('Clave de servicio inválida:', e.message);
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

  /* 2. convenio + perfil en un solo paso (todo o nada), con acceso activo.
        status "pending" queda como marca de revisión posterior; el acceso lo da activo: true */
  try {
    const lote = db.batch();
    lote.set(db.collection('convenios').doc(uid), {
      status: 'pending',
      activo: true,
      institution: d.institution,
      location: d.location,
      representative: d.representative,
      consents: d.consents,
      language: d.language,
      createdAt: FieldValue.serverTimestamp()
    });
    lote.set(db.collection('perfiles').doc(uid), {
      tipo: 'convenio',
      convenioId: uid,
      activo: true,
      correo: d.institution.email,
      entidad: d.institution.name,
      territorio: d.location.country,
      creado: FieldValue.serverTimestamp()
    });
    await lote.commit();
  } catch (e) {
    console.error('Firestore falló:', e.message);
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
