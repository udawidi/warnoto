# WARNOTO — Environment Staging

Dibangun 2026-09-04. Dokumen ini adalah runbook operasional staging. Status ringkas ada di
`HANDOFF.md` bagian "Status sekarang"; yang di sini adalah detail cara pakai dan cara memperbaiki.

---

## 1. Kenapa ada staging

Sebelum ini setiap perubahan langsung mendarat di production, dipakai petugas gudang yang sama.
Staging memberi tempat mencoba: aplikasi yang sama, **database berbeda**. Rusak di staging tidak
mengganggu siapa pun.

Yang membuat staging berarti bukan frontend-nya — itu gratis di Vercel — tapi database terpisah.
Tanpa DB terpisah, "staging" hanyalah production dengan nama lain.

---

## 2. Peta

```
                  browser
                     |
        +------------+------------------+
        |                               |
   PRODUCTION                       STAGING
   pln.warnoto.com            Vercel Preview (branch `staging`)
        |                               |
   warnoto.com                api-staging.warnoto.com
   (tunnel minipc                (tunnel pve-gudang
    608c0d32-...)                 5f8e099c-...)
        |                               |
   minipc-gudang                  pve-gudang / LXC 101
   10.91.20.202                   10.91.21.242
   vps-dr-stack                   warnoto-staging-supabase
```

| | Production | Staging |
|---|---|---|
| Host | `minipc-gudang` (10.91.20.202) | LXC `101` di `pve-gudang` (10.91.21.242) |
| Endpoint | `https://warnoto.com` | `https://api-staging.warnoto.com` |
| Frontend | `pln.warnoto.com` (branch `main`) | Vercel Preview (branch `staging`) |
| Stack | `~/vps-dr-stack` | `/root/warnoto-staging-supabase` |
| Data | asli | salinan dump, bisa dibuang kapan saja |

Spesifikasi LXC: 4 core, 6GB RAM, 40GB disk, Debian 13, `onboot=1`, Docker 29.7.2.
Container Supabase memakai `restart: unless-stopped`, jadi ikut hidup setelah reboot.

---

## 3. Alur kerja harian

```bash
git checkout staging
git merge main          # atau kerjakan langsung di staging
git push origin staging
```

Vercel otomatis membangun preview. Ambil URL-nya:

```bash
vercel ls --meta githubCommitRef=staging
```

Buka, uji, dan kalau sudah beres barulah merge ke `main`. Login memakai akun yang sama seperti
production (ikut tersalin), tapi datanya salinan.

Branch `staging` disamakan dengan `main` lewat fast-forward, bukan force-push:

```bash
git branch -f staging main && git push origin staging
```

---

## 4. Pengaman yang sudah terpasang

**Semua secret staging berbeda dari production.** `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`,
`SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `VAULT_ENC_KEY`,
`DASHBOARD_PASSWORD` — dirotasi lewat `utils/generate-keys.sh` dan `utils/add-new-auth-keys.sh`.
Kredensial production tidak pernah dipakai di staging.

**Integrasi keluar sengaja dikosongkan** di `.env` staging:

```
FONNTE_TOKEN=          # WhatsApp
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
SMTP_USER=
SMTP_PASS=
```

Artinya salah pencet di staging **tidak bisa** mengirim pesan ke petugas gudang asli.
**Jangan pernah mengisi ini dengan token production.** Kalau perlu menguji notifikasi, pakai
token/nomor uji terpisah.

**Sesi browser terpisah.** `SUPABASE_AUTH_STORAGE_KEY` bernilai `sb-warnoto-staging-auth-token`
di staging, berbeda dari `sb-warnoto-auth-token` di production. Tanpa ini, token production
terbawa ke tab staging (JWT_SECRET berbeda) dan memicu banjir 401 "sesi login berakhir".

**Guard host aplikasi.** `src/supabaseClient.js` menolak endpoint di luar daftar putih:

```js
const ALLOWED_SUPABASE_HOSTS = ["warnoto.com", "api-staging.warnoto.com"];
```

Daftar ini **wajib literal**. Jangan diganti `endsWith("warnoto.com")` atau regex longgar —
`endsWith` akan meloloskan domain jahat seperti `evilwarnoto.com`. Kalau nanti ada environment
baru, tambahkan host-nya sebagai entri literal.

---

## 5. Menyegarkan data staging

Data staging = salinan dump production dan akan basi. Backup production sudah berjalan tiap jam,
jadi tidak perlu membuat dump baru — cukup ambil yang terakhir.

**Langkah 1 — dari `minipc-gudang`:**

```bash
PUB=$(ls -t ~/vps-backup/dumps/*.dump | head -1)
AUTH=$(ls -t ~/vps-backup/dumps-auth-storage/*.dump | head -1)
scp -i ~/.ssh/id_ed25519_lxc "$PUB" "$AUTH" root@10.91.21.242:/root/staging-seed/
```

**Langkah 2 — di LXC staging:**

```bash
ssh pve-gudang-home "pct exec 101 -- bash /root/staging-seed/refresh-staging.sh"
```

Skrip akan mengosongkan schema `public` staging lalu me-restore ulang. Di akhir tercetak
`users=<n>` dan `tabel_public=<n>`; keduanya harus bukan nol.

Sisi production hanya dibaca (`scp` dari folder backup), tidak pernah ditulis.

---

## 6. Perintah operasional

```bash
# status container staging
ssh pve-gudang-home "pct exec 101 -- bash -c 'cd /root/warnoto-staging-supabase && docker compose ps'"

# log satu service
ssh pve-gudang-home "pct exec 101 -- docker logs --tail 50 supabase-auth"

# hidupkan ulang stack
ssh pve-gudang-home "pct exec 101 -- bash -c 'cd /root/warnoto-staging-supabase && docker compose up -d'"

# cek endpoint dari luar (401 = hidup, minta apikey)
curl -s -o /dev/null -w "%{http_code}\n" https://api-staging.warnoto.com/rest/v1/

# cek satu tabel (butuh publishable key staging)
curl -s -H "apikey: <SUPABASE_PUBLISHABLE_KEY staging>" \
  "https://api-staging.warnoto.com/rest/v1/katalog?select=*&limit=1"
```

Ambil publishable key staging:

```bash
ssh pve-gudang-home "pct exec 101 -- grep SUPABASE_PUBLISHABLE_KEY /root/warnoto-staging-supabase/.env"
```

---

## 7. Environment variable di Vercel

Tiga rak terpisah. Yang diubah hanya **Preview**:

| Rak | Dipakai saat | `VITE_SUPABASE_URL` |
|---|---|---|
| Production | `pln.warnoto.com` | production — **jangan disentuh** |
| Preview | push ke branch `staging` | `https://api-staging.warnoto.com` |
| Development | `npm run dev` | production |

Tiap rak punya record sendiri, jadi mengubah Preview tidak menyentuh Production:

```bash
vercel env ls
vercel env rm VITE_SUPABASE_URL preview --yes
printf 'https://api-staging.warnoto.com' | vercel env add VITE_SUPABASE_URL preview
```

Perubahan env tidak memicu build ulang otomatis — push commit baru ke `staging` supaya terpakai.

---

## 8. Gotcha yang sudah menghabiskan waktu

**`/rest/v1/` root membalas 403 walau apikey benar.** Itu perilaku yang dirancang — route root
PostgREST di `volumes/api/kong.yml` memang `admin only`. Uji memakai path tabel
(`/rest/v1/katalog?limit=1`), bukan root.

**Pull image Docker dari dalam LXC selalu timeout.** Ambil dari minipc lewat LAN:

```bash
# dari minipc-gudang
IMGS=$(cd ~/vps-dr-stack && docker compose config --images | sort -u | tr '\n' ' ')
docker save $IMGS | ssh -i ~/.ssh/id_ed25519_lxc root@10.91.21.242 'docker load'
```

Image besar (`supabase/studio`) kadang putus di tengah — ulangi per image, `docker load` idempoten.

**URL preview Vercel dilindungi SSO.** `curl` anonim membalas `302`, bukan HTML. Untuk memverifikasi
bundle, bangun lokal dengan env yang sama lalu periksa hasilnya:

```bash
VITE_SUPABASE_URL="https://api-staging.warnoto.com" \
VITE_SUPABASE_PUBLISHABLE_KEY="<key staging>" \
npx vite build --outDir dist-cek-staging --emptyOutDir
grep -rhoE 'https://(api-staging\.)?warnoto\.com' dist-cek-staging/assets/*.js | sort | uniq -c
```

**Error CSP di konsol preview bukan bug aplikasi.** Dua ini normal dan boleh diabaikan:

```
Refused to load the script 'https://vercel.live/_next-live/feedback/feedback.js'
Refused to load manifest from 'https://vercel.com/sso-api?...'
```

Keduanya milik toolbar dan proteksi login Vercel, bukan kode WARNOTO. **Jangan melubangi CSP
production demi menghilangkannya.** `connect-src` sudah memuat `https://*.warnoto.com` dan
`wss://*.warnoto.com`, jadi endpoint staging lolos tanpa perubahan `vercel.json` sama sekali.

**`volumes/storage` tidak disalin.** 674MB foto material sengaja ditinggal. Fitur yang menampilkan
foto akan kosong di staging. Kalau suatu saat perlu, salin folder itu dari minipc dengan cara yang
sama seperti image Docker.

**Beberapa perintah diblokir asisten AI.** Restore database, membaca `.env` server, dan
`vercel env pull` ditolak classifier karena menulis data massal / membaca kredensial. Perintahnya
disediakan di dokumen ini untuk dijalankan manual oleh manusia.

---

## 9. Batas yang tidak boleh dilanggar

- **Jangan menyentuh tunnel `608c0d32-...`** di minipc — itu API production. Tunnel staging adalah
  `5f8e099c-...` di pve-gudang.
- **Jangan menyentuh LXC `100 warnoto-standby`** di pve-gudang — itu warm standby database
  production, jaring pengaman failover.
- **Jangan mengisi token integrasi production** ke `.env` staging.
- **Jangan mengubah rak Production/Development** di Vercel saat mengurus staging.
- Staging berisi **salinan data PLN yang asli**. Aksesnya dibatasi apikey dan login; jangan
  membagikan endpoint atau `SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY` staging ke luar.

---

## 10. Berkas di server staging

```
/root/warnoto-staging-supabase/   stack Supabase (docker compose + .env)
/root/staging-seed/
    README.md                     ringkasan singkat di server
    restore.sh                    restore dump ke DB staging
    refresh-staging.sh            kosongkan public lalu restore ulang
    *.dump                        dump production terakhir yang disalin
```
