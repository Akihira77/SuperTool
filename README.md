# Super Tool

Satu aplikasi web lokal untuk delapan kebutuhan harian developer: menulis Markdown, merapikan JSON, membuat tipe TypeScript, mencatat, membuka tool lain lewat URL, mengedit konfigurasi nginx, memantau port yang hidup, dan menjelajah file.

Semua berjalan di mesin sendiri. Tanpa database, tanpa layanan eksternal.

## Daftar tool

| # | Tool | Kegunaan |
|---|------|----------|
| 1 | Markdown | Editor + live preview, toolbar format, auto simpan ke browser |
| 2 | JSON | Formatter, minify, urutkan kunci, highlight, unduh |
| 3 | JSON ke TypeScript | Generate `interface` otomatis, array objek digabung |
| 4 | Catatan | Notepad tersimpan di server, autosave, pencarian |
| 5 | URL Viewer | Iframe untuk 9router/termix/docmost, cek koneksi, edit URL, mode proxy |
| 6 | Nginx | CRUD file konfigurasi, cadangan otomatis + kembalikan asli, `nginx -t`, klik kanan → jelaskan ke LLM |
| 7 | Port & Proses | Daftar port listening, tab proses ala htop, kill dengan konfirmasi, auto refresh |
| 8 | File Explorer | Tree, ukuran, viewer teks/kode/gambar/PDF/Markdown, upload, rename, hapus, tombol kembali |

## Tech stack

| Lapisan | Pilihan | Alasan |
|---------|---------|--------|
| Backend | NestJS 11 + TypeScript | Modul jelas per domain, dependency injection tipis |
| Frontend | React 19 + Vite + Tailwind CSS 4 | Bundel kecil, HMR cepat, styling tanpa file konfigurasi |
| Auth | Cookie HttpOnly + token HMAC (`node:crypto`) | Tanpa JWT lib, tanpa session store |
| Data | File JSON atomik | Tanpa database untuk single user |
| Markdown | `marked` + `DOMPurify` | Dua dependency ini wajib: parsing + sanitasi XSS |

Dependency runtime sengaja minim: backend hanya paket inti Nest, frontend hanya React, `marked`, dan `DOMPurify`.

## Menjalankan

Prasyarat: Node.js 20+ dan pnpm 9+.

~~~bash
git clone <repo> super-tool && cd super-tool
pnpm install
cp apps/api/.env.example apps/api/.env   # opsional, semua ada default
pnpm dev
~~~

- UI dev: http://localhost:5173 (Vite mem-proxy `/api` ke port 3001)
- API: http://127.0.0.1:3001

Mode produksi (UI dan API satu port, dilayani Nest):

~~~bash
pnpm build
pnpm start
# buka http://127.0.0.1:3001
~~~

Login pertama memakai password `password`, lalu aplikasi **wajib** meminta password baru sebelum tool bisa dipakai.

## Konfigurasi

Semua lewat environment variable atau file `apps/api/.env` (dimuat dengan `process.loadEnvFile` bawaan Node).

| Variabel | Default | Arti |
|----------|---------|------|
| `ST_PORT` | `3001` | Port server |
| `ST_HOST` | `127.0.0.1` | Alamat bind. Pakai `0.0.0.0` kalau mau diakses dari LAN |
| `ST_DATA_DIR` | `~/.local/share/super-tool` | Lokasi `auth.json`, `notes.json`, dan cadangannya |
| `ST_FS_ROOTS` | home user | Folder yang boleh diakses File Explorer, dipisah `:` |
| `ST_NGINX_DIR` | `/etc/nginx` | Folder konfigurasi nginx |
| `ST_PROXY_ALLOW_PUBLIC` | `0` | `1` = proxy boleh ke host publik (default hanya localhost/jaringan privat) |
| `ST_LLM_BASE_URL` | `http://127.0.0.1:20128/v1` | Endpoint kompatibel OpenAI (9router, ollama, dll) |
| `ST_LLM_MODEL` | kosong | Model default; bisa juga dipilih dari UI |
| `ST_LLM_API_KEY` | kosong | API key bila provider mewajibkan |
| `ST_WEB_DIST` | `../web/dist` | Lokasi hasil build frontend |
| `ST_DEV_ORIGIN` | `http://localhost:5173` | Origin yang diizinkan CORS saat dev |

Contoh untuk mengakses dua folder:

~~~bash
ST_FS_ROOTS=/home/akihira17:/srv/data pnpm start
~~~

Membaca `/etc/nginx` butuh izin baca. Kalau server jalan sebagai user biasa dan file tidak terbaca, arahkan `ST_NGINX_DIR` ke salinan konfigurasi, atau jalankan lewat `systemd` dengan user yang sesuai.

## Data dan cadangan

Semua data pengguna disimpan di **luar folder project**:

- `~/.local/share/super-tool/auth.json` — hash password
- `~/.local/share/super-tool/notes.json` — catatan
- `*.bak` — salinan versi sebelumnya, ditulis ulang setiap penyimpanan

Jadi `git clean`, `rm -rf node_modules`, atau hapus folder project tidak menyentuh data. Pindahkan dengan env `ST_DATA_DIR` bila perlu.

Catatan disimpan sebagai file JSON (bukan database). Kalau nanti butuh pencarian/riwayat lebih serius, jalur upgrade-nya `node:sqlite` — bawaan Node, tanpa dependensi baru.

## Fitur "jelaskan ke LLM"

Di menu Nginx, **klik kanan** di editor → *Jelaskan ke LLM*. Kalau ada teks terseleksi, teks itu yang dikirim; kalau tidak, kata di posisi kursor (atau barisnya) yang dipakai. Hasilnya muncul di panel samping kanan editor.

Butuh endpoint kompatibel OpenAI:

1. Isi **model** dan **API key** di toolbar Nginx (disimpan di browser), atau
2. Set lewat env: `ST_LLM_BASE_URL`, `ST_LLM_MODEL`, `ST_LLM_API_KEY`.

Daftar model diambil otomatis dari `/models` (contoh 9router di port 20128, ollama di `http://127.0.0.1:11434/v1`).

## Keamanan

- Password disimpan sebagai hash `scrypt` (salt acak per password), bukan plaintext.
- Password default `password` hanya dipakai sekali; sesi berikutnya dipaksa ganti (`PASSWORD_CHANGE_REQUIRED` di semua endpoint).
- Sesi berupa cookie `HttpOnly` + `SameSite=Lax`, ditandatangani HMAC-SHA256, berisi versi password (`pv`) sehingga ganti password otomatis membatalkan semua token lama.
- Semua request pengubah (`POST/PUT/DELETE`) wajib menyertakan header `X-ST-CSRF: 1`.
- Login dibatasi 6 percobaan per 10 menit per IP.
- Semua path File Explorer dipaksa berada di dalam `ST_FS_ROOTS`, termasuk pemeriksaan symlink (tidak bisa kabur lewat `..` atau link).
- Proxy URL hanya boleh ke `localhost`/IP privat; `169.254.x.x` (metadata cloud) dan host publik ditolak kecuali diaktifkan.
- Header `X-Frame-Options`/`CSP` dari target dilepas hanya pada endpoint proxy, bukan pada aplikasi ini.

Aplikasi ini alat pribadi. Jangan bind ke `0.0.0.0` lalu membukanya ke internet tanpa reverse proxy + HTTPS.

## Struktur project

~~~text
super-tool/
├── apps/
│   ├── api/                 # NestJS
│   │   └── src/
│   │       ├── main.ts      # bootstrap, static SPA, body limit
│   │       ├── config.ts    # semua env di satu tempat
│   │       ├── app.module.ts
│   │       ├── common/      # json-store, token, fs-jail, decorator
│   │       └── modules/     # auth, notes, files, ports, nginx, proxy
│   └── web/                 # React + Vite + Tailwind
│       └── src/
│           ├── App.tsx      # shell + sidebar + auth gate
│           ├── lib/         # api client, router, json2ts, markdown, format
│           ├── components/  # ui, CodeEditor, Login, ChangePassword
│           └── tools/       # satu file per tool (lazy loaded)
├── docs/                    # arsitektur & referensi API
├── pnpm-workspace.yaml
└── package.json
~~~

Detail arsitektur: [docs/arsitektur.md](docs/arsitektur.md). Referensi endpoint: [docs/api.md](docs/api.md).

## Skrip

| Perintah | Fungsi |
|----------|--------|
| `pnpm dev` | API (watch) + Vite bersamaan |
| `pnpm build` | Build frontend lalu backend |
| `pnpm start` | Jalankan hasil build |
| `pnpm typecheck` | `tsc --noEmit` di semua paket |
| `pnpm check` | Build + uji mandiri (token HMAC & pembatas path) |

## Batasan yang diketahui

- **URL Viewer**: iframe biasa bekerja untuk tool yang tidak mengirim `X-Frame-Options`. Mode `Proxy` melepas header tersebut dan menyuntik `<base>`, cukup untuk halaman statis; aplikasi SPA yang memanggil API ke origin aslinya tetap butuh reverse proxy sungguhan (nginx/caddy). Untuk pemakaian penuh, arahkan subdomain ke tool tersebut.
- **Catatan**: disimpan sebagai satu file JSON. Cukup untuk satu pengguna; pindahkan ke SQLite kalau butuh penulis bersamaan atau ribuan catatan.
- **Port viewer**: memakai perintah `ss` (paket `iproute2`). Di sistem tanpa `ss`, endpoint mengembalikan pesan error yang jelas. Aksi *kill* mengirim SIGTERM (bukan SIGKILL) dan menolak PID 1 serta proses server ini sendiri.
- **URL Viewer**: preset memakai `127.0.0.1`, bukan `localhost`. Service yang hanya bind IPv4 akan gagal kalau browser memilih `::1` — ini penyebab error "localhost refused to connect". URL lama di browser otomatis dibenahi saat dibuka.
- **Mode Proxy**: membuka target lewat `/api/proxy/b/<token>/...` — header `X-Frame-Options`/CSP dilepas, aset relatif ikut di-proxy, cookie & WebSocket diteruskan. Ini yang membuat Termix (`X-Frame-Options: DENY`) bisa tampil di iframe. Aplikasi yang memanggil API dengan path absolut `/api/...` tetap perlu reverse proxy sungguhan.
- **Jaringan proxy**: hostname di-resolve dulu; hanya alamat loopback/privat/CGNAT yang diizinkan (misal `theAkihira:4096`). Host publik tetap diblokir kecuali `ST_PROXY_ALLOW_PUBLIC=1`.
- **Nginx**: setiap penyimpanan pertama membuat `<file>.bak`; tombol *Kembalikan asli* memulihkan dari cadangan itu lalu menghapusnya.
- **File Explorer**: daftar folder dibatasi 2000 entri dan pencarian 200 hasil agar UI tetap responsif.

## Lisensi

MIT.
