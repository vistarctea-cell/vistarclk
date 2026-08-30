// ============================================================
// FIREBASE CONFIG — Vistarc Tea Store
// ============================================================
// You said you don't have a Firebase project yet. Here's the
// exact setup path (all free, no billing card required for
// Phone + Email-link auth — Blaze plan is only needed if you
// later add Cloud Functions for things like WhatsApp/email
// notifications).
//
// 1. Go to https://console.firebase.google.com → "Add project"
//    → name it "Vistarc Tea Store" → create.
// 2. In the project, click the Web icon (</>) to register a
//    web app. Name it "Vistarc Website". Firebase will show you
//    a config object exactly like the one below — copy YOUR
//    values into this file (replace every "REPLACE_ME").
// 3. Left sidebar → Build → Authentication → "Get started".
// 4. Sign-in method tab → enable:
//      - "Phone"
//      - "Email link (passwordless sign-in)" under the Email
//        provider — toggle "Email link" on.
// 5. Authentication → Settings → Authorized domains → add:
//      - your Netlify domain (e.g. vistarctea.netlify.app)
//      - your custom domain if you attach one later
//    (localhost is already there by default, for testing.)
// 6. That's it — no server, no API keys beyond this file.
//    This file is safe to expose publicly: Firebase web config
//    values are not secret, security is enforced by Firebase's
//    own rules/domain allow-list, not by hiding this object.
// ============================================================

export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};
