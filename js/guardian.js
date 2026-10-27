import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword, sendEmailVerification,
  signInWithEmailAndPassword, signOut, setPersistence,
  browserSessionPersistence, updateProfile, deleteUser,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

export function rutaPorTipo(tipo) {
  if (tipo === "individual") return "central.html";
  if (tipo === "convenio") return "carga.html";
  return null;
}

export async function registrarPersona(correo, clave, datos = {}) {
  const cred = await createUserWithEmailAndPassword(auth, correo, clave);
  try {
    if (datos.username) {
      try { await updateProfile(cred.user, { displayName: datos.username }); } catch (_) {}
    }
    await setDoc(doc(db, "perfiles", cred.user.uid), {
      correo: correo.toLowerCase(),
      tipo: datos.tipo || "individual",
      convenioId: datos.convenioId || null,
      username: datos.username || "",
      territorio: datos.territorio || "",
      entidad: datos.entidad || "INDIVIDUAL",
      creado: serverTimestamp(),
      activo: true
    });
  } catch (e) {
    try { await deleteUser(cred.user); } catch (_) {}
    throw e;
  }
  try {
    await sendEmailVerification(cred.user);
  } finally {
    await signOut(auth);
  }
}

export async function ingresar(correo, clave) {
  await setPersistence(auth, browserSessionPersistence);
  const cred = await signInWithEmailAndPassword(auth, correo, clave);
  await cred.user.reload();

  if (!cred.user.emailVerified) {
    await signOut(auth);
    throw new Error("correo_no_verificado");
  }

  const snap = await getDoc(doc(db, "perfiles", cred.user.uid));
  if (!snap.exists()) {
    await signOut(auth);
    throw new Error("sin_perfil");
  }

  const perfil = snap.data();
  const tipo = perfil.tipo;

  if (tipo !== "individual" && tipo !== "convenio") {
    await signOut(auth);
    throw new Error("tipo_desconocido");
  }

  if (tipo === "convenio") {
    if (!perfil.convenioId) {
      await signOut(auth);
      throw new Error("sin_convenio");
    }
    const c = await getDoc(doc(db, "convenios", perfil.convenioId));
    if (!c.exists() || c.data().activo !== true) {
      await signOut(auth);
      throw new Error("convenio_inactivo");
    }
  }

  const sesionActiva = {
    uid: cred.user.uid,
    correo: cred.user.email,
    tipo: tipo,
    entidad: perfil.entidad || (perfil.username ? perfil.username.toUpperCase() : (tipo === "convenio" ? "INSTITUCIÓN VINCULADA" : "INDIVIDUAL")),
    convenio: tipo === "convenio" ? perfil.convenioId : null,
    token: await cred.user.getIdToken(),
    loginAt: new Date().toISOString()
  };

  sessionStorage.setItem("omnih_institucion_activa", JSON.stringify(sesionActiva));

  return sesionActiva;
}

export async function reenviarVerificacion(correo, clave) {
  const cred = await signInWithEmailAndPassword(auth, correo, clave);
  try {
    await cred.user.reload();
    if (cred.user.emailVerified) throw new Error("ya_verificado");
    await sendEmailVerification(cred.user);
  } finally {
    await signOut(auth);
  }
}

export async function recuperarClave(correo) {
  return sendPasswordResetEmail(auth, correo);
}

export function mensajeError(e) {
  const code = (e && (e.code || e.message)) || "";
  const m = {
    correo_no_verificado: "Revisa tu correo y confirma tu cuenta antes de ingresar.",
    "auth/unverified-email": "Revisa tu correo y confirma tu cuenta antes de ingresar.",
    ya_verificado: "Tu correo ya está verificado. Puedes ingresar.",
    sin_perfil: "Cuenta no reconocida. Regístrate de nuevo.",
    tipo_desconocido: "Tu cuenta no tiene un tipo válido. Contacta a OMNIH.",
    sin_convenio: "Tu cuenta institucional no tiene un convenio asociado.",
    convenio_inactivo: "Tu institución no tiene un convenio activo.",
    "permission-denied": "No se pudo guardar tu perfil. Revisa las reglas de Firestore.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/user-not-found": "No existe usuario registrado con este correo.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/too-many-requests": "Demasiados intentos fallidos. Intenta más tarde."
  };
  return m[code] || (e && e.message) || "Error al procesar la solicitud.";
}
