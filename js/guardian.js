import "./firebase-init.js";
import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, sendEmailVerification,
  signInWithEmailAndPassword, signOut, setPersistence,
  browserSessionPersistence, updateProfile, deleteUser
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const auth = getAuth(getApp());
const db = getFirestore(getApp());

export async function registrarPersona(correo, clave, datos = {}) {
  const cred = await createUserWithEmailAndPassword(auth, correo, clave);
  try {
    if (datos.username) {
      try { await updateProfile(cred.user, { displayName: datos.username }); } catch (_) {}
    }
    await setDoc(doc(db, "perfiles", cred.user.uid), {
      correo,
      tipo: "persona",
      convenioId: null,
      username: datos.username || "",
      territorio: datos.territorio || "",
      entidad: datos.entidad || "individual",
      creado: serverTimestamp()
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
    await signOut(auth); throw new Error("correo_no_verificado");
  }
  const snap = await getDoc(doc(db, "perfiles", cred.user.uid));
  if (!snap.exists()) { await signOut(auth); throw new Error("sin_perfil"); }
  const perfil = snap.data();
  if (perfil.tipo === "convenio") {
    const c = await getDoc(doc(db, "convenios", perfil.convenioId));
    if (!c.exists() || c.data().activo !== true) {
      await signOut(auth); throw new Error("convenio_inactivo");
    }
  }
  return perfil;
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

export function mensajeError(e) {
  const m = {
    correo_no_verificado: "Revisa tu correo y confirma tu cuenta antes de ingresar.",
    ya_verificado: "Tu correo ya está verificado. Puedes ingresar.",
    sin_perfil: "Cuenta no reconocida. Regístrate de nuevo.",
    convenio_inactivo: "Tu institución no tiene un convenio activo.",
    "permission-denied": "No se pudo guardar tu perfil. Revisa las reglas de Firestore.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
