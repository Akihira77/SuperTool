# Audit UI/UX Setelah Milestone E2E

Tanggal: 23 November 2026 (Asia/Jakarta)
Baseline: `7c7913a` (`test(e2e): assert cleanup removes dirs on port failure`)
Cakupan: shell aplikasi, 15 tool, 10 tab Dev Space, 5 viewport (360/390/768/1280/1440), locale ID dan EN.

Dokumen ini mencatat audit setelah milestone E2E & aksesibilitas. Fokusnya regresi,
aksesibilitas, dan usability responsif — bukan penambahan fitur. Acuan utama tetap
source code dan test, bukan klaim laporan sebelumnya.

## 1. Metode

| Metode | Cakupan | Bukti |
|---|---|---|
| Sweep Playwright sementara | 15 tool + 10 tab Dev Space × 5 viewport; cek `scrollWidth`, elemen melewati tepi, target sentuh, heading | skrip sekali pakai, hasil JSON di `/tmp/audit-report.json` lalu dihapus |
| axe (WCAG 2.1 A/AA + 2.2 AA) | 15 tool pada 390 dan 1440 (Dev Space: 10 tab internal pada 1440) | `@axe-core/playwright`, tanpa pengecualian rule |
| Locale EN | 15 tool pada 360 dan 1440: teks EN tidak boleh menambah overflow | pembandingan hasil ukur ID vs EN |
| Ukur DOM terarah | menu proyek, command palette, empty state, sort header, tooltip | `getBoundingClientRect`, `getComputedStyle` |
| Review visual | screenshot 360/390/1440 | pembacaan gambar, bukan pengganti uji screen reader |

Hasil sweep: **0 overflow horizontal tingkat dokumen** pada seluruh tool × viewport,
dan tidak ada overflow baru saat bahasa Inggris aktif. Semua masalah layout yang
tersisa berskala lokal (tooltip, satu menu).

## 2. Temuan

| # | Prioritas | Temuan | Lokasi | Bukti | Dampak | Status |
|---|---|---|---|---|---|---|
| 1 | P1 | Output TypeScript tidak bisa di-scroll dengan keyboard | `apps/web/src/tools/TypesTool.tsx:79` | axe `scrollable-region-focusable` serious di 390 dan 1440 | pengguna keyboard tidak bisa membaca baris terpotong | diperbaiki |
| 2 | P1 | Daftar log diagnostik tidak bisa di-scroll dengan keyboard | `apps/web/src/tools/SettingsTool.tsx:278` | axe serious di 390 dan 1440 | log terbaru tidak terbaca tanpa mouse | diperbaiki |
| 3 | P1 | Panel webhook (daftar + detail) tidak fokusable saat riwayat kosong | `apps/web/src/tools/WebhookTool.tsx:276,301` | axe serious di 390 (2 node) | area scroll tidak terjangkau keyboard | diperbaiki |
| 4 | P2 | Menu proyek keluar viewport kiri di layar sempit | `apps/web/src/components/ProjectPicker.tsx:120` | `#project-menu` `x=-72` pada 360, `x=-42` pada 390 | 72 px kiri menu terpotong: label dan ikon tidak terbaca | diperbaiki |
| 5 | P2 | Dua empty state berbeda tampil bersamaan saat webhook kosong | `apps/web/src/tools/WebhookTool.tsx:335` | "Belum ada request…" dan "Pilih satu request…" tampil sekaligus | panel detail meminta memilih item yang belum ada | diperbaiki |
| 6 | P2 | Audit axe hanya mencakup 5 state aplikasi | `e2e/a11y.spec.ts` | temuan 1–3 tidak terdeteksi suite | regresi aksesibilitas di 13 tool lain lolos CI | diperbaiki |
| 7 | P2 | Tidak ada test layout 360 px | `e2e/` | temuan 4 hanya terlihat lewat pengukuran manual | regresi responsif tidak tertangkap | diperbaiki |
| 8 | P3 | Tooltip menempel di tepi kanan terpotong viewport | `apps/web/src/styles.css:220` | `right=367` pada vw 360 ("Sesi baru"), `right=1454` pada vw 1440 ("Ekspor / unduh") | 3–14 px teks petunjuk hilang | backlog |
| 9 | P3 | Dua `h1` di halaman Markdown saat preview tampil | `apps/web/src/tools/MarkdownTool.tsx` + `.md h1` | `h1` judul halaman + `h1` konten contoh pada ≥1024 | navigasi heading ganda untuk screen reader | backlog |
| 10 | P3 | 22 `aria-label` hardcoded berbahasa Indonesia | `lib/player.tsx`, `NginxTool.tsx`, `UrlTool.tsx`, `devspace/*` | grep `aria-label="` | nama kontrol tidak ikut bahasa aktif | backlog |
| 11 | P3 | Pesan "Tidak ada error tercatat." berada di atas daftar log berisi | `apps/web/src/tools/SettingsTool.tsx:277` | teks khusus `lastError` tetapi terbaca sebagai status seluruh log | terlihat kontradiktif | backlog |
| 12 | P3 | Toolbar format Markdown hanya bisa di-scroll horizontal tanpa petunjuk | `apps/web/src/tools/MarkdownTool.tsx` | strip 708 px dalam 360 px, `overflow-x:auto` | tombol terakhir tampak terpotong di tepi | backlog |

Catatan yang diverifikasi dan **bukan** temuan:

- Empty state Catatan sudah terisi penuh panel (554 px pada 360), bukan menempel atas.
- Tombol sort File Explorer tingginya 24 px (`min-h-6`), memenuhi target WCAG 2.2 2.5.8.
- Kontras di dalam iframe URL Viewer berasal dari dokumen pihak ketiga (URL contoh
  `http://127.0.0.1:20128`), sudah dikecualikan oleh kebijakan audit yang ada.
- Menu "Sesi baru" pada 360 tetap di dalam viewport (`x=112`, `right=352`).

## 3. Implementasi

| File | Perubahan |
|---|---|
| `apps/web/src/tools/TypesTool.tsx` | `<pre>` hasil TypeScript: `tabIndex=0`, `role=region`, `aria-label` i18n |
| `apps/web/src/tools/SettingsTool.tsx` | Daftar log diagnostik: `tabIndex=0`, `role=region`, `aria-label` i18n |
| `apps/web/src/tools/WebhookTool.tsx` | Daftar request dan `<pre>` body fokusable; empty state detail hanya muncul bila daftar berisi |
| `apps/web/src/components/ProjectPicker.tsx` + `styles.css` | Di bawah 440 px menu proyek diposisikan terhadap viewport, tepat di bawah header |
| `apps/web/src/lib/i18n.id.ts`, `i18n.en.ts` | Key `types.output` (ID/EN) |
| `e2e/a11y.spec.ts` | Test baru: axe pada Webhook 390, JSON ke TS 390/1440, Setelan 390/1440 |
| `e2e/layout.spec.ts` | Test baru: menu proyek di dalam viewport 360; webhook hanya satu empty state |

`role="region"` dipakai (bukan hanya `tabindex`) agar area scroll punya nama
aksesibel yang ikut bahasa aktif. Tooltip dibiarkan dekoratif (`aria-hidden`)
karena setiap tombol sudah punya `aria-label`.

Screenshot sebelum/sesudah (360 px, sebelum memakai baseline `7c7913a`):

- Menu proyek: [sebelum](ux/audit-before-project-menu-360.png) ·
  [sesudah](ux/audit-after-project-menu-360.png)
- Webhook kosong: [sebelum](ux/audit-before-webhook-empty-360.png) ·
  [sesudah](ux/audit-after-webhook-empty-360.png)

## 4. Verifikasi

| Perintah | Exit | Hasil |
|---|---|---|
| `pnpm typecheck` | 0 | api + web |
| `pnpm check` | 0 | 87 test lulus |
| `pnpm e2e` | 0 | 31 test lulus |
| `git diff --check` | 0 | bersih |

Bukti test menangkap regresi (negative control lokal, perubahan dikembalikan):
melepas `tabIndex`/`role` dari daftar log membuat `e2e/a11y.spec.ts` gagal, dan
mengembalikan empty state ganda membuat `e2e/layout.spec.ts` gagal.

Keterbatasan: pengukuran hanya pada state awal tiap tool (tanpa data panjang,
tabel lebar, atau file besar); uji screen reader manual belum dilakukan; axe
tidak menganalisis isi iframe pihak ketiga.

## 5. Backlog

- **P3 polish**: tooltip di tepi kanan, `h1` ganda Markdown, 22 aria-label hardcoded,
  copy diagnostik Settings, petunjuk scroll toolbar.
- **P2 berikutnya**: audit state berisi data (tabel Files dengan nama panjang,
  preview file besar, riwayat webhook penuh) pada 360 px.
- **P2 berikutnya**: uji screen reader manual (NVDA/VoiceOver) untuk Notes, Files,
  Dev Space, dan Settings.
