# Audit UX Interaksi Frontend SuperTool

Status: pasca-implementasi interaksi, 10 November 2026 (Asia/Jakarta)
Baseline audit: `1f09e88 Correct UI polish report file count`
Commit implementasi: `ac2444d Fix interaction focus lifecycle and dialog safety`
Aplikasi: `apps/web` (React 19, Vite, Tailwind 4)
Cakupan: command palette, perpindahan sesi, fokus otomatis, menu/dropdown, dialog, tab, pencarian, form, shortcut keyboard, dan umpan balik status.

## 1. Ringkasan eksekutif

Audit visual sebelumnya sudah menyelesaikan skala tipografi, shell responsif, dan konsistensi tampilan. Audit ini menemukan bahwa masalah yang tersisa bukan lagi soal tampilan, melainkan **kontrak interaksi**:

1. **P0 — konfirmasi destruktif tidak aman.** `confirm.tsx` memasang handler `window.keydown` yang menganggap setiap Enter sebagai persetujuan. Fokus awal memang di Cancel, tetapi menekan Enter saat Cancel fokus tetap menjalankan operasi berbahaya.
2. **P1 — fokus otomatis tidak deterministik.** Command palette meminta fokus sebelum palet benar-benar tertutup, lalu cleanup focus-trap memulihkan fokus lama. Pencarian melalui `document.querySelector` juga bisa menemukan elemen di sesi yang tidak aktif.
3. **P1 — target fokus bersyarat tidak bisa difokuskan.** Input pencarian Notes hanya dirender saat panel daftar terbuka; tool lazy juga belum tentu sudah ter-commit saat permintaan fokus dikirim.
4. **P1 — menu kustom tidak konsisten.** Menu Project Picker dan Session Add memakai `role="menu"` tanpa navigasi panah, tanpa `aria-controls`, dan Escape tidak selalu mengembalikan fokus ke trigger.
5. **P1/P2 — dialog tidak seragam.** Beberapa dialog tool tidak punya focus trap, Escape, atau pengembalian fokus; ada juga elemen interaktif bersarang di dalam `role="tab"`.
6. **P2 — pencarian, form, dan feedback belum punya kontrak seragam.** Sebagian search field tidak punya tombol bersihkan; beberapa aksi async belum punya status loading/error yang eksplisit.

Perbaikan P0/P1 sudah diterapkan dan diverifikasi. Matriks browser A–H lulus 16/16 pemeriksaan, termasuk Notes Search dari palette pada sesi baru, sesi lama yang tidak aktif, panel tertutup, tab Text Compare, viewport mobile, dan lazy chunk yang sengaja diperlambat.

## 2. Metode dan bukti

| Metode | Cakupan | Bukti |
|---|---|---|
| Inspeksi sumber | `App.tsx`, palette, session tabs, ProjectPicker, confirm, toast, ui, useFocusTrap, useMenu, seluruh tool dan tab Dev Space | pembacaan kode dan grep terarah; temuan diberi nomor baris |
| Uji statis | TypeScript seluruh web | `pnpm --filter @super-tool/web typecheck` EXIT 0 |
| Build produksi | Vite build | `pnpm check` EXIT 0; `index-BhjJmYkV.js` 378,68 kB (117,15 kB gzip) |
| Unit test yang ada | Vitest + selfcheck API | 3 file / 9 test frontend, 37 test API, semuanya lulus |
| Browser otomatis | Playwright headless terautentikasi, Chromium 1248 | matriks A–H, 16/16 pemeriksaan lulus |
| Pemeriksaan ad hoc | Project Picker menu dan Session Add menu | Enter/Arrow/Escape dan pengembalian fokus terverifikasi |
| Analisis visual | screenshot dan vision bridge dari audit sebelumnya | tidak dipakai ulang untuk klaim interaksi baru |

Keterbatasan: tidak ada axe-core, uji screen reader manual, atau suite E2E yang di-commit. Skrip Playwright yang dipakai bersifat lokal, membutuhkan sesi login dan Chromium cache, lalu dihapus setelah verifikasi agar cookie tidak masuk repository.

## 3. Arsitektur interaksi saat ini

```text
App.tsx
├── shortcut global Ctrl/Cmd+K
├── sidebar + drawer mobile (focus trap)
├── header (ProjectPicker, PrayerWidget, aksi global)
├── SessionTabs (sesi = container, persist st:sessions:v1)
└── session viewport
    └── satu panel per sesi ter-mount
        ├── role="tabpanel", id session-panel-<id>
        ├── Suspense sendiri untuk tool lazy
        └── tool (Notes, Files, Dev Space, ...)
```

Prinsip yang dipertahankan:

- Sesi adalah container; state internal tool tidak dipersist.
- Sesi yang pernah dibuka tetap ter-mount agar scan, SSE, unduhan, dan iframe tidak terputus.
- Hanya sesi aktif yang terlihat; sesi lain `invisible`, `pointer-events-none`, dan `aria-hidden`.
- Tidak ada polling untuk sinkronisasi antar-tab; memakai event `storage`.

Konsekuensi untuk fokus: keberadaan elemen di DOM **tidak** berarti elemen itu boleh menerima fokus. Setiap permintaan fokus harus dibatasi ke root sesi aktif dan menunggu target benar-benar terlihat.

## 4. Arsitektur manajemen fokus

### 4.1 Kondisi sebelum perbaikan

`lib/palette.ts` menyediakan `runFocus(tool, action)` yang:

- mencari `document.querySelector('[data-action="tool:action"]')` secara global;
- mencoba 40 kali dengan jeda 50 ms;
- tidak memeriksa sesi aktif, visibilitas, atau `aria-hidden`;
- tidak punya pembatalan atau nomor generasi.

`App.tsx` memanggil `openTool()` lalu langsung `runFocus()`/`runClick()`. `CommandPalette` memanggil `onRun()` sebelum `close()`, sehingga cleanup focus-trap palet bisa memulihkan fokus ke elemen sebelum palet dan menimpa fokus tujuan.

### 4.2 Mekanisme baru

Setiap aksi palette menjadi `PendingAction`:

```ts
type PendingAction = {
  id: number;
  tool: string;
  selector?: string;   // suffix data-action, bukan selector CSS
  intent?: string;     // perintah tool-level, mis. notes "search"
  payload?: unknown;
  select?: boolean;    // pilih isi input setelah fokus
  click?: boolean;     // aksi tanpa target fokus: klik tombolnya
  focusSession?: boolean;
};
```

Siklus eksekusi:

1. Pengguna memilih aksi di palette.
2. Palette **ditutup lebih dulu**, lalu `onRun` mengantrekan `PendingAction`.
3. Sesi tujuan diaktifkan atau dibuat.
4. `useLayoutEffect` menunggu `paletteOpen === false`, status auth siap, dan sesi aktif cocok dengan tool tujuan.
5. Dua `requestAnimationFrame` memberi kesempatan focus-trap palette melepas dan memulihkan fokus.
6. `dispatchIntent()` dikirim sekali per id aksi; tool melakukan perubahan state yang diperlukan (mis. Notes membuka panel dan memilih tab).
7. `waitForVisibleTarget()` menunggu elemen `[data-action="..."]` di dalam root sesi, memakai `MutationObserver` + interval 120 ms + batas 5 detik + `AbortSignal`.
8. Elemen difokuskan, di-scroll ke tampilan, dan isinya dipilih bila `select`.
9. Jika target tidak pernah muncul, fokus jatuh ke root sesi, bukan ke `body`.
10. `pointerdown` atau `keydown` pengguna setelah permintaan dibuat membatalkan permintaan yang belum selesai.

### 4.3 Mengapa root sesi sempat tidak ditemukan

Tool dimuat dengan `React.lazy` di dalam `Suspense`. Selama chunk belum selesai, React belum meng-commit panel sesi, jadi callback ref belum terpasang. Effect pertama melihat root tidak ada; ketika chunk selesai, dependensi effect tidak berubah sehingga permintaan fokus tidak pernah dijalankan ulang.

Perbaikannya: callback ref menaikkan `rootTick` **sekali per id sesi** setelah node pertama kali terpasang. `rootTick` masuk dependensi effect. Guard `rootSeen` wajib; tanpa guard, pemasangan ulang ref pada setiap render memicu loop `setState` dan React error #185.

## 5. Inventaris shortcut keyboard

| Shortcut | Konteks | Perilaku | Status |
|---|---|---|---|
| Ctrl/Cmd + K | global | membuka/menutup command palette | terverifikasi browser |
| Escape | menu/listbox | menutup menu terdekat dan mengembalikan fokus ke trigger | terverifikasi browser |
| Escape | dialog/alertdialog | menutup dialog; fokus dikembalikan oleh focus trap | terverifikasi browser |
| Escape | command palette | menutup palette; fokus kembali ke elemen sebelumnya | terverifikasi browser |
| Escape | drawer mobile | menutup drawer | sumber |
| Escape | popover prayer | menutup popover dan fokus ke trigger | sumber |
| Enter/Space | tombol dialog konfirmasi | mengaktifkan tombol yang sedang fokus, bukan selalu Confirm | terverifikasi browser |
| ArrowLeft/Right, Home/End | session tabs | berpindah tab dan memindahkan fokus | sumber |
| Alt + ArrowLeft/Right | session tabs | mengubah urutan sesi | sumber |
| F2 | session tab | mengubah nama sesi | sumber |
| ArrowLeft/Right, Home/End | Notes tabs | berpindah tab internal Notes | sumber |
| ArrowLeft/Right, Home/End | shared `Tabs` | roving tabindex dan aktivasi | sumber |
| Enter | form pencarian/aksi tool | menjalankan aksi yang memang dimiliki form | sumber per tool |
| Ctrl/Cmd + S | CodeEditor | menyimpan | sumber |
| Tab | CodeEditor | menyisipkan indentasi, bukan keluar editor | sumber |

Catatan: shortcut global Ctrl/Cmd + K tidak memeriksa apakah fokus ada di dalam editor teks. Ini disengaja sebagai shortcut aplikasi, tetapi perlu diuji dengan pengguna keyboard sebelum diubah.

## 6. Inventaris aksi command palette

Palette memiliki 15 tool, 39 aksi tool, tiga aksi global, satu form pencarian Files, dan tiga cabang URL Viewer.

| Tool | Aksi | Fokus/intent |
|---|---|---|
| Markdown | write, upload, export, sample, clear | write → editor |
| JSON | write, format, minify, sort, upload, download | write → editor |
| JSON ke TS | download | — |
| Notes | new, search, delete, list | search → intent buka panel + tab, fokus input, pilih isi |
| Nginx | save, new | — |
| Port | refresh, tabPorts, tabProcs, auto | — |
| Kompresor | pick, run, download | — |
| Webhook | pause, clear | — |
| Settings | backup, restore | — |
| Dev Space | regex, encode, http, logs, docker, git, cron, dns, sqlite, audit | membuka tab Dev Space |
| File Explorer | form pencarian nama/isi | intent search + payload, fokus input |
| URL Viewer | add, access, edit | buka sesi; URL dinamis |
| Global | bahasa, ganti password, logout | — |

Aksi tanpa target fokus diklik melalui `[data-action]` setelah sesi tampil. Aksi dengan target fokus tidak mengklik tombol, tetapi memfokuskan kontrol tujuan agar pengguna bisa langsung mengetik.

## 7. Inventaris dropdown dan menu

| Komponen | Semantik | Trigger | Keyboard | Fokus saat tutup | Status |
|---|---|---|---|---|---|
| Project Picker menu | `role="menu"`, item `menuitem` | `aria-haspopup="menu"`, `aria-controls`, `aria-expanded` | Enter/Space/ArrowDown buka, panah, Home/End | Escape → trigger | diperbaiki + ad hoc |
| Session Add menu | `role="menu"`, item `menuitem` | `aria-haspopup="menu"`, `aria-controls`, `aria-expanded` | sama | Escape → trigger | sumber + ad hoc |
| Notes search scope | `role="listbox"`, item `option` | `aria-haspopup="listbox"`, `aria-expanded` | panah, Home/End, Enter | Escape → trigger; pilih → trigger | terverifikasi browser |
| Command palette | combobox + listbox | input `role="combobox"`, `aria-controls`, `aria-activedescendant` | panah, Home/End, Enter, Backspace, Escape | focus trap memulihkan fokus lama | terverifikasi browser |
| Prayer popover | `role="dialog"` non-modal | `aria-haspopup="dialog"`, `aria-controls` | Escape | Escape → trigger | sumber |
| Native `<select>` / tombol aksi | native | label | native | native | tidak diubah |

Docker, Git, HTTP, Calendar, dan Settings tidak memakai `role="menu"` kustom; aksinya berupa tombol atau kontrol native. Ini alasan tidak ada abstraksi menu paksa untuk semua tool.

## 8. Inventaris dialog dan overlay

| Komponen | Peran | Fokus awal | Trap | Escape | Restore | Catatan |
|---|---|---|---|---|---|---|
| `confirm.tsx` | alertdialog | Cancel | ya | ya, `stopPropagation` | ya | Enter hanya mengaktifkan tombol yang fokus |
| Command Palette | dialog + combobox | input | ya | ya | ya | ditutup sebelum aksi dijalankan |
| Project Picker | dialog | tombol tutup | ya | ya | ya | backdrop menutup |
| Drawer mobile | dialog | focus trap | ya | ya | ya | hanya < md |
| Files recent | dialog | tombol tutup | ya | ya | ya | tombol tutup punya nama |
| Files exclude | dialog | tombol tutup | ya | ya | ya | validasi pola |
| Files name dialog | dialog | input nama | ya | ya | ya | rename/mkdir, error `role="alert"` |
| Calendar detail | dialog | tombol tutup | ya | ya | ya | — |
| Calendar composer | dialog | input judul | ya | ya (kecuali menyimpan) | ya | — |
| Calendar reminder | alertdialog | tidak | tidak | tidak | tidak | non-modal, pojok layar; sengaja tidak trap |
| Prayer popover | dialog non-modal | tidak | tidak | ya | ke trigger | bukan modal |

## 9. Inventaris pencarian dan filter

| Lokasi | Field | Perilaku saat ini | Temuan |
|---|---|---|---|
| Notes | input daftar | query dipertahankan; palette search membuka panel + tab, fokus, pilih isi | tidak ada tombol bersihkan eksplisit |
| Files | nama + isi | intent search membawa query/mode/include/exclude; hasil async dengan abort | fokus hasil belum dipindahkan ke baris |
| Command palette | input | fuzzy, highlight, loading/error/retry, aktivasi via keyboard | tidak ada tombol bersihkan; Backspace mengedit query |
| Audit Log | filter | filter sumber | dibaca sumber, belum diuji browser |
| SQLite | cari tabel | filter tabel | dibaca sumber |
| Logs | filter baris | filter teks | dibaca sumber |
| Docker | cari container/image | filter lokal | dibaca sumber |
| Fitur lain | pencarian/daftar | umumnya input terkontrol | belum ada audit perilaku menyeluruh |

Tidak ada field pencarian yang otomatis dibersihkan hanya karena aksi palette dibuka. Ini sesuai persyaratan: query lama dipertahankan kecuali aksi secara eksplisit meminta penggantian.

## 10. Sesi dan tab bersarang

- **Session tabs**: tab adalah button dengan `role="tab"`; tombol tutup sekarang bersaudara, bukan anak dari tab. Ini memperbaiki semantik interaktif bersarang.
- **Notes**: tab Notes/Text Compare sekarang `tablist` + `tab` + `tabpanel` dengan panah/Home/End.
- **Dev Space, Ports, Compress**: memakai komponen `Tabs` bersama; roving tabindex, panah, Home/End, `aria-controls` sudah ada dari pekerjaan visual.
- **Settings**: navigasi bagian berupa tombol anchor, bukan tab; belum punya semantik tablist. Ini dapat diterima karena ia memang navigasi halaman, bukan panel tab.
- **Calendar**: pemilih tampilan dan dialog event memakai tombol; belum diuji keyboard menyeluruh.

## 11. Temuan dan prioritas

| ID | Prioritas | Temuan | Bukti | Status |
|---|---|---|---|---|
| I-01 | P0 | Enter saat Cancel fokus menyetujui operasi destruktif | `confirm.tsx` handler global Enter (baseline) | diperbaiki, diuji |
| I-02 | P1 | Cleanup focus-trap palette menimpa fokus tujuan | urutan `onRun` sebelum `close` (baseline) | diperbaiki, diuji |
| I-03 | P1 | Fokus bisa masuk ke sesi tersembunyi | selector global + panel inactive tetap ter-mount | diperbaiki, diuji |
| I-04 | P1 | Target fokus kondisional tidak ada saat diminta | Notes search hanya jika panel terbuka | diperbaiki, diuji |
| I-05 | P1 | Permintaan fokus hilang saat tool lazy | root sesi belum ter-commit | diperbaiki, diuji dengan chunk 1,4 detik |
| I-06 | P1 | Permintaan fokus lama bisa menimpa interaksi baru | tidak ada pembatalan | diperbaiki, diuji |
| I-07 | P1 | Menu Project Picker tidak punya keyboard/ARIA lengkap | `role="menu"` tanpa panah/controls | diperbaiki |
| I-08 | P1 | Menu Session Add tidak mengembalikan fokus saat Escape | baseline | diperbaiki |
| I-09 | P1 | Dialog Files/Calendar tanpa trap/Escape/restore | baseline | diperbaiki |
| I-10 | P1 | `window.confirm`/`window.prompt` tidak konsisten | TextCompare, Files | diganti dialog bersama |
| I-11 | P2 | Tombol tutup bersarang di dalam `role="tab"` | SessionTabs baseline | diperbaiki |
| I-12 | P2 | Notes tabs tanpa semantik tab | baseline | diperbaiki |
| I-13 | P2 | Sebagian search field tanpa tombol bersihkan | Notes, Files, palette | belum diperbaiki; dicatat |
| I-14 | P2 | Feedback async belum seragam di semua tool | audit sumber | sebagian; lihat laporan |
| I-15 | P3 | Settings navigation bukan tablist | desain navigasi | diterima |
| I-16 | P3 | Reminder Calendar non-modal tanpa trap | desain notifikasi | diterima |

## 12. Kriteria penerimaan

1. Enter pada Cancel tidak menjalankan operasi; Enter pada Confirm menjalankan. **Lulus browser.**
2. Notes Search dari palette membuka sesi, tab Notes, panel daftar, dan memfokuskan input. **Lulus A, C, D, G.**
3. Fokus bekerja untuk sesi baru maupun sesi lama yang tidak aktif. **Lulus A, B.**
4. Tidak ada elemen sesi tersembunyi yang menerima fokus. **Lulus B.**
5. Panel kondisional dibuka sebelum fokus dikirim. **Lulus C.**
6. Menu konsisten dengan semantiknya. **Sebagian besar diperbaiki; E dan ad hoc lulus.**
7. Dialog konfirmasi aman. **Lulus F.**
8. Escape menutup lapisan terdekat. **Menu, dialog, palette, popover: terverifikasi/sumber; belum ada uji lapisan bertumpuk.**
9. Fokus dipulihkan setelah penutupan biasa. **Terverifikasi pada Confirm, menu, palette, dialog.**
10. Navigasi memindahkan fokus ke tujuan. **Lulus A–D.**
11. Form/editor menjaga posisi fokus wajar. **Notes create dan Files rename; tool lain sumber.**
12. Fungsi lama tetap berjalan. **`pnpm check` EXIT 0.**
13. Interaksi responsif di desktop/tablet/mobile. **G: 390×844; desktop 1440×900; tablet belum diuji browser.**
14. Regression test lulus. **16/16 browser; 9/9 frontend; 37/37 API.**

## 13. Batasan audit

- Fokus otomatis hanya diuji penuh pada Notes dan dialog konfirmasi. Tool lain diperiksa dari sumber dan perilaku umumnya, bukan satu per satu di browser.
- Tidak ada pengujian screen reader nyata; klaim aksesibilitas dibatasi pada semantik dan keyboard yang bisa diperiksa.
- Pengujian mobile hanya 390×844, bukan 360×800 dan tablet 768×1024.
- Feedback async belum diaudit dengan simulasi jaringan gagal untuk setiap tool.
- Skrip browser QA tidak di-commit karena memuat cookie sesi; verifikasi dapat diulang secara manual dengan sesi login.
