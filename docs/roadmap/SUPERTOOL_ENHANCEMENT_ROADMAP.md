# SuperTool — Roadmap Peningkatan Keamanan, Keandalan, dan Produktivitas

Dokumen ini adalah deliverable Fase 0 dari arahan *Security Hardening, Reliability, and Productivity*.
Isinya baseline repo, temuan, prioritas, rencana bertahap, kriteria penerimaan, dan backlog.
Dokumen ini hidup: setiap fase yang selesai wajib memperbarui tabel status di sini.

- Tanggal baseline: 2026-11-10 (Asia/Jakarta)
- Baseline commit: `bf88478` (sebelum perubahan hardening)
- Repo: `/home/akihira17/personal/super-tool`
- Stack: Node.js >= 22.13, pnpm workspace, NestJS + Express, SQLite (`node:sqlite`), React 19 + Vite + Tailwind 4

---

## 1. Ringkasan eksekutif

SuperTool adalah aplikasi lokal-first dengan satu API NestJS dan satu web React. Semua tool berjalan
di mesin pengguna. Permukaan serangan utamanya bukan internet publik, melainkan **konten lokal /
jaringan privat yang diproses aplikasi**, terutama proxy iframe dan HTTP client. Karena itu prioritas
keamanan diarahkan ke: isolasi origin, otentikasi proxy, pencegahan SSRF, dan pembatasan resource.

Status singkat:

| Area | Status baseline | Status saat ini |
| --- | --- | --- |
| Autentikasi sesi | Cookie `httpOnly`, token bertanda tangan, rate limit login | Dipertahankan; `Secure` mengikuti HTTPS |
| Proxy HTTP/WS | Subdomain **tanpa auth**; WS tanpa validasi tujuan | Tiket per-origin + validasi tujuan |
| Isolasi origin | iframe path-mode same-origin, tanpa sandbox | CSP `sandbox` + atribut `sandbox` iframe |
| SSRF / net guard | Regex privat, tanpa metadata cloud/IPv4-mapped | Allowlist IP + metadata + pinning DNS |
| HTTP client | `redirect: follow`, buffer tak terbatas | Redirect manual tervalidasi, batas 1 MB |
| Baca file | `readFile` utuh lalu potong | Baca maksimum 2 MB + deteksi biner |
| Include grep | Escape lewat path absolut / `../` | Dijail ke `ST_FS_ROOTS` |
| Download notes | Tidak ada | Unduh `.md` dari note aktif |
| Jobs | Belum ada | Antrean persisten + status/cancel/retensi |
| Backup/restore atomik | Belum atomik | Staging + fsync/rename + rollback uploads |

---

## 2. Arsitektur saat ini

### 2.1 Proses dan port

- API: NestJS di `ST_PORT` (default 3001), global prefix `/api`.
- Web: Vite dev/preview di 4173; di produksi dilayani statis.
- PM2: `super-tool-api`, `super-tool-web`.
- Data: `ST_DATA_DIR` (default `apps/api`), SQLite `super-tool.db`, upload, backup, log.

### 2.2 Backend

- `apps/api/src/main.ts` — bootstrap Express, body parser manual, audit middleware, proxy middleware,
  static web, security headers, health check, graceful shutdown.
- `apps/api/src/common/db.ts` — `node:sqlite`, migrasi idempoten, WAL.
- `apps/api/src/common/net-guard.ts` — validasi alamat privat/publik, metadata, resolusi DNS.
- `apps/api/src/common/http-client.ts` — HTTP client terbatas untuk fitur server-side.
- Modul: `auth`, `files`, `notes`, `dev`, `proxy`, `downloads`, `storage`, `backup`, `audit`,
  `hosts`, `docker`, `git`, `calendar`, `webhook`, `ports`, `nginx`, `logs`, `cron`, `network`.
- Semua route kecuali `@Public()` dilindungi guard sesi; mutasi memakai CSRF header.

### 2.3 Frontend

- `apps/web/src/App.tsx` — katalog tool, hash router, session container multi-tab.
- Session container menyimpan daftar tab + tab aktif di `localStorage` (`st:sessions:v1`), disinkronkan
  antar-tab lewat event `storage`; isi internal tool tidak dipersist.
- Session yang pernah dibuka tetap ter-mount (kecuali tool viewer) agar iframe/terminal/scan tidak putus.
- Tool berat di-lazy-load per session dengan Suspense boundary sendiri.

### 2.4 Alur proxy

Tiga mode:

1. **Original** — iframe langsung ke target; hanya untuk target yang mengizinkan framing.
2. **Subdomain** — `http://<hex-target>.localhost:<port>/?st_ticket=...`; origin terpisah, cookie
   target tidak bercampur dengan cookie SuperTool. Tiket wajib, terikat pada origin target, berlaku 12 jam.
3. **Path** — `/api/proxy/b/<token>/...`; dipakai kalau subdomain tidak bisa. Same-origin secara
   network, sehingga respons HTML diberi CSP `sandbox` dan iframe diberi atribut `sandbox` tanpa
   `allow-same-origin`.

WebSocket mengikuti mode yang sama; subdomain wajib tiket, path wajib sesi.

---

## 3. Temuan dan status

### 3.1 Kritis (P0)

| ID | Temuan | Dampak | Status |
| --- | --- | --- | --- |
| P0-1 | Proxy subdomain tanpa autentikasi | Siapa pun di host yang bisa menjangkau port API dapat memakai proxy untuk target lokal/privat | **Selesai** — tiket per-origin, 401 tanpa tiket |
| P0-2 | WebSocket subdomain tanpa auth dan tanpa validasi tujuan | Tunnel WS arbitrer ke jaringan lokal | **Selesai** — tiket + `assertLocalUrl` sebelum connect |
| P0-3 | Proxy path same-origin, iframe tanpa sandbox | XSS target dapat membaca API same-origin | **Mitigasi** — CSP `sandbox`, iframe `sandbox` tanpa `allow-same-origin`. Isolasi penuh butuh mode subdomain |
| P0-4 | Include grep bisa keluar dari `ST_FS_ROOTS` | Baca file di luar root lewat path absolut/`../` | **Selesai** — `jailPath` sebelum `stat` |
| P0-5 | SSRF: metadata cloud, IPv4-mapped, redirect bebas | Akses metadata cloud / jaringan internal | **Selesai** — net guard baru, redirect manual, validasi tiap hop |

### 3.2 Tinggi (P1)

| ID | Temuan | Dampak | Status |
| --- | --- | --- | --- |
| P1-1 | Proxy HTTP memakai `fetch` global setelah validasi | DNS rebinding TOCTOU | **Selesai** — `streamLocal` mem-pin IP hasil resolusi |
| P1-2 | Rewrite proxy membaca seluruh body | Memori naik untuk respons besar | **Selesai** — batas 8 MB, 502 |
| P1-3 | Upload/backup/restore menahan data di memori | OOM pada file besar | **Selesai** — upload file & restore ke disk (multer), backup di-stream archiver |
| P1-4 | Restore tidak atomik / cache tidak invalid | Data lama/parsial setelah restore | **Selesai** — staging, validasi SQLite, rename atomik, rollback uploads, cache auth/disk dibuang |
| P1-5 | Tidak ada health/graceful shutdown | Restart memutus job/tulis DB | **Selesai** — `/api/health`, shutdown hooks |
| P1-6 | CORS default terbuka | Origin asing dapat memanggil API | **Selesai** — CORS hanya jika `ST_DEV_ORIGIN` |
| P1-7 | Cookie `Secure` dipaksa di HTTP loopback | Login gagal di deployment HTTP lokal | **Selesai** — `secure: req.secure` |

### 3.3 Sedang (P2)

| ID | Temuan | Dampak | Status |
| --- | --- | --- | --- |
| P2-1 | Belum ada job runner terpusat | Operasi panjang memblokir request / tidak tahan restart | **Selesai** — tabel `jobs`, API `/jobs`, kompresor memakai antrean; uji `apps/api/jobs.test.mjs` |
| P2-2 | Belum ada pusat diagnostik | Sulit menelusuri error lintas tool | **Selesai** — `GET /api/diagnostics` + kartu Settings; ring buffer log |
| P2-3 | Aksi tersebar per tool | Command palette tidak lengkap | **Selesai** — registry `lib/actions.ts`, palette membangun submenu dari registry |
| P2-4 | Tidak ada workspace | Konteks proyek bercampur | **Terbuka** |
| P2-5 | Belum ada Git workbench / Docker Compose / log explorer / AI kontekstual | Fitur Fase 4 | **Terbuka** |

---

## 4. Prinsip dan batasan

Wajib dipertahankan:

- **Lokal-first**: tidak ada cloud/DB baru; data tetap di mesin pengguna.
- **Tanpa shell arbitrer**: eksekusi hanya lewat allowlist argumen yang sudah ada.
- **Kompatibilitas data**: skema SQLite berubah hanya lewat migrasi idempoten; backup sebelum migrasi.
- **Konfirmasi aksi destruktif**: hapus, restore, overwrite, kill proses.
- **Resource terbatas**: semua baca/tulis/streaming punya batas byte, waktu, dan jumlah item.
- **Tidak ada regresi fitur**: proxy, terminal, scan, download, session container tetap berjalan.

Non-goals untuk putaran ini: multi-user/tenant, cloud sync, akses internet publik, plugin dinamis,
penulisan file arbitrary dari browser.

---

## 5. Roadmap bertahap

Kompleksitas: **S** <= 1 hari, **M** 2–4 hari, **L** > 4 hari (perkiraan engineering, bukan kalender).

### Fase 0 — Audit dan baseline (selesai)

- [x] Audit repo, dokumentasi, dan dependensi.
- [x] Catat baseline build/test.
- [x] Dokumen roadmap ini.
- Acceptance: dokumen memuat arsitektur, temuan, prioritas, acceptance per fase.

### Fase 1 — Keamanan kritis (hampir selesai)

- [x] Jail filesystem untuk semua path yang berasal dari request.
- [x] Net guard: privat, metadata, IPv4-mapped, IPv6 ULA/link-local.
- [x] Redirect manual + validasi tiap hop di HTTP client.
- [x] Proxy subdomain: tiket per-origin, HTTP + WS.
- [x] Path-mode: CSP `sandbox` + iframe `sandbox`.
- [x] CORS mati kecuali dikonfigurasi.
- [x] Security headers + health + graceful shutdown.
- [x] **P1-1** Pinning IP pada proxy HTTP (`streamLocal`, lookup tetap ke alamat hasil validasi).
- [ ] Audit ulang semua endpoint `@Public()` dan route statis.
- [ ] Uji bypass: path traversal, encoded slash, symlink, DNS rebinding.
- Acceptance:
  - Tidak ada request yang bisa membaca/menulis di luar `ST_FS_ROOTS`.
  - Proxy tanpa tiket/sesi selalu 401; WS tanpa tiket 401.
  - Target metadata/privat tetap diblokir walau lewat redirect.
  - `pnpm check` hijau; uji manual terdokumentasi.

### Fase 2 — Keandalan dan resource (M/L)

- [x] Baca file besar per chunk (2 MB, offset byte) + streaming download; batas ukuran eksplisit.
- [x] Upload streaming ke disk (bukan buffer); batas per file dan total.
- [x] Backup/restore atomik: staging, fsync, rename, rollback uploads, invalidasi cache auth/disk; uji kegagalan di `apps/api/restore.test.mjs`.
- [x] Job runner: antrean persisten, status, cancel, batas konkurensi; retry manual lewat start ulang. Uji `apps/api/jobs.test.mjs`.
- [x] Pusat diagnostik: versi, uptime, DB, disk, log terakhir, error terakhir (`GET /api/diagnostics`, kartu Settings).
- [x] Standar Node >= 22.13, `.nvmrc`, dan `engines` paket API/root; README menyebut prasyarat yang sama.
- Acceptance:
  - File 1 GB tidak menaikkan RSS > 200 MB.
  - Restore yang gagal tidak meninggalkan DB parsial (diuji: arsip traversal, SQLite rusak, versi skema lebih baru).
  - Job bertahan setelah restart dan bisa dibatalkan.
  - Diagnostik menjawab < 1 detik.

### Fase 3 — Produktivitas (M)

- [ ] Action registry terpusat: id, label, ikon, shortcut, handler, guard.
- [x] Command palette memakai registry `apps/web/src/lib/actions.ts` (bukan daftar manual).
- [x] Workflow lintas tool: File Explorer → Kompresor lewat event `st:workflow` + `usePaletteIntent`; tool lain memakai jalur yang sama.
- [x] HTTP collections: request tersimpan + koleksi, environment `{{variabel}}`, riwayat 20 terakhir; disimpan di SQLite, header sensitif tidak dipersistensi.
- [ ] Workspace: root proyek, session, preferensi per workspace.
- Acceptance:
  - Semua aksi utama muncul di palette tanpa duplikasi kode.
  - Workflow berjalan tanpa menyalin data manual.
  - Workspace berpindah tanpa restart.

### Fase 4 — Advanced (L)

- [ ] Git workbench: status, diff, stage, commit, branch, log.
- [ ] Docker Compose: daftar project, up/down/restart, log.
- [ ] Log explorer: tail, filter, level, pencarian.
- [ ] AI kontekstual: ringkas file/log, saran aksi, dengan consent eksplisit.
- Acceptance:
  - Operasi Git/Docker aman terhadap path traversal dan argumen injection.
  - Log explorer menangani file besar tanpa memuat seluruh isi.
  - AI tidak mengirim data keluar tanpa persetujuan.

### Fase 5 — Non-fungsional (M)

- [ ] Batas memori/CPU per operasi; timeout konsisten.
- [ ] Aksesibilitas: fokus, label, keyboard untuk tab/session.
- [ ] Responsif untuk layar kecil.
- [ ] Telemetri lokal (opt-in) untuk durasi/error.
- Acceptance:
  - Audit aksesibilitas otomatis tidak menemukan pelanggaran kritis.
  - Tidak ada operasi tanpa timeout.

### Fase 6 — Test dan CI (M)

- [ ] Unit test untuk net guard, jail, token, backup.
- [ ] Integration test API dengan DB sementara.
- [ ] E2E minimal: login, buka tool, proxy, notes download.
- [ ] CI: typecheck, build, test, audit dependensi.
- Acceptance:
  - `pnpm check` mencakup semua paket.
  - CI gagal pada type error, test gagal, atau build gagal.

### Fase 7 — Milestone rilis

- [ ] M1 (Fase 1): security hardening.
- [ ] M2 (Fase 2): reliability.
- [ ] M3 (Fase 3): productivity.
- [ ] M4 (Fase 4): advanced.
- Acceptance per milestone: dokumentasi, changelog, backup, rollback, dan verifikasi manual.

---

## 6. Backlog berprioritas

1. Job runner + diagnostik.
2. Action registry + palette.
3. Workspace.
4. Git/Docker/log/AI.
5. Test/CI lengkap.

---

## 7. Matriks verifikasi

| Pemeriksaan | Perintah | Baseline |
| --- | --- | --- |
| Typecheck API | `pnpm --filter @super-tool/api typecheck` | lulus |
| Typecheck web | `pnpm --filter @super-tool/web typecheck` | lulus |
| Build API | `pnpm --filter @super-tool/api build` | lulus |
| Build web | `pnpm --filter @super-tool/web build` | lulus |
| Selfcheck API | `node --test apps/api/selfcheck.test.mjs` | 11/11 lulus |
| Uji restore | `node --test apps/api/restore.test.mjs` | 6/6 lulus (roundtrip, traversal, bentuk arsip, SQLite rusak, versi skema, uploads lama) |
| Full check | `pnpm check` | dijalankan sebelum rilis |

Uji manual keamanan yang sudah dilakukan:

- Proxy subdomain tanpa tiket → 401.
- Proxy subdomain dengan `?st_ticket` → 302 + cookie `HttpOnly`; follow cookie → 200.
- WebSocket tanpa tiket → 401; dengan tiket → 101.
- Tiket untuk `169.254.169.254` ditolak 400.
- Health mengembalikan header `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, CSP.
- Origin asing tidak mendapat `Access-Control-Allow-Origin`.

---

## 8. Rollback

- Perubahan kode: `git revert <commit>` per fase; tidak ada migrasi destruktif.
- DB: backup otomatis sebelum migrasi (Fase 2); restore lewat menu backup.
- Konfigurasi: `ST_DEV_ORIGIN` kosong = CORS mati; `ST_PROXY_ALLOW_PUBLIC=0` default.
- Proxy: jika tiket bermasalah, nonaktifkan mode subdomain di UI (target tetap bisa dibuka lewat path).

---

## 9. Risiko dan mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Tiket proxy bocor lewat URL | `?st_ticket` langsung diubah jadi cookie `HttpOnly` + redirect; `Referrer-Policy: no-referrer` |
| CSP sandbox memblokir tool yang butuh same-origin | Gunakan mode subdomain; path-mode hanya fallback |
| Net guard memblokir target lokal yang sah | `ST_PROXY_ALLOW_PUBLIC` hanya untuk publik; target privat tetap perlu tiket |
| Restore merusak DB | Backup sebelum restore + tulis atomik (Fase 2) |
| Perubahan session container merusak state | Container saja yang dipersist; isi tool tidak |

---

## 10. Keputusan terbuka

- Apakah mode path dipertahankan jangka panjang, atau dihapus setelah subdomain stabil?
- Apakah job runner memakai SQLite yang sama atau file antrean terpisah?
- Apakah workspace menyimpan snapshot session atau hanya preferensi root?
- Batas ukuran file default: 2 MB baca teks, 1 MB respons HTTP; perlu konfigurasi per tool?

---

## 11. Catatan implementasi

- `node:sqlite` membutuhkan Node >= 22.13; root dan API `engines` sudah disamakan, `.nvmrc` = 22.13.0.
- Semua route API memakai prefix `/api`; health ada di `/api/health`.
- Error API mengembalikan JSON `{message, error, statusCode}`; jangan bocorkan stack.
- Audit log meredaksi rahasia dan membatasi ukuran payload.
