// Supabase client + helper email auth — dipindah dari App.jsx (refactor Fase 1).
// Satu client dipakai untuk auth (login/sesi/logout) maupun REST sync
// (tug15_history, stock_current, dst). SUPABASE_URL/SUPABASE_KEY diekspor
// karena fungsi sync di App.jsx memakainya langsung untuk fetch REST.
import { createClient } from "@supabase/supabase-js";

// Test harness is DEV-only and must remain physically unable to construct a
// production Supabase client, even when the developer has .env.local secrets.
const E2E_MODE = import.meta.env.DEV && (import.meta.env.MODE === "e2e" || import.meta.env.VITE_E2E === "true");
export const SUPABASE_URL = E2E_MODE ? undefined : import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = E2E_MODE ? undefined : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const EXPECTED_SUPABASE_HOST = "warnoto.com";
const CANONICAL_SUPABASE_ORIGIN = "https://warnoto.com";

// Dev harus gagal cepat bila .env masih menunjuk ke Supabase Cloud lama. Produksi
// sudah dibuild oleh Vercel; guard ini khusus mencegah data dev tersinkron ke backend
// yang salah dan tidak pernah mengirim key apa pun ke log.
if (import.meta.env.DEV && !E2E_MODE && SUPABASE_URL) {
  let configuredHost = "";
  try { configuredHost = new URL(SUPABASE_URL).hostname.toLowerCase(); } catch {}
  if (configuredHost !== EXPECTED_SUPABASE_HOST) {
    throw new Error("VITE_SUPABASE_URL harus menunjuk ke warnoto.com (backend self-host). Periksa .env.local.");
  }
}

// Jangan menerima token dari endpoint/project lain. Nama ini eksplisit agar cache
// profil dan sesi browser selalu terikat ke satu backend self-host yang disepakati.
export const SUPABASE_AUTH_STORAGE_KEY = E2E_MODE ? "sb-e2e-auth-token" : "sb-warnoto-auth-token";
const devSupabaseFetch = import.meta.env.DEV && !E2E_MODE
  ? (input, init) => {
      const requestUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const url = new URL(requestUrl, window.location.origin);
      if (url.origin !== CANONICAL_SUPABASE_ORIGIN) return fetch(input, init);
      const proxiedUrl = `/supabase${url.pathname}${url.search}${url.hash}`;
      const proxiedInput = input instanceof Request ? new Request(proxiedUrl, input) : proxiedUrl;
      return fetch(proxiedInput, init);
    }
  : undefined;
// Raw REST/Storage helpers outside the Supabase JS client must use the same
// development proxy as the client itself. Production keeps the native fetch
// path, while localhost routes the self-host origin through Vite's /supabase
// proxy (avoiding local certificate interception by endpoint filters).
export function fetchSupabase(input, init) {
  return devSupabaseFetch ? devSupabaseFetch(input, init) : fetch(input, init);
}
export const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { storageKey: SUPABASE_AUTH_STORAGE_KEY },
      global: devSupabaseFetch ? { fetch: devSupabaseFetch } : undefined
    })
  : null;

// Supabase Auth butuh format email; akun PLN login pakai username pendek,
// jadi kita tempelkan domain sintetis di belakangnya.
const AUTH_EMAIL_DOMAIN = "@warnoto.pln.local";
export function usernameToAuthEmail(username) { return `${(username||"").trim().toLowerCase()}${AUTH_EMAIL_DOMAIN}`; }

// Login hanya boleh diulang untuk gangguan server/jaringan yang sementara.
// Error 4xx (termasuk 429) selalu dianggap final agar retry tidak memperburuk
// rate-limit atau menyamarkan kredensial yang memang salah.
export function isRetryableLoginError(error) {
  const rawStatus = error?.status ?? error?.statusCode;
  const status = Number(rawStatus);
  const hasStatus = rawStatus !== undefined && rawStatus !== null && rawStatus !== "" && Number.isFinite(status);
  if (hasStatus && status >= 400 && status < 500) return false;
  if (hasStatus && status >= 500) return true;
  if (hasStatus && status !== 0) return false;
  const message = String(error?.message || error || "").toLowerCase();
  return /failed to fetch|fetch failed|network|timeout|connection|load fail(?:ed|ure)/.test(message);
}

// Pesan login membedakan kredensial, pembatasan akun, dan gangguan server/jaringan
// tanpa membeberkan detail respons Auth ke pengguna.
export function describeLoginError(error) {
  const message = String(error?.message || "").toLowerCase();
  const status = Number(error?.status || 0);
  if (status === 429 || message.includes("rate limit") || message.includes("too many")) return "Terlalu banyak percobaan masuk. Tunggu sebentar lalu coba lagi.";
  if (status >= 500 || message.includes("failed to fetch") || message.includes("network") || message.includes("timeout")) return "Server login sedang tidak dapat dihubungi. Periksa koneksi lalu coba lagi.";
  if (message.includes("email not confirmed")) return "Akun ini belum aktif. Hubungi Admin.";
  if (message.includes("banned") || message.includes("disabled")) return "Akun ini tidak aktif. Hubungi Admin.";
  if (status === 400 || status === 401 || message.includes("invalid login credentials") || message.includes("invalid credentials")) return "Username atau password salah.";
  return "Login belum berhasil. Coba lagi atau hubungi Admin bila masalah berlanjut.";
}
