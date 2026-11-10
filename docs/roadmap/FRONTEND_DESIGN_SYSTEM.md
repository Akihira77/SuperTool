# Frontend Design System SuperTool

Status: v1, 10 November 2026  
Berlaku untuk seluruh `apps/web`. Sistem ini menjaga identitas **Developer Control Center**: gelap, padat, terstruktur, dan tenang. Bukan dashboard SaaS generik.

## 1. Prinsip

1. **Kepadatan yang bisa dibaca.** Informasi banyak, tetapi tidak ada teks di bawah 11,5 px.
2. **Satu bahasa visual.** Warna, radius, kontrol, dan fokus berasal dari token; tidak ada hex baru di komponen tanpa alasan data-viz.
3. **Hierarki lewat ukuran dan ruang, bukan card bertumpuk.** Gunakan border dan divider; card hanya untuk unit yang benar-benar mandiri.
4. **Kontrol harus terasa seperti alat.** Tombol 32–36 px, target minimum 24 px, state hover/focus/disabled jelas.
5. **Aksesibilitas adalah bagian dari komponen.** Nama, fokus, keyboard, dan live region disediakan oleh pola bersama.
6. **Teks selalu lewat i18n.** ID default, EN lengkap; istilah teknis tetap Inggris.

## 2. Token warna

Token didefinisikan di `apps/web/src/styles.css` dalam `@theme` Tailwind 4, sehingga tersedia sebagai `bg-panel`, `text-muted`, `border-line`, dan seterusnya.

| Token | Nilai | Peran | Pemakaian |
|---|---|---|---|
| `bg` | `#080d13` | background aplikasi | `body`, area kosong |
| `panel` | `#0f1721` | surface utama | sidebar, card, dialog |
| `panel2` | `#16212d` | surface sekunder | input, tombol, header tabel |
| `panel3` | `#1b2836` | elevasi/terpilih | hover kuat, item aktif |
| `hover` | `#1e2c3b` | hover permukaan | baris tabel, menu |
| `line` | `#28394b` | border kontrol | input, tombol, divider kuat |
| `line-soft` | `#1b2836` | divider halus | pemisah seksi |
| `ink` | `#eaf1f8` | teks utama | judul, isi |
| `muted` | `#9aacbf` | teks sekunder | label, hint, ikon nonaktif |
| `accent` | `#7aa2ff` | aksi utama/fokus | tombol primer, link, tab aktif |
| `accent2` | `#a78bfa` | aksen sekunder | gradien, status khusus |
| `ok` | `#4ade80` | sukses | status sehat, hasil |
| `warn` | `#fbbf24` | peringatan | risiko, prayer before |
| `bad` | `#fb7185` | error/destruktif | hapus, gagal |
| `info` | `#60a5fa` | informasi | catatan netral |
| `focus` | `#a9c4ff` | focus ring | `:focus-visible` global |

Aturan:

- `ink` dan `muted` di atas `bg`/ `panel` sudah ≥7:1. Jangan menurunkan opasitas teks utama di bawah 70%.
- `bad` hanya untuk aksi destruktif atau error nyata, bukan hiasan.
- `accent` untuk satu aksi utama per area. Beberapa tombol primer bersamaan menghilangkan hierarki.
- Warna chart/treemap boleh memakai palet data-viz terpisah, tetapi harus punya label teks dan kontras ≥3:1 terhadap permukaan.
- Jangan memakai `text-danger`; token tersebut tidak ada.

## 3. Tipografi

Font UI: system sans (`ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`).  
Font kode: `ui-monospace, SFMono-Regular, JetBrains Mono, Menlo, Consolas`.

| Peran | Ukuran | Line-height | Weight | Tracking | Implementasi |
|---|---|---|---|---|---|
| Judul halaman | 20 px | 28 px | 600 | -0,015em | `PageHeader` |
| Judul seksi | 16 px | 24 px | 600 | tight | `.section-title` |
| Body | 14 px | 21 px | 400 | -0,006em | `body` |
| Teks tool utama | 13–13,5 px | 1,45 | 400 | normal | `.input`, konten padat |
| Nav/tab/tombol | 13 px | 1,4 | 500 | normal | `.btn`, `.tab`, `.nav-item` |
| Helper | 12,5 px | 1,6 | 400 | normal | `.hint` |
| Label | 11,5 px | 1,4 | 500 | 0,07em uppercase | `.label` |
| Badge/metadata | 11,5 px | 1,3 | 500 | normal | `.badge`, `.chip` |
| Kode/log | 12,5–14 px | 1,6 | 400 | normal | `.mono` |

Aturan:

- Minimum teks UI **11,5 px**. Pengecualian hanya label SVG yang ruangnya terbatas, dan itu harus dicatat.
- Jangan memakai heading `h1` di dalam konten tool; `PageHeader` sudah menjadi `h1`. Konten yang dirender (Markdown) harus menurunkan heading-nya.
- Angka di tabel gunakan `tabular-nums` bila tersedia.
- Jangan mencampur ukuran 12/12,5/13 tanpa alasan hierarki.

## 4. Spacing, radius, dan elevasi

Skala spacing 4 px: `gap-1` 4, `gap-1.5` 6, `gap-2` 8, `gap-3` 12, `gap-4` 16, `gap-5` 20. Layout halaman memakai `.page-body` (`gap-4 p-4 md:p-5`).

| Radius | Nilai | Pemakaian |
|---|---|---|
| `rounded-md` | 6 px | chip, kbd, tombol kecil |
| `rounded-lg` | 8 px | tombol, input, panel |
| `rounded-xl` | 12 px | dialog, card besar |

Elevasi:

- Permukaan utama: border `line`, tanpa bayangan.
- Dialog/dropdown: `shadow-2xl` + border.
- Fokus: outline 2 px `focus`, offset 2 px; jangan mematikan outline tanpa pengganti.

## 5. Komponen

### 5.1 Tombol

```tsx
<button className="btn btn-primary">Simpan</button>
<button className="btn btn-ghost btn-sm">Batal</button>
<button className="btn btn-icon" aria-label={t('common.close')}><Icon name="x" /></button>
<button className="btn btn-danger">Hapus</button>
```

- `.btn` min-height 34 px; `.btn-sm` 32 px; `.btn-icon` 32×32.
- Ikon selalu punya `aria-label` atau teks; ikon dekoratif `aria-hidden`.
- Satu `.btn-primary` per toolbar.
- Aksi destruktif tidak diletakkan bersebelahan langsung dengan aksi utama tanpa pemisah.

### 5.2 Input dan form

```tsx
<label className="flex flex-col gap-1">
  <span className="label">{t('form.name')}</span>
  <input className="input" aria-invalid={!!error} aria-describedby={error ? 'name-error' : undefined} />
  {error ? <span id="name-error" className="text-[12px] text-bad" role="alert">{error}</span> : null}
</label>
```

- Selalu gunakan `label` yang terhubung; placeholder bukan label.
- Error: `aria-invalid`, `aria-describedby`, dan teks `role="alert"`.
- Input file memakai style `file:` bawaan; jangan membuat tombol upload terpisah jika `input[type=file]` cukup.

### 5.3 Tabs

Gunakan `Tabs` dari `components/ui.tsx` untuk tab di dalam satu halaman. Untuk tab sesi aplikasi gunakan `SessionTabs`.

```tsx
<Tabs
  items={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]}
  value={tab}
  onChange={setTab}
  panelId="tool-panel"
/>
```

- `role="tablist"`, `role="tab"`, `aria-selected`, roving `tabIndex`.
- ArrowLeft/Right, Home/End.
- Panel sebaiknya `role="tabpanel"` dengan `id` yang dirujuk `aria-controls`.

### 5.4 Dialog

```tsx
<div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1}>
  <h2 id="dialog-title">…</h2>
</div>
```

- Gunakan `useFocusTrap(open, ref)`; jangan implementasi trap sendiri.
- Escape menutup; fokus kembali ke pemicu.
- Backdrop `bg-black/55`; konten `max-h-[min(80vh,…)] overflow-y-auto`.
- Jangan menumpuk dialog di atas dialog.

### 5.5 Toast dan konfirmasi

- Toast: `toast.tsx`, `aria-live="polite"`, durasi 3–5 detik, maksimal 3 terlihat.
- Konfirmasi destruktif: `confirm.tsx`, bukan `window.confirm`; tombol berbahaya memakai `.btn-danger`.
- Untuk operasi yang tidak bisa dibatalkan, teks menjelaskan akibatnya, bukan sekadar “Yakin?”.

### 5.6 PageHeader

```tsx
<PageHeader icon="files" title={t('files.title')} subtitle={t('files.subtitle')} actions={<button className="btn">…</button>} />
```

- Judul 20 px; subtitle disembunyikan di bawah `sm`.
- Aksi dibungkus satu baris yang bisa di-scroll horizontal di mobile; jangan menumpuk tombol ikon menjadi grid.
- Jangan mengulang judul yang sama di badan tool.

### 5.7 Kartu, panel, dan tabel

- `.card`: unit mandiri, radius 12 px, border `line`, background `panel`.
- `.soft-panel`: subbagian di dalam card, background `panel2/35`.
- Tabel: header `.label`, baris minimal 32 px, hover `hover/60`, angka rata kanan, aksi di kolom kanan.
- Di bawah `sm`, sembunyikan kolom non-esensial; jangan memaksa scroll horizontal untuk data utama.

### 5.8 Empty, loading, error

- `Empty`: ikon + judul + satu kalimat + aksi opsional.
- `Spinner`: hanya untuk proses singkat; untuk proses panjang gunakan progress/status teks.
- Error memakai `role="alert"` dan menyebut langkah pemulihan (“Coba lagi”, “Periksa path”).

## 6. Shell dan layout

- Sidebar: rail 56 px (`md`), expanded 240 px (`lg`); mobile drawer 288 px.
- Header: tinggi minimum 44 px, satu baris, `backdrop-blur`, border bawah.
- Konten: `.page-body`, maksimum lebar mengikuti tool (editor boleh penuh).
- Session tabs: di atas konten, satu baris scroll horizontal; tab aktif selalu terlihat.
- Mobile: drawer menutup setelah navigasi; konten utama tetap satu kolom.

Breakpoint:

| Nama | Lebar | Perilaku |
|---|---|---|
| base | < 640 | satu kolom, aksi sekunder di menu |
| `sm` | ≥ 640 | dua kolom kecil, subtitle tampil |
| `md` | ≥ 768 | sidebar rail, split pane sederhana |
| `lg` | ≥ 1024 | sidebar expanded, split pane penuh |
| `xl` | ≥ 1280 | ruang editor maksimal, panel samping tetap |

## 7. Aksesibilitas

Checklist minimum untuk komponen baru:

- [ ] Nama aksesibel untuk semua kontrol (teks, `aria-label`, atau `label`).
- [ ] Fokus terlihat; tidak ada `outline-none` tanpa pengganti.
- [ ] Keyboard: Tab masuk/keluar, panah untuk tab, Escape untuk overlay.
- [ ] Dialog: `role="dialog"`, `aria-modal`, label, trap, restore.
- [ ] Status dinamis: `role="status"` atau `aria-live`.
- [ ] Error terhubung ke input.
- [ ] Ikon dekoratif `aria-hidden`.
- [ ] Animasi menghormati `prefers-reduced-motion`.
- [ ] Kontras teks ≥4,5:1 (target saat ini ≥7:1).
- [ ] Target sentuh ≥24×24 px; ideal 32–36 px.

## 8. Internasionalisasi

- Gunakan `useI18n()` → `t(key)`.
- Setiap kunci wajib ada di `ID` dan `EN`; EN tidak boleh mengandalkan fallback.
- Jangan menyusun kalimat dengan konkatenasi; gunakan parameter eksplisit bila perlu.
- Istilah teknis (JSON, API, URL, Webhook, Git, Docker, SQL) tidak diterjemahkan.
- Nama file, path, perintah, dan output tool tidak diterjemahkan.
- Teks aria adalah teks pengguna; localize juga.

## 9. Konvensi kode

- Satu tool = satu file di `src/tools`; komponen bersama di `src/components`.
- Gunakan `cn()` untuk conditional class.
- Jangan menambah library UI; Tailwind + komponen yang ada cukup.
- Jangan menambah state global baru tanpa kebutuhan lintas-tool.
- Untuk data yang sering berubah, hindari re-render React per tick (contoh: resize textarea memakai DOM style langsung).
- Lazy load tool; jangan mengimpor tool berat secara statis di `App.tsx`.
- Pertahankan sesi yang sudah terbuka; jangan unmount iframe/terminal saat pindah tab.

## 10. Do / Don't

| Do | Don't |
|---|---|
| `text-muted` untuk teks sekunder | `text-[#91a4b7]` |
| `.btn btn-sm` | tombol `h-6` tanpa padding |
| `t('common.close')` | `aria-label="Tutup"` |
| `PageHeader` | `<h1 className="text-lg">` di dalam tool |
| `.soft-panel` | card di dalam card di dalam card |
| satu aksi primer | tiga tombol biru bersamaan |
| `useFocusTrap` | trap manual dengan event listener |
| label + input | placeholder sebagai satu-satunya label |

## 11. Definition of done untuk perubahan UI

1. Tidak ada overflow horizontal di 360, 390, 768, 1024, 1280, 1440.
2. Keyboard: semua alur utama bisa diselesaikan tanpa mouse.
3. Nama aksesibel lengkap; tidak ada tombol ikon tanpa label.
4. ID/EN simetris; tidak ada string baru di luar i18n.
5. `pnpm --filter @super-tool/web typecheck` dan `pnpm --filter @super-tool/web build` lulus.
6. Screenshot before/after untuk halaman yang berubah.
7. Tidak mengubah kontrak API atau perilaku sesi tanpa mencatat alasannya.
