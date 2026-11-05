# Audit performa backend & frontend

Commit: `27ffbd8` (5 Nov 2026). Cakupan: seluruh modul API NestJS (`apps/api/src`), bootstrap/DB, dan frontend React (`apps/web/src`, termasuk bundel hasil build).

Metode: baca kode, ukur endpoint pada server produksi hasil build (port 3113, `node dist/main.js`), dan ukur perilaku UI di Chromium headless (playwright-core sementara). Fixture: 1.900 berkas di satu folder, berkas kode 2.000 baris, JSON 4.000 objek (~600 KB), log teks 96 MB, webhook 10 item × 200 KB. Angka absolut bergantung disk/CPU lokal; yang penting rasionya. Tidak ada perubahan kode pada audit ini.

## Ringkasan prioritas

| Prioritas | Temuan | Dampak |
|-----------|--------|--------|
| **P0** | Aset statis tanpa kompresi + `Cache-Control: max-age=0` (A1) | 292 KB JS dikirim mentah tiap reload; API JSON 326 KB tanpa gzip |
| **P0** | `readText` membaca seluruh berkas sebelum memotong 2 MB (A2) | Buka log 96 MB = 96 MB RAM + 160 ms; beberapa tab bisa OOM |
| **P0** | `/fs/list` dan `/fs/du` melakukan `stat` serial per entri (A3) | 1.900 entri = 73 ms; folder 50 ribu entri = detik |
| **P0** | SSE webhook mengirim snapshot penuh tiap request masuk (A4) | 10 item = 1,96 MB per push; maksimum 20 MB, memblokir event loop |
| **P0** | JSON tool mem-parse + highlight seluruh dokumen tiap ketikan (B1) | 600 KB: buka 922 ms, 84 ribu node DOM, 56 ms per karakter |
| **P0** | Tabel File Explorer merender semua baris tanpa virtualization (B2) | 1.900 baris = 950 ms, 40.538 node DOM |
| **P1** | Proxy dan HTTP client Dev Space menampung seluruh respons (A5, A6) | Unduhan besar = RAM penuh sebelum dipotong 1 MB |
| **P1** | Pencarian rekursif membaca berkas satu per satu tanpa concurrency (A7) | Ribuan berkas = lambat; tidak bisa dibatalkan |
| **P1** | Pratinjau gambar memakai berkas asli, bukan versi resize (B3) | Gambar 50 MP didekode penuh di browser (ratusan MB) |
| **P1** | `CodeEditor` merender gutter 2.000 div + textarea penuh (B4) | Buka 2.000 baris = 231 ms; ambang virtualisasi terlalu tinggi |
| **P1** | Ports poll 5 detik tanpa single-flight/visibility (A8, B5) | `ss`+`ps` terus di-spawn walau tab disembunyikan |
| **P1** | WebhookTool mem-parse ulang seluruh state tiap event (B6) | 2–20 MB `JSON.parse` + render ulang 100 item |
| **P2** | Statement SQLite disiapkan ulang tiap query, VACUUM sinkron, thumbnail tanpa dedupe, dll. | Perbaikan kecil/bertahap |

## Hasil pengukuran

| Uji | Hasil |
|-----|-------|
| `GET /api/fs/list` 1.900 entri | 73 ms (serial `stat`) |
| `GET /api/fs/du` 2.000 berkas | 67 ms (serial `stat`) |
| `GET /api/ports` | 11,7 ms (spawn `ss` + `ps` tiap request) |
| `GET /api/notes` | 0,6 ms |
| `GET /api/fs/read` log 96 MB | 160 ms, membaca 96 MB untuk mengembalikan 2,26 MB |
| SSE webhook, 10 item × 200 KB | 1,96 MB per push; 100 item ≈ 20 MB |
| Aset `index-*.js` | 292.321 B mentah; 89.621 B kalau gzip (3,3×) |
| Aset `index-*.css` | 48.426 B mentah; 8.599 B kalau gzip (5,6×) |
| JSON `/api/fs/list` | 326.314 B mentah; 12.048 B kalau gzip (27×) |
| `Cache-Control` aset ber-hash | `public, max-age=0` (selalu revalidasi) |
| File Explorer, 1.900 baris | 950 ms; 40.538 node DOM |
| `CodeEditor`, 2.000 baris | buka 231 ms; 2.000 div gutter; mengetik 0,8 ms/char |
| JSON tool, 4.000 objek (~600 KB) | buka 922 ms; 84.208 node DOM; mengetik 56,2 ms/char |
| Markdown 1.500 baris | mengetik 4,0 ms/char; 1.722 node DOM |
| Bundel web | 27 berkas, 640 KB total; chunk utama 285 KB (89,6 KB gzip); `markdown` 67 KB; `FilesTool` 63 KB |

## A. Backend

### A1. Aset statis tidak dikompresi dan tidak di-cache — **Tinggi**
- `apps/api/src/main.ts:64`: `app.useStaticAssets(cfg.webDist, { index: false })`. Tidak ada middleware kompresi (paket `compression` tidak ada di `apps/api/package.json`), jadi Express memakai default `Cache-Control: public, max-age=0` dan mengirim berkas apa adanya.
- Nama berkas Vite sudah ber-hash (`index-DzWtEg5U.js`), aman di-cache `immutable` selamanya. Saat ini setiap reload tetap meminta ulang ke server (walau biasanya 304).
- Perbaikan: pasang `compression` (gzip/brotli) sebelum static; set header khusus: `/assets/*` → `public, max-age=31536000, immutable`, `index.html` → `no-cache`. Alternatif tanpa dependensi: prekompresi saat build (`.br`/`.gz`) + middleware kecil yang memilih berkas terkompresi.
- Dampak terukur: JS 3,3×, CSS 5,6×, JSON list 27× lebih kecil; ini juga menutup temuan API JSON tanpa gzip.

### A2. `readText` membaca seluruh berkas — **Tinggi**
- `apps/api/src/modules/files/files.service.ts:189-207`: `await readFile(path)` di baris 194 membaca seluruh isi, baru kemudian `buffer.subarray(0, TEXT_LIMIT)` (2 MB) dan deteksi biner dari 8 KB pertama.
- Log 96 MB: 160 ms dan alokasi 96 MB hanya untuk mengirim 2 MB. Dua-tiga request bersamaan bisa mendorong RSS ratusan MB; berkas 1 GB berisiko mematikan proses.
- Perbaikan: `stat` dulu; buka berkas dan baca hanya `TEXT_LIMIT + 8192` byte pertama (`open` + `read`). Deteksi biner dari head yang sudah dibaca. `truncated` dihitung dari `info.size > TEXT_LIMIT`. Estimasi: 160 ms → <10 ms, RAM ~2 MB.

### A3. `list` dan `dirSize` memakai `stat` serial — **Tinggi**
- `files.service.ts:158-186`: loop `for (const dirent ...)` dengan `await stat(full)` di baris 168. 1.900 entri = 73 ms; folder `node_modules`/dataset besar bisa 0,5–2 detik.
- `dirSize` (`files.service.ts:461-488`) juga `await stat` per berkas, berurutan, sampai 50 ribu kunjungan.
- Perbaikan: batasi konkurensi (`Promise.all` per batch 32/64) untuk `stat`; `dirSize` batch 16 dan hentikan saat `visited` melewati batas. Pertahankan `withFileTypes` agar tidak perlu `stat` untuk direktori. Estimasi list 73 → 15–25 ms.
- Tambahan kecil: sorting memakai `localeCompare` baru per pasangan; simpan satu `Intl.Collator('id')` di level modul.

### A4. SSE webhook mengirim snapshot penuh — **Tinggi**
- `apps/api/src/modules/webhook/webhook.service.ts:45-47` `info()` mengembalikan `endpoints` + `items` (termasuk `body` sampai 200 KB per item). `capture()` memanggil `push()` (baris 103) dan `send()` menulis `JSON.stringify(this.info())` untuk setiap listener (baris 119-129).
- Terukur: 10 item = 1,96 MB per push; 100 item (batas `MAX_ITEMS`) ≈ 20 MB per push. Setiap request webhook masuk memicu serialisasi 20 MB secara sinkron → event loop beku, semua endpoint lain ikut lambat.
- Perbaikan: kirim delta (`{ type: 'item', item }`) saat `capture`; snapshot penuh hanya saat subscribe/create/remove/clear. Kalau body besar tidak perlu di UI, kirim metadata dan sediakan endpoint `GET /webhook/item/:id` untuk membuka body. Frontend cukup prepend satu item.

### A5. Proxy menampung seluruh respons dan body — **Sedang–Tinggi**
- `apps/api/src/modules/proxy/proxy.middleware.ts:308`: `Buffer.from(await upstream.arrayBuffer())` sebelum memutuskan rewrite. Video/unduhan besar lewat proxy = seluruh isi di RAM; batas tidak ada.
- `readBody` (baris 99-108) menampung body request sampai 30 MB di memori sebelum diteruskan (Buffer.concat).
- Perbaikan: periksa `content-type`/`content-length` lebih dulu; untuk biner dan respons non-HTML/JS/JSON alirkan langsung (`Readable.fromWeb(upstream.body).pipe(res)`). Untuk HTML/JS/JSON yang perlu di-rewrite, beri batas (mis. 5 MB) dan streaming rewrite atau fallback tanpa rewrite di atas batas. Batasi `content-length` di awal.

### A6. HTTP client Dev Space menampung seluruh respons — **Sedang**
- `apps/api/src/modules/dev/dev.service.ts:67-76`: `Buffer.from(await response.arrayBuffer())`, baru kemudian `.subarray(0, 1_000_000)`. Unduhan 500 MB = 500 MB RAM walau UI hanya menampilkan 1 MB.
- Perbaikan: baca `response.body` bertahap sampai 1 MB lalu `cancel()`; set `truncated` dari pembacaan. Batalkan juga jika `content-length` sudah melebihi batas.

### A7. Pencarian rekursif serial dan tanpa pembatalan — **Sedang**
- `files.service.ts:409-460`: `readdir` + `readFile` per berkas berurutan; `search` tidak menerima `AbortSignal` (berbeda dari `grepText` yang memakai `rg` dan abort di `files.controller.ts:83-85`).
- Perbaikan: batasi konkurensi 8–16, lewati berkas > batas ukuran (mis. 2 MB) lewat `stat`, hentikan setelah hasil cap tercapai, dan teruskan sinyal `req.on('close')` seperti grep. Untuk pencarian isi di folder besar, arahkan ke `rg` (sudah ada) daripada walker JS.

### A8. SQLite: prepare per query, VACUUM sinkron — **Rendah–Sedang**
- `apps/api/src/common/db.ts:68-79`: setiap `all/one/run` memanggil `db.prepare(sql)` baru. Biayanya kecil (µs), tetapi query yang sama dipanggil terus (notes, recents, auth).
- `db.ts:62` dan `apps/api/src/modules/backup/backup.service.ts:45`: `VACUUM INTO` sinkron; selama snapshot, semua request lain menunggu.
- Perbaikan: cache `Map<string, StatementSync>` (dibatasi jumlahnya); pindahkan snapshot backup ke `worker_threads` bila DB membesar, atau dokumentasikan batas ukuran dan beri timeout.

### A9. Thumbnail tanpa dedupe konkurensi — **Rendah–Sedang**
- `files.service.ts:105-133`: cache 300 entri sudah baik, tetapi dua request untuk path yang sama saat cache kosong menjalankan dua proses `sharp`/`ffmpeg`. Folder berisi 100 video = 100 proses sekaligus, CPU jenuh dan UI lambat.
- Perbaikan: `Map<key, Promise<Buffer>>` untuk in-flight + antrean 2 proses. Setelah selesai, simpan ke cache seperti sekarang.

### A10. Pratinjau Office membaca seluruh OOXML — **Rendah**
- `apps/api/src/modules/files/office.ts:213,286`: `readFile` utuh sebelum unzip/parse; dokumen 100 MB = 100 MB RAM. Simpan juga membangun ulang zip penuh (`replaceEntry`).
- Perbaikan: tolak/peringatkan di atas batas ukuran (mis. 50 MB) sebelum membaca; untuk menyimpan, tetap rebuild karena format zip, tetapi batasi ukuran.

### A11. Ports: spawn tiap request, tanpa timeout — **Rendah**
- `apps/api/src/modules/ports/ports.service.ts:28-30`: `execFile` tanpa `timeout`; frontend memanggil tiap 5 detik (`apps/web/src/tools/PortsTool.tsx:143`).
- Terukur 11,7 ms/request, tetapi `ss`+`ps` terus dijalankan selamanya. Perbaikan: cache snapshot 2 detik di server, timeout 3 detik, single-flight.

## B. Frontend

### B1. JSON tool: parse + highlight seluruh dokumen tiap ketikan — **Tinggi**
- `apps/web/src/tools/JsonTool.tsx:50-61`: `JSON.parse`, `JSON.stringify(value, null, 2)`, lalu `highlightJson(pretty)` seluruh dokumen pada setiap perubahan teks. Hasil dimasukkan sebagai satu `dangerouslySetInnerHTML` (`JsonTool.tsx:114-115`).
- Terukur pada 4.000 objek (~600 KB): buka 922 ms, 84.208 node DOM, mengetik 56,2 ms/karakter. JSON 5 MB akan jauh lebih buruk (bahkan bisa freeze beberapa detik).
- Perbaikan: debounce parse 150–250 ms atau `useDeferredValue`; tampilkan preview dengan `VirtualCode`/`highlightLine` per baris (hanya baris terlihat), bukan satu HTML raksasa; batasi preview (mis. 2 MB) dengan tombol "buka penuh". Editor input tetap textarea.

### B2. Tabel File Explorer tanpa virtualization — **Tinggi**
- `apps/web/src/tools/FilesTool.tsx:937` merender `rows.map(...)` untuk seluruh entri (sampai 2.000). Terukur 1.900 baris: 950 ms, 40.538 node DOM, dan scroll berat di perangkat lemah.
- Perbaikan: pakai `@tanstack/react-virtual` yang sudah terpasang (dipakai `VirtualCode`) untuk body tabel; pertahankan header sticky, aksi per baris, dan perluasan. Ambang mis. >200 baris; di bawah itu biarkan render biasa. Estimasi: 950 → <150 ms, DOM <2.000 node.

### B3. Pratinjau gambar memakai berkas asli — **Sedang–Tinggi**
- `FilesTool.tsx:855-856`: `<img src="/api/fs/raw?...">` tanpa resize; gambar 8.000×6.000 (48 MP) didekode penuh di browser (ratusan MB) meski ditampilkan maksimal ~1.200 px.
- Perbaikan: endpoint `GET /api/fs/preview?path=...&w=1600` memakai `sharp.resize({ width, withoutEnlargement: true }).webp()` + cache seperti thumbnail; `<img>` memakai endpoint itu, klik "buka asli" tetap `/raw`.

### B4. `CodeEditor` merender gutter penuh — **Sedang**
- `apps/web/src/components/CodeEditor.tsx:24,60`: `value.split('\n')` lalu `Array.from({length: lineCount})` untuk gutter. 2.000 baris = 231 ms saat dibuka dan 2.000 node tambahan; masih bisa mengetik (0,8 ms/char) tetapi boros memori.
- Ambang virtualisasi di File Explorer baru aktif >2.000 baris (`FilesTool.tsx`, `largeFile`), jadi berkas 1.500–2.000 baris masih memakai textarea penuh.
- Perbaikan: turunkan ambang mode baca virtual ke ~500–800 baris, atau virtualkan gutter + pakai teknik overlay highlight untuk editor kecil. Hindari `split` ganda: hitung sekali dengan `useMemo`.

### B5. Ports poll tanpa visibility/single-flight — **Sedang**
- `apps/web/src/tools/PortsTool.tsx:116-146`: `load()` tiap 5 detik; tidak ada penjaga request sebelumnya, tidak berhenti saat tab disembunyikan. Server ikut men-spawn `ss`+`ps` terus-menerus.
- Perbaikan: `document.visibilityState` (pause saat hidden), `inFlight` ref, dan cache 2 detik di server.

### B6. WebhookTool: parse penuh + render semua item — **Sedang**
- `apps/web/src/tools/WebhookTool.tsx:72`: `JSON.parse(event.data)` untuk seluruh state pada setiap event; `items.map` (baris 227) merender sampai 100 item lengkap dengan header/body.
- Setelah backend mengirim delta (A4), ubah state dengan prepend item baru saja; buka detail body sesuai permintaan (lazy). Bila tetap 100 item, virtualkan daftar dan jangan render body yang tertutup.

### B7. Markdown tanpa debounce — **Rendah**
- `apps/web/src/tools/MarkdownTool.tsx:64`: `renderMarkdown(text)` lewat `useMemo` pada tiap ketikan. Pada 1.500 baris hanya 4 ms/char, jadi belum mendesak; dokumen >5.000 baris atau tabel/kode besar akan terasa.
- Perbaikan: `useDeferredValue(text)` untuk preview (input tetap responsif), atau debounce preview 120–200 ms saat dokumen besar.

### B8. URL Viewer menyimpan semua iframe — **Rendah**
- `apps/web/src/tools/UrlTool.tsx:150`: semua view yang pernah dibuka tetap hidup (iframe tidak dilepas) demi state tool. Setiap iframe = proses/renderer terpisah; 10 tab = memori besar.
- Perbaikan: batasi view aktif (mis. 5) atau buang iframe yang tidak terlihat setelah N menit, dengan peringatan state hilang.

### B9. Poll kompresor 700 ms — **Rendah**
- `apps/web/src/tools/CompressTool.tsx:163`: interval 700 ms per job, tanpa visibility check. Beban server kecil (satu job), tetapi mudah diperbaiki: 1.000–1.500 ms atau `visibilitychange`.

### B10. Bundel — **Rendah**
- Chunk utama 285 KB (89,6 KB gzip) berisi React + router + i18n + shell; route tool sudah lazy (27 chunk, total 640 KB). Belum perlu `manualChunks`; setelah A1 (gzip + cache immutable) biaya muat ulang hampir hilang. Pertimbangkan vendor split hanya jika chunk utama >400 KB mentah.

## C. Quick win (urut rasio manfaat/biaya)

| # | Perubahan | Perkiraan | Dampak |
|---|-----------|-----------|--------|
| 1 | Kompresi + cache immutable aset dan API (A1) | <1 jam | Transfer 3–27× lebih kecil; reload tanpa roundtrip |
| 2 | `readText` baca prefix saja (A2) | <1 jam | Buka berkas besar dari 160 ms/96 MB → <10 ms/~2 MB |
| 3 | `stat` paralel untuk list/du (A3) | 1–2 jam | List 73 → 15–25 ms |
| 4 | Delta SSE webhook + UI append (A4/B6) | 2–3 jam | Push 20 MB → <1 KB untuk item baru |
| 5 | JSON preview virtual + debounce (B1) | 3–4 jam | Ketik 56 → <5 ms/char; DOM 84 ribu → <200 |
| 6 | Virtualisasi tabel File Explorer (B2) | 3–4 jam | Buka listing 950 → <150 ms |
| 7 | Streaming proxy + HTTP client (A5/A6) | 3–5 jam | RAM tidak meledak saat unduhan besar |
| 8 | Endpoint preview gambar resize (B3) | 2 jam | Decode gambar besar di browser turun drastis |

## D. Yang sudah baik (jangan diutak-atik)

- `GET /api/fs/raw` memakai stream + dukungan HTTP Range (`files.controller.ts:105-140`), jadi audio/video tidak diunduh penuh.
- Pencarian isi memakai `rg` (proses terpisah) dan dibatalkan saat klien menutup koneksi; jauh lebih cepat daripada walker JS.
- Thumbnail di-cache 300 entri di memori dan dimuat `loading="lazy"` di klien.
- SQLite viewer membatasi baris (`MAX_ROWS`) dan tabel memakai `LIMIT/OFFSET`; tidak menarik seluruh tabel.
- Read log memakai jendela 4 MB terakhir, bukan seluruh berkas (`dev.service.ts:86-98`).
- Route tool sudah `lazy()` per fitur; `VirtualCode` hanya merender baris terlihat.
- Daftar catatan tidak menyertakan `body`; detail diambil saat dipilih.
- `fs/search` minimal 2 karakter dan `grep` memakai batas hasil; mencegah query tak terbatas.
