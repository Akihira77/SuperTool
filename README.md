# Super Tool

Satu aplikasi web lokal untuk kebutuhan harian developer: menulis Markdown, merapikan JSON, membuat tipe TypeScript, mencatat, membuka tool lain lewat URL, mengedit konfigurasi nginx, memantau port, menjelajah file (termasuk pratinjau & edit Office, audio, video), mengompres/mengonversi berkas, dan ruang kerja developer (regex, hash, HTTP client, log, docker, git, cron, DNS).

Semua berjalan di mesin sendiri. Data (password, catatan, daftar URL) di SQLite lokal; isi berkas tetap di disk.

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
| 8 | File Explorer | Tree, ukuran, viewer teks/kode/gambar/PDF/Markdown, pratinjau + edit docx/xlsx, pemutar audio & video, pencarian isi berkas (grep), upload, rename, hapus |
| 9 | Kompresor | Kompres gambar & PDF, konversi gambar↔PDF dan antar format gambar, drag & drop, proses latar belakang |
| 10 | Dev Space | Regex tester, encode/decode + hash, HTTP client, log tailer (live), docker read-only, git status, cron manager, DNS/IP lookup |

## Tech stack

| Lapisan | Pilihan | Alasan |
|---------|---------|--------|
| Backend | NestJS 11 + TypeScript | Modul jelas per domain, dependency injection tipis |
| Frontend | React 19 + Vite + Tailwind CSS 4 | Bundel kecil, HMR cepat, styling tanpa file konfigurasi |
| Auth | Cookie HttpOnly + token HMAC (`node:crypto`) | Tanpa JWT lib, tanpa session store |
| Data | SQLite (`node:sqlite`) | Bawaan Node, tanpa dependensi tambahan |
| Markdown | `marked` + `DOMPurify` | Dua dependency ini wajib: parsing + sanitasi XSS |
| Gambar | `sharp` | Codec gambar cepat (libvips), tanpa proses eksternal |
| PDF | `pdf-lib` | Baca/tulis PDF murni JS, aman untuk simpan-ulang |
| Office | ZIP + regex sendiri (`zip.ts`, `office.ts`) | docx/xlsx/pptx/odt/ods/odp tanpa library berat |

Dependency runtime sengaja minim: backend hanya paket inti Nest, `sharp`, `pdf-lib`; frontend hanya React, `marked`, dan `DOMPurify`.

## Alat eksternal (opsional, menaikkan kemampuan)

Beberapa fitur memakai binary sistem. Tanpa binary itu aplikasi tetap jalan, hanya fiturnya berkurang, dan UI menampilkan pesan yang jelas.

~~~bash
# Debian/Ubuntu/WSL
sudo apt update
sudo apt install -y ghostscript poppler-utils cron iproute2 docker.io
~~~

| Binary | Dipakai untuk | Kalau tidak ada |
|--------|---------------|-----------------|
| `gs` (ghostscript) | kompres PDF besar (streaming, hemat RAM) | PDF hanya disimpan ulang lewat pdf-lib, penghematan kecil |
| `pdftoppm` (poppler-utils) | konversi PDF → gambar | tab Konversi untuk PDF dinonaktifkan |
| `docker` | tab Docker (read-only) | tab menampilkan pesan error |
| `git` | tab Git Status | tab menampilkan pesan error |
| `cron` | tab Cron Job | daftar kosong, penambahan gagal dengan pesan jelas |
| `grep` | pencarian isi berkas | pencarian isi tidak berfungsi (pencarian nama tetap jalan) |
| `ss` (iproute2) | daftar port | tab Port kosong |

**Ghostscript di WSL:** instal lewat apt (perintah di atas). Cek dengan `gs --version`. Kalau server dijalankan lewat systemd/PM2 di dalam WSL, PATH biasanya sudah memuat `/usr/bin`. Setelah terpasang, `GET /api/compress/info` berubah menjadi `"pdf": "ghostscript"` dan kompresor otomatis memakai jalur streaming (berkas tidak dimuat penuh ke RAM).

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
| `ST_DATA_DIR` | `~/.local/share/super-tool` | Lokasi `super-tool.db` (SQLite) dan cadangannya |
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

Semua data pengguna disimpan di **satu database SQLite** di luar folder project:

- `~/.local/share/super-tool/super-tool.db`
- `super-tool.db.bak` — salinan utuh yang dibuat setiap aplikasi start (`VACUUM INTO`)

Tabelnya:

| Tabel | Isi |
|-------|-----|
| `account` | salt, hash password (scrypt), versi sesi, wajib-ganti, secret HMAC |
| `notes` | catatan |
| `urls` | daftar URL di URL Viewer |
| `recent_paths` | path yang pernah dibuka per tool (nginx, file explorer) |

Yang **tidak** masuk database: isi file itu sendiri. Konfigurasi nginx dan isi file explorer tetap di disk — database hanya mencatat path-nya.

`git clean`, `rm -rf node_modules`, atau hapus folder project tidak menyentuh data. Pindahkan dengan env `ST_DATA_DIR` bila perlu.

## Fitur "jelaskan ke LLM"

Di menu Nginx, **klik kanan** di editor → *Jelaskan ke LLM*. Kalau ada teks terseleksi, teks itu yang dikirim; kalau tidak, kata di posisi kursor (atau barisnya) yang dipakai. Hasilnya muncul di panel samping kanan editor.

Butuh endpoint kompatibel OpenAI:

1. Isi **model** dan **API key** di toolbar Nginx (disimpan di browser), atau
2. Set lewat env: `ST_LLM_BASE_URL`, `ST_LLM_MODEL`, `ST_LLM_API_KEY`.

Daftar model diambil otomatis dari `/models` (contoh 9router di port 20128, ollama di `http://127.0.0.1:11434/v1`).

## Pratinjau & edit Office

File Explorer membuka docx, xlsx, pptx, odt, ods, dan odp tanpa library eksternal: berkas OOXML/ODF adalah ZIP berisi XML, dan `apps/api/src/modules/files/zip.ts` membaca serta menulis ulang ZIP itu sendiri.

| Format | Baca | Edit |
|--------|------|------|
| docx | paragraf + tabel | teks paragraf (1:1, jumlah paragraf tidak boleh berubah) |
| xlsx | tabel per sheet | nilai sel (angka atau teks) |
| pptx | teks per slide | - |
| odt / ods / odp | teks / tabel | - |

Saat menyimpan, isi lama disalin dulu ke `<nama>_backup_<YYYYMMDD-HHMMSS>.<ext>` di folder yang sama. Lima cadangan terbaru disimpan, sisanya dihapus otomatis. Berkas asli baru ditimpa setelah cadangan selesai dibuat.

**Kenapa tidak OnlyOffice?** OnlyOffice bukan library npm, melainkan Document Server terpisah (Docker, ~2 GB RAM) yang menyajikan editor WYSIWYG lewat iframe. Untuk mesin ini pratinjau + edit teks di atas sudah cukup dan tetap jalan tanpa container. Kalau nanti butuh edit visual penuh, pola yang dipakai sama seperti URL Viewer: jalankan Document Server, lalu tambahkan URL-nya sebagai entri di tool URL Viewer (mode proxy kalau header iframe diblokir).

## Audio & video

File Explorer memutar mp3, wav, ogg, m4a, aac, flac, opus, mp4, webm, mkv, mov lewat `GET /api/fs/raw` yang mendukung HTTP Range, jadi video bisa di-seek tanpa mengunduh seluruh berkas.

## Kompresor

- **Kompres**: gambar (kualitas + lebar maksimum + format keluaran) dan PDF. Hasil ditulis sebagai `<nama>-min.<ext>`.
- **Konversi**: gambar → PDF, PDF → PNG/JPG, dan antar format gambar. Hasil `<nama>-conv.<ext>` atau `<nama>-page-N.png`.
- Proses berjalan sebagai job di latar belakang: `POST /api/compress/*` langsung mengembalikan `jobId`, UI memantau `GET /api/compress/job?id=`. Halaman tidak terkunci dan ada indikator progres.
- Drag & drop mengunggah berkas ke `<root>/.super-tool-drop` lalu memprosesnya dari folder itu.
- Berkas rusak atau terkunci password menghasilkan pesan seperti "Berkas terkunci password, tidak bisa diproses", bukan halaman kosong.

## Dev Space

| Tab | Endpoint | Catatan |
|-----|----------|---------|
| Regex Tester | - | jalan di browser, highlight + grup + hasil replace |
| Encode/Decode & Hash | `POST /api/dev/hash` | base64, URL, HTML entity, JWT decode di browser; MD5/SHA/HMAC di server |
| HTTP Client | `POST /api/dev/http` | seperti curl ringan: method, header, body, timeout. Alamat metadata cloud (169.254.169.254) diblokir |
| Log Tailer | `GET /api/dev/logs`, `GET /api/dev/logs/stream` | tail 300 baris, mode live pakai SSE, filter teks |
| Docker | `GET /api/dev/docker` | read-only: `docker ps`, `docker images`, `docker logs --tail 300` |
| Git Status | `GET /api/dev/git` | branch, ahead/behind, staged/changed/untracked, 10 commit terakhir, diff stat |
| Cron Job | `GET/POST/DELETE /api/dev/cron` | `crontab -l`, tambah baris, hapus per indeks |
| DNS/IP Lookup | `GET /api/dev/dns` | A, AAAA, MX, CNAME, NS, TXT + lokasi lewat ip-api.com |

Tab Cron mengubah crontab milik user yang menjalankan server. Di WSL tanpa cron daemon aktif, jadwal tetap tersimpan tapi tidak dieksekusi sampai `sudo service cron start`.

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
│   │       ├── common/      # db (sqlite), token, fs-jail, net-guard
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
- **Catatan**: sudah di SQLite, tapi belum ada pencarian penuh (FTS5) di dalam isi catatan.
- **Port viewer**: memakai perintah `ss` (paket `iproute2`). Di sistem tanpa `ss`, endpoint mengembalikan pesan error yang jelas. Aksi *kill* mengirim SIGTERM (bukan SIGKILL) dan menolak PID 1 serta proses server ini sendiri.
- **URL Viewer**: preset memakai `127.0.0.1`, bukan `localhost`. Service yang hanya bind IPv4 akan gagal kalau browser memilih `::1` — ini penyebab error "localhost refused to connect". URL lama di browser otomatis dibenahi saat dibuka.
- **Mode Proxy**: membuka target lewat `/api/proxy/b/<token>/...` — header `X-Frame-Options`/CSP dilepas, aset relatif ikut di-proxy, cookie & WebSocket diteruskan. Ini yang membuat Termix (`X-Frame-Options: DENY`) bisa tampil di iframe. Aplikasi yang memanggil API dengan path absolut `/api/...` tetap perlu reverse proxy sungguhan.
- **Jaringan proxy**: hostname di-resolve dulu; hanya alamat loopback/privat/CGNAT yang diizinkan (misal `theAkihira:4096`). Host publik tetap diblokir kecuali `ST_PROXY_ALLOW_PUBLIC=1`.
- **Nginx**: setiap penyimpanan pertama membuat `<file>.bak`; tombol *Kembalikan asli* memulihkan dari cadangan itu lalu menghapusnya.
- **File Explorer**: daftar folder dibatasi 2000 entri dan pencarian 200 hasil agar UI tetap responsif. Pencarian isi berkas memakai `grep -rIn`, melewati berkas biner (docx/xlsx tidak ikut), dibatasi 300 hasil.
- **Edit Office**: hanya teks paragraf (docx) dan nilai sel (xlsx). Jumlah paragraf tidak boleh berubah — menambah atau menghapus paragraf belum didukung, dan aplikasinya menolak dengan pesan jelas. Format pptx/odt/ods/odp hanya bisa dibaca.
- **Kompres PDF**: tanpa ghostscript, pdf-lib memuat seluruh berkas ke memori (batas 200 MB) dan penghematannya kecil. Dengan ghostscript proses berjalan sebagai subprocess streaming. Instalasi ghostscript ada di bagian *Alat eksternal*.
- **Konversi PDF → gambar**: memecah 3 halaman pertama per proses, butuh `pdftoppm`. Hasilnya gambar per halaman, bukan PDF baru.
- **Cron**: mengubah crontab user yang menjalankan server; butuh izin tulis ke `/var/spool/cron`. Di sandbox/container tanpa cron, penulisan ditolak dengan pesan jelas.
- **DNS lookup**: lokasi server memakai ip-api.com (HTTP, tanpa API key) sehingga butuh internet; tanpa internet record DNS tetap tampil.
- **Docker**: hanya baca (ps/images/logs). Tombol start/stop sengaja tidak ada.
- **HTTP Client**: mengizinkan host publik seperti curl, kecuali alamat metadata cloud. Cookie dan otentikasi tidak disimpan antar request.

## Lisensi

MIT.
