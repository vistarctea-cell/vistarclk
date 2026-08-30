// ============================================================
// VISTARC TEA STORE — AUTHENTICATION (Firebase, OTP-based)
// ============================================================
// Replaces the old demo login. Two real sign-in methods:
//   1. Phone  — real 6-digit SMS OTP (Firebase Phone Auth)
//   2. Email  — passwordless sign-in link sent to the inbox
//               (Firebase's native passwordless flow; this is
//               the "OTP" equivalent for email — see the note
//               in the chat reply about why a literal 6-digit
//               emailed code needs a backend and this doesn't)
//
// Both are first-sign-in-creates-the-account. No passwords
// anywhere, so "Forgot Password" is replaced by "just sign in
// again" — there's nothing to forget.
//
// Firebase enforces, with no code needed from us:
//   - OTP / link expiration
//   - one-time use (can't replay a code or link)
//   - abuse-rate throttling per phone/email/IP
// We add a client-side cooldown on top, purely for UX (stops
// someone mashing "Send code" 10 times in a row).
// ============================================================

import { firebaseConfig } from './firebase-config.js';
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  linkWithPhoneNumber,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  linkWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ---------- state ----------
let confirmationResult = null;   // active phone OTP confirmation
let linkConfirmationResult = null; // phone OTP confirmation when linking to an existing account
let cooldownTimer = null;
const COOLDOWN_SECONDS = 60;
const PENDING_EMAIL_KEY = 'vistarc_pending_email';
const LINK_MODE_KEY = 'vistarc_link_mode'; // 'signin' | 'link'

// ---------- helpers ----------
function isTa(){ try { return typeof isTaLang === 'function' && isTaLang(); } catch(e){ return false; } }
function toast(en, ta){ try { showToast(isTa() ? (ta||en) : en); } catch(e){ console.log(en); } }
function showError(msg){
  const box = document.getElementById('authError');
  if (!box) { console.error(msg); return; }
  box.textContent = msg;
  box.style.display = 'block';
}
function clearError(){
  const box = document.getElementById('authError');
  if (box) { box.style.display = 'none'; box.textContent = ''; }
}
function friendlyError(err){
  const code = err && err.code || '';
  const map = {
    'auth/invalid-phone-number': 'That phone number looks invalid. Use full international format, e.g. +9477xxxxxxx.',
    'auth/too-many-requests': 'Too many attempts. Please wait a bit before trying again.',
    'auth/invalid-verification-code': 'That code is incorrect or expired. Request a new one.',
    'auth/code-expired': 'That code expired. Request a new one.',
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/credential-already-in-use': 'That account is already linked to a different user.',
    'auth/email-already-in-use': 'That email is already linked to a different account.',
    'auth/provider-already-linked': 'That sign-in method is already linked to this account.',
    'auth/network-request-failed': 'Network error — check your connection and try again.'
  };
  return map[code] || (err && err.message) || 'Something went wrong. Please try again.';
}
function startCooldown(btnId, seconds){
  const btn = document.getElementById(btnId);
  if (!btn) return;
  let remaining = seconds;
  btn.disabled = true;
  const originalText = btn.dataset.origText || btn.textContent;
  btn.dataset.origText = originalText;
  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    remaining--;
    btn.textContent = `${isTa() ? 'மீண்டும் அனுப்பவும்' : 'Resend'} (${remaining}s)`;
    if (remaining <= 0) {
      clearInterval(cooldownTimer);
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }, 1000);
}
function selectedPersistence(){
  const remember = document.getElementById('rememberMeChk');
  return (remember && remember.checked) ? browserLocalPersistence : browserSessionPersistence;
}
function ensureRecaptcha(containerId, verifierField){
  if (window[verifierField]) return window[verifierField];
  window[verifierField] = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  return window[verifierField];
}

// ---------- PHONE OTP: sign in / sign up ----------
async function sendPhoneOtp(isResend){
  clearError();
  const input = document.getElementById('phoneInput');
  const phone = input.value.trim();
  if (!phone.startsWith('+')) {
    showError(isTa() ? 'நாட்டு குறியீட்டுடன் எண்ணை உள்ளிடவும் (உதா. +9477xxxxxxx)' : 'Enter your number with country code, e.g. +9477xxxxxxx');
    return;
  }
  try {
    await setPersistence(auth, selectedPersistence());
    const verifier = ensureRecaptcha('recaptcha-container', '_recaptchaVerifier');
    confirmationResult = await signInWithPhoneNumber(auth, phone, verifier);
    document.getElementById('phoneStep1').style.display = 'none';
    document.getElementById('phoneStep2').style.display = 'block';
    startCooldown('phoneResendBtn', COOLDOWN_SECONDS);
    toast('Code sent by SMS.', 'குறியீடு SMS மூலம் அனுப்பப்பட்டது.');
  } catch (err) {
    console.error(err);
    showError(friendlyError(err));
    // reCAPTCHA must be reset after a failed attempt
    if (window._recaptchaVerifier) { window._recaptchaVerifier.render().then(id => grecaptcha.reset(id)); }
  }
}

async function verifyPhoneOtp(){
  clearError();
  const code = document.getElementById('phoneOtpInput').value.trim();
  if (!confirmationResult) { showError('Request a code first.'); return; }
  if (!/^\d{6}$/.test(code)) { showError(isTa() ? '6 இலக்க குறியீட்டை உள்ளிடவும்.' : 'Enter the 6-digit code.'); return; }
  try {
    await confirmationResult.confirm(code); // throws on wrong/expired/reused code
    confirmationResult = null;
    toggleLogin(false);
    toast('Signed in successfully.', 'வெற்றிகரமாக உள்நுழைந்தீர்கள்.');
  } catch (err) {
    console.error(err);
    showError(friendlyError(err));
  }
}

// ---------- EMAIL sign-in link ----------
async function sendEmailLink(isResend){
  clearError();
  const input = document.getElementById('emailInput');
  const email = input.value.trim();
  if (!email || !email.includes('@')) {
    showError(isTa() ? 'சரியான மின்னஞ்சலை உள்ளிடவும்.' : 'Enter a valid email address.');
    return;
  }
  const actionCodeSettings = {
    url: window.location.href.split('#')[0], // return to this same page
    handleCodeInApp: true
  };
  try {
    await setPersistence(auth, selectedPersistence());
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem(PENDING_EMAIL_KEY, email);
    window.localStorage.setItem(LINK_MODE_KEY, 'signin');
    document.getElementById('emailStep1').style.display = 'none';
    document.getElementById('emailStep2').style.display = 'block';
    startCooldown('emailResendBtn', COOLDOWN_SECONDS);
    toast('Sign-in link sent — check your inbox.', 'உள்நுழைவு இணைப்பு அனுப்பப்பட்டது — உங்கள் இன்பாக்ஸை சரிபார்க்கவும்.');
  } catch (err) {
    console.error(err);
    showError(friendlyError(err));
  }
}

// Runs on every page load: completes sign-in if the URL is a Firebase email link.
async function completeEmailLinkSignInIfPresent(){
  if (!isSignInWithEmailLink(auth, window.location.href)) return;
  let email = window.localStorage.getItem(PENDING_EMAIL_KEY);
  if (!email) {
    email = window.prompt(isTa() ? 'உறுதிப்படுத்த உங்கள் மின்னஞ்சலை மீண்டும் உள்ளிடவும்' : 'Confirm your email to finish signing in');
  }
  if (!email) return;
  const mode = window.localStorage.getItem(LINK_MODE_KEY) || 'signin';
  try {
    if (mode === 'link' && auth.currentUser) {
      const credential = EmailAuthProvider.credentialWithLink(email, window.location.href);
      await linkWithCredential(auth.currentUser, credential);
      toast('Email linked to your account.', 'மின்னஞ்சல் உங்கள் கணக்குடன் இணைக்கப்பட்டது.');
    } else {
      await signInWithEmailLink(auth, email, window.location.href);
      toast('Signed in successfully.', 'வெற்றிகரமாக உள்நுழைந்தீர்கள்.');
    }
  } catch (err) {
    console.error(err);
    showError(friendlyError(err));
  } finally {
    window.localStorage.removeItem(PENDING_EMAIL_KEY);
    window.localStorage.removeItem(LINK_MODE_KEY);
    // clean the sign-in params out of the visible URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// ---------- account linking (dashboard) ----------
async function linkEmail(){
  clearError();
  const email = document.getElementById('linkEmailInput').value.trim();
  if (!email || !email.includes('@')) { showError('Enter a valid email address.'); return; }
  const actionCodeSettings = { url: window.location.href.split('#')[0], handleCodeInApp: true };
  try {
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem(PENDING_EMAIL_KEY, email);
    window.localStorage.setItem(LINK_MODE_KEY, 'link');
    toast('Check your inbox to confirm linking this email.', 'இந்த மின்னஞ்சலை இணைக்க உங்கள் இன்பாக்ஸை சரிபார்க்கவும்.');
  } catch (err) {
    console.error(err);
    showError(friendlyError(err));
  }
}

async function linkPhone(){
  clearError();
  const phone = document.getElementById('linkPhoneInput').value.trim();
  if (!phone.startsWith('+')) { showError('Enter your number with country code, e.g. +9477xxxxxxx'); return; }
  try {
    const verifier = ensureRecaptcha('recaptcha-container-link', '_recaptchaVerifierLink');
    linkConfirmationResult = await linkWithPhoneNumber(auth.currentUser, phone, verifier);
    const code = window.prompt(isTa() ? '6 இலக்க குறியீட்டை உள்ளிடவும்' : 'Enter the 6-digit code sent to that number');
    if (!code) return;
    await linkConfirmationResult.confirm(code);
    toast('Phone linked to your account.', 'தொலைபேசி உங்கள் கணக்குடன் இணைக்கப்பட்டது.');
  } catch (err) {
    console.error(err);
    showError(friendlyError(err));
  }
}

// ---------- logout ----------
async function logout(){
  await signOut(auth);
  toast('Logged out.', 'வெளியேறியது.');
  if (typeof toggleDash === 'function') toggleDash(false);
}

// ---------- UI sync on auth state change ----------
function fmtDate(iso){
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

onAuthStateChanged(auth, (user) => {
  const loginBtn = document.getElementById('loginBtn');
  if (!loginBtn) return;
  if (user) {
    loginBtn.title = user.displayName || user.email || user.phoneNumber || 'Account';
    loginBtn.dataset.loggedIn = 'true';
    const nameEl = document.getElementById('dashName');
    const emailEl = document.getElementById('dashEmail');
    const phoneEl = document.getElementById('dashPhone');
    const createdEl = document.getElementById('dashCreated');
    if (nameEl) nameEl.textContent = user.displayName || (isTa() ? 'பெயர் அமைக்கப்படவில்லை' : 'Not set');
    if (emailEl) emailEl.textContent = user.email || (isTa() ? 'இணைக்கப்படவில்லை' : 'Not linked');
    if (phoneEl) phoneEl.textContent = user.phoneNumber || (isTa() ? 'இணைக்கப்படவில்லை' : 'Not linked');
    if (createdEl) createdEl.textContent = fmtDate(user.metadata && user.metadata.creationTime);
    const linkEmailRow = document.getElementById('linkEmailRow');
    const linkPhoneRow = document.getElementById('linkPhoneRow');
    if (linkEmailRow) linkEmailRow.style.display = user.email ? 'none' : 'block';
    if (linkPhoneRow) linkPhoneRow.style.display = user.phoneNumber ? 'none' : 'block';
  } else {
    loginBtn.title = 'Open account login';
    loginBtn.dataset.loggedIn = 'false';
  }
});

// run once on load to catch email-link returns
completeEmailLinkSignInIfPresent();

// expose to inline onclick="" handlers used in index.html
window.vistarcAuth = {
  sendPhoneOtp, verifyPhoneOtp, sendEmailLink, linkEmail, linkPhone, logout
};
window.vistarcAuthInstance = auth;
