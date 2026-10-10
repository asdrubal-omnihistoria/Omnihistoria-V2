import "./firebase-init.js";
import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const auth = getAuth(getApp());
const LIMITE = 15 * 60 * 1000; // 15 minutos de inactividad
let temporizador;

function salir() {
  signOut(auth).finally(() => { location.href = "login.html"; });
}

function reiniciar() {
  clearTimeout(temporizador);
  temporizador = setTimeout(salir, LIMITE);
}

["click", "keydown", "mousemove", "touchstart", "scroll"].forEach((evento) =>
  window.addEventListener(evento, reiniciar, { passive: true })
);

onAuthStateChanged(auth, (usuario) => {
  if (!usuario) { location.href = "login.html"; return; }
  reiniciar();
});

document.querySelectorAll("[data-salir]").forEach((boton) =>
  boton.addEventListener("click", salir)
);
