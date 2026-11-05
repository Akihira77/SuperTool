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

## Penyimpanan data

`common/db.ts`: buka `super-tool.db` (`node:sqlite`, WAL), buat skema, simpan salinan `VACUUM INTO` ke `.bak` setiap start, dan impor sekali dari `auth.json`/`notes.json` versi lama. Penulisan lewat SQLite, jadi tidak ada tulis-separuh: transaksi sqlite yang menjamin.

Koneksi utama memakai `journal_mode = WAL`, `busy_timeout = 5000`, dan `synchronous = NORMAL`. Modul `sqlite` (SQLite Viewer di Dev Space) membuka koneksi kedua **read-only** dengan `PRAGMA query_only = ON` + `busy_timeout`, jadi viewer bisa membaca tabel saat aplikasi menulis tanpa `database is locked`. Route `/sqlite/*` ikut AuthGuard global (401 tanpa sesi, 403 tanpa header `x-st-csrf` untuk POST).

Penulisan catatan diserialisasi lewat satu promise chain di `NotesService` agar tidak ada lost update saat autosave beruntun.

## Peta modul backend

| Modul | File penting | Isi |
|-------|--------------|-----|
| auth | `auth.service.ts`, `auth.guard.ts` | login, ganti password, verifikasi sesi |
| notes | `notes.service.ts` | CRUD catatan + serialisasi tulis |
| files | `files.service.ts`, `mime.ts`, `office.ts`, `zip.ts` | list, read, write, mkdir, rename, delete, upload, search, du, grep isi berkas, pratinjau + edit OOXML/ODF, kirim berkas dengan HTTP Range |
| ports | `ports.service.ts` | `ss -ltnpH` + `ps` + hitung koneksi established |
| nginx | `nginx.service.ts` | daftar `*.conf`, baca/tulis, `nginx -t` |
| proxy | `proxy.controller.ts` | mode sederhana `?u=` + probe koneksi |
| proxy | `proxy.middleware.ts` | reverse proxy path-prefix (`/api/proxy/b/<token>/`) dan subdomain (`<hex>.localhost`): aset, cookie, POST body, WebSocket, tulis-ulang origin absolut di HTML/JS/JSON |
| sqlite | `sqlite.controller.ts` | viewer read-only database aplikasi (info tabel, isi tabel, query SELECT) |
| webhook | `webhook.controller.ts` | receiver request masuk: route publik `/hook/<token>` + SSE `/webhook/stream` untuk UI |
| llm | `llm.controller.ts` | klien chat-completions kompatibel OpenAI untuk "jelaskan ke LLM" |
| tools | `compress.service.ts` | kompres/koversi gambar (`sharp`) dan PDF (`pdf-lib`/ghostscript), antrean job latar belakang |
| dev | `dev.service.ts` | hash, HTTP client, tail + stream log, docker read-only, git ringkas, crontab, DNS + geo |

## Peta frontend

| File | Peran |
|------|-------|
| `App.tsx` | Gate auth (loading/anonymous/wajib-ganti/siap), sidebar, routing hash |
| `lib/router.ts` | Router hash 15 baris — tanpa react-router |
| `lib/api.ts` | `fetch` wrapper: JSON, cookie, header CSRF, `ApiError` |
| `lib/json2ts.ts` | Inferensi tipe: nama dari key, gabung bentuk array, penanda `?` untuk field yang tidak selalu ada |
| `lib/highlight.ts` | Highlighter JSON ~15 baris, escape HTML sebelum span |
| `components/CodeEditor.tsx` | Textarea + gutter nomor baris + Tab + Ctrl+S |
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
