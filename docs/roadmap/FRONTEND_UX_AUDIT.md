# Audit UX/UI Frontend SuperTool

Status: pasca-implementasi, 10 November 2026 (Asia/Jakarta)  
Baseline kode: `7437ca5 Update implementation summary head`  
Aplikasi: `apps/web` (React 19, Vite, Tailwind 4)  
Cakupan: shell aplikasi, session tabs, command palette, dialog, seluruh halaman tool, Dev Space, responsive 360–1440 px, aksesibilitas, dan i18n.

## 1. Ringkasan eksekutif

SuperTool sudah punya identitas visual yang kuat (dark navy, aksen biru/ungu, kepadatan tinggi), tetapi sebelum audit terdapat tiga masalah struktural:

1. **Skala tipografi tidak konsisten.** 593 utility `text-[...]` arbitrer, 406 di antaranya ≤11 px. Label 9–10,5 px sulit dibaca pada layar 1440 px, apalagi 360 px.
2. **Shell belum responsif dan belum punya affordance aksesibilitas dasar.** Sidebar selalu `w-60`/`w-14`, tanpa drawer mobile, tanpa skip link, dan header memadatkan aksi menjadi ikon kecil.
3. **Pola interaksi penting belum lengkap.** Command palette hanya substring tanpa trap fokus; session tabs punya `role="tab"` tetapi tidak bisa dinavigasi dengan panah; `WorkspacePanel` memakai textarea delimiter; beberapa dialog tidak mengembalikan fokus.

Audit ini juga menemukan masalah layout nyata di 390 px: daftar catatan `w-64` menghabiskan hampir seluruh lebar editor, toolbar Notes keluar viewport, tabel Files memaksa scroll horizontal, dan tab Dev Space terpotong.

**Status akhir:** temuan P0/P1 sudah diperbaiki. Tidak ada overflow horizontal dokumen pada 15 route × 6 viewport (360, 390, 768, 1024, 1280, 1440). Typecheck, build, dan 9 test frontend lulus. Sisa pekerjaan bersifat P2/P3 dan tercatat di bagian 12.

## 2. Metode dan bukti

| Metode | Cakupan | Bukti |
|---|---|---|
| Audit sumber | 67 file `.ts/.tsx`, `styles.css`, komponen bersama | hitungan utility, grep token/hex/aria, pembacaan App.tsx dan tool |
| Playwright headless | 15 route × 6 viewport; screenshot terautentikasi | `docs/roadmap/ux/after-<route>-<width>.png` |
| Pengukuran DOM | `scrollWidth`, bounding box, tinggi kontrol, nama aksesibel | script Playwright ad hoc; hasil di bagian 8–9 |
| Uji keyboard | skip link, palette, drawer mobile, session tabs | skrip Tab/Shift+Tab/Escape/Arrow |
| Analisis visual | screenshot 1440/768/360 melalui vision bridge | catatan vision di bagian 11 |
| Kontras WCAG | pasangan token utama | rasio di bagian 4 |
| Simetri i18n | kunci `ID` vs `EN` | 896 kunci per locale, 0 selisih |

Keterbatasan: tidak ada uji perangkat fisik, tidak ada axe-core di CI, dan screenshot berasal dari Chromium headless. Hasil vision tidak boleh dianggap sebagai pengganti uji manual screen reader.

## 3. Arsitektur UI saat ini

```text
App.tsx
├── skip link + main landmark
├── sidebar (desktop rail / mobile drawer, focus trap)
├── header (ProjectPicker, PrayerWidget, global actions)
├── SessionTabs (container sesi, persist localStorage)
└── session viewport
    └── satu SessionContent per sesi yang pernah dibuka
        └── Suspense boundary sendiri → tool lazy
```

Prinsip yang dipertahankan:

- **Satu tool = satu file** di `apps/web/src/tools`, di-lazy-load.
- **Sesi adalah container**, bukan state internal tool. Yang dipersist hanya daftar sesi, nama, urutan, dan sesi aktif (`st:sessions:v1`).
- **Sesi yang pernah dibuka tetap ter-mount** agar scan, SSE, download, dan iframe URL Viewer tidak terputus saat berpindah tab.
- **Tidak ada polling.** Sinkronisasi antar-tab memakai event `storage`.

Dampak UX: perpindahan tab terasa seperti tmux, tetapi biaya memori naik linear sampai 16 sesi. Ini keputusan sadar; lihat bagian 12.

## 4. Inventaris token

### 4.1 Token warna final

| Peran | Token | Nilai | Kontras terhadap `bg` |
|---|---|---|---|
| Background aplikasi | `bg` | `#080d13` | — |
| Surface utama | `panel` | `#0f1721` | 1,10:1 (surface) |
| Surface sekunder | `panel2` | `#16212d` | 1,22:1 |
| Surface elevasi/terpilih | `panel3` | `#1b2836` | 1,35:1 |
| Hover | `hover` | `#1e2c3b` | 1,44:1 |
| Border | `line` | `#28394b` | 1,65:1 |
| Border halus | `line-soft` | `#1b2836` | 1,35:1 |
| Teks utama | `ink` | `#eaf1f8` | **17,11:1** |
| Teks sekunder | `muted` | `#9aacbf` | **8,38:1** (di `panel`: 7,75:1) |
| Aksen utama | `accent` | `#7aa2ff` | **7,83:1** |
| Aksen sekunder | `accent2` | `#a78bfa` | 6,85:1 |
| Sukses | `ok` | `#4ade80` | **11,19:1** |
| Peringatan | `warn` | `#fbbf24` | **11,68:1** |
| Error | `bad` | `#fb7185` | **7,24:1** |
| Info | `info` | `#60a5fa` | 7,16:1 |
| Fokus | `focus` | `#a9c4ff` | **11,16:1** |

Sebelum audit: `line #243445`, `muted #91a4b7`, `accent #6b96ff`, `ok #34d399`, `bad #f87171`; tidak ada token `info`, `focus`, `panel3`, atau `hover`. Tidak ada token `text-danger`; beberapa tool memakainya sehingga class tidak berefek. Sekarang semua memakai `bad`.

### 4.2 Temuan token

| Temuan | Bukti | Dampak | Status |
|---|---|---|---|
| 22 hex hardcoded di TSX | grep `#[0-9a-f]{6}` | warna tidak konsisten dengan tema | Sebagian: 37 hex tersisa (banyak warna data/treemap), perlu migrasi token data |
| `text-danger` tidak terdefinisi | SettingsTool | error state tidak berwarna | Diperbaiki → `bad` |
| Tidak ada token fokus | `styles.css` | focus ring bergantung browser | Diperbaiki → `focus` + `:focus-visible` global |
| Border terlalu gelap | `line #243445` | pemisah kontrol sulit terlihat | Diperbaiki → `#28394b` |
| Muted terlalu rendah | `#91a4b7` | teks bantu kurang tegas | Diperbaiki → `#9aacbf` |

## 5. Tipografi

### 5.1 Baseline

- 593 utility ukuran arbitrer; 406 ≤11 px.
- Label 9 px (FilesTool), 10 px (beberapa badge), 10,5 px (label form), 11 px (umum).
- Tidak ada skala baku untuk judul halaman; `PageHeader` memakai 16 px.
- Session tabs 12 px, tombol 12,5 px, input tanpa ukuran minimum konsisten.
- Line-height dan tracking hampir tidak pernah ditentukan.

### 5.2 Skala final

| Peran | Ukuran | Implementasi |
|---|---|---|
| Judul halaman | 20 px / 28 | `PageHeader` `text-[20px] leading-7 tracking-[-0.015em]` |
| Judul seksi | 16 px | `.section-title` |
| Body | 14 px / 1,5 | `body` |
| Kontrol/tab/nav | 13–13,5 px | `.btn`, `.input`, `.tab`, `.nav-item` |
| Helper | 12,5 px | `.hint` |
| Label | 11,5 px uppercase, tracking 0,07em | `.label` |
| Metadata/badge | 11,5 px | `.badge`, chip |
| Kode/log/path | 12,5–14 px mono | `.mono`, CodeEditor |

Batas bawah praktis adalah **11,5 px**. Tidak ada lagi teks ≤11 px di TSX. Angka 574 utility arbitrer masih ada, tetapi terdistribusi pada 11,5–20 px; ini utang kosmetik, bukan masalah keterbacaan.

### 5.3 Temuan tipografi tersisa

| Temuan | Lokasi | Prioritas |
|---|---|---|
| 574 utility `text-[...]` belum menjadi token skala | seluruh TSX | P2 |
| Treemap Storage masih ~8 label SVG 11 px | `StorageTool.tsx` | P3 (batas ruang visual) |
| CodeEditor 14 px, gutter 13 px | `CodeEditor.tsx` | Selesai |
| Markdown preview 15 px | `.md` | Sengaja, konten bacaan |

## 6. Komponen dan pola

| Komponen | Temuan baseline | Perbaikan | Status |
|---|---|---|---|
| `PageHeader` | judul 16 px, subtitle 11,5 px, aksi berdesakan di mobile | judul 20 px, subtitle 13 px disembunyikan <`sm`, aksi satu baris scroll horizontal | Selesai |
| Tombol | tinggi 30 px, teks 12,5 px, tanpa varian ikon konsisten | `.btn` min 34 px, `.btn-sm` 32 px, `.btn-icon` 32 px, focus ring | Selesai |
| Input | tinggi 32 px, teks 12,5 px, tanpa state invalid | min 36 px, teks 13,5 px, `aria-invalid` styling | Selesai |
| `Tabs` | `role=tablist` tanpa roving tabindex/panah | `useId`, roving tabindex, Arrow/Home/End, `aria-controls` | Selesai |
| Session tabs | tanpa panah, close 20 px, tanpa hint keyboard | panah/Home/End, Alt+panah reorder, F2 rename, close 24 px, hint `aria-describedby` | Selesai |
| Command palette | substring, tanpa trap/restore, tanpa status error | fuzzy scoring + highlight, trap, combobox/listbox, loading/error | Selesai |
| Dialog ProjectPicker | tanpa trap, tanpa label | focus trap, `aria-modal`, `aria-labelledby`, retry | Selesai |
| WorkspacePanel | textarea delimiter `|`, rawan salah format | editor baris terstruktur, validasi, import/export, active badge | Selesai |
| Confirm | `window.confirm` | dialog terstandar + fokus | Selesai |
| Toast | tanpa live region | `aria-live="polite"` | Selesai |
| Tabel Files | baris 21 px, header 11 px, tanpa semantik tabel mobile | baris 32 px, teks ≥11,5 px, kolom ukuran disembunyikan <`sm`, `table-fixed` | Sebagian |
| Form error | pesan tidak terhubung ke input | `aria-invalid`, error `role=alert` di Workspace | Sebagian |

### 6.1 Pola layout yang dipakai

- **Toolbar**: satu baris `flex flex-wrap items-center gap-2`; aksi sekunder masuk `.btn-ghost`; aksi destruktif terpisah.
- **Pane**: `soft-panel` atau `card`, bukan card bertumpuk.
- **Empty state**: `Empty` dari `ui.tsx`; tinggi minimum 40–160 px sesuai konteks.
- **Data padat**: tabel/grid mono, header `.label`, angka rata kanan.
- **Mobile**: kontrol utama tetap terlihat; kontrol sekunder masuk menu overflow.

## 7. Navigasi dan shell

Baseline:

- Sidebar fixed `w-60`, collapse `w-14`, tanpa drawer; di 390 px konten hanya 390 px karena sidebar menjadi rail 56 px.
- Tidak ada skip link; fokus pertama jatuh ke tombol sidebar.
- Header memuat ProjectPicker, PrayerWidget, dan aksi global; di mobile saling menekan.
- Session tabs berada di atas konten tanpa overflow indicator.

Perbaikan:

- Drawer mobile dengan backdrop, `role="dialog"`, `aria-modal`, focus trap, Escape, restore fokus.
- Skip link “Lewati ke konten” → `main#main-content`.
- Sidebar rail `md`, expanded `lg`; state collapse dipersist.
- Tombol menu mobile ber-`aria-controls`/`aria-expanded`.
- Session tabs satu baris, scroll horizontal, tab aktif auto-scroll, hint keyboard.

Temuan tersisa:

| Temuan | Dampak | Prioritas |
|---|---|---|
| Dua tombol ber-`aria-controls="app-sidebar"` (toggle sidebar dan menu mobile) | bisa membingungkan screen reader | P3; beda `aria-label` sudah jelas |
| Sidebar desktop rail tidak punya tooltip label | pengguna baru harus menebak ikon | P2 |
| Tidak ada indikator “sesi penuh” selain toast | pengguna menekan + dan tidak terjadi apa-apa | P3 |

## 8. Responsif

Viewport yang diuji: 360×800, 390×844, 768×1024, 1024×768, 1280×800, 1440×900. Route: notes, markdown, files, viewer, json, types, compress, downloader, devspace, storage, nginx, ports, webhook, calendar, settings.

| Temuan baseline | Perbaikan | Bukti |
|---|---|---|
| Notes: list `w-64` + editor sisa ±60 px di 390 | list menjadi overlay penuh <`md`, menutup setelah pilih catatan | screenshot 390; editor terbaca |
| Notes toolbar keluar viewport (tombol kanan di x=457) | toolbar `flex-wrap`, judul `basis-full`, count disembunyikan <`sm` | tidak ada overflow |
| Files: tabel 540 px di container 390 | `table-fixed`, kolom size disembunyikan <`sm`, aksi 7,25rem | tabel 390/390 |
| Files toolbar berdesakan | aksi desktop di grup `lg`, sisanya overflow menu | screenshot 360/768 |
| Markdown textarea mulai y=375 | baris format `nowrap` + scroll, tombol 32 px | mulai y=262 |
| Dev Space 10 tab, Audit Log terpotong (right 1472) | tabbar `flex-wrap`, gap 1, padding 2 | satu baris di 1440, wrap rapi di 360 |
| Calendar month grid sempit | default agenda <`md`; kontrol 32 px | screenshot 390 |
| Webhook URL box meluber | box `max-sm:basis-full`, input penuh | 324×51 di 390 |
| Settings satu halaman panjang | nav seksi sticky + scroll | 4 seksi |

Hasil pengukuran akhir: **0 overflow horizontal tingkat dokumen** pada seluruh kombinasi. Overflow lokal yang disengaja tetap ada pada tabel data, code viewer, dan toolbar format Markdown (di dalam container `overflow-x-auto`).

## 9. Aksesibilitas

| Area | Temuan | Perbaikan | Status |
|---|---|---|---|
| Landmark | tidak ada skip link; `main` tanpa id | skip link + `main#main-content tabIndex=-1` | Selesai |
| Fokus | tidak konsisten; beberapa dialog tidak trap | `useFocusTrap` (first, Tab loop, restore), `:focus-visible` global | Selesai |
| Drawer mobile | tidak ada | dialog semantics, trap, Escape, restore | Selesai |
| Session tabs | tanpa panah | roving tabindex, Arrow/Home/End, `aria-selected` | Selesai |
| Shared tabs | tanpa panah | roving tabindex, `aria-controls` | Selesai |
| Palette | tanpa trap/restore | combobox + listbox + option, `aria-activedescendant`, trap | Selesai |
| Nama kontrol | ikon tanpa label, search tanpa label | aria-label di input Files/Ports/Viewer/Notes, tombol close | Sebagian |
| Dialog | ProjectPicker tanpa label | `aria-modal`, `aria-labelledby` | Selesai |
| Live region | toast tanpa pengumuman | `aria-live="polite"`; Notes/Downloader `role=status` | Selesai |
| Reduced motion | animasi tidak menyesuaikan | media query global + animasi prayer dimatikan | Selesai |
| Kontras | muted/aksen lama marginal | semua pasangan teks utama ≥7:1 | Selesai |

Temuan tersisa:

- Checkbox task list pada Markdown yang dirender `marked` tidak punya nama aksesibel; statusnya dekoratif dan non-interaktif, tetapi screen reader tetap membacanya tanpa label.
- Halaman Markdown dapat memiliki dua `h1` (judul halaman + contoh konten yang dirender).
- Delapan string `aria-label` masih hardcoded (App brand, player media 4, Nginx 2, SQL), belum lewat i18n.
- Belum ada uji axe-core otomatis di CI dan belum ada uji screen reader manual (NVDA/VoiceOver).

## 10. Internasionalisasi

- Kamus: 896 kunci per locale setelah penambahan terakhir (ID dan EN simetris).
- Sebelum perbaikan, EN hanya 814 kunci dan 80 kunci jatuh ke ID; sekarang 0 fallback tak sengaja.
- Semua label baru (palette, sesi, workspace, markdown, JSON, types, files, viewer) memakai `t()`.
- Format angka/tanggal masih mengikuti locale browser, bukan locale aplikasi; ini keputusan yang perlu ditinjau (P2).
- Istilah teknis (JSON, URL, Webhook, Git) sengaja tidak diterjemahkan.

## 11. Temuan per tool

| Tool | Temuan utama | Status |
|---|---|---|
| Notes | list menutupi editor di mobile; toolbar meluber; judul catatan terpotong | Diperbaiki; tooltip judul ditambahkan |
| Markdown | toolbar 27 px, textarea turun; preview sampel punya h1 ganda | Diperbaiki sebagian; h1 ganda tersisa |
| Files | toolbar padat, teks 9–10,5 px, baris 21 px, tabel mobile | Diperbaiki; density masih tinggi |
| URL Viewer | header nama/URL tanpa label | Diperbaiki |
| JSON | tombol ikon tanpa label, layout sempit | Diperbaiki |
| JSON→TS | layout sempit, tombol tanpa label | Diperbaiki |
| Compress/Compare | resize lag (DOM style di RAF), label kecil | Diperbaiki |
| Downloader | label 11 px, URL input | Diperbaiki |
| Dev Space | 10 tab terpotong; kolom kanan pendek; flag chip mengandalkan warna | Tab diperbaiki; warna chip tersisa |
| Storage | treemap label 11 px | Sebagian (floor 11,5 px) |
| Nginx | tombol file 23 px | Diperbaiki |
| Ports | filter tanpa label | Diperbaiki |
| Webhook | endpoint 51 px, token terpotong, state live tidak jelas | Sebagian |
| Calendar | event pill terpotong, tombol disconnect berdekatan, kontras grid rendah | Sebagian |
| Settings | satu halaman panjang, token `text-danger` tidak ada, textarea delimiter | Diperbaiki |
| Workspace | delimiter `|`, tanpa validasi | Diperbaiki |

## 12. Prioritas dan kompleksitas sisa pekerjaan

| # | Temuan | Prioritas | Kompleksitas | Catatan |
|---|---|---|---|---|
| 1 | Checkbox task list Markdown tanpa nama aksesibel | P2 | S | Post-process HTML `marked` atau renderer kustom |
| 2 | 574 utility ukuran teks arbitrer | P2 | M | Mapping ke token skala; risiko regresi visual |
| 3 | 37 hex hardcoded (warna data/treemap) | P2 | S | Tambah token data-viz |
| 4 | Sidebar rail tanpa tooltip | P2 | S | `title` + `aria-label` |
| 5 | Format angka/tanggal belum mengikuti locale aplikasi | P2 | M | `Intl` helper; audit semua `toLocaleString` |
| 6 | Kalender: pill terpotong, kontras grid, posisi tombol berbahaya | P2 | M | Tooltip + pemisahan aksi |
| 7 | Webhook state/live dan token | P2 | S | Label status + `title` penuh |
| 8 | Tabel Files masih padat di mobile | P2 | M | Mode kartu <`sm` |
| 9 | 8 aria-label hardcoded | P3 | S | Pindahkan ke i18n |
| 10 | Palet warna data-viz | P3 | S | Skala 6–8 warna |
| 11 | Uji axe-core + E2E visual di CI | P2 | L | Playwright + axe; baseline screenshot |
| 12 | Uji screen reader manual | P2 | M | NVDA/VoiceOver checklist |

Legenda prioritas: P0 blocker, P1 merusak alur utama, P2 penting tetapi ada workaround, P3 kosmetik. Kompleksitas: S < 1 hari, M 1–3 hari, L > 3 hari.

## 13. Lampiran bukti

- Screenshot: `docs/roadmap/ux/after-<route>-<width>.png` (60 file), plus `after-notes-list-390.png`, `ux-before-notes.jpeg`, `ux-after-notes-1.jpeg`.
- Pengukuran viewport dan keyboard dijalankan dengan Playwright Chromium 1248 headless; cookie sesi diekspor dari browser DSH.
- Perintah verifikasi: `pnpm check`, `pnpm --filter @super-tool/web typecheck`, `pnpm --filter @super-tool/web test`, `pnpm --filter @super-tool/web build`.
- Dokumen terkait: `docs/roadmap/FRONTEND_DESIGN_SYSTEM.md`, `docs/roadmap/FRONTEND_UI_POLISH_REPORT.md`.
