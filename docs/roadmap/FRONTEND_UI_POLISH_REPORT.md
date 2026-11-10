# Laporan Polish UI Frontend SuperTool

Tanggal: 10 November 2026 (Asia/Jakarta)  
Baseline: `7437ca5`  
Status: implementasi selesai untuk lingkup P0/P1; sisa P2/P3 tercatat.

## 1. Ringkasan

Polish ini mengubah SuperTool dari kumpulan tool yang berfungsi menjadi **control center** dengan bahasa visual dan pola interaksi yang konsisten, tanpa mengganti arsitektur, API, atau fitur.

Hasil utama:

- Skala tipografi baru: judul halaman 20 px, body 14 px, kontrol 13–13,5 px, minimum UI 11,5 px (sebelumnya banyak 9–11 px).
- Token warna semantik lengkap, termasuk `focus`, `info`, `panel3`, `hover`, dan error yang benar-benar terdefinisi.
- Shell responsif: sidebar rail/drawer, skip link, header yang tidak pecah di 360 px.
- Session tabs dan shared tabs bisa dioperasikan penuh dengan keyboard.
- Command palette fuzzy, ter-highlight, punya trap fokus dan status error.
- WorkspacePanel memakai editor terstruktur, bukan sintaks delimiter.
- 15 route diaudit pada 6 viewport; tidak ada overflow horizontal dokumen.
- ID/EN simetris 896 kunci; tidak ada string UI baru di luar i18n.
- Typecheck, build, dan seluruh test frontend lulus.

## 2. Metrik sebelum vs sesudah

| Metrik | Sebelum | Sesudah | Catatan |
|---|---|---|---|
| Utility ukuran teks arbitrer | 593 | 574 | Belum dimigrasi ke token skala (P2) |
| Teks ≤11 px | 406 | **0** | Batas bawah 11,5 px |
| Ukuran judul halaman | 16 px | **20 px** | `PageHeader` |
| Tinggi tombol utama | 30 px | **34 px** (sm 32) | target 32–36 |
| Tinggi input | 32 px | **36 px** | teks 13,5 px |
| Close session tab | 20×20 | **24×24** | target minimum 24 |
| Overhang tab Dev Space | ya (Audit Log di 1472 px) | **tidak** | tabbar wrap |
| Overflow dokumen 390 px | ya (Notes, Files) | **tidak** | 15 route × 6 viewport |
| Kunci EN yang hilang | 80 | **0** | ID/EN simetris |
| Hex hardcoded di TSX | 22 | 37 | naik karena warna data/treemap; perlu token data-viz |
| aria-label hardcoded | 12 | 8 | sisa di player/Nginx/SQL |
| Build JS | 373,16 kB / 115,33 kB gzip | 373,99 kB / 115,63 kB gzip | tidak ada library UI baru |
| CSS build | 85,70 kB / 14,03 kB gzip | 86,50 kB / 14,20 kB gzip | token + utility |

## 3. Screenshot

Semua screenshot terautentikasi, Chromium headless, satu sesi per konteks.

- **Before:** [ux-before-notes.jpeg](ux/ux-before-notes.jpeg) — Notes 1400×836, label sangat kecil, campuran ID/EN.
- **After Notes 1440:** [after-notes-1440.png](ux/after-notes-1440.png)
- **After Notes 390:** [after-notes-390.png](ux/after-notes-390.png)
- **After Notes list 390:** [after-notes-list-390.png](ux/after-notes-list-390.png)
- **After Files 1440:** [after-files-1440.png](ux/after-files-1440.png)
- **After Files 390:** [after-files-390.png](ux/after-files-390.png)
- **After Dev Space 1440:** [after-devspace-1440.png](ux/after-devspace-1440.png)
- **After Dev Space 390:** [after-devspace-390.png](ux/after-devspace-390.png)
- **After Settings 1440:** [after-settings-1440.png](ux/after-settings-1440.png)
- **After Settings 390:** [after-settings-390.png](ux/after-settings-390.png)

Matriks lengkap: 15 route × 4 lebar (360, 390, 768, 1440) = 60 file di `docs/roadmap/ux/`. Viewport 1024 dan 1280 diuji secara metrik, tidak disimpan screenshot-nya.

Route: `notes`, `markdown`, `files`, `viewer`, `json`, `types`, `compress`, `downloader`, `devspace`, `storage`, `nginx`, `ports`, `webhook`, `calendar`, `settings`.

Keterbatasan: before hanya tersedia untuk Notes. Klaim before/after lain berbasis pengukuran sumber/DOM, bukan pasangan gambar.

## 4. Perubahan per area

### 4.1 Fondasi visual

File: `apps/web/src/styles.css`.

- Token warna: `bg #080d13`, `panel #0f1721`, `panel2 #16212d`, `panel3 #1b2836`, `hover #1e2c3b`, `line #28394b`, `line-soft #1b2836`, `ink #eaf1f8`, `muted #9aacbf`, `accent #7aa2ff`, `accent2 #a78bfa`, `ok #4ade80`, `warn #fbbf24`, `bad #fb7185`, `info #60a5fa`, `focus #a9c4ff`.
- Body 14 px/1,5/-0,006em; placeholder, selection, scrollbar, dan `color-scheme: dark` konsisten.
- `:focus-visible` global 2 px `focus` offset 2 px.
- `.btn` 34 px, `.btn-sm` 32 px, `.btn-icon` 32 px; `.input` 36 px; `.label` 11,5 px; `.hint` 12,5 px; `.tab` 32 px; `.nav-item` 36 px; `.section-title` 16 px.
- `.tabbar` wrap, `.page-body` gap 16/20, `.soft-panel`, `.separator`.
- `prefers-reduced-motion` mematikan animasi/transisi; animasi prayer punya fallback statis.

### 4.2 Shell dan navigasi

Files: `App.tsx`, `components/ProjectPicker.tsx`.

- Skip link ke `main#main-content`; `main` menerima fokus.
- Sidebar: drawer mobile dengan backdrop, `role=dialog`, `aria-modal`, trap fokus, Escape, restore fokus; rail `md`, expanded `lg`.
- Tombol menu mobile `aria-controls="app-sidebar"`, `aria-expanded`.
- Header responsif; label proyek dan aksi global tidak menekan konten.
- `useSidebar` sekarang mengembalikan setter eksplisit agar tool bisa menutup panel di mobile.

### 4.3 Komponen bersama

File: `components/ui.tsx`, `lib/useFocusTrap.ts`, `lib/fuzzy.ts`, `lib/fuzzy.test.ts`.

- `PageHeader`: judul 20 px, subtitle 13 px (disembunyikan <`sm`), aksi satu baris scrollable.
- `Tabs`: roving tabindex, ArrowLeft/Right/Home/End, `aria-controls`, `useId`.
- `PasswordInput`: label aksesibel via i18n.
- `useFocusTrap`: fokus awal, loop Tab/Shift+Tab, restore; tidak menangani Escape agar dialog bisa menentukan sendiri.
- `fuzzyMatch`: substring-first, subsequence, bonus boundary/consecutive; `splitHighlight` untuk highlight. 3 unit test.

### 4.4 Command palette

File: `components/CommandPalette.tsx`.

- Fuzzy search dan sorting, highlight kecocokan.
- `role=combobox`, `listbox`, `option`, `aria-activedescendant`.
- Focus trap + restore, Escape, loading guard, error state dengan tombol retry.
- Label dan empty state diterjemahkan; layout aman hingga `dvh`.

### 4.5 Session tabs

File: `components/SessionTabs.tsx`.

- Panah kiri/kanan, Home/End, Alt+panah untuk reorder, F2 untuk rename.
- Hint keyboard dihubungkan via `aria-describedby`.
- Close 24 px; middle-click; drag-and-drop; auto-scroll tab aktif.
- `role=tab`, `aria-selected`, `tabIndex` roving.
- Sesi yang pernah dibuka tetap ter-mount; `SessionContent` di-memo agar perpindahan tab tidak me-render ulang tool.

### 4.6 Dialog, konfirmasi, toast

Files: `components/confirm.tsx`, `components/toast.tsx`, `components/ProjectPicker.tsx`, `components/WorkspacePanel.tsx`.

- ProjectPicker: trap fokus, `aria-modal`, `aria-labelledby`, tombol retry, layout max `80vh`.
- Confirm: dialog terstandar, bukan `window.confirm`.
- Toast: `aria-live="polite"`.
- WorkspacePanel: editor baris untuk URL favorit, service, shortcut, tool chips; validasi sebelum simpan; import/export JSON; active badge; konfirmasi hapus.

### 4.7 Tool

| Tool | Perubahan |
|---|---|
| Notes | list overlay mobile, toggle panel, toolbar wrap, label input, tooltip judul, status simpan |
| Markdown | mode responsif (split hanya ≥1024), toolbar scroll, tombol 32 px, stats ID/EN, sample/clear |
| JSON | layout stack <`lg`, label tombol, status, error position, upload/download |
| JSON→TS | layout stack, placeholder, hint, download |
| Files | toolbar responsif, baris 32 px, teks ≥11,5 px, tabel `table-fixed`, kolom mobile, menu overflow |
| URL Viewer | label nama/URL, header responsif |
| Compress/Compare | resize tanpa re-render React per tick (DOM style di RAF), label/aria |
| Downloader | label, input URL, status live |
| Dev Space | 10 tab wrap, ukuran kontrol, label; Git/Docker/HTTP/DSN/SQLite diaudit visual |
| Storage | label treemap 11,5 px, path tree target 32 px |
| Nginx | tombol file 32 px, penjelasan Markdown |
| Ports | filter berlabel |
| Webhook | endpoint penuh di mobile, kontrol 32 px, token/endpoint pill |
| Calendar | agenda default <`md`, tombol 32 px, sel tanggal 24 px |
| Settings | nav seksi sticky, token `bad`, smooth scroll hormati reduced motion |
| Semua | ukuran teks dinormalisasi; label/aria ditambahkan; tombol ikon punya nama |

### 4.8 Internasionalisasi

File: `lib/i18n.tsx`.

- ID 896 kunci, EN 896 kunci, 0 selisih.
- 80 kunci EN yang sebelumnya hanya ada di ID sudah dilengkapi.
- Kunci baru: nav, palette, auth password, session hint, settings workspace, markdown, JSON, types, files, viewer, common previous/next.
- Indentasi blok EN dirapikan agar mudah di-diff.

## 5. Aksesibilitas

| Perbaikan | Bukti |
|---|---|
| Skip link + landmark | Tab pertama menampilkan “Lewati ke konten”; Enter memfokuskan `main` |
| Focus trap drawer | 25 Tab tetap di dalam drawer; Escape menutup dan mengembalikan fokus ke “Buka navigasi” |
| Palette | fokus masuk ke input; Escape menutup dan mengembalikan fokus |
| Session tabs | panah/Home/End/Alt+panah/F2 teruji |
| Shared tabs | roving tabindex dan panah |
| Dialog | `aria-modal`, label, trap, restore |
| Live region | toast, status Notes/Downloader |
| Reduced motion | CSS global + animasi prayer |
| Kontras | teks utama 17,1:1; muted 8,4:1; accent 7,8:1; error 7,2:1 |

Yang belum:

- Checkbox task list Markdown tanpa nama aksesibel.
- Dua `h1` pada halaman Markdown (judul halaman + konten contoh).
- Delapan aria-label hardcoded di player/Nginx/SQL.
- Belum ada axe-core di CI dan uji screen reader manual.

## 6. Responsif

Diuji pada 360×800, 390×844, 768×1024, 1024×768, 1280×800, 1440×900.

- **0** overflow horizontal tingkat dokumen pada 15 route × 6 viewport.
- Notes 390: editor terbaca; list menjadi overlay 370 px, menutup setelah pilih catatan.
- Files 390: tabel 390/390; kolom ukuran dan aksi sekunder disembunyikan/dipindah.
- Markdown 390: textarea mulai y=262 (sebelumnya y=375); toolbar bisa di-scroll.
- Webhook 390: box 324×51, input 306.
- Dev Space 1440: 10 tab satu baris (tinggi tabbar 51 px); 360: wrap.
- Calendar 390: agenda default, bukan grid bulan yang sempit.
- Header mobile: satu baris aksi scrollable; subtitle tool disembunyikan.

## 7. Verifikasi

Perintah dan hasil akhir:

```text
pnpm check
  build web + API ......................... PASS
  API node tests .......................... PASS (37)
  frontend vitest ......................... PASS (3 file, 9 test)
  total ................................... PASS

pnpm --filter @super-tool/web typecheck ... PASS
pnpm --filter @super-tool/web build ....... PASS
```

Uji manual terotomasi:

- Skip link, palette, drawer mobile, session tabs: PASS.
- Keyboard trap: 25 Tab di drawer tetap di dalam; Escape restore: PASS.
- 15 route × 6 viewport: tidak ada `document.scrollWidth > clientWidth`: PASS.
- Simetri i18n: 896/896, 0 missing, 0 duplicate: PASS.
- Kontras token: semua pasangan teks utama ≥7:1.

Build terakhir:

- `index` JS 373,99 kB (115,63 kB gzip), CSS 86,50 kB (14,20 kB gzip), 532 modul.
- Tidak ada dependency UI baru.

## 8. Masalah tersisa

| # | Masalah | Prioritas | Rencana |
|---|---|---|---|
| 1 | 574 utility teks arbitrer | P2 | migrasi bertahap ke token skala |
| 2 | 37 hex di TSX (warna data/treemap) | P2 | token data-viz |
| 3 | Markdown task checkbox tanpa nama | P2 | renderer/post-process |
| 4 | Dua h1 di halaman Markdown | P3 | turunkan heading konten |
| 5 | Sidebar rail tanpa tooltip | P2 | `title` + label |
| 6 | Tabel Files masih padat di mobile | P2 | mode kartu <`sm` |
| 7 | Kalender: pill terpotong, kontras grid | P2 | tooltip + kontras |
| 8 | Webhook: status live dan token | P2 | label status, title penuh |
| 9 | 8 aria-label hardcoded | P3 | pindah ke i18n |
| 10 | Tidak ada axe/E2E di CI | P2 | Playwright + axe |
| 11 | Uji screen reader manual belum | P2 | NVDA/VoiceOver |
| 12 | Fullscreen browser window | — | host-controlled; tidak bisa diubah dari sesi ini |

Catatan fullscreen: permintaan memperbesar window browser tidak dapat dipenuhi dari sesi karena window dikendalikan host DSH. Screenshot QA memakai Chromium headless dengan viewport eksak.

## 9. Rekomendasi berikutnya

1. Tambahkan Playwright + axe-core ke CI dengan 3 viewport dan baseline screenshot.
2. Migrasikan ukuran teks arbitrer ke token skala; prioritaskan 12/12,5/13 px.
3. Tambahkan token data-viz dan ganti hex treemap/chart.
4. Selesaikan aksesibilitas Markdown (checkbox, heading).
5. Audit screen reader manual untuk Notes, Files, Dev Space, dan Settings.
6. Tinjau ulang batas 16 sesi dan biaya memori sesi yang selalu ter-mount.

## 10. File utama yang berubah

44 file termodifikasi, 3 modul baru (`fuzzy.ts`, `fuzzy.test.ts`, `useFocusTrap.ts`), 3 dokumen baru, dan 63 screenshot.

Baru:

- `apps/web/src/lib/useFocusTrap.ts`
- `apps/web/src/lib/fuzzy.ts`
- `apps/web/src/lib/fuzzy.test.ts`
- `docs/roadmap/FRONTEND_UX_AUDIT.md`
- `docs/roadmap/FRONTEND_DESIGN_SYSTEM.md`
- `docs/roadmap/FRONTEND_UI_POLISH_REPORT.md`

Inti:

- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/components/{ui,SessionTabs,CommandPalette,ProjectPicker,WorkspacePanel,CodeEditor,VirtualCode,confirm,toast}.tsx`
- `apps/web/src/lib/{i18n.tsx,useSidebar.ts,fuzzy.ts,useFocusTrap.ts}`
- `apps/web/src/tools/*` dan `apps/web/src/tools/devspace/*`
- `apps/web/src/tools/calendar.css`
