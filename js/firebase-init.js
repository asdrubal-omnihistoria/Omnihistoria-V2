import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDwbscopbBbCXY47bms5xE5-cf8EG7kT68",
  authDomain: "omnih-beta.firebaseapp.com",
  projectId: "omnih-beta",
  storageBucket: "omnih-beta.firebasestorage.app",
  messagingSenderId: "529661744261",
  appId: "1:529661744261:web:cce51afd145ec4cd2c85ec"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
