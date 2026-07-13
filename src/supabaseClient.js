// Supabase client + helper email auth — dipindah dari App.jsx (refactor Fase 1).
// Satu client dipakai untuk auth (login/sesi/logout) maupun REST sync
// (tug15_history, stock_current, dst). SUPABASE_URL/SUPABASE_KEY diekspor
// karena fungsi sync di App.jsx memakainya langsung untuk fetch REST.
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Supabase Auth butuh format email; akun PLN login pakai username pendek,
// jadi kita tempelkan domain sintetis di belakangnya.
const AUTH_EMAIL_DOMAIN = "@warnoto.pln.local";
export function usernameToAuthEmail(username) { return `${(username||"").trim().toLowerCase()}${AUTH_EMAIL_DOMAIN}`; }
