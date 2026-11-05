# Audit ketahanan & keamanan

Commit: `a6c3413` (5 Nov 2026). Cakupan: API NestJS + frontend React, seluruh modul di `apps/api/src/modules`, bootstrap/DB, serta titik integrasi sistem (grep, git, docker, nginx, cron, proxy, backup).

Metode: baca kode, uji langsung endpoint pada server uji (port 3106), dan audit perilaku di browser. Tidak ada perubahan kode pada audit ini.

## Ringkasan prioritas

| Prioritas | Temuan | Dampak |
|-----------|--------|--------|
| **P0** | Proxy path berjalan di origin aplikasi, iframe tanpa sandbox (B1) | Aplikasi yang di-proxy bisa memanggil seluruh API dengan cookie + CSRF: baca data, ganti password, unduh backup |
| **P0** | Jalur upgrade WebSocket melewati cek alamat lokal dan (mode subdomain) login (B2) | Terowongan/port-scan ke host mana pun dari browser, tanpa sesi |
| **P0** | Restore database tidak menyegarkan cache akun (A7) | Sesi lama tetap sah setelah restore, password hasil restore ditolak sampai server restart |
| **P1** | Batas ukuran hilang: upload berkas, buffer respons proxy/HTTP client, inflate ZIP (A5, B11) | Satu permintaan bisa menghabiskan RAM lalu mematikan proses |
| **P1** | Perintah sistem tanpa timeout + polling tanpa single-flight (A4) | `ss`/`ps` yang macet membuat request menggantung dan menumpuk |
| **P1** | CORS ber-kredensial ke `localhost:5173` di semua mode (B3) | Halaman lain di port itu bisa membaca API (termasuk `/api/backup`) selama user login |
| **P1** | Tidak ada graceful shutdown, handler proses, health check, security header (A1, A2, B5) | Restart/Ctrl+C rawan state setengah jadi; clickjacking; error tak terlihat |
| **P2** | Sisanya di bawah | Perbaikan bertahap |

## A. Ketahanan (error, proses gagal, hang/crash)

### A1. Tidak ada graceful shutdown — **Sedang**
- `apps/api/src/main.ts:75` hanya `await app.listen(...)`. Tidak ada `app.enableShutdownHooks()`, tidak ada handler `SIGTERM`/`SIGINT`.
- Job kompres, proses `rg`, SSE webhook, dan stream log tidak ditutup rapi saat server dimatikan.
- `replaceDatabase()` (`apps/api/src/common/db.ts:98`) menutup koneksi SQLite saat request lain masih berjalan: request yang tepat mengenai restore akan gagal 500 (`database is not open`), dan dua restore bersamaan bisa saling menimpa.
- Perbaikan: `enableShutdownHooks`, lacak child process/stream, mutex restore (satu restore pada satu waktu), dan tolak restore selama ada job kompres/stream aktif atau tunggu sampai selesai.

### A2. Tidak ada observabilitas proses — **Sedang**
- `void bootstrap()` tanpa `.catch`; porta bentrok/kegagalan listen hanya menghasilkan stack lalu keluar. Tidak ada `process.on('uncaughtException'|'unhandledRejection')`, tidak ada logger terstruktur/request id, tidak ada `/api/health`.
- Tidak ada konfigurasi PM2/systemd di repo (hanya disebut lewat teks), jadi tidak ada restart otomatis/health probe.
- Perbaikan: handler proses yang mencatat + keluar terkontrol, endpoint kesehatan (DB `SELECT 1`, ruang disk), contoh unit systemd/PM2 di docs.

### A3. Operasi SQLite sinkron memblokir event loop — **Sedang**
- `node:sqlite` dipakai langsung (`apps/api/src/common/db.ts:15`); `VACUUM INTO` untuk backup (`apps/api/src/modules/backup/backup.service.ts:41`) berjalan sinkron di request.
- Selama backup database besar, semua endpoint lain ikut membeku (tidak ada timeout HTTP), termasuk SSE.
- Perbaikan: jalankan snapshot di `worker_threads`, atau setidaknya dokumentasikan batas ukuran DB dan tambahkan timeout/estimasi; jangan lakukan VACUUM pada request selain backup.

### A4. Perintah sistem tanpa timeout / tanpa single-flight — **Sedang**
- `apps/api/src/modules/ports/ports.service.ts:28` menjalankan `ss`/`ps` tanpa `timeout`; jika perintah menggantung, promise tidak pernah selesai.
- `PortsTool` memanggil `load()` tiap 5 detik tanpa penjaga in-flight (`apps/web/src/tools/PortsTool.tsx:141`), jadi request bisa menumpuk dan memicu banyak child process.
- `hasRg()` memakai `spawn('rg', ['--version'])` tanpa timeout (`apps/api/src/modules/files/files.service.ts:46`). `git`/`docker`/`nginx` sudah punya timeout 10–20 detik (baik).
- Perbaikan: timeout di semua `execFile/spawn` (2–5 detik untuk `ss`/`ps`), `AbortSignal` dari request, dan penjaga in-flight di frontend.

### A5. Buffer tanpa batas — **Tinggi** (bisa OOM)
- Upload File Explorer: `FileInterceptor('file')` tanpa `limits` (`apps/api/src/modules/files/files.controller.ts:168`), multer menyimpan seluruh berkas di memori.
- Proxy HTTP: `await upstream.arrayBuffer()` (`apps/api/src/modules/proxy/proxy.middleware.ts:308`), proxy sederhana `proxy.controller.ts:65`, HTTP client Dev Space `dev.service.ts:67` — semuanya membaca seluruh respons ke RAM sebelum dipotong.
- Restore backup menerima 100 MB lewat multer memori; unzip dieksekusi sebagai proses terpisah (baik), tetapi berkas `.zip` tetap di memori.
- Perbaikan: `limits.fileSize` (mis. 50 MB), stream respons proxy (`Readable.fromWeb`), batalkan jika `content-length` melebihi batas, dan gunakan disk untuk upload besar.

### A6. Job kompresor tanpa antrean/batas — **Sedang**
- `apps/api/src/modules/tools/compress.service.ts:90` langsung menjalankan setiap permintaan; tidak ada batas konkurensi, tidak ada pembatalan, hasil tidak pernah dihapus.
- Job hilang saat restart; UI yang masih polling mendapat 404 (`job()` melempar NotFound) dan menampilkan toast error.
- Perbaikan: antrean maksimum 1–2 proses, status `queued`, cancel (`SIGTERM` ke `gs`), pembersihan berkas hasil setelah 24 jam.

### A7. Restore merusak konsistensi sesi — **Tinggi** (terverifikasi)
Uji langsung pada server uji: backup → ganti password → restore backup.
- Login dengan password hasil restore (seharusnya benar) → **401**.
- Cookie sesi lama setelah restore → **200** (tetap sah).
- Respons restore tetap menyebut `revoked: true`, jadi UI menampilkan pesan yang salah.

Penyebab: `AuthService.cache` (`apps/api/src/modules/auth/auth.service.ts:32`) tidak pernah dibersihkan saat `replaceDatabase()` mengganti berkas DB. Sampai server restart, verifikasi sesi dan login memakai hash/secret lama.
- Perbaikan: panggil invalidasi cache dari `replaceDatabase` (mis. daftar listener di `db.ts`), atau hapus cache sama sekali (satu query SQLite per request masih sangat murah), lalu tambahkan test regresi.

### A8. SSE: backpressure & heartbeat — **Rendah/Sedang**
- `webhook.service.ts:107` dan stream log `dev.service.ts` memakai `res.write` tanpa memeriksa nilai balik/backpressure; klien lambat bisa menahan memori. Listener dibersihkan saat `close` (baik), tetapi tidak ada heartbeat (`: ping`) untuk melewati proxy yang buffering.
- Perbaikan: interval `: ping` 25 detik, lewati klien yang `write()` mengembalikan `false` sampai `drain`, batasi jumlah listener.

### A9. Cron: temp file tetap + tanpa snapshot — **Rendah**
- `dev.service.ts:256` menulis ke `cfg.dataDir/crontab.tmp` dengan nama tetap; dua operasi bersamaan bisa saling menimpa, dan konten crontab lama tidak dicadangkan sebelum diganti.
- Perbaikan: `mkdtemp`, baca `crontab -l` lalu simpan cadangan `.bak` sebelum menulis, hapus file temp di `finally`.

### A10. Nginx: `.bak` ditimpa setiap simpan — **Rendah**
`apps/api/src/modules/nginx/nginx.service.ts:75` selalu `copyFile(abs, abs + '.bak')` sebelum menulis, jadi 'Kembalikan asli' hanya mengembalikan versi simpanan terakhir; setelah dua kali simpan, isi asli hilang. README menyebut `.bak` dibuat saat pertama kali diubah — kode tidak memeriksa itu.
- Perbaikan: tulis `.bak` hanya kalau belum ada, atau pakai `.bak.<timestamp>` dengan retensi.

### A11. Ketahanan frontend — **Sedang**
- Tidak ada React ErrorBoundary (`componentDidCatch`/`getDerivedStateFromError` = 0 hasil): satu error render membuat layar kosong permanen.
- `apps/web/src/lib/api.ts:16` tidak punya timeout dan tidak menangani 401 secara global: sesi kedaluwarsa hanya memunculkan toast tiap aksi, bukan kembali ke halaman login.
- Catatan: autosave memakai `setTimeout` (`NotesTool.tsx`) tanpa membersihkan timer saat unmount dan tanpa urutan/retry — dua simpanan cepat bisa selesai tidak berurutan (isi lama menimpa isi baru). Tidak ada antrean offline.
- Perbaikan: ErrorBoundary dengan tombol muat ulang, penanganan 401 → reset state auth, `AbortSignal.timeout` default 30 detik, simpan catatan memakai versi/ETag.

### A12. Pemulihan DB saat start — **Rendah**
- `db.ts:59` membuat `super-tool.db.bak` (`VACUUM INTO`) setiap start, tetapi tidak ada `PRAGMA quick_check` dan tidak ada pemulihan otomatis dari `.bak` bila DB korup. DB korup → proses gagal start berulang tanpa petunjuk.
- Perbaikan: cek integritas saat start; jika gagal, salin `.bak` + log peringatan; dokumentasikan prosedur pemulihan manual.

### A13. `SQLITE_BUSY` tanpa retry — **Rendah**
`busy_timeout = 5000` (db.ts:21). Penulisan yang bertabrakan (restore, viewer lama, autosave) bisa melewati 5 detik dan menjadi 500. Perbaikan: retry sekali dengan backoff untuk operasi tulis.

## B. Keamanan

### B1. Mode proxy path = konten pihak lain berjalan di origin aplikasi — **Kritis**
- HTML dari target diproxy di bawah `/api/proxy/b/<token>/...` pada origin Super Tool, sementara header keamanan target dibuang (`proxy.middleware.ts:8-17`).
- Iframe tidak memakai `sandbox` (`apps/web/src/tools/UrlTool.tsx:378`).
- Akibatnya JS dari aplikasi yang di-proxy berjalan **same-origin**: bisa `fetch('/api/...')` dengan cookie HttpOnly (otomatis) + header `x-st-csrf: 1`, membaca `/api/backup` (berisi hash password + secret sesi), mengganti password, atau menghapus data. Cukup user membuka satu tool proxy yang tidak dipercaya.
- Model ancaman: aplikasi lokal lain yang di-proxy, atau tool yang nanti ditambahkan. Ini bukan bug kecil.
- Perbaikan: default mode subdomain untuk semua target yang tidak eksplisit dipercaya; jika path mode dipertahankan, pakai iframe `sandbox="allow-scripts allow-forms allow-popups"` **tanpa** `allow-same-origin` untuk target tak dipercaya, atau sajikan proxy dari origin/port berbeda. Beri peringatan di UI saat memilih mode path untuk target baru.

### B2. Upgrade WebSocket melewati guard — **Tinggi**
- Jalur HTTP memanggil `assertLocalUrl()` (`proxy.middleware.ts:249`) dan wajib sesi untuk mode path (:239).
- `handleProxyUpgrade` (`proxy.middleware.ts:338`) hanya memakai sesi untuk mode path; mode subdomain tidak, dan **tidak ada `assertLocalUrl`** sebelum `connect()` ke target.
- Siapa pun yang bisa menjangkau `127.0.0.1:3001` dapat membuka `ws://<hex>.localhost:3001/` untuk origin yang di-encode sendiri dan meneruskan koneksi ke host/port mana pun (termasuk internet) — SSRF/terowongan tanpa login.
- Perbaikan: panggil `assertLocalUrl` di jalur upgrade (awal `handleProxyUpgrade`) dan tolak mode subdomain untuk upgrade sampai ada model otorisasi yang jelas.

### B3. CORS ber-kredensial — **Tinggi di mesin bersama**
- `apps/api/src/main.ts:15` mengaktifkan CORS ke `cfg.devOrigin` (default `http://localhost:5173`) dengan `credentials: true`; header diverifikasi selalu ada di respons.
- Aplikasi lain yang berjalan di port 5173 (dev server proyek lain, halaman lokal) dapat memanggil API memakai cookie user, membaca respons, termasuk `GET /api/backup` dan `GET /api/notes`.
- Perbaikan: jangan aktifkan CORS bila `ST_DEV_ORIGIN` tidak diset; hanya aktif saat development. Tambahkan uji bahwa produksi tanpa origin tetap same-origin.

### B4. Izin berkas data — **Sedang**
Terverifikasi: `.data-audit` 755, `super-tool.db` 644, `.bak` 644. Isinya hash password (scrypt) dan secret HMAC untuk cookie. Di mesin multi-user, user lain bisa membaca secret lalu memalsukan sesi.
- Perbaikan: `mkdir(..., { mode: 0o700 })`, `chmod 600` untuk DB/`.bak`/zip backup, dan cek saat start.

### B5. Tidak ada security header — **Sedang**
Terverifikasi tidak ada `X-Frame-Options`, `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`.
- Aplikasi bisa di-iframe situs lain (clickjacking). Konfirmasi destruktif tetap modal sendiri, tetapi UI tetap bisa diklik.
- Perbaikan: middleware header minimal (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, CSP dasar `frame-ancestors 'none'`), kecuali route proxy yang memang perlu.

### B6. Cookie sesi tanpa `Secure` — **Sedang**
Terverifikasi: `Set-Cookie: ...; HttpOnly; SameSite=Lax` (tanpa `Secure`). Wajar untuk loopback HTTP, tetapi jika nanti dijalankan di belakang HTTPS atau `ST_HOST` bukan loopback, cookie bisa terkirim lewat HTTP.
- Perbaikan: set `Secure` otomatis saat request `x-forwarded-proto=https` atau saat `ST_HOST` bukan loopback; dokumentasikan.

### B7. Backup: rahasia plaintext + upload di memori — **Sedang**
- Zip backup berisi `super-tool.db` (hash password + secret HMAC) tanpa enkripsi/checksum; unduhan lewat `GET /api/backup`.
- Restore menerima 100 MB di memori (`FileInterceptor`), tanpa rate limit; validasi path zip sudah baik (menolak `..`, absolut, backslash, batas jumlah entri/ukuran), tetapi entri symlink di dalam zip tidak diperiksa khusus.
- Perbaikan: checksum di `backup.json`, opsi passphrase (AES-GCM), streaming upload ke disk, rate limit restore.

### B8. Restore: race & pemulihan sebagian — **Sedang**
- Restore mengganti DB hidup tanpa mengunci request lain (lihat A1) dan tanpa memverifikasi hasil akhir (`PRAGMA quick_check`) sebelum menimpa.
- Jika `replaceDatabase` gagal di tengah (disk penuh, izin), DB bisa hilang tanpa rollback otomatis; cadangan `.bak` lama tidak dipulihkan.
- Perbaikan: tulis DB baru ke file sementara, verifikasi, lalu `rename` atomik; simpan `super-tool.db.bak` sebelum menimpa; kunci global selama restore.

### B9. Rate limit login: memori & proxy — **Rendah**
- `attempts` (`auth.service.ts:33`) tidak pernah dipangkas; entri hanya dihapus saat login sukses untuk IP itu (`:85`). Banyak IP unik → memori tumbuh.
- `req.ip` dipakai tanpa `trust proxy`; di belakang reverse proxy semua klien terlihat satu IP, sehingga 6 percobaan salah memblokir semua user.
- Perbaikan: sapu entri kedaluwarsa saat `assertNotLocked`, batasi ukuran map, konfigurasi `trust proxy` eksplisit.

### B10. SSRF: DNS rebinding & HTTP client bebas — **Rendah**
- `assertLocalUrl` (`common/net-guard.ts:29`) me-resolve DNS lalu `fetch` me-resolve ulang: hostname milik penyerang bisa berubah ke IP privat setelah cek (TOCTOU). Risiko rendah karena butuh hostname dikendalikan penyerang dan sesi login.
- HTTP client Dev Space sengaja bebas (hanya memblokir `169.254.169.254`, `dev.service.ts:44`) — dokumentasikan sebagai fitur, bukan bug.
- Perbaikan (opsional): pin IP hasil resolve lewat dispatcher, blokir rentang privat untuk target publik.

### B11. Zip bomb OOXML — **Rendah**
`inflateRawSync` tanpa batas (`apps/api/src/modules/files/zip.ts:101`); docx/xlsx kecil bisa mengembang menjadi GB saat pratinjau/sunting. Perbaikan: batas ukuran hasil inflate (mis. 50 MB) dan rasio kompresi.

### B12. Nama berkas di Content-Disposition — **Rendah**
`files.controller.ts:118` hanya menghapus `"`; nama berkas berisi `\r`/`\n`/`\` membuat Node menolak header → 500 (DoS lokal). Perbaikan: sanitasi `[\r\n"\\]` atau pakai `filename*` RFC 5987.

### B13. Webhook publik — **Info**
`/api/hook/<token>` sengaja tanpa login (dokumentasi), token 6 byte, body 10 MB di buffer sebelum dipotong ke 200 KB, maksimal 10 endpoint/100 item (memori). Binding default loopback membuat risiko rendah. Saran: naikkan token ke 16 byte, rate limit per token.

### B14. Temuan positif (jangan diubah tanpa alasan)
- Password `scrypt` + salt acak; token HMAC dengan `timingSafeEqual`; `pv` membatalkan sesi lama saat ganti password (`common/token.ts`, `auth.service.ts`).
- Cookie `HttpOnly`, `SameSite=Lax`; semua POST/PUT/DELETE wajib `x-st-csrf: 1`.
- Jail path memakai `realpath` bertahap (`common/fs-jail.ts`), restore memvalidasi entri zip, cek header SQLite.
- Eksekusi `git`/`docker`/`rg` memakai array argumen (tanpa shell) sehingga tidak ada injeksi perintah lewat argumen.
- Markdown disanitasi DOMPurify (`lib/markdown.ts`), data dinamis dirender React (escape).
- Backup memakai `VACUUM INTO` (konsisten) dan stream zip, bukan buffer seluruh DB.

## C. Observabilitas & pengujian

- Test otomatis hanya 2 unit test (`apps/api/selfcheck.test.mjs`: token + jail); tidak ada test integrasi/endpoint, tidak ada test browser di repo.
- Tidak ada log request/error terpusat, request id, audit trail untuk aksi destruktif (hapus file, restore, ganti password), atau metrik.
- Tidak ada health check/readiness, tidak ada backup terjadwal (manual), hasil kompresi menumpuk, state webhook hilang saat restart (didokumentasikan).
- Saran: `GET /api/health` (DB + disk), logger + request id, tabel `audit_log` untuk aksi destruktif, cron backup + retensi, smoke test endpoint utama di CI.

## D. Rencana perbaikan

**P0 (segera)**
1. `assertLocalUrl` di jalur upgrade WebSocket; tolak upgrade mode subdomain tanpa otorisasi (B2).
2. Invalidasi cache auth saat `replaceDatabase` + test regresi restore (A7).
3. Mitigasi proxy same-origin: default subdomain untuk target baru, atau sandbox iframe tanpa `allow-same-origin` untuk mode path (B1).
4. Batas ukuran: upload, buffer respons proxy/HTTP client, inflate ZIP (A5, B11).
5. Graceful shutdown + handler `uncaughtException`/`unhandledRejection` + `/api/health` (A1, A2).

**P1 (minggu ini)**
1. CORS hanya aktif bila `ST_DEV_ORIGIN` diset (B3); security header minimal (B5); izin 0700/0600 (B4).
2. Timeout semua `execFile`/`spawn` + single-flight polling Ports (A4).
3. Antrean kompresor + cancel + pembersihan hasil (A6).
4. ErrorBoundary, 401 global, timeout default `api.ts` (A11).
5. Restore atomik + kunci + `quick_check` + rate limit (B8, A7).
6. Cron temp unik + snapshot; nginx `.bak` sekali saja (A9, A10).

**P2 (bertahap)**
1. SSE heartbeat/backpressure (A8); sapu rate limit (B9); sanitasi nama unduhan (B12).
2. Backup terenkripsi opsional + checksum (B7); token webhook lebih panjang (B13).
3. `quick_check` saat start + auto-recover dari `.bak` (A12); retry `SQLITE_BUSY` (A13).
4. Observabilitas: logger, audit trail, backup terjadwal, CI smoke test (C).

## E. Catatan

- Semua nomor baris mengacu pada commit `a6c3413`.
- Uji restore memakai server sementara (`ST_PORT=3106`, `ST_DATA_DIR=.data-audit`); data uji dihapus setelah audit.
- Temuan B1/B2 adalah risiko desain proxy, bukan regresi round sebelumnya: keduanya sudah ada sejak fitur proxy ditambahkan.
- Rekomendasi urutan: B2 → A7 → B1 → A5/B11 → A1/A2 → sisanya.
