# Super Tool

Satu aplikasi web lokal untuk kebutuhan harian developer: menulis Markdown, merapikan JSON, membuat tipe TypeScript, mencatat, membuka tool lain lewat URL, mengedit konfigurasi nginx, memantau port dan pemakaian disk, menjelajah file (termasuk pratinjau & edit Office, audio, video), mengompres/mengonversi berkas, mengunduh video/audio, dan ruang kerja developer (regex, hash, HTTP client, log, docker, git, cron, DNS).

Semua berjalan di mesin sendiri. Data (password, catatan, daftar URL) di SQLite lokal; isi berkas tetap di disk. Susunan tab multi sesi disimpan di `localStorage` browser.

## Daftar tool

| # | Tool | Kegunaan |
|---|------|----------|
| 1 | Markdown | Editor + live preview, toolbar format, auto simpan ke browser |
| 2 | JSON | Formatter, minify, urutkan kunci, highlight, unduh |
| 3 | JSON ke TypeScript | Generate `interface` otomatis, array objek digabung |
| 4 | Catatan | Notepad tersimpan di server, autosave, pencarian, unduh catatan aktif sebagai `.md`, tab Text Compare dengan sorotan perbedaan baris/kata, riwayat hasil bandingkan (infinite scroll) |
| 5 | URL Viewer | Iframe untuk 9router/termix/docmost, cek koneksi, edit URL, mode proxy |
| 6 | Nginx | CRUD file konfigurasi, cadangan otomatis + kembalikan asli, `nginx -t`, klik kanan → jelaskan ke LLM |
| 7 | Port & Proses | Daftar port listening, tab proses ala htop, kill dengan konfirmasi, auto refresh |
| 8 | File Explorer | Tree, thumbnail gambar/video di daftar, ukuran, viewer teks/kode (virtual untuk berkas besar)/gambar/PDF/Markdown, pratinjau + edit docx/xlsx, pemutar audio & video global, pencarian nama/isi berkas (grep, bisa dibatalkan, exclude lewat dialog centang tipe berkas & folder), upload, rename, hapus |
| 9 | Kompresor | Kompres gambar & PDF, konversi gambar↔PDF dan antar format gambar, drag & drop, proses latar belakang |
| 10 | Dev Space | Regex tester, encode/decode + hash, HTTP client, log tailer (live), kontrol container Docker (start/stop/restart/hapus, cari & urutkan container/image), git status (grafik SVG + stage/unstage + diff), cron manager, DNS/IP lookup, SQLite viewer, Audit Log |
| 11 | Webhook Receiver | Endpoint siap salin, daftar request masuk live (SSE), detail header + body (JSON dirapikan), tombol Bersihkan |
| 12 | Calendar | Kalender visual bulan/minggu/agenda dari Google Calendar; tambah event, detail event, OAuth baca-tulis, auto-refresh 5 menit, pengingat pop-up + bell 1 jam/30/15 menit |
| 13 | Downloader | Cek link dulu (judul, thumbnail, durasi), pilih resolusi/audio, unduh MP4/MP3; streaming ke perangkat, tanpa file permanen di server |
| 14 | Settings | Unduh backup `.zip` (database + uploads), pulihkan dari file backup, info ukuran/tabel database |
| 15 | Storage Monitor | Treemap + tree ukuran folder home, urut terbesar, hapus folder aman (`node_modules`, `temp`, cache), bersihkan Docker |
| 16 | Telegram Command Center | Bot long polling: download URL YouTube/FB/Bilibili, kirim file langsung / link 0x0.st untuk file besar, kompres gambar/PDF lewat caption `/compress` |

## Multi sesi

Bar tab di atas area kerja menyimpan beberapa tool sekaligus, seperti tmux untuk panel web.

- Satu sesi per tool. Membuka tool yang sudah punya sesi akan mengaktifkan sesi itu, bukan membuat duplikat.
- Susunan sesi (daftar, urutan, nama, sesi aktif) disimpan di `localStorage` `st:sessions:v1` dan dipulihkan saat URL Super Tool dibuka lagi.
- Perubahan tab disinkronkan antar-tab browser lewat event `storage`, tanpa polling.
- Klik dua kali nama untuk mengganti nama, seret tab untuk mengurutkan, klik `x` atau klik tengah untuk menutup. Tombol `+` membuka tool baru.
- Sesi yang sudah pernah aktif tetap di-mount (tersembunyi) saat pindah tab, jadi scan, unduhan, SSE, atau terminal di sesi lama tidak batal. Sesi yang belum pernah dibuka baru di-mount saat pertama kali diaktifkan.
- Tool di dalam sesi tidak punya tab bertingkat. State internal tiap tool tidak disimpan per sesi; datanya tetap memakai sumber aslinya (server atau `localStorage` tool).

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
| Jadwal sholat | `adhan` (frontend) | Perhitungan astronomi lokal; tanpa API jadwal sholat |
| Kalender visual | `react-big-calendar` + `dayjs` | Bulan/minggu/agenda, lazy-load hanya di halaman Calendar |
| Downloader | `youtube-dl-exec` + `ffmpeg-static` | yt-dlp + ffmpeg dibundel di backend; streaming, tanpa simpan permanen |

Dependency runtime sengaja minim: backend hanya paket inti Nest, `sharp`, `pdf-lib`, plus binary downloader; frontend hanya React, `marked`, dan `DOMPurify`.

## Alat eksternal (opsional, menaikkan kemampuan)

Beberapa fitur memakai binary sistem. Tanpa binary itu aplikasi tetap jalan, hanya fiturnya berkurang, dan UI menampilkan pesan yang jelas.

~~~bash
# Debian/Ubuntu/WSL
sudo apt update
sudo apt install -y ghostscript poppler-utils ffmpeg cron iproute2 docker.io
~~~

| Binary | Dipakai untuk | Kalau tidak ada |
|--------|---------------|-----------------|
| `du` (coreutils) | Storage Monitor menghitung ukuran folder | endpoint storage membalas 503 dengan pesan jelas |
| `gs` (ghostscript) | kompres PDF besar (streaming ke disk, tanpa batas 200 MB) | hanya PDF ≤50 MB yang bisa disimpan ulang lewat pdf-lib; PDF besar ditolak dengan pesan jelas |
| `pdftoppm` (poppler-utils) | konversi PDF → gambar | tab Konversi untuk PDF dinonaktifkan |
| `docker` | tab Docker (ps/images/logs + kontrol container) | tab menampilkan pesan error; aksi start/stop/restart/hapus gagal dengan pesan jelas |
| `git` | tab Git Status | tab menampilkan pesan error |
| `cron` | tab Cron Job | daftar kosong, penambahan gagal dengan pesan jelas |
| `grep` | pencarian isi berkas | pencarian isi tidak berfungsi (pencarian nama tetap jalan) |
| `ss` (iproute2) | daftar port | tab Port kosong |
| `unzip` | restore backup `.zip` di Settings | tombol Pulihkan gagal dengan pesan jelas |
| `ffmpeg` | thumbnail video di File Explorer (frame detik ke-1) | thumbnail video diganti ikon berkas generik |

Downloader memakai `ffmpeg-static` bawaannya sendiri; tidak perlu `ffmpeg` sistem.

**Ghostscript di WSL:** instal lewat apt (perintah di atas). Cek dengan `gs --version`. Kalau server dijalankan lewat systemd/PM2 di dalam WSL, PATH biasanya sudah memuat `/usr/bin`. Setelah terpasang, `GET /api/compress/info` berubah menjadi `"pdf": "ghostscript"` dan kompresor otomatis memakai jalur streaming (berkas tidak dimuat penuh ke RAM). Tanpa ghostscript, fallback pdf-lib tetap dibatasi 50 MB agar RAM server tidak habis.

## Menjalankan

Prasyarat: Node.js 22.13+ (fitur `node:sqlite`) dan pnpm 9+. Jalankan `nvm use` untuk memakai versi di `.nvmrc`.

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
| `ST_LOG_ROOTS` | `/var/log` | Folder log yang boleh dibaca Log Tailer walau di luar `ST_FS_ROOTS` |
| `ST_LLM_BASE_URL` | `http://127.0.0.1:20128/v1` | Endpoint kompatibel OpenAI (9router, ollama, dll) |
| `ST_LLM_MODEL` | kosong | Model default; bisa juga dipilih dari UI |
| `ST_LLM_API_KEY` | kosong | API key bila provider mewajibkan |
| `ST_WEB_DIST` | `../web/dist` | Lokasi hasil build frontend |
| `ST_TEMP_DIR` | `temp/` di root repo | Folder kerja sementara yt-dlp dan upload besar; berkas upload dipindahkan, bukan disalin ke RAM |
| `ST_MAX_UPLOAD_BYTES` | `21474836480` (20 GB) | Batas maksimum satu berkas upload di File Explorer/Kompresor |
| `ST_DEV_ORIGIN` | kosong | Origin yang diizinkan CORS saat dev; kosong = CORS mati |
| `GOOGLE_CLIENT_ID` | kosong | OAuth client ID Google (Calendar) |
| `GOOGLE_CLIENT_SECRET` | kosong | OAuth client secret Google |
| `GOOGLE_REDIRECT_URI` | `http://127.0.0.1:<ST_PORT>/api/calendar/callback` | Redirect URI yang sama persis dengan Google Cloud Console |
| `TELEGRAM_BOT_TOKEN` | kosong | Token BotFather; kosong = Telegram Command Center nonaktif |
| `TELEGRAM_ALLOWED_CHAT_IDS` | kosong | Daftar chat ID yang boleh memakai bot, pisahkan koma. Kosong = semua chat (tidak disarankan) |

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
| `compare_history` | isi kiri/kanan + ringkasan hasil Text Compare |
| `urls` | daftar URL di URL Viewer |
| `recent_paths` | path yang pernah dibuka per tool (nginx, file explorer) |

Yang **tidak** masuk database: isi file itu sendiri. Konfigurasi nginx dan isi file explorer tetap di disk — database hanya mencatat path-nya.

Isi database bisa dilihat langsung di **Dev Space → Database**: daftar tabel + jumlah baris, pratinjau data dengan paging, dan kotak query bebas (SELECT/WITH/PRAGMA/EXPLAIN, maksimal 500 baris). Viewer memakai koneksi **read-only**; database berjalan di `journal_mode = WAL` dengan `busy_timeout`, jadi membuka viewer tidak mengunci aplikasi.

`git clean`, `rm -rf node_modules`, atau hapus folder project tidak menyentuh data. Pindahkan dengan env `ST_DATA_DIR` bila perlu.

### Backup & restore (halaman Settings)

Menu **Settings** punya dua bagian:

- **Backup data** — tombol **Unduh backup (.zip)** memanggil `GET /api/backup`. Isi arsip: `super-tool.db` (snapshot konsisten via `VACUUM INTO`, bukan salinan file WAL), `uploads/` bila folder itu ada, dan `backup.json` (metadata). Ukuran/tabel database ditampilkan di halaman ini.
- **Restore data** — pilih file `.zip` hasil backup, klik **Pulihkan sekarang** → modal konfirmasi → `POST /api/restore`. Berkas upload ditulis ke disk oleh multer (tidak ditampung di RAM), lalu server mengekstrak ke folder staging terpisah, menolak path `..`/absolut, symbolic link, entri di luar `super-tool.db`/`uploads`/`backup.json`, dan versi skema yang lebih baru; database diperiksa dengan `PRAGMA integrity_check` + `foreign_key_check` sebelum menyentuh data aktif. Database baru ditulis ke file sementara, di-`fsync`, lalu di-`rename` atomik (file lama disimpan sampai sukses); folder `uploads` ditukar dengan rollback bila penggantian database gagal. Cache auth/disk dibuang setelah sukses dan **sesi login lama berakhir** — setelah restore, login ulang. Restore yang gagal tidak meninggalkan database parsial. Aksi ini tidak bisa dibatalkan.

Batasan: backup tidak memuat isi file di disk (nginx/explorer) — hanya database + folder `uploads`; kedua endpoint memakai login + CSRF seperti endpoint lain. Backup manual tetap disarankan sebelum restore dari sumber yang tidak dikenal.

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

Klik berkas audio/video di File Explorer tidak membuka halaman baru: berkas diputar di pemutar global yang menempel di pojok kanan bawah dan tetap berjalan saat pindah menu (Markdown, Dev Space, dst). Sumbernya `GET /api/fs/raw` yang mendukung HTTP Range, jadi video bisa di-seek tanpa mengunduh seluruh berkas.

- State pemutaran (path, posisi playhead, play/pause, durasi, mode besar/mini) ada di React Context `apps/web/src/lib/player.tsx`; elemen media tidak di-unmount saat ganti route, jadi suara tidak terputus.
- Video dibuka dalam tampilan besar (default), bukan langsung mini. Tombol **Kecilkan** mengubahnya jadi pemutar floating 320px; **Perbesar** mengembalikannya. Playback tetap berjalan saat pindah menu, baik dalam mode besar maupun mini.
- Pemutar floating bisa **digeser** dengan menyeret header (audio maupun video). Posisi bertahan saat pindah menu dan otomatis dijepit agar tetap di dalam viewport.
- Tombol **Layar penuh** memakai Fullscreen API native pada panel pemutar; video mengisi layar dan kontrol play/pause/seek/volume tetap terlihat. Tekan **Esc** atau klik ikon keluar untuk kembali ke mode sebelumnya.
- Kontrol: play/pause, seek, volume, kecilkan/perbesar (video), layar penuh (video), tutup. Volume disimpan di `localStorage` (`st:media:volume`).
- Berkas yang sama diklik lagi → lanjut dari posisi terakhir. Berkas baru → mulai dari awal.
- Codec tidak didukung (mis. MKV/H.265) → pesan error di dalam pemutar; berkas tetap bisa diunduh dari daftar.
- Ekstensi dinormalkan ke huruf kecil di server, jadi `VIDEO.MP4` tetap terbuka sebagai video.
- Daftar berkas menampilkan thumbnail 96×96 (`GET /api/fs/thumb`): gambar diproses dengan sharp, video diambil frame detik ke-1 lewat ffmpeg. Gagal/ffmpeg tidak ada → ikon berkas generik. Thumbnail di-cache di memori (maks. 300) per path + mtime.

## Kompresor

- **Kompres**: gambar (kualitas + lebar maksimum + format keluaran) dan PDF. Hasil ditulis sebagai `<nama>-min.<ext>`.
- **Konversi**: gambar → PDF, PDF → PNG/JPG, dan antar format gambar. Hasil `<nama>-conv.<ext>` atau `<nama>-page-N.png`.
- Proses berjalan sebagai job di latar belakang: `POST /api/compress/*` langsung mengembalikan `jobId`, UI memantau `GET /api/compress/job?id=`. Halaman tidak terkunci dan ada indikator progres.
- Job disimpan di tabel `jobs`, punya batas konkurensi (`ST_JOB_CONCURRENCY`, default 2), bisa dibatalkan selama masih `queued`, bertahan setelah restart, dan riwayat terminal dibatasi 200 job / 7 hari. Daftar dan detailnya tersedia di `GET /api/jobs` dan `GET /api/jobs/:id`.
- Berkas dipilih lewat kotak drop (klik untuk membuka dialog file) atau ditarik ke sana; hasil unggahan masuk ke `<root>/.super-tool-drop`. Upload ditulis bertahap ke disk (bukan Buffer di RAM), menampilkan persen unggah; batas default 20 GB, ubah lewat `ST_MAX_UPLOAD_BYTES`.
- PDF besar diproses satu per satu agar dua file GB tidak berebut RAM; output ditulis ke berkas `.part-*` lalu di-rename setelah ghostscript sukses.
- Berkas rusak atau terkunci password menghasilkan pesan seperti "Berkas terkunci password, tidak bisa diproses", bukan halaman kosong.

Hasil kompresi/konversi ditampilkan **berdampingan**: berkas asli di kiri, hasil di kanan, masing-masing dengan pratinjau besar (gambar tampil penuh, klik untuk ukuran asli), ukuran berkas, dan tombol unduh. Konversi yang melibatkan PDF tidak menampilkan isi, hanya info berkas.

## Diagnostik

- Kartu **Diagnostik** di Settings menampilkan versi aplikasi, versi Node, uptime, RSS, ukuran database + WAL, versi skema, jumlah halaman, sisa disk, error terakhir, dan 30 log terakhir.
- Endpoint `GET /api/diagnostics?logs=40` membaca ring buffer log di memori (maks 400 entri) dan `statfs` folder data; tidak menulis apa pun.
- Log dari Nest ditangkap lewat logger kustom sehingga peringatan/error startup dan job ikut terlihat. Nilai seperti password/token disamarkan sebelum masuk buffer.

## Storage Monitor

- Memindai folder root pertama dari `ST_FS_ROOTS` (default home) sampai **2 level**. Folder sistem `snap` dan `lost+found` dilewati.
- Scan dipecah per folder top-level dan dijalankan paralel (`du -x -0 -B1 --max-depth=1`), jadi home 58 GB selesai sekitar 20–30 detik. Timeout per folder 5 menit dan batas output 8 MB supaya folder besar tidak terpotong terlalu cepat. Scan hanya berjalan saat diminta (buka menu atau tombol **Pindai ulang**), tanpa cron. Hasil di-cache **6 jam di tabel `storage_cache` SQLite** (bertahan setelah restart). Cache dibuang setelah hapus folder atau Docker prune.
- Kalau ada folder tanpa izin baca (mis. volume Docker milik `nobody`), warning menyebut path penyebabnya. Scan tetap selesai, tetapi isi folder tersebut tidak masuk total karena `du` tidak bisa membacanya.
- Tampilan: kartu total + sisa disk, **treemap SVG** (tanpa dependency), dan tree yang bisa diurutkan berdasarkan ukuran/nama. Klik blok di **Folder Map** untuk scroll dan menyorot baris folder yang sesuai di daftar bawah. Baris bisa dibuka untuk melihat anak folder. Setiap baris punya **Salin path**; **Hapus** hanya muncul untuk nama folder yang masuk allowlist.
- **Hapus** hanya untuk nama folder yang masuk allowlist: `node_modules`, `temp`, `.cache`, `dist`, `build`, `target`, `vendor`, `coverage`, dan cache build lain. Path tetap dicek lewat `ST_FS_ROOTS` + symlink, jadi bukan hapus path bebas.
- **Bersihkan Docker** menjalankan `docker system prune -f` (fixed command, tanpa input pengguna) dan menampilkan outputnya. Volume tidak dihapus karena tidak memakai `--volumes`.
- Endpoint: `GET /api/storage/usage?refresh=1`, `POST /api/storage/delete` `{ path }`, `POST /api/storage/docker-prune`.

## Dev Space

| Tab | Endpoint | Catatan |
|-----|----------|---------|
| Regex Tester | - | jalan di browser, highlight + grup + hasil replace |
| Encode/Decode & Hash | `POST /api/dev/hash` | konversi Teks ↔ Base64 ↔ Base64 URL-safe ↔ Hex (dua arah), URL, HTML entity, JWT decode; MD5/SHA/HMAC di server |
| HTTP Client | `POST /api/dev/http` | seperti curl ringan: method, header, body, timeout. Alamat metadata cloud (169.254.169.254) diblokir |
| Log Tailer | `GET /api/dev/logs`, `GET /api/dev/logs/stream` | tail 400 baris, mode live pakai SSE, filter teks, preset `/var/log/nginx/*` |
| Docker | `GET /api/dev/docker`, `POST /api/dev/docker/action` | baca: `docker ps`, `docker images`, `docker logs --tail 300`; aksi: `start`, `stop`, `restart`, `remove` (hapus paksa) berdasarkan ID container tervalidasi |
| Git Status | `GET /api/dev/git`, `POST /api/dev/git/stage`, `GET /api/dev/git/diff`, `GET /api/dev/git/show` | pilih folder lewat daftar direktori (klik nama = pakai folder, tombol `›` = masuk folder). Dua kolom: kiri grafik commit (SVG, warna per lane/branch) + daftar commit (inisial penulis, waktu, hash biru, badge HEAD/branch), kanan kartu berkas staged/diubah/belum dilacak dengan centang untuk stage/unstage + panel diff merah/hijau saat berkas atau commit diklik |
| Cron Job | `GET/POST/DELETE /api/dev/cron` | `crontab -l`, tambah baris, hapus per indeks |
| DNS/IP Lookup | `GET /api/dev/dns` | A, AAAA, MX, CNAME, NS, TXT + lokasi lewat ip-api.com |
| Database | `GET /api/sqlite/*` | viewer read-only `super-tool.db`: daftar tabel, isi tabel dengan paging, query SELECT/PRAGMA |

Tab Cron mengubah crontab milik user yang menjalankan server. Di WSL tanpa cron daemon aktif, jadwal tetap tersimpan tapi tidak dieksekusi sampai `sudo service cron start`.

## URL Viewer dan mode proxy

Ada dua cara membuka tool lain: langsung (iframe biasa) atau lewat server ini (`Proxy`). Mode proxy punya dua gaya:

| Mode | URL iframe | Kapan dipakai |
|------|-----------|---------------|
| Subdomain | `http://<token>.localhost:3001/?st_ticket=...` | **Default.** Tiap tool dapat origin sendiri, jadi cookie, `localStorage`, redirect, dan panggilan `/api/...` bekerja seperti aslinya. Wajib tiket per-origin |
| Path | `/api/proxy/b/<token>/...` | Fallback satu origin, HTML ditulis ulang, respons diberi CSP `sandbox`. Cukup untuk halaman statis; app yang memanggil `/api/...` absolut akan gagal login |

Kenapa subdomain: aplikasi modern memanggil API dengan path absolut dan menyimpan sesi di cookie. Di mode path, cookie itu menempel ke origin Super Tool dan `/api/...` nyasar ke server ini — akibatnya login selalu gagal walau halaman tampil. Dengan subdomain, semuanya kembali normal karena origin-nya memang milik tool tersebut.

Yang perlu diketahui:

- `*.localhost` otomatis menunjuk ke 127.0.0.1 di Chromium, jadi tidak perlu mengubah `/etc/hosts`.
- Mode subdomain meminta tiket 12 jam yang terikat pada origin target (`POST /api/proxy/ticket`). Tiket di URL langsung dipindah ke cookie `HttpOnly` lewat redirect 302; tanpa tiket HTTP/WS dijawab 401.
- Mode path tidak punya origin terpisah; respons HTML-nya diberi CSP `sandbox` dan iframe-nya diberi atribut `sandbox` tanpa `allow-same-origin` supaya skrip target tidak bisa membaca API Super Tool.
- Cookie dari target ditulis ulang menjadi `SameSite=None; Secure` supaya tetap terkirim di dalam iframe. Chromium menganggap `localhost` sebagai secure context, jadi ini sah walau lewat http.
- Proxy ini hanya menerima alamat loopback/privat (kecuali `ST_PROXY_ALLOW_PUBLIC=1`) dan hanya binding ke `127.0.0.1`, sama seperti mode path.
- Kalau browser menolak cookie pihak ketiga (beberapa pengaturan privasi ketat), buka tool tersebut di tab baru lewat tombol ↗ — origin subdomain yang sama tetap dipakai.
- Bundel JS/JSON yang memuat alamat API absolut (misalnya Chroma UI yang menyimpan `http://localhost:8000`) ditulis ulang ke origin proxy, jadi panggilan API-nya tidak lagi diblokir sebagai lintas origin.
- Tab yang sudah dibuka **tetap hidup** saat pindah menu: iframe tidak di-unmount dan tidak di-`display:none` (hanya disembunyikan lewat `visibility`/`opacity`), jadi sesi ssh, `pm2 log`, atau terminal panjang di dalam Termix terus berjalan dan tidak macet di layar loading. Tiap tab punya iframe sendiri dan hanya yang aktif yang bisa diklik.

## Webhook Receiver

Menu **Webhook Receiver** bisa punya **beberapa endpoint** sekaligus (maks 10), masing-masing dengan nama + token sendiri, misalnya `http://127.0.0.1:3001/api/hook/67ac6f2fcf00`. Tambah endpoint lewat tombol **Tambah endpoint**, klik chip untuk berpindah; daftar request dan tombol **Bersihkan** mengikuti endpoint yang aktif. Field endpoint berupa input read-only berisi URL lengkap (klik = pilih semua) + tombol **Salin** dan **Buka**. Kirim method apa pun:

```bash
curl -X POST http://127.0.0.1:3001/api/hook/<token> \
  -H 'content-type: application/json' -d '{"hello":"world"}'
```

Request muncul di daftar tanpa refresh (SSE `/api/webhook/stream`), klik satu item untuk melihat header dan body; body JSON dirapikan otomatis. Batasan: endpoint + token dibuat ulang tiap server restart, riwayat hanya di memori (100 request total, body maksimal 200 KB), dan endpoint ini sengaja tanpa login supaya aplikasi luar bisa memanggilnya — server tetap binding ke loopback.

## Google Calendar

Integrasi baca-tulis ke Google Calendar. Menu **Calendar** menampilkan event sekitar bulan berjalan dalam kalender visual (bulan/minggu/agenda), detail event, form **Tambah Event**, serta pengingat pop-up + bell untuk event terdekat.

Setup:

1. Google Cloud Console → buat project → aktifkan **Google Calendar API**.
2. OAuth consent screen (External, mode Testing) → tambahkan akun Google yang dipakai sebagai test user, lalu di **Data access** tambahkan scope `https://www.googleapis.com/auth/calendar`.
3. Credentials → Create credentials → OAuth client ID → Web application → Authorized redirect URI: `http://127.0.0.1:3001/api/calendar/callback`. Harus sama persis dengan `GOOGLE_REDIRECT_URI`. Endpoint juga menerima alias `http://127.0.0.1:3001/api/google/callback`; kalau `.env`/Google Console sudah memakai salah satunya, cukup samakan keduanya.
4. Isi `apps/api/.env` (lihat `apps/api/.env.example`):

```bash
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx
GOOGLE_REDIRECT_URI=http://127.0.0.1:3001/api/calendar/callback
```

Alur:

- `GET /api/calendar/auth` (wajib login lewat AuthGuard cookie — aplikasi ini tidak memakai JWT) → `{ url }`; frontend membuka URL tersebut. Scope OAuth: `https://www.googleapis.com/auth/calendar` (baca-tulis), bukan lagi `calendar.readonly`.
- Google mengembalikan `code` ke `GET /api/calendar/callback`. Route ini publik karena consent bisa diselesaikan di profil browser lain; keamanannya dari `state` acak sekali pakai (TTL 10 menit). Token ditukar lalu disimpan ke tabel `google_tokens`, setelah itu user diarahkan ke `/#/calendar?google=connected` (atau `denied`/`error`).
- `GET /api/calendar/events?timeMin=&timeMax=` (wajib login) → event dari semua kalender (termasuk kalender langganan/hari libur) pada rentang tersebut; `account` berisi email kalender utama yang tersambung; tanpa parameter memakai awal bulan berjalan. `singleEvents` + `orderBy=startTime`, maksimal 250 event. Access token di-refresh otomatis 60 detik sebelum kedaluwarsa; refresh token lama dipertahankan.
- `POST /api/calendar/events` (wajib login + `X-ST-CSRF`) menerima `{ summary, start, end, timeZone?, location?, description?, allDay? }` dan memanggil `events.insert` ke kalender `primary`. `start`/`end` berupa ISO datetime (atau `YYYY-MM-DD` untuk `allDay`); respons adalah event yang sudah dipetakan.
- Scope `https://www.googleapis.com/auth/calendar`. Token tidak pernah dikirim ke browser. Backup database ikut memuat token, jadi perlakukan file backup seperti kredensial. Token lama yang masih `calendar.readonly` tetap bisa membaca; halaman menampilkan ajakan **Hubungkan ulang** agar bisa menambah event.

Halaman Calendar:

- Saat dibuka, halaman memanggil `/api/calendar/events` untuk rentang bulan sebelumnya sampai tiga bulan ke depan, jadi event bulan berjalan (termasuk yang sudah lewat) tetap terlihat. Kalau belum terhubung, tampil tombol **Hubungkan ke Google Calendar** yang membuka URL dari `/api/calendar/auth` di tab baru (atau tab yang sama kalau popup diblokir).
- Setelah memberi izin, Google redirect ke `/#/calendar?google=connected` (atau `denied`/`error`); halaman menampilkan toast sesuai status lalu membersihkan query. Di tab asal, klik **Sync** untuk memuat token yang baru tersimpan.
- Tampilan kalender memakai `react-big-calendar` + `dayjs` (lazy-load): default **bulan**, bisa pindah ke **minggu** atau **agenda**. Setiap event menampilkan **judul** di grid, bukan cuma blok warna. Event sepanjang hari dari Google (`start.date`/`end.date`) dipetakan dengan benar; jam mengikuti zona waktu perangkat.
- Tombol **Tambah Event** membuka modal judul, mulai/selesai, lokasi, dan deskripsi; event disimpan lewat `POST /api/calendar/events` lalu kalender di-refresh. Kalau token lama masih baca-saja, muncul banner **Hubungkan ulang**.
- Klik event membuka **modal detail**: judul, waktu mulai–selesai dengan label **WIB/WITA/WIT** sesuai zona waktu perangkat (sama dengan jam di header), lokasi, deskripsi, dan tautan ke Google Calendar. Escape/klik latar menutup modal.
- Toolbar (Hari ini/Sebelumnya/Berikutnya + pilihan view) mengikuti bahasa ID/EN. Warna event, border, dan font memakai token tema Super Tool lewat `tools/calendar.css`.
- Tombol **Sync** di header memuat ulang data, dan halaman juga **auto-refresh setiap 5 menit** selama Calendar terbuka. Kalau rentang tidak punya event, kalender tetap tampil dengan tombol Tambah Event.
- Dropdown **Ingatkan** di header: 1 jam, 30 menit, 15 menit sebelum event, atau **Nonaktif**. Pilihan disimpan di `localStorage` (`st:calendar:remind`). Pengingat dicek tiap 15 detik, menampilkan pop-up dengan judul/waktu event dan membunyikan bell Web Audio. Event yang sama hanya diberitahu sekali per sesi tab (`sessionStorage`). Event sepanjang hari belum diingatkan karena tidak punya jam mulai; pengingat hanya aktif selama halaman Calendar terbuka.

Belum ada tombol "putuskan kalender"; hubungkan ulang akan menimpa token. Untuk menghapus total, hapus baris `google_tokens` lewat SQLite Viewer, lalu cabut akses aplikasi di myaccount.google.com/permissions.

## Downloader Video

Menu **Downloader** mengunduh video/audio publik dari YouTube, Facebook, dan Bilibili. Backend memakai `youtube-dl-exec` (yt-dlp) + `ffmpeg-static`; tidak ada file yang disimpan permanen.

- Alurnya dua tahap: tempel URL lalu klik **Cek link**. Backend menjalankan yt-dlp `--dump-single-json --skip-download` (`POST /api/downloader/info`) dan mengembalikan judul, channel, durasi, thumbnail, sumber, dan resolusi yang tersedia. Setelah detail muncul, baru pilih resolusi/audio dan klik **Download**.
- Hanya tautan host yang diizinkan (YouTube, Facebook, Bilibili, termasuk short link `youtu.be`, `fb.watch`, `b23.tv`); host lain ditolak sebelum yt-dlp dijalankan (anti-SSRF). Tanpa dukungan cookie, video privat/login atau yang butuh verifikasi akun akan gagal dengan pesan dari yt-dlp.
- `POST /api/downloader/proxy` menerima `{ url, quality, audioOnly }`, menjalankan yt-dlp, lalu mengalirkan file sebagai `Content-Disposition: attachment` dengan nama judul video. `quality` = `best|1080|720|480|360`; `audioOnly` menghasilkan MP3. Ada juga `GET /api/downloader/proxy?url=...&quality=...&audio=1` untuk browser/anchor.
- Di Chrome/Edge halaman memakai **File System Access API**: dialog Save As muncul lebih dulu, respons di-stream langsung ke file yang dipilih (bukan blob di memori). Browser lain memakai fallback blob/unduhan biasa. Tombol berubah menjadi **Memproses video…** dan bisa dibatalkan; permintaan yang dibatalkan ikut menghentikan yt-dlp.
- Setiap unduhan memakai folder unik di `temp/` (`ST_TEMP_DIR`), berisi file hasil merge. Folder dihapus setelah respons selesai, saat klien memutus koneksi, atau saat proses gagal; sisa folder lebih dari 6 jam dibersihkan saat server start. Batas playlist dimatikan (`--no-playlist`), jadi satu URL = satu video.

## Telegram Command Center

Bot Telegram berjalan di backend dengan **long polling** (tanpa webhook, tanpa membuka port tambahan). Isi `TELEGRAM_BOT_TOKEN` dari BotFather di `apps/api/.env`, lalu restart API.

- **Download**: kirim URL YouTube/Facebook/Bilibili. Bot membalas "Sedang mengunduh...", mengunduh video 720p lewat Downloader yang sama, lalu mengirim video sebagai dokumen agar tidak auto-play.
- **Batas file**: file ≤45 MB dikirim langsung. File lebih besar diunggah ke `https://0x0.st`, lalu bot mengirim link. 0x0.st adalah layanan publik dan sementara; jangan kirim file sensitif. Jika 0x0.st menolak (mis. 503), bot melaporkan error dan file tidak terkirim.
- **Kompres**: kirim gambar atau PDF dengan caption `/compress`. Bot mengunduh file dari Telegram (maks. 20 MB), menjalankan `CompressService` yang sama dengan halaman Kompresor, lalu mengirim hasilnya.
- **Perintah**: `/start` dan `/help` untuk bantuan, `/compress` untuk petunjuk kompres, `/id` untuk melihat chat ID.
- **Keamanan**: isi `TELEGRAM_ALLOWED_CHAT_IDS` dengan chat ID kamu. Tanpa allowlist, siapa pun yang menemukan bot bisa memakai resource server. Bot hanya memproses operasi di private chat.
- **Temp**: file kerja memakai `ST_TEMP_DIR`; untuk fitur `/compress`, folder itu harus berada di dalam `ST_FS_ROOTS` karena `CompressService` memakai `jailPath`.

Saat pertama kali dipakai, kirim `/id` ke bot, salin ID ke `TELEGRAM_ALLOWED_CHAT_IDS`, lalu restart API.

## Audit Log

Request API pengubah state (`POST`/`PUT`/`PATCH`/`DELETE`) dan aksi Telegram dicatat ke tabel `audit_log` di SQLite: timestamp, sumber (`web` / `telegram_bot`), actor, fitur, aksi, status, durasi, IP/user agent, payload, dan error. Request baca (`GET`/`HEAD`/`OPTIONS`) diabaikan agar audit tidak penuh noise. Lihat di **Dev Space → Audit Log**, atau `GET /api/audit` dengan filter `source`, `actor`, `feature`, `q`, `since`, `until`, `limit`, `offset`.

- Payload disimpan sampai 64 KB; field sensitif seperti password, token, cookie, dan secret diredaksi.
- Request proxy mentah dan file statis tidak masuk audit; request mutasi yang ditolak auth tetap dicatat.
- Audit ikut masuk backup SQLite. Tidak ada penghapusan otomatis, jadi bersihkan tabel secara berkala jika sudah terlalu besar.

## Widget Waktu & Jadwal Sholat

Widget di header (kanan atas, sebelah pemilih proyek) menampilkan hari, tanggal, bulan, tahun, dan jam 24 jam sesuai waktu perangkat. Klik jam untuk membuka popover berisi jadwal sholat hari ini.

- Perhitungan memakai `adhan` di browser (tanpa API): **CalculationMethod.Singapore** (Fajr 20°, Isya 18°, madhab Shafi), metode yang umum untuk Indonesia.
- **Tidak memakai geolocation browser/GPS** — tidak ada permintaan izin lokasi sama sekali. Lokasi diisi manual di **Settings → Waktu & Jadwal Sholat**: nama kota (label), latitude, longitude, atau pilih salah satu dari 27 kota untuk mengisi koordinat otomatis.
- Data disimpan di `localStorage` (`st:prayer`) dan **tidak pernah dikirim ke server**. Kalau lokasi belum diisi, popover widget menampilkan tombol **Atur Lokasi** yang membuka Settings. Perubahan langsung dipakai widget tanpa reload.
- Pengingat dicek tiap menit: jendela 5 menit sebelum sampai 1 menit sesudah waktu sholat. Saat masuk jendela, muncul kartu **“Waktunya Sholat [Nama]”** di pojok kiri bawah (bukan alert browser) dan/atau bunyi beep Web Audio. Satu sholat hanya memicu sekali per hari; pop-up menutup sendiri setelah 20 detik atau bisa ditutup manual.
- Throbber di tombol jam aktif 15 menit sebelum waktu sholat (oranye) sampai 10 menit sesudahnya (hijau). Selama 10 menit sesudah itu widget tetap menampilkan sholat yang baru masuk, belum melompat ke sholat berikutnya.
- Toggle **Suara pengingat** dan **Pop-up pengingat** ada di Settings. Tombol **Tes bunyi** di Settings membuka kunci audio browser dan memutar beep percobaan. Kalau pop-up dimatikan, pengingat suara tetap jalan (dan sebaliknya).
- Batasan: bunyi bisa diblokir browser sampai ada interaksi user (kebijakan autoplay); setelah interaksi pertama, audio dibuka sekali dan dipakai ulang. Perhitungan memakai zona waktu perangkat, jadi untuk kota di zona lain jam ditampilkan menurut waktu lokal perangkat.

## Notifikasi toast

Toast di kanan bawah (`components/toast.tsx`): sukses hijau, gagal merah, klik untuk menutup. Durasi 3,5 detik (gagal 6 detik), pesan kembar dalam 1,2 detik digabung.

- **Semua kegagalan aksi** (POST/PUT/DELETE) otomatis jadi toast lewat `lib/api.ts` → `notify()`; error GET tidak di-toast supaya polling tidak berisik.
- **Operasi berhasil** memberi toast sendiri: simpan/unggah/rename/hapus di File Explorer, catatan dibuat/dihapus, URL disimpan/dihapus, nginx simpan/hapus/restore, cron tambah/hapus, kompresi selesai, webhook, git stage/unstage.

## Modal konfirmasi

Semua konfirmasi destruktif memakai modal sendiri (`components/confirm.tsx` → `useConfirm()`), bukan `window.confirm`. Enter = setuju, Esc/klik latar = batal, fokus awal di tombol batal, tombol setuju merah untuk aksi berbahaya. Dipakai untuk hapus berkas, catatan, URL, file nginx, cron, restore nginx, dan kill proses.

## Gaya input dan tombol

- `.input`: ring fokus biru lembut, hover border, status `aria-invalid`, file input bergaya, select/textarea konsisten.
- `.btn`: efek tekan (`active:translate-y-px`), ring fokus keyboard, state disabled.
- Utility `.label`, `.hint`, `.kbd` untuk label kecil, teks bantuan, dan petunjuk tombol.
- Animasi toast dihormati `prefers-reduced-motion`; checkbox/radio memakai warna aksen.

## Konteks proyek global (opsional)

Bar tipis di atas tiap halaman punya pemilih **Proyek** di kanan atas. Pilih folder lewat penjelajah folder (`/fs/list`), dan pilihan itu dipakai semua tool yang berhubungan dengan berkas:

- **File Explorer** langsung membuka folder proyek; chip proyek di toolbar untuk kembali ke situ, dan tombol **Semua folder** di atas tree untuk keluar dari proyek (root pilihan terakhir diingat per proyek).
- **Git Status** langsung membuka repo di folder proyek (tanpa klik folder lagi).
- Tool lain (Markdown/JSON/Notes/URL/Port/Dev Space/Nginx/Settings) tidak terpengaruh. Nginx tetap fokus ke folder konfigurasi nginx sistem.

Pilihan disimpan di `localStorage`: `st:project` (folder aktif) dan `st:project:recent` (8 folder terakhir; bisa dihapus satu per satu dari dropdown). Tombol **Tanpa proyek** mengembalikan perilaku default (folder pertama dari `ST_FS_ROOTS`), jadi fitur ini murni mempercepat dan tidak wajib dipakai.

## Command Palette

Tekan **Ctrl + K** (atau **Cmd + K** di macOS) di mana saja untuk membuka palette. Dua tingkat:

1. **Pilih menu** — ketik nama menu (misal `json`, `file`, `git`), **Enter** membuka daftar aksi menu itu.
2. **Pilih aksi** — Enter menjalankan aksinya; **Esc** (atau Backspace saat kolom kosong) kembali ke daftar menu.

Aksi yang tersedia mengikuti isi tiap tool, misalnya:

| Menu | Submenu |
|------|---------|
| Markdown | tulis/fokus editor, unggah berkas, ekspor .md, muat contoh, bersihkan |
| JSON | tulis, format, minify, urutkan kunci, unggah, unduh hasil |
| Catatan | baru, cari, hapus, tampilkan daftar |
| URL Viewer | tambah, akses (daftar URL tersimpan → langsung terbuka), edit (daftar URL → form edit) |
| Kompresor | pilih berkas, jalankan, unduh hasil |
| Dev Space | semua tab: regex, encode/hash, HTTP, log, docker, git, cron, DNS, database |
| File Explorer | **Cari berkas** — form di palette: toggle nama/isi, kata kunci, "hanya di dalam" (include), "kecualikan" (exclude); Enter membuka File Explorer dengan pencarian itu langsung berjalan |
| Port | refresh, tab port, tab proses, auto refresh |
| Webhook | jeda/lanjut live, bersihkan |

Palette juga memuat aksi cepat (ganti bahasa, ganti password, keluar). Aksi yang butuh tool aktif dijalankan setelah halaman tujuan muncul (`data-action`), jadi tidak ada state yang hilang saat pindah menu.

## Bahasa (ID / EN)

Tombol `ID` / `EN` di bawah sidebar mengubah bahasa antarmuka dan disimpan di `localStorage` (`st:lang`). Hampir semua teks statis ikut berganti: menu, judul & subjudul tool, label form, header tabel, tombol, placeholder, pesan error, dialog konfirmasi, dan tab Dev Space. Yang tidak diterjemahkan hanya data dinamis (nama berkas, isi dokumen, output perintah, contoh JSON/markdown, waktu relatif dari server).

## Keamanan

- Password disimpan sebagai hash `scrypt` (salt acak per password), bukan plaintext.
- Password default `password` hanya dipakai sekali; sesi berikutnya dipaksa ganti (`PASSWORD_CHANGE_REQUIRED` di semua endpoint).
- Sesi berupa cookie `HttpOnly` + `SameSite=Lax`, ditandatangani HMAC-SHA256, berisi versi password (`pv`) sehingga ganti password otomatis membatalkan semua token lama.
- Semua request pengubah (`POST/PUT/DELETE`) wajib menyertakan header `X-ST-CSRF: 1`.
- Login dibatasi 6 percobaan per 10 menit per IP.
- Semua path File Explorer dipaksa berada di dalam `ST_FS_ROOTS`, termasuk pemeriksaan symlink (tidak bisa kabur lewat `..` atau link).
- Hapus di Storage Monitor hanya menerima nama folder yang ada di allowlist (`node_modules`, `temp`, cache build). Path tetap dijail ke root pertama `ST_FS_ROOTS`; Docker prune selalu memakai argumen tetap, tanpa input pengguna.
- Proxy URL hanya boleh ke `localhost`/IP privat. Net guard memblokir metadata cloud (`169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`), IPv4-mapped IPv6, ULA/link-local, dan host publik kecuali `ST_PROXY_ALLOW_PUBLIC=1`.
- Proxy subdomain (HTTP + WebSocket) wajib tiket per-origin; WebSocket juga memvalidasi ulang alamat tujuan sebelum connect.
- Downloader hanya menerima host YouTube/Facebook/Bilibili (allowlist domain, bukan suffix palsu), memakai argumen yt-dlp tetap (tanpa shell), dan menghapus file temp setelah stream. Endpoint tetap butuh sesi; POST butuh `X-ST-CSRF`.
- Header `X-Frame-Options`/`CSP` dari target dilepas hanya pada endpoint proxy, bukan pada aplikasi ini. Aplikasi sendiri mengirim `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, dan CSP `frame-ancestors 'none'`.
- Endpoint webhook (`/api/hook/<token>`) sengaja tanpa login dan tanpa CSRF; token acak 6 byte dibuat tiap restart dan endpoint hanya bisa dijangkau lewat loopback. Jangan diekspos ke publik.
- Audit ketahanan & keamanan (commit `a6c3413`, temuan P0–P2 beserta bukti) ada di [docs/audit-resilience-security.md](docs/audit-resilience-security.md). Status perbaikan dan roadmap ada di [docs/roadmap/SUPERTOOL_ENHANCEMENT_ROADMAP.md](docs/roadmap/SUPERTOOL_ENHANCEMENT_ROADMAP.md).
- Audit performa backend & frontend (commit `27ffbd8`, pengukuran + temuan P0–P2) ada di [docs/audit-performance.md](docs/audit-performance.md).
- Calendar meminta scope tulis penuh (`calendar`) agar bisa membuat event; token lama baca-saja tetap aman untuk membaca sampai user menekan **Hubungkan ulang**.

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
│   │       └── modules/     # auth, notes, files, storage, ports, nginx, proxy, downloader
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
| `pnpm check` | Build + uji mandiri (token HMAC, pembatas path, parser du/allowlist storage, allowlist downloader) |

## Batasan yang diketahui

- **URL Viewer**: iframe biasa bekerja untuk tool yang tidak mengirim `X-Frame-Options`. Mode `Proxy` punya dua gaya: **Subdomain** (`<token>.localhost:PORT`, default, origin terpisah per tool sehingga login/cookie/`/api/...` bekerja normal) dan **Path** (satu origin, HTML ditulis ulang, hanya untuk halaman statis). Butuh `*.localhost` yang di Chromium sudah otomatis menunjuk 127.0.0.1; di browser lain tanpa dukungan subdomain lokal, pakai mode path atau buka di tab baru.
- **File Explorer / berkas besar**: teks lebih dari 2.000 baris (atau terpotong di batas 2 MB) dibuka di penampil virtual (`@tanstack/react-virtual`): hanya baris yang terlihat masuk DOM, jadi 40 ribu baris terbuka < 0,5 dtk. Chunk berikutnya dimuat lewat tombol **Muat 2 MB berikutnya** tanpa menggeser posisi baca; API hanya membaca 2 MB per request dan 8 KB untuk deteksi biner. Mode baca saja; syntax highlight per baris tetap jalan (JSON memakai highlighter lama, bahasa lain pola ringan). Berkas kecil tetap memakai editor textarea.
- **Catatan**: sudah di SQLite, tapi belum ada pencarian penuh (FTS5) di dalam isi catatan.
- **Port viewer**: memakai perintah `ss` (paket `iproute2`). Di sistem tanpa `ss`, endpoint mengembalikan pesan error yang jelas. Aksi *kill* mengirim SIGTERM (bukan SIGKILL) dan menolak PID 1 serta proses server ini sendiri.
- **URL Viewer**: preset memakai `127.0.0.1`, bukan `localhost`. Service yang hanya bind IPv4 akan gagal kalau browser memilih `::1` — ini penyebab error "localhost refused to connect". URL lama di browser otomatis dibenahi saat dibuka.
- **Mode Proxy**: `X-Frame-Options`/CSP dilepas, cookie di tulis ulang, WebSocket diteruskan. Mode subdomain menambahkan `SameSite=None; Secure` pada cookie target agar tetap dipakai di dalam iframe; mode path mengganti `Path` cookie ke prefix proxy. Proxy berjalan di proses yang sama, tanpa nginx/caddy.
- **Jaringan proxy**: hostname di-resolve dulu; hanya alamat loopback/privat/CGNAT yang diizinkan (misal `theAkihira:4096`). Host publik tetap diblokir kecuali `ST_PROXY_ALLOW_PUBLIC=1`.
- **Downloader**: hanya video publik tanpa login/cookie; kualitas tertinggi bergantung format yang disediakan situs. Chrome/Edge memakai Save As streaming; Firefox/Safari memakai fallback blob sehingga video sangat besar dibatasi memori browser.
- **Nginx**: setiap penyimpanan pertama membuat `<file>.bak`; tombol *Kembalikan asli* memulihkan dari cadangan itu lalu menghapusnya.
- **File Explorer**: daftar folder dibatasi 2000 entri dan pencarian 200 hasil agar UI tetap responsif. Kolom Nama/Ukuran/Diubah bisa diurutkan (folder selalu di atas), dan tiap baris punya aksi unduh, salin path, ganti nama, hapus. Pencarian isi berkas memakai `ripgrep` bila tersedia (fallback `grep -rIn`), jadi jauh lebih cepat dan otomatis menghormati `.gitignore`; data tetap disaring per folder sampah (node_modules, .git, dist, .cache). Kolom **"hanya di dalam" (include)** dipakai sebagai titik mulai pencarian — folder lain tidak ditelusuri sama sekali — dan pencarian nama juga berhenti menelusuri di luar folder itu. Berkas biner dilewati (docx/xlsx tidak ikut), isi dibatasi 300 hasil, nama 200 hasil.
- **Edit Office**: hanya teks paragraf (docx) dan nilai sel (xlsx). Jumlah paragraf tidak boleh berubah — menambah atau menghapus paragraf belum didukung, dan aplikasinya menolak dengan pesan jelas. Format pptx/odt/ods/odp hanya bisa dibaca.
- **Kompres PDF**: dengan ghostscript, proses streaming ke disk, tanpa batas 200 MB; cocok untuk file ratusan MB/GB. Tanpa ghostscript hanya PDF ≤50 MB yang diproses lewat pdf-lib (memori); PDF besar ditolak dengan pesan agar RAM tidak habis. Instalasi ghostscript ada di bagian *Alat eksternal*.
- **Konversi PDF → gambar**: memecah 3 halaman pertama per proses, butuh `pdftoppm`. Hasilnya gambar per halaman, bukan PDF baru.
- **Cron**: mengubah crontab user yang menjalankan server; butuh izin tulis ke `/var/spool/cron`. Di sandbox/container tanpa cron, penulisan ditolak dengan pesan jelas.
- **DNS lookup**: lokasi server memakai ip-api.com (HTTP, tanpa API key) sehingga butuh internet; tanpa internet record DNS tetap tampil.
- **Storage Monitor**: scan pertama membaca metadata seluruh isi home, jadi di home puluhan GB butuh puluhan detik; hasil di-cache 5 menit. Kedalaman tree 2 level, folder yang tidak bisa dibaca ditandai peringatan, dan angka memakai blok disk (bukan ukuran logis). Docker prune hanya menghapus objek tidak terpakai (tanpa volume).
- **Docker**: start/stop/restart/hapus container tersedia langsung dari daftar. Tab Container bisa dicari berdasarkan name/image/port dan diurutkan berdasarkan name/image; tab Image bisa dicari berdasarkan repository dan diurutkan berdasarkan repository/ukuran/dibuat. Hapus memakai `docker rm -f` dan minta konfirmasi; aksi hanya menerima ID/nama container yang tervalidasi, tanpa shell. Pembuatan container, pull image, dan Docker Compose belum termasuk.
- **HTTP Client**: mengizinkan host publik seperti curl, kecuali alamat metadata cloud. Cookie dan otentikasi tidak disimpan antar request.

## Lisensi

MIT.
