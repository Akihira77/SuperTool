# Laporan Perbaikan UX Interaksi SuperTool

Status: selesai untuk P0/P1 utama, 10 November 2026 (Asia/Jakarta)
Baseline: `1f09e88 Correct UI polish report file count`
Commit kode: `ac2444d Fix interaction focus lifecycle and dialog safety`
Dokumen audit: `docs/roadmap/INTERACTION_UX_AUDIT.md`

## 1. Ringkasan

Perbaikan berfokus pada kontrak interaksi, bukan tampilan. Perubahan menghasilkan:

- konfirmasi destruktif yang aman untuk keyboard;
- permintaan fokus yang menunggu sesi, panel, dan target benar-benar siap;
- fokus tidak pernah masuk ke sesi tersembunyi;
- menu kustom yang konsisten (panah, Home/End, Escape, pengembalian fokus);
- dialog tool memakai focus trap, Escape, dan restore;
- Notes Search dari command palette langsung siap diketik;
- tab sesi dan tab Notes dengan semantik ARIA dan navigasi keyboard yang benar.

Verifikasi akhir: `pnpm check` EXIT 0, 9/9 test frontend, 37/37 test API, dan 16/16 pemeriksaan browser pada matriks A–H.

## 2. Defect terverifikasi dan akar masalah

| Defect | Akar masalah | Bukti | Perbaikan |
|---|---|---|---|
| Enter saat Cancel menyetujui operasi destruktif | `window.keydown` global memanggil `close(true)` untuk setiap Enter, mengabaikan tombol yang fokus | inspeksi `confirm.tsx` baseline; skenario F setelah perbaikan | handler global dihapus; aktivasi native tombol; Cancel fokus awal; trap + restore |
| Fokus palette tidak sampai ke tujuan | `onRun` dipanggil sebelum palette ditutup; cleanup focus trap memulihkan fokus lama setelahnya | urutan kode baseline; skenario A | palette ditutup dulu; aksi masuk antrean; effect menunggu palette tertutup |
| Fokus bisa masuk sesi tidak aktif | `document.querySelector` global tanpa cek visibilitas/sesi | mode sesi ter-mount + `aria-hidden` | root sesi aktif di-scope lewat ref; target wajib terlihat |
| Fokus Notes Search gagal saat panel tertutup | input hanya dirender jika `panelOpen` | skenario C | intent Notes membuka tab Notes + panel sebelum fokus |
| Fokus hilang saat tool lazy | panel sesi belum ter-commit ketika effect pertama berjalan | skenario H dengan delay 1,4 detik | `rootTick` dari callback ref, sekali per sesi |
| Fokus lama menimpa interaksi baru | tidak ada pembatalan/generation | skenario H | `AbortController` + pembatalan pada pointer/keydown pengguna + id aksi |
| Menu tidak konsisten | `role="menu"` tanpa keyboard dan tanpa `aria-controls` | inspeksi ProjectPicker/SessionTabs | hook `useMenu` bersama |
| Escape menu tidak mengembalikan fokus | hanya `setOpen(false)` | inspeksi baseline; ad hoc | `closeAndRestore()` fokus trigger |
| Dialog tool tanpa trap/Escape | markup dialog tanpa manajemen fokus | inspeksi Files/Calendar | `useFocusTrap`, Escape, restore |
| `window.confirm`/`window.prompt` | tidak memakai dialog aplikasi | TextCompare/Files baseline | `useConfirm`, NameDialog |
| Tombol tutup di dalam `role="tab"` | nesting interaktif tidak valid | inspeksi SessionTabs baseline | wrapper + tombol tab dan tombol tutup bersaudara |
| Notes tabs tanpa semantik | tombol biasa | inspeksi Notes | tablist/tab/tabpanel + panah/Home/End |

## 3. Arsitektur fokus yang diterapkan

### 3.1 Antrean aksi

`App.tsx` menyimpan `PendingAction` dengan id monotonik. Aksi palette tidak lagi memanggil fokus langsung. `runPalette` hanya:

1. mengantrekan aksi;
2. membuka atau mengaktifkan sesi tujuan.

### 3.2 Effect fokus

`useLayoutEffect` berjalan setelah DOM commit dan menunggu:

- palette tertutup;
- autentikasi siap;
- sesi aktif adalah tool tujuan;
- root sesi sudah terpasang.

Setelah itu dua frame ditunggu, intent dikirim sekali, target dicari **di dalam root sesi aktif**, dan hanya elemen yang lolos `getClientRects` + `visibility` + `display` yang difokuskan. Pencarian memakai `MutationObserver`, interval 120 ms, timeout 5 detik, dan `AbortSignal`.

### 3.3 Sinyal root lazy

Callback ref panel sesi menaikkan `rootTick` sekali per sesi. Effect fokus memakai `rootTick` sebagai dependensi. Guard `rootSeen` mencegah loop `setState` yang sebelumnya memicu React error #185.

### 3.4 Pembatalan

Listener capture `pointerdown`/`keydown` dibatalkan dan dilepas saat aksi selesai. Pengguna yang menekan Escape atau mengklik tempat lain tidak akan ditarik kembali ke target lama.

## 4. Perubahan per komponen

| File | Perubahan |
|---|---|
| `apps/web/src/App.tsx` | antrean `PendingAction`, lifecycle fokus, scoped target, rootTick, cancel, panel sesi bertab |
| `apps/web/src/lib/palette.ts` | hapus polling `runFocus`/`runClick`; intent tetap deklaratif |
| `apps/web/src/lib/actions.ts` | metadata `intent`/`select`; perbaikan id tab Dev Space |
| `apps/web/src/lib/useMenu.ts` | hook baru: keyboard menu/listbox, dismiss, restore |
| `apps/web/src/lib/useFocusTrap.ts` | restore hanya jika aman dan tidak menimpa dialog lain |
| `apps/web/src/components/confirm.tsx` | tombol native, Cancel fokus awal, trap, Escape |
| `apps/web/src/components/CommandPalette.tsx` | tutup sebelum aksi; combobox/listbox ARIA lengkap |
| `apps/web/src/components/SessionTabs.tsx` | tab valid, keyboard, reorder, fokus setelah tutup, menu |
| `apps/web/src/components/ProjectPicker.tsx` | menu keyboard, dialog trap/Escape/restore |
| `apps/web/src/components/PrayerWidget.tsx` | Escape mengembalikan fokus ke trigger |
| `apps/web/src/tools/NotesTool.tsx` | intent search, panel/tab, fokus judul baru, tab ARIA |
| `apps/web/src/tools/FilesTool.tsx` | NameDialog, trap/Escape untuk dialog, penanda search |
| `apps/web/src/tools/CalendarTool.tsx` | trap/Escape/fokus dialog detail dan composer |
| `apps/web/src/tools/TextCompare.tsx` | konfirmasi aplikasi menggantikan `window.confirm` |
| `apps/web/src/lib/i18n.tsx` | kunci ID/EN untuk tab Notes, nama file, placeholder exclude |

## 5. Perilaku menu dan dropdown

`useMenu` dipakai oleh Project Picker, Session Add, dan Notes search scope.

- Enter/Space membuka lewat aktivasi native trigger; ArrowUp/Down juga membuka.
- Saat terbuka, fokus masuk ke item terpilih atau item pertama.
- ArrowUp/Down berputar, Home/End ke batas.
- Escape menutup dan mengembalikan fokus ke trigger; Tab menutup tanpa merebut fokus.
- Klik di luar menutup; klik pada trigger tidak ditelan.
- Item nonaktif tidak dapat difokuskan atau diaktifkan.

Command palette tetap memakai pola combobox/listbox sendiri karena perilakunya berbeda (input, hasil dinamis, dua level), bukan dipaksa ke `useMenu`.

## 6. Perilaku dialog dan overlay

- Confirm: Cancel fokus awal, native Enter/Space, Escape membatalkan, trap, restore.
- Project Picker, drawer mobile, Files recent/exclude/name, Calendar detail/composer: focus trap dan Escape.
- Command Palette: trap, Escape, restore; ditutup sebelum aksi dijalankan.
- Calendar reminder tetap non-modal dan tidak di-trap karena bukan dialog blocking.
- Prayer popover non-modal; Escape mengembalikan fokus ke trigger.

## 7. Aksesibilitas keyboard

- Semantik tab diperbaiki untuk tab sesi dan tab Notes; tombol tutup tidak lagi bersarang di dalam tab.
- Tab sesi: panah, Home/End, F2 rename, Alt+Arrow reorder.
- Notes tabs: panah, Home/End, roving tabindex.
- Confirm memakai aktivasi tombol native sehingga Enter tidak lagi menjadi shortcut global tersembunyi.
- Menu memakai `aria-expanded`, `aria-controls`, dan fokus yang terlihat; trigger ikon tetap punya nama aksesibel.
- Escape mengikuti lapisan terdekat pada komponen yang memiliki lapisan tersebut.

## 8. Perbaikan alur form dan editor

- **Notes baru**: setelah dibuat, fokus berpindah ke input judul dan isinya dipilih, sehingga pengguna bisa langsung menamai catatan.
- **Notes Search dari palette**: tab Notes dipilih, panel dibuka, input dicari difokuskan, query lama dipertahankan dan dipilih untuk penggantian cepat.
- **Files rename/mkdir**: dialog aplikasi menggantikan `window.prompt`; nama divalidasi (kosong, `.`, `..`, slash), error diumumkan, input difokuskan kembali.
- **Text Compare delete**: memakai dialog konfirmasi aplikasi, bukan `window.confirm`.

## 9. Hasil pengujian

### 9.1 Uji statis dan build

```text
pnpm --filter @super-tool/web typecheck   EXIT 0
pnpm check                                EXIT 0
  vite build                              PASS (3,87 s)
  Vitest                                  3 file / 9 test lulus
  API selfcheck                           37 test lulus, 0 gagal
```

Ukuran bundle terakhir: `index-BhjJmYkV.js` 378,68 kB (117,15 kB gzip), `CalendarTool` 221,91 kB, `FilesTool` 70,29 kB, `NotesTool` 27,94 kB.

### 9.2 Matriks browser A–H

Lingkungan: Playwright headless, Chromium 1248, viewport 1440×900 (G: 390×844), sesi login nyata, bahasa EN, preview `http://127.0.0.1:4173`.

| Skenario | Pemeriksaan | Hasil |
|---|---|---|
| A | palette membuka sesi Notes, panel terbuka, `notes:search` fokus, mengetik `alpha` langsung masuk | lulus (2/2) |
| B | Notes ter-mount tetapi tidak aktif; fokus masuk sesi aktif yang terlihat; tidak ada fokus di sesi tersembunyi | lulus (2/2) |
| C | panel daftar ditutup; palette search membuka panel dan memfokuskan input | lulus (2/2) |
| D | dari Text Compare kembali ke tab Notes; search terlihat dan tab aktif | lulus (1/1) |
| F | Cancel fokus awal; Enter membatalkan (catatan tetap); Tab ke Confirm; Enter menghapus (22 → 21) | lulus (3/3) |
| E | scope listbox: panah, Escape menutup dan fokus ke trigger; Enter memilih dan fokus ke trigger | lulus (2/2) |
| G | mobile 390×844: palette membuka panel Notes, fokus search, tidak ada overflow horizontal | lulus (2/2) |
| H | chunk Notes ditunda 1,4 detik: fokus tetap sampai; interaksi pengguna setelahnya membatalkan intent lama | lulus (2/2) |

Total: **16/16 lulus**.

### 9.3 Pemeriksaan ad hoc

- Project Picker: trigger `aria-haspopup="menu"`, `aria-expanded` berubah; Enter membuka `role="menu"` dengan fokus `menuitem`; ArrowDown tetap di item; Escape menutup dan fokus kembali ke `project:toggle`.
- Session Add: Enter membuka menu dengan fokus `menuitem`; Escape menutup dan fokus kembali ke trigger.

### 9.4 Bukti sumber vs browser

- **Diuji browser**: A–H, Project Picker menu, Session Add menu.
- **Diperiksa sumber + typecheck**: dialog Files/Calendar, tab bersama Dev Space/Ports/Compress, popover prayer, seluruh alur per tool lainnya.
- **Tidak diklaim teruji**: screen reader, axe, tablet 768×1024, seluruh kombinasi error jaringan.

## 10. Masalah tersisa

1. **Search clear button** belum seragam di Notes, Files, dan beberapa filter Dev Space. Query sengaja dipertahankan, tetapi belum ada tombol bersihkan yang selalu dapat dijangkau keyboard.
2. **File Explorer** belum memindahkan fokus ke baris hasil setelah rename/mkdir; dialog sudah aman dan validasi sudah benar, tetapi pengguna masih harus mencari baris baru.
3. **Git/Docker/HTTP** belum memiliki pengalihan fokus pasca-aksi (mis. setelah staging atau mengirim request) yang diuji.
4. **Feedback async** belum diaudit dengan simulasi kegagalan untuk setiap tool; toast dan inline status yang ada dipertahankan.
5. **Calendar reminder** tetap non-modal tanpa focus trap. Ini keputusan desain, bukan cacat dialog blocking.
6. **Settings navigation** tetap navigasi bagian, bukan tablist; semantik halaman sudah benar.
7. **Ctrl/Cmd+K** tetap aktif saat fokus di editor teks. Perilaku ini perlu keputusan produk bila ingin dibatasi.
8. **Tidak ada suite E2E/axe yang di-commit.** Skrip Playwright lokal dihapus setelah verifikasi karena memuat cookie sesi dan bergantung pada Chromium cache.
9. **Tablet 768×1024** dan seluruh tool belum diuji browser pada iterasi ini.

## 11. Definition of Done

| Kriteria | Status |
|---|---|
| P0 confirmation safety | selesai, diuji |
| Notes Search fokus dari palette | selesai, diuji |
| Sesi lama dan sesi baru | selesai, diuji |
| Tidak ada fokus ke sesi tersembunyi | selesai, diuji |
| Panel kondisional dibuka sebelum fokus | selesai, diuji |
| Dropdown konsisten | menu utama selesai; kontrol native dipertahankan |
| Dialog konfirmasi aman | selesai, diuji |
| Escape lapisan terdekat | selesai pada komponen berlapis; belum ada uji tumpukan penuh |
| Restore fokus | selesai dan terverifikasi pada dialog/menu/palette |
| Fokus tujuan setelah navigasi | selesai untuk Notes/Files/Dev Space/sesi |
| Form/editor fokus wajar | Notes dan Files selesai; tool lain sebagian |
| Fungsi lama tetap | `pnpm check` lulus |
| Responsif desktop/mobile | desktop dan 390×844 lulus; tablet belum |
| Regression test | unit + browser lulus |
