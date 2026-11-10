# Arsitektur

Dokumen ini menjelaskan keputusan desain dan alasan di baliknya. Targetnya bukan "arsitektur bersih", tapi **mudah dibaca dan mudah diubah**: satu perilaku sebaiknya terlihat dalam satu tempat (Locality of Behaviour).

## Prinsip

1. **Hapus dulu, tambah belakangan.** Tidak ada abstraksi yang belum dipakai. Tidak ada `interface` dengan satu implementasi, tidak ada layer yang hanya meneruskan data.
2. **Dependency minimal.** Kalau standar Node bisa, pakai itu (`crypto`, `fs`, `child_process`, `fetch`, `loadEnvFile`).
3. **Modul = domain.** Satu folder di `apps/api/src/modules` = satu topik (auth, notes, files, ports, nginx, proxy). Service memegang logika, controller hanya memetakan HTTP.
4. **Frontend: satu file per tool.** Setiap tool di `src/tools` memuat seluruh state dan UI-nya sendiri, di-`lazy` load sehingga hanya terunduh saat dibuka.

## Alur request

~~~text
Browser
  │  cookie st_session + header X-ST-CSRF
  ▼
Vite dev (proxy /api)  ── atau ──  Nest static (apps/web/dist)
  ▼
Nest: AuthGuard global  ──►  validasi sesi + CSRF + status wajib ganti password
  ▼
Controller  ──►  Service  ──►  fs / ss / nginx / fetch / SQLite
  ▼
JSON response
~~~

Urutan middleware di `main.ts`: body parser (limit 25 MB untuk menyimpan file besar) → static assets → SPA fallback `index.html` → route `/api`.

## Autentikasi

| Bagian | Implementasi |
|--------|--------------|
| Penyimpanan | `~/.local/share/super-tool/super-tool.db` (SQLite, `node:sqlite`): akun, catatan, daftar URL, path terakhir |
| Hash | `scrypt` 64 byte + salt acak 16 byte |
| Sesi | `base64url(payload).hmacSHA256` — payload `{ exp, pv }`, umur 30 hari |
| Invalidasi | `pv` naik setiap ganti password; token lama otomatis ditolak |
| Cookie | `st_session`, `HttpOnly`, `SameSite=Lax`, `Path=/` |
| CSRF | Wajib header `X-ST-CSRF: 1` pada metode selain GET/HEAD |
| Rate limit | 6 percobaan / 10 menit per IP (in-memory) |

Kenapa bukan JWT library? Token di sini hanya dibaca server sendiri, isinya `exp` dan `pv`. HMAC 12 baris cukup dan tidak menambah dependency.

Kenapa `mustChange` dicek di guard, bukan di frontend? Karena frontend bisa dilewati. Guard memblokir semua endpoint selain `/auth/me`, `/auth/change-password`, `/auth/logout` dengan kode `PASSWORD_CHANGE_REQUIRED`.

## Keamanan path

`common/fs-jail.ts` dipakai semua endpoint file dan nginx:

1. `resolve()` input menjadi path absolut.
2. Harus berada di dalam salah satu root (`path === root` atau berawalan `root + "/"`).
3. `realpath` dicek untuk mencegah symlink keluar area. Untuk path yang belum ada (file baru), realpath dilakukan pada parent terdekat yang ada.
4. Root itu sendiri tidak boleh dihapus.

Pencarian isi (`grep`) memakai jail yang sama untuk setiap include path, termasuk path absolut dan `../`, sebelum `stat`.

## Isolasi proxy

- **Subdomain** (`<hex-target>.localhost`) adalah mode default: origin terpisah, cookie target tidak bercampur dengan cookie aplikasi. Setiap origin memerlukan tiket bertanda tangan (`{exp, pv, origin}`) yang diterbitkan `POST /api/proxy/ticket` setelah target divalidasi net guard. HTTP tanpa tiket → 401; tiket di query langsung dipindah ke cookie `HttpOnly; SameSite=None; Secure` lewat 302.
- **Path** (`/api/proxy/b/<token>/`) adalah fallback same-origin. Respons HTML diberi `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals` (tanpa `allow-same-origin`), dan iframe memakai atribut `sandbox` yang sama. Skrip target berjalan di origin opak sehingga tidak bisa membaca API atau cookie aplikasi.
- **WebSocket** mengikuti aturan mode: subdomain wajib tiket, path wajib sesi; keduanya memanggil `assertLocalUrl` sebelum connect.
- **Batas tulis-ulang** 8 MB; respons lebih besar dijawab 502 alih-alih ditahan di memori.

## Net guard dan HTTP client

`common/net-guard.ts` mengklasifikasikan alamat IPv4/IPv6 (termasuk IPv4-mapped) dan memblokir loopback, privat, CGNAT, link-local, ULA, dokumentasi, multicast, serta metadata cloud. `resolveLocalAddress()` mengunci alamat hasil resolusi pertama.

`common/http-client.ts` dipakai fitur server-side (Dev Space HTTP client, proxy probe, proxy fetch): metode di-allowlist, header terlarang ditolak, redirect manual maksimal 5 hop dengan validasi ulang tiap hop, body ≤ 1 MB, respons ≤ 1 MB (maks 10 MB), timeout 1–60 detik, dan `accept-encoding: identity` agar ukuran terprediksi.

## Operasional

- `GET /api/health` mengembalikan `{ok, uptime}` setelah `SELECT 1`; gagal → 503.
- `main.ts` memasang `trust proxy` hanya untuk loopback, mengaktifkan shutdown hook, dan mencatat `unhandledRejection`/`uncaughtException`.
- CORS hanya aktif bila `ST_DEV_ORIGIN` diisi.
- Cookie sesi memakai `Secure` hanya saat request datang lewat HTTPS (`req.secure`), sehingga deployment HTTP loopback tetap bisa login.

## Testing dan CI

- `pnpm check` = build web + API, unit test frontend (Vitest), lalu seluruh suite `node:test` API (selfcheck, restore, jobs, HTTP store, workspace, integrasi).
- Uji integrasi menjalankan hasil build API di port acak dengan `ST_DATA_DIR`/`ST_FS_ROOTS` sementara, lalu memverifikasi login, ganti password, baca berkas, penolakan path di luar jail, dan penolakan tiket proxy ke alamat metadata.
- `.github/workflows/ci.yml` menjalankan frozen lockfile, typecheck, `pnpm check`, dan `pnpm audit --audit-level high` pada Node 22.13 dan 24.

## Penyimpanan data

`common/db.ts`: buka `super-tool.db` (`node:sqlite`, WAL), buat skema, simpan salinan `VACUUM INTO` ke `.bak` setiap start, dan impor sekali dari `auth.json`/`notes.json` versi lama. Penulisan lewat SQLite, jadi tidak ada tulis-separuh: transaksi sqlite yang menjamin.

Koneksi utama memakai `journal_mode = WAL`, `busy_timeout = 5000`, dan `synchronous = NORMAL`. Modul `sqlite` (SQLite Viewer di Dev Space) membuka koneksi kedua **read-only** dengan `PRAGMA query_only = ON` + `busy_timeout`, jadi viewer bisa membaca tabel saat aplikasi menulis tanpa `database is locked`. Route `/sqlite/*` ikut AuthGuard global (401 tanpa sesi, 403 tanpa header `x-st-csrf` untuk POST).

Penulisan catatan diserialisasi lewat satu promise chain di `NotesService` agar tidak ada lost update saat autosave beruntun.

## Peta modul backend

| Modul | File penting | Isi |
|-------|--------------|-----|
| auth | `auth.service.ts`, `auth.guard.ts` | login, ganti password, verifikasi sesi |
| notes | `notes.service.ts` | CRUD catatan + serialisasi tulis |
| compare | `compare.service.ts`, `compare.controller.ts` | riwayat Text Compare: simpan teks kiri/kanan setelah tombol Bandingkan, listing cursor + infinite scroll, buka/hapus |
| files | `files.service.ts`, `mime.ts`, `office.ts`, `zip.ts` | list, read, write, mkdir, rename, delete, upload, search, du, grep isi berkas, pratinjau + edit OOXML/ODF, kirim berkas dengan HTTP Range |
| storage | `storage-usage.service.ts`, `storage-usage.controller.ts` | scan home 2 level on-demand dengan `du` per folder paralel (timeout 5 menit) + cache 6 jam di tabel `storage_cache`, tree/treemap klik-ke-daftar, salin path, hapus folder allowlist, `docker system prune -f` |
| ports | `ports.service.ts` | `ss -ltnpH` + `ps` + hitung koneksi established |
| nginx | `nginx.service.ts` | daftar `*.conf`, baca/tulis, `nginx -t` |
| proxy | `proxy.controller.ts` | mode sederhana `?u=`, probe koneksi, dan `POST /proxy/ticket` (tiket per-origin 12 jam) |
| proxy | `proxy.middleware.ts` | reverse proxy path-prefix (`/api/proxy/b/<token>/`) dan subdomain (`<hex>.localhost`): aset, cookie, POST body, WebSocket, tulis-ulang origin absolut di HTML/JS/JSON; subdomain wajib tiket, path-mode diberi CSP `sandbox`, body tulis-ulang dibatasi 8 MB |
| sqlite | `sqlite.controller.ts` | viewer read-only database aplikasi (info tabel, isi tabel, query SELECT) |
| backup | `backup.service.ts`, `backup.controller.ts` | snapshot SQLite (`VACUUM INTO`) + `uploads/` → zip (archiver); restore zip tervalidasi dengan `unzip`, staging, penggantian DB atomik + rollback `uploads` |
| webhook | `webhook.controller.ts` | receiver multi-endpoint: tiap endpoint punya token sendiri (`/hook/<token>`), CRUD endpoint + SSE `/webhook/stream` untuk UI |
| telegram | `telegram.service.ts`, `telegram.module.ts` | bot long polling: download URL → dokumen Telegram/0x0.st (video tidak auto-play), `/compress` gambar/PDF lewat `CompressService`, allowlist chat ID |
| audit | `audit.service.ts`, `audit.controller.ts`, `common/audit-http.middleware.ts` | catat request API pengubah state (POST/PUT/PATCH/DELETE) dan aksi Telegram ke `audit_log`: payload, actor, fitur, status, durasi, IP/user agent; GET/HEAD/OPTIONS diabaikan; UI di Dev Space → Audit Log |
| calendar | `calendar.service.ts`, `calendar.controller.ts` | OAuth2 Google Calendar baca-tulis: URL consent + state sekali pakai, token di `google_tokens`, refresh otomatis, event semua kalender (maks 250), `events.insert` ke primary |
| downloader | `downloader.service.ts`, `downloader.controller.ts` | yt-dlp + ffmpeg-static; allowlist host, metadata preview (`/info`), temp per request, stream `Content-Disposition` MP4/MP3, cleanup saat selesai/abort |
| llm | `llm.controller.ts` | klien chat-completions kompatibel OpenAI untuk "jelaskan ke LLM" |
| diagnostics | `diagnostics.service.ts`, `diagnostics.controller.ts`, `common/log-buffer.ts`, `common/app-logger.ts` | ringkasan runtime untuk Settings: versi, Node, uptime, memori, ukuran DB/WAL, `user_version`, sisa disk (`statfs`), error terakhir, dan ring buffer 400 log |
| jobs | `jobs.service.ts`, `jobs.controller.ts` | antrean job persisten di tabel `jobs`: status queued/running/completed/failed/cancelled, batas konkurensi, cancel, dedupe, retensi 200/7 hari; handler didaftarkan modul pemakai |
| tools | `compress.service.ts` | kompres/koversi gambar (`sharp`) dan PDF (ghostscript streaming + antrean satu PDF besar; fallback `pdf-lib` ≤50 MB), job latar belakang |
| dev | `dev.service.ts` | hash, HTTP client, tail + stream log, docker lifecycle (start/stop/restart/hapus), Docker Compose (project/service/log/up/down), git status/diff/stage/commit/branch/stash, crontab, DNS + geo |
| dev | `http-store.service.ts` | HTTP workspace di SQLite: request + koleksi, environment, riwayat; header sensitif dikosongkan, riwayat tanpa body/token |
| workspaces | `workspaces.service.ts` | metadata proyek (root, repo, URL, tool, endpoint, shortcut) di SQLite; root lewat jail; ekspor/impor JSON |

## Peta frontend

| File | Peran |
|------|-------|
| `App.tsx` | Gate auth (loading/anonymous/wajib-ganti/siap), sidebar, routing hash, pemilik state sesi |
| `lib/sessions.ts` | Kontainer multi sesi di `localStorage` (`st:sessions:v1`): daftar, urutan, nama, sesi aktif; normalisasi data rusak; sinkron antar-tab lewat event `storage` |
| `components/SessionTabs.tsx` | Bar tab sesi: aktifkan, rename (klik dua kali), tutup (`x`/klik tengah), drag urutkan, tombol `+` buka tool; cursor tab default seperti browser |
| `lib/router.ts` | Router hash ~15 baris — tanpa react-router; query di hash (`#/calendar?google=connected`) dibuang saat mencocokkan id tool |
| `lib/api.ts` | `fetch` wrapper: JSON, cookie, header CSRF, `ApiError` |
| `lib/project.tsx` | Konteks folder proyek aktif (localStorage `st:project`) + riwayat `st:project:recent`; `useProject()` dipakai File Explorer dan Git |
| `components/ProjectPicker.tsx` | Bar pemilih proyek di atas halaman: dropdown riwayat + penjelajah folder (`/fs/list`) |
| `lib/workflow.ts` | Workflow lintas tool: event `st:workflow` (`{tool, action, payload}`); Shell membuka sesi tujuan lalu meneruskan intent ke `usePaletteIntent` |
| `lib/actions.ts` | Registry aksi per tool: id `tool:aksi`, ikon, target fokus; command palette membangun submenu dari sini |
| `lib/palette.ts` | Jembatan command palette → tool: intent tertunda (`usePaletteIntent`) + klik `data-action="tool:aksi"` setelah halaman tampil |
| `components/CommandPalette.tsx` | Palette dua tingkat: submenu statis/async (daftar URL), form pencarian File Explorer, Esc/Backspace kembali |
| `lib/json2ts.ts` | Inferensi tipe: nama dari key, gabung bentuk array, penanda `?` untuk field yang tidak selalu ada |
| `lib/highlight.ts` | Highlighter JSON ~15 baris, escape HTML sebelum span |
| `components/CodeEditor.tsx` | Textarea + gutter nomor baris + Tab + Ctrl+S |
| `tools/CalendarTool.tsx` | Kalender visual `react-big-calendar` (bulan/minggu/agenda); judul event di grid, modal detail (WIB/WITA/WIT), rentang bulan berjalan, form Tambah Event, connect/reconnect OAuth, Sync + auto-refresh 5 menit, mapping all-day; pengingat pop-up + bell 1 jam/30/15 menit dengan pilihan tersimpan di `localStorage` |
| `tools/DownloaderTool.tsx` | Cek link dulu (`/downloader/info`: judul/thumbnail/durasi/resolusi), lalu pilih resolusi/audio-only dan Download; POST `/downloader/proxy`; Chrome/Edge stream ke File System Access, fallback blob; status proses & cancel |
| `tools/calendar.css` | Override tema `react-big-calendar` dengan token warna/font Super Tool; hanya dimuat di halaman Calendar |
| `lib/prayer.ts` | Setelan sholat manual di `localStorage` (`st:prayer`), daftar 27 kota, hitung adhan (Singapore) via dynamic import, jendela pengingat; tanpa geolocation |
| `lib/chime.ts` | AudioContext singleton; dibuka pada gesture pertama (`pointerdown`/`keydown`), lalu `playChime` me-resume context dan memutar tiga beep |
| `components/PrayerWidget.tsx` | Widget jam 24 jam + popover jadwal di header; tampilkan **Atur Lokasi** jika koordinat kosong; cek pengingat tiap menit; throbber oranye 15 menit sebelum dan hijau 10 menit sesudah sholat, tanpa melompat ke sholat berikutnya selama jendela itu |
| `components/PrayerSettings.tsx` | Form Settings: nama kota (label), latitude/longitude manual, dropdown kota cepat, toggle suara & pop-up |
| `tools/SettingsTool.tsx` | Unduh backup (`/api/backup`), restore zip (modal konfirmasi + `POST /api/restore`), info database |
| `tools/StorageTool.tsx` | Storage Monitor: kartu total/disk, treemap SVG, tree urut ukuran/nama, hapus folder allowlist dengan konfirmasi, bersihkan Docker |
| `tools/*.tsx` | Satu tool = satu file, di-`lazy` load |
| `tools/devspace/*.tsx` | Satu tab Dev Space = satu file, di-`lazy` load saat tab pertama dibuka |

## Keputusan dan trade-off

| Keputusan | Alternatif yang ditolak | Alasan |
|-----------|-------------------------|--------|
| SQLite (`node:sqlite`) | Postgres | Single user, tanpa server database terpisah |
| Router hash buatan sendiri | react-router | 8 route statis, tidak perlu nested/loader |
| `marked` + `DOMPurify` | Parser Markdown sendiri | Menulis parser aman = risiko XSS tanpa manfaat |
| `ss` + `ps` | Library port-scanner | Perintah sistem sudah akurat, hasilnya mudah diparse |
| Tailwind tanpa file config | CSS manual | `@theme` di satu file CSS sudah cukup |
| Satu port saat produksi | Nginx/Caddy terpisah | Satu proses, satu URL, tanpa konfigurasi tambahan |
| Baca/tulis OOXML sendiri (`zip.ts`) | `mammoth`, `xlsx`, `docx` | Hanya butuh teks & nilai sel, bukan rendering; hemat 3 dependency besar |
| Job in-memory untuk kompresi | Worker thread / queue eksternal | Satu pengguna, job pendek; hasil tidak perlu tahan restart |
| sharp untuk gambar | ImageMagick lewat subprocess | native, cepat, tanpa proses tambahan; pdf-lib untuk PDF |
| Tidak memakai OnlyOffice | Document Server (Docker) | Butuh ~2 GB RAM untuk satu pengguna; pratinjau + edit teks sudah cukup |

## Kapan harus upgrade

Tanda-tanda desain ini mulai kurang, beserta jalannya:

- **Butuh pencarian isi catatan** → tambah FTS5 di tabel `notes` (`node:sqlite` sudah mendukung).
- **Butuh multi-user / role** → tambah tabel user + `userId` di catatan, guard membaca user dari sesi.
- **Butuh iframe SPA penuh** → pasang reverse proxy per tool (subdomain), bukan memperbesar `proxy.controller.ts`.
- **Iframe jangan reload saat pindah menu** → UrlTool tetap ter-mount di App dan hanya disembunyikan dengan `visibility: hidden` + `pointer-events: none` (bukan `display: none`, karena viewport 0×0 membuat SPA macet di loading). Tiap view punya iframe sendiri yang tidak dilepas; iframe non-aktif ditumpuk `absolute` dengan `opacity: 0`.
- **Navigasi cepat** → `components/CommandPalette.tsx` mendengarkan Ctrl/Cmd+K di window, memfilter daftar menu + aksi dengan `includes`, dan memanggil `navigate` saat Enter. Tanpa dependensi tambahan.
- **Database bersama antar mesin** → pindah ke Postgres; skema tabel sekarang sudah relasional.
