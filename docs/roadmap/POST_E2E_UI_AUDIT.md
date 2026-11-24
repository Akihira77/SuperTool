# Audit UI/UX Setelah Milestone E2E

Tanggal: 23 November 2026 (Asia/Jakarta)
Baseline: `7c7913a` (`test(e2e): assert cleanup removes dirs on port failure`)
Cakupan: shell aplikasi, 15 tool, 10 tab Dev Space, 5 viewport (360/390/768/1280/1440), locale ID dan EN.

Fase lanjutan (23 November 2026, baseline `2ee378a`): audit **state berisi data**
pada Files, Markdown, Webhook, dan Setelan, lalu perbaikan backlog B1–B5
(tooltip, heading Markdown, aria-label i18n, status error Setelan, toolbar Markdown).

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
| Sweep state berisi data | Files (46 entri, nama 96 karakter, path 8 level, berkas 2500 baris, baris kode panjang), Markdown (tabel lebar, kode panjang, task list), Webhook (15 request: header/body/query panjang), Setelan (log + path workspace) × 5 viewport; pratinjau dan detail di 360/1440 | fixture `e2e/support/seed.ts` lewat API aplikasi; pengukuran `getBoundingClientRect` + `scrollWidth` |
| Regresi permanen | 4 test baru: layout 360/390, tooltip, axe state berisi, locale ID↔EN | `e2e/responsive-data-rich.spec.ts` |

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
| 8 | P3 | Tooltip menempel di tepi kanan terpotong viewport | `apps/web/src/components/ui.tsx` (`Tooltip`), `styles.css` | `right=375` pada vw 360, `right=1461` pada vw 1440; tooltip kiri `x=-28` | teks petunjuk hilang di kedua tepi | diperbaiki |
| 9 | P3 | Dua `h1` di halaman Markdown saat preview tampil | `apps/web/src/tools/MarkdownTool.tsx` + `.md h1` | `h1` judul halaman + `h1` konten (`["Markdown","Catatan Rilis"]`) | navigasi heading ganda untuk screen reader | diperbaiki |
| 10 | P3 | 23 `aria-label` hardcoded berbahasa Indonesia | `lib/player.tsx`, `NginxTool.tsx`, `UrlTool.tsx`, `devspace/*` | grep `aria-label="` (23 kecocokan) | nama kontrol tidak ikut bahasa aktif | diperbaiki |
| 11 | P3 | Pesan "Tidak ada error tercatat." berada di atas daftar log berisi | `apps/web/src/tools/SettingsTool.tsx` | teks khusus `lastError` tetapi terbaca sebagai status seluruh log | terlihat kontradiktif | diperbaiki |
| 12 | P3 | Toolbar format Markdown hanya bisa di-scroll horizontal tanpa petunjuk | `apps/web/src/tools/MarkdownTool.tsx` | strip 535 px dalam parent `scrollWidth=708` pada `clientWidth=360`, `overflow-x:auto` | tombol terakhir tampak terpotong di tepi | diperbaiki |
| 13 | P1 | Tombol aksi baris File Explorer hanya 23 px | `apps/web/src/tools/FilesTool.tsx:1082` | axe `target-size` serious (9 node) di 360: "23px by 32px, should be at least 24px" | salah tekan Unduh/Salin/Ubah/Hapus di layar sentuh | diperbaiki |
| 14 | P2 | Navigasi bagian Setelan meluber; "Preferensi" `right=379` pada vw 360 | `apps/web/src/tools/SettingsTool.tsx:192` | strip `overflow-x-auto` tanpa petunjuk, tombol `shrink-0` | bagian terakhir tidak terlihat | diperbaiki |
| 15 | P2 | Panel detail Webhook hanya 133 px pada 360 (daftar 89 px) | `apps/web/src/tools/WebhookTool.tsx:269` | `grid-rows 2fr/3fr` membagi sisa 234 px setelah kartu endpoint | header/body hanya terbaca lewat scroll sempit | diperbaiki |
| 16 | P1 | Area scroll state berisi tanpa fokus keyboard | `lib/markdown.ts` (`pre`), `FilesTool.tsx` (preview), `components/VirtualCode.tsx`, `WebhookTool.tsx` (detail) | sweep `noFocus` pada 360–1440 (`PRE` 1367×57, penampil 582×60000, detail webhook) | konten panjang tidak bisa dibaca pengguna keyboard | diperbaiki |

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
| `apps/web/src/components/ui.tsx`, `styles.css` | `Tooltip` dirender lewat portal ke `body`; posisi dihitung dan dijepit 8 px ke dalam viewport pada resize/scroll; muncul saat hover dan fokus keyboard |
| `apps/web/src/lib/markdown.ts` | Opsi `headingOffset` (turunkan `h1…h5` tanpa mengubah sumber Markdown); `pre` diberi `tabIndex=0`, `role=region`, `aria-label` |
| `apps/web/src/tools/MarkdownTool.tsx` | Pratinjau memakai `headingOffset: 1`; toolbar membungkus (`flex-wrap`) tanpa scroll horizontal; panel pratinjau jadi region fokusable |
| `apps/web/src/tools/FilesTool.tsx`, `components/VirtualCode.tsx` | Pratinjau dan penampil berkas besar jadi region fokusable bernama; tombol aksi baris `min-w-6`; label "Edit"/"Pratinjau" ikut i18n |
| `apps/web/src/tools/WebhookTool.tsx` | Di bawah `lg` panel bisa di-scroll vertikal dan grid daftar/detail punya `min-height` 420 px (maks 560 px); detail jadi region fokusable; path terpotong punya `title` |
| `apps/web/src/tools/SettingsTool.tsx` | "Error terakhir" dipisah dari "Log terakhir"; empty state daftar log sendiri; navigasi bagian membungkus, bukan scroll horizontal |
| `lib/player.tsx`, `tools/NginxTool.tsx`, `tools/UrlTool.tsx`, `tools/devspace/{HttpTab,CronTab,DnsTab,EncodeTab,LogsTab,SqliteTab}.tsx` | 23 `aria-label`/tooltip hardcoded diganti `t('a11y.*')` / `t('common.*')` |
| `apps/web/src/lib/i18n.id.ts`, `i18n.en.ts` | Key `a11y.*`, `files.preview`, `files.contentPane`, `markdown.previewPane`, `markdown.codeBlock`, `webhook.detail`, `settings.diagLastError`, `settings.diagNoLogs`, `nginx.explain*` (ID/EN simetris, 953 key) |
| `e2e/support/seed.ts` | Fixture deterministik lewat API aplikasi: 46 entri Files, path 8 level, berkas 2500 baris, 15 request webhook |
| `e2e/responsive-data-rich.spec.ts` | 4 test baru: layout 360/390, tooltip dua tepi, axe 6 state berisi, nama aksesibel ID↔EN tanpa reload |

`role="region"` dipakai (bukan hanya `tabindex`) agar area scroll punya nama
aksesibel yang ikut bahasa aktif. Tooltip tetap dekoratif (`aria-hidden`)
karena setiap tombol sudah punya `aria-label`; tooltip hanya pelengkap visual.

Dua keputusan yang perlu dicatat:

- **B2**: heading dokumen diturunkan satu level saat render (`h1→h2`), bukan
  mengubah isi Markdown pengguna. Halaman tetap punya tepat satu `h1`.
- **B5**: toolbar Markdown membungkus di layar sempit. Tidak ada tombol yang
  disembunyikan atau butuh scroll horizontal, sehingga urutan Tab tetap utuh.

Screenshot sebelum/sesudah (360 px, sebelum memakai baseline `7c7913a`):

- Menu proyek: [sebelum](ux/audit-before-project-menu-360.png) ·
  [sesudah](ux/audit-after-project-menu-360.png)
- Webhook kosong: [sebelum](ux/audit-before-webhook-empty-360.png) ·
  [sesudah](ux/audit-after-webhook-empty-360.png)

## 4. Verifikasi

| Perintah | Exit | Hasil |
|---|---|---|
| `pnpm -r typecheck` | 0 | api + web |
| `pnpm check` | 0 | 9 test unit web + 87 test API (Node) lulus |
| `pnpm e2e` | 0 | 35 test lulus (31 lama + 4 test regresi baru) |
| `git diff --check` | 0 | bersih |

Pengukuran langsung pada build produksi (state berisi data):

| Ukuran | Sebelum | Sesudah |
|---|---|---|
| Tooltip kanan, vw 360 | `right=375` (15 px terpotong) | `x=253, width=99.4` → `right=352.4` |
| Tooltip kanan, vw 1440 | `right=1461` (21 px terpotong) | `right=1432.4` |
| Tooltip kiri (Files), vw 360 | `x=-28` | `x=8` |
| Toolbar Markdown, vw 360 | `scrollWidth=708` pada `clientWidth=360`, `overflow-x:auto` | `scrollWidth=clientWidth=360`, tombol "Tabel" di dalam viewport |
| Pratinjau Markdown/berkas, `h1` | 2 (`Markdown` + judul dokumen) | 1 (`Markdown`); judul dokumen jadi `h2` |
| Detail Webhook, vw 360 | tinggi 133 px | tinggi 328 px |
| Navigasi Setelan, vw 360 | "Preferensi" `right=379` | membungkus; semua tombol di dalam viewport |
| Tombol aksi baris Files | 23×32 px | 24×32 px |
| `aria-label` hardcoded | 23 | 0 (kecuali nama merek `Super Tool` pada landmark) |
| Overflow horizontal dokumen | 0 di semua state terukur (5 viewport untuk state utama, 360/1440 untuk pratinjau/detail) | 0 di semua state terukur |

Bukti test menangkap regresi (negative control lokal, perubahan dikembalikan):
melepas `tabIndex`/`role` dari daftar log membuat `e2e/a11y.spec.ts` gagal, dan
mengembalikan empty state ganda membuat `e2e/layout.spec.ts` gagal.

Keterbatasan: axe tidak menganalisis isi iframe pihak ketiga; kebutuhan
screen reader hanya diverifikasi lewat struktur aksesibilitas (nama peran,
urutan fokus, heading), bukan dengan pembaca layar sungguhan.

## 5. Verifikasi screen reader (persiapan, belum dijalankan)

Lingkungan pengembangan saat ini tidak punya NVDA/JAWS/VoiceOver, jadi **tidak
ada klaim hasil uji screen reader manual** pada dokumen ini. Yang tersedia hanya
pemeriksaan otomatis dan struktural:

| Pemeriksaan | Status | Bukti |
|---|---|---|
| axe WCAG 2.1 A/AA + 2.2 AA pada 6 state berisi | lulus critical/serious | `axe files-data-rich`, `files-preview-data-rich`, `markdown-edit-data-rich`, `markdown-preview-data-rich`, `webhook-detail-data-rich`, `settings-data-rich` |
| Nama aksesibel mengikuti locale tanpa reload | lulus | region "Pratinjau Markdown" → "Markdown preview" → "Pratinjau Markdown" |
| Area scroll punya nama + fokus | lulus | `role=region` + `tabIndex=0`: isi berkas, pratinjau Markdown, blok kode, detail webhook, log Setelan |
| Satu `h1` per panel terlihat | lulus | dihitung pada `[role="tabpanel"]:not([aria-hidden="true"])` |
| Urutan fokus dialog/palet | lulus (test lama) | `e2e/a11y.spec.ts` |

Checklist manual yang masih harus dijalankan di mesin dengan NVDA/VoiceOver:

1. Login → File Explorer: baris tabel terbaca sebagai nama + ukuran + aksi, dan
   aksi baris dapat dijangkau tanpa mouse.
2. File Explorer: buka berkas > 2000 baris, pastikan region "Isi berkas"
   diumumkan dan panah/PageDown menggulir tanpa keluar dari area.
3. Markdown: pindah Split → Pratinjau; pastikan satu `h1`, heading konten mulai `h2`,
   dan blok kode diumumkan sebagai region.
4. Webhook: daftar request dan panel detail dapat dibaca berurutan; path panjang
   tidak memutus pengumuman.
5. Setelan: "Error terakhir" dan "Log terakhir" diumumkan sebagai dua blok
   terpisah; status kosong tidak terbaca sebagai "sistem sehat".

## 6. Backlog

- **P2 berikutnya**: jalankan checklist screen reader di atas pada NVDA (Windows)
  dan VoiceOver (macOS), lalu catat temuan nyata — bukan prediksi.
- **P3**: sisa teks hardcoded non-aksen (mis. `title="Simpan ke SQLite"` dan opsi
  dropdown "Tanpa environment") bila ingin cakupan i18n penuh.
- **P3**: `pnpm e2e` saat ini ~48 detik untuk 35 test; tetap satu worker karena
  semua test berbagi satu database sementara.
