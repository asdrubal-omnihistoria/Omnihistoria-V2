import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { rutaPorTipo } from "./guardian.js";

const LIMITE = 15 * 60 * 1000; // 15 minutos de inactividad
let temporizador;

// Cada página declara su tipo en el body: data-tipo="individual" o data-tipo="convenio"
const tipoEsperado = document.body ? document.body.dataset.tipo : null;
if (tipoEsperado) document.documentElement.style.visibility = "hidden";

async function esAdmin(uid) {
  try {
    const a = await getDoc(doc(db, "admins", uid));
    return a.exists() && a.data().activo === true;
  } catch (e) { return false; }
}

function salir() {
  sessionStorage.removeItem("omnih_atajo_carga");
  signOut(auth).finally(() => { location.href = "login.html"; });
}

function reiniciar() {
  clearTimeout(temporizador);
  temporizador = setTimeout(salir, LIMITE);
}

["click", "keydown", "mousemove", "touchstart", "scroll"].forEach((evento) =>
  window.addEventListener(evento, reiniciar, { passive: true })
);

onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) { location.href = "login.html"; return; }

  if (tipoEsperado) {
    try {
      const snap = await getDoc(doc(db, "perfiles", usuario.uid));
      const tipo = snap.exists() ? snap.data().tipo : null;
      if (tipo !== tipoEsperado) {
        // ===== INICIO ATAJO TEMPORAL A CARGA (lo activa solo el enlace del index; borrar junto con las líneas del index) =====
        const atajo = tipoEsperado === "convenio" && sessionStorage.getItem("omnih_atajo_carga") === "1";
        // ===== FIN ATAJO TEMPORAL A CARGA =====
        if (atajo || await esAdmin(usuario.uid)) {
          document.documentElement.style.visibility = "";
          reiniciar();
          return;
        }
        const destino = rutaPorTipo(tipo);
        if (destino) { location.replace(destino); } else { salir(); }
        return;
      }
    } catch (e) {
      salir();
      return;
    }
    document.documentElement.style.visibility = "";
  }

  reiniciar();
});

document.querySelectorAll("[data-salir]").forEach((boton) =>
  boton.addEventListener("click", salir)
);
