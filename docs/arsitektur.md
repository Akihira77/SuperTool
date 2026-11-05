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
Controller  ──►  Service  ──►  fs / ss / nginx / fetch / file JSON
  ▼
JSON response
~~~

Urutan middleware di `main.ts`: body parser (limit 25 MB untuk menyimpan file besar) → static assets → SPA fallback `index.html` → route `/api`.

## Autentikasi

| Bagian | Implementasi |
|--------|--------------|
| Penyimpanan | `data/auth.json`: `{ salt, hash, pv, mustChange, secret }` |
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

`common/json-store.ts`: baca file, tulis ke `*.tmp`, lalu `rename`. Rename atomik di filesystem yang sama, jadi proses mati di tengah penulisan tidak membuat data korup.

Penulisan catatan diserialisasi lewat satu promise chain di `NotesService` agar tidak ada lost update saat autosave beruntun.

## Peta modul backend

| Modul | File penting | Isi |
|-------|--------------|-----|
| auth | `auth.service.ts`, `auth.guard.ts` | login, ganti password, verifikasi sesi |
| notes | `notes.service.ts` | CRUD catatan + serialisasi tulis |
| files | `files.service.ts`, `mime.ts` | list, read, write, mkdir, rename, delete, upload, search, du |
| ports | `ports.service.ts` | `ss -ltnpH` + `ps` + hitung koneksi established |
| nginx | `nginx.service.ts` | daftar `*.conf`, baca/tulis, `nginx -t` |
| proxy | `proxy.controller.ts` | fetch target, lepas `X-Frame-Options`/CSP, suntik `<base>`, probe koneksi |
| llm | `llm.controller.ts` | klien chat-completions kompatibel OpenAI untuk "jelaskan ke LLM" |

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

## Keputusan dan trade-off

| Keputusan | Alternatif yang ditolak | Alasan |
|-----------|-------------------------|--------|
| File JSON untuk data | SQLite/Postgres | Single user, volume kecil, tanpa dependency |
| Router hash buatan sendiri | react-router | 8 route statis, tidak perlu nested/loader |
| `marked` + `DOMPurify` | Parser Markdown sendiri | Menulis parser aman = risiko XSS tanpa manfaat |
| `ss` + `ps` | Library port-scanner | Perintah sistem sudah akurat, hasilnya mudah diparse |
| Tailwind tanpa file config | CSS manual | `@theme` di satu file CSS sudah cukup |
| Satu port saat produksi | Nginx/Caddy terpisah | Satu proses, satu URL, tanpa konfigurasi tambahan |

## Kapan harus upgrade

Tanda-tanda desain ini mulai kurang, beserta jalannya:

- **Catatan > ribuan atau butuh pencarian isi** → ganti `NotesService` ke SQLite (`node:sqlite` sudah bawaan Node 22+, tanpa dependency baru).
- **Butuh multi-user / role** → tambah tabel user + `userId` di catatan, guard membaca user dari sesi.
- **Butuh iframe SPA penuh** → pasang reverse proxy per tool (subdomain), bukan memperbesar `proxy.controller.ts`.
- **Catatan JSON mulai lambat** → pisahkan satu file per catatan (`data/notes/<id>.json`), tulis hanya file yang berubah.
