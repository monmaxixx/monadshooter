// Firebase leaderboard module — uses CDN modular SDK.
// To enable the leaderboard, replace the firebaseConfig values below with your
// own Firebase project credentials, then deploy these Firestore rules:
//
//   rules_version = '2';
//   service cloud.firestore {
//     match /databases/{database}/documents {
//       match /scores/{doc} {
//         allow read: if true;
//         allow create: if request.resource.data.name is string
//           && request.resource.data.name.size() > 0
//           && request.resource.data.name.size() <= 16
//           && request.resource.data.score is number
//           && request.resource.data.score >= 0
//           && request.resource.data.score <= 1000000
//           && request.resource.data.time is number
//           && request.resource.data.time >= 0;
//         allow update, delete: if false;
//       }
//     }
//   }

const firebaseConfig = {
  apiKey: "AIzaSyB0X6TxZcuL9L6oyPUItjB8ZcSu3ZBfBqU",
  authDomain: "monadshoterlb.firebaseapp.com",
  projectId: "monadshoterlb",
  storageBucket: "monadshoterlb.firebasestorage.app",
  messagingSenderId: "386682561777",
  appId: "1:386682561777:web:5ab5e885e7e9ee9feaf550",
};

const ENABLED = !Object.values(firebaseConfig).some((v) => v === "REPLACE_ME");

let _db = null;
let _fs = null;

async function init() {
  if (!ENABLED) return null;
  if (_db) return _db;
  const appMod = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
  _fs = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
  const app = appMod.initializeApp(firebaseConfig);
  _db = _fs.getFirestore(app);
  return _db;
}

export function isLeaderboardEnabled() {
  return ENABLED;
}

export async function submitScore(name, score, time) {
  if (!ENABLED) return { ok: false, reason: "disabled" };
  if (typeof name !== "string" || name.length === 0 || name.length > 16) {
    return { ok: false, reason: "invalid_name" };
  }
  if (typeof score !== "number" || score < 0 || score > 1_000_000) {
    return { ok: false, reason: "invalid_score" };
  }
  if (typeof time !== "number" || time < 0) {
    return { ok: false, reason: "invalid_time" };
  }
  try {
    const db = await init();
    await _fs.addDoc(_fs.collection(db, "scores"), {
      name, score, time,
      ts: _fs.serverTimestamp(),
    });
    return { ok: true };
  } catch (err) {
    console.error("submitScore failed", err);
    return { ok: false, reason: "error" };
  }
}

export async function getLeaderboard(limit = 10) {
  if (!ENABLED) return [];
  try {
    const db = await init();
    const q = _fs.query(
      _fs.collection(db, "scores"),
      _fs.orderBy("score", "desc"),
      _fs.limit(limit),
    );
    const snap = await _fs.getDocs(q);
    return snap.docs.map((d) => d.data());
  } catch (err) {
    console.error("getLeaderboard failed", err);
    return [];
  }
}
