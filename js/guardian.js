import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, sendEmailVerification,
  signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const auth = getAuth(getApp());
const db = getFirestore(getApp());

export async function registrarPersona(correo, clave) {
  const cred = await createUserWithEmailAndPassword(auth, correo, clave);
  await setDoc(doc(db, "perfiles", cred.user.uid), {
    correo, tipo: "persona", convenioId: null, creado: serverTimestamp()
  });
  await sendEmailVerification(cred.user);
  await signOut(auth);
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

export function mensajeError(e) {
  const m = {
    correo_no_verificado: "Revisa tu correo y confirma tu cuenta antes de ingresar.",
    sin_perfil: "Cuenta no reconocida. Regístrate de nuevo.",
    convenio_inactivo: "Tu institución no tiene un convenio activo.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/email-already-in-use": "Ese correo ya está registrado.",
    "auth/weak-password": "La contraseña es muy débil (mínimo 6 caracteres).",
    "auth/too-many-requests": "Demasiados intentos. Espera unos minutos."
  };
  return m[e.code] || m[e.message] || "No se pudo completar. Intenta de nuevo.";
  }
