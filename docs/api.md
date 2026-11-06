# Referensi API

Base URL: `http://127.0.0.1:3001/api` (dev: sama, di-proxy Vite).

Semua endpoint (kecuali `/auth/login`, `/hook/<token>`, dan `/calendar/callback`) butuh cookie `st_session`. Metode selain GET wajib menyertakan header `X-ST-CSRF: 1`.

Contoh login dan menyimpan cookie:

~~~bash
curl -c cookies.txt -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"password":"password"}'
~~~

## Auth

| Metode | Path | Body | Hasil |
|--------|------|------|-------|
| POST | `/auth/login` | `{ password }` | `{ ok, mustChange }` + set cookie |
| POST | `/auth/logout` | – | `{ ok }` |
| GET | `/auth/me` | – | `{ authenticated, mustChange }` |
| POST | `/auth/change-password` | `{ current, next }` | `{ ok, mustChange }` + cookie baru |

Password baru minimal 8 karakter dan tidak boleh `password`.

Selama `mustChange = true`, endpoint lain membalas:

~~~json
{ "statusCode": 403, "code": "PASSWORD_CHANGE_REQUIRED", "message": "Ganti password dulu" }
~~~

## Catatan

| Metode | Path | Body | Hasil |
|--------|------|------|-------|
| GET | `/notes` | – | daftar `{ id, title, createdAt, updatedAt }` |
| GET | `/notes/:id` | – | catatan lengkap termasuk `body` |
| POST | `/notes` | `{ title?, body? }` | catatan baru |
| PUT | `/notes/:id` | `{ title?, body? }` | catatan terbaru |
| DELETE | `/notes/:id` | – | `{ ok }` |

## URL Viewer

| Metode | Path | Body | Hasil |
|--------|------|------|-------|
| GET | `/urls` | – | `{ urls: [{ id, name, url, proxy, createdAt }] }` |
| POST | `/urls` | `{ name?, url, proxy? }` | `{ ok, url }` |
| PUT | `/urls/:id` | `{ name?, url?, proxy? }` | `{ ok, url }` |
| DELETE | `/urls/:id` | – | `{ ok }` |

Skema selain `http`/`https` ditolak dengan 400.

## Path terakhir dibuka

| Metode | Path | Query | Hasil |
|--------|------|-------|-------|
| GET | `/recent` | `kind` (`nginx`, `file`) | `{ kind, paths: [{ path, openedAt }] }` |

Catatan:

- **Database**: akun, catatan, URL, dan path terakhir ada di SQLite (`~/.local/share/super-tool/super-tool.db`).
- Isi file nginx/explorer tidak disimpan di database — hanya path yang pernah dibuka.

## Backup & restore

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/backup` | – | file `.zip` (attachment) berisi `super-tool.db`, `uploads/` bila ada, `backup.json` |
| POST | `/restore` | multipart `file` (bukan query), wajib header `x-st-csrf: 1` | `{ ok, size, uploads, revoked, at }` |

`GET /backup` membuat snapshot konsisten dengan `VACUUM INTO` lalu mengompresnya (archiver). `POST /restore` memvalidasi arsip (nama entri tanpa `..`/path absolut, maks 3000 entri, maks 100 MB terkompresi dan 1 GB isi), memeriksa header `SQLite format 3`, mengekstrak dengan perintah sistem `unzip`, mengganti database aktif (koneksi ditutup lalu dibuka ulang) dan folder `uploads`. Sesi login lama tidak valid setelah restore karena secret HMAC tersimpan di database.

## Storage Monitor

Root scan adalah folder pertama `ST_FS_ROOTS` (default home). Kedalaman 2 level; `snap`/`lost+found` dilewati. Scan per folder top-level berjalan paralel dengan timeout 5 menit per folder; scan bersifat on-demand (tanpa cron), hasilnya di-cache 6 jam di tabel `storage_cache` SQLite dan bertahan setelah restart.

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/storage/usage` | `refresh=1` (opsional) | `{ root, total, scannedAt, truncated, warning?: { code, path? }, count, disk, tree[] }` |
| POST | `/storage/delete` | `{ path }` | `{ ok, path }`; hanya nama folder allowlist, path di dalam root |
| POST | `/storage/docker-prune` | – | `{ ok, output }` dari `docker system prune -f` |

`tree[]` berisi `{ name, path, size, depth, cleanable, children? }`, diurutkan dari yang terbesar. Semua baris bisa disalin path-nya; folder dengan `cleanable=true` boleh dihapus dari UI setelah konfirmasi. Docker prune memakai argumen tetap dan tidak menghapus volume. Cache dihapus setelah delete/prune.

## File sistem

Root yang diizinkan berasal dari `ST_FS_ROOTS`. Path di luar root → `403`.

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/fs/roots` | – | `[{ path, label }]` |
| GET | `/fs/list` | `path` | `{ path, parent, entries[], truncated }` |
| GET | `/fs/read` | `path` | `{ text, binary, size, mtime, ext, truncated }` |
| GET | `/fs/raw` | `path`, `download=1` | isi file mentah, mendukung HTTP Range (206) |
| GET | `/fs/thumb` | `path` | thumbnail `image/webp` 96×96 (gambar via sharp, video via ffmpeg); 400 jika tidak didukung |
| GET | `/fs/office` | `path` | pratinjau docx/xlsx/pptx/odt/ods/odp |
| POST | `/fs/office` | `{ path, texts[] }` atau `{ path, cells[] }` | simpan hasil edit + cadangan otomatis |
| GET | `/fs/grep` | `path`, `q`, `limit`, `exclude`, `include` | `{ results: [{ path, line, text }], truncated, warning? }` |
| GET | `/fs/search` | `path`, `q`, `all=1`, `exclude`, `include` | `{ results[], truncated }` |

`exclude` = pola berkas yang dilewati, dipisah koma (contoh `*.log,*.map`); entri berakhiran `/` dianggap folder (`node_modules/` → `--exclude-dir`). `include` = batasi hasil ke path yang memuat salah satu potongan, juga dipisah koma (contoh `apps/api,src`). Path include yang ada dipakai sebagai titik mulai, jadi folder lain tidak dipindai; pencarian isi memakai ripgrep bila tersedia (fallback grep). Berlaku untuk pencarian isi (diteruskan sebagai `--exclude` ke grep) maupun pencarian nama. Pencarian isi memakai `grep` streaming: bila browser memutus request (tombol **Batal**), proses grep langsung dihentikan dan hasil parsial dikirim sebelum koneksi ditutup. Exit code 2 (misal ada folder tanpa izin) tidak lagi dianggap gagal selama ada hasil.
| GET | `/fs/du` | `path` | `{ bytes, files, truncated }` |
| PUT | `/fs/write` | `{ path, content }` | `{ ok, size }` |
| POST | `/fs/mkdir` | `{ path }` | `{ ok, path }` |
| POST | `/fs/rename` | `{ path, name }` | `{ ok, path }` |
| POST | `/fs/upload` | multipart `file` + query `path` | `{ ok, path, size }` |
| DELETE | `/fs` | `path` | `{ ok }` |

Entri berisi `{ name, path, dir, size, mtime, ext, hidden }`. File > 2 MB dipotong (`truncated: true`), file biner mengembalikan `binary: true` tanpa isi.

**Pratinjau Office** mengembalikan `{ kind, blocks[], editable, size, mtime }`. `blocks` berisi `{ type: "text", lines[] }` atau `{ type: "table", name, rows[][], refs[][] }` (`refs` = alamat sel seperti `B3`). `editable`: `text` untuk docx, `sheet` untuk xlsx, `none` untuk sisanya.

Menyimpan hasil edit:

~~~bash
# docx: ganti teks paragraf, jumlah paragraf harus sama
curl -b cookies.txt -X POST http://127.0.0.1:3001/api/fs/office \
  -H 'content-type: application/json' -H 'x-st-csrf: 1' \
  -d '{"path":"/home/akihira17/laporan.docx","texts":["Judul baru","Isi paragraf"]}'

# xlsx: ganti nilai sel
curl -b cookies.txt -X POST http://127.0.0.1:3001/api/fs/office \
  -H 'content-type: application/json' -H 'x-st-csrf: 1' \
  -d '{"path":"/home/akihira17/data.xlsx","cells":[{"sheet":0,"ref":"B2","value":"123"}]}'
~~~

Respons: `{ ok: true, path, size, backup }`. `backup` adalah salinan `<nama>_backup_<YYYYMMDD-HHMMSS>.<ext>`; lima cadangan terbaru disimpan per berkas, sisanya dihapus.

Contoh:

~~~bash
curl -b cookies.txt "http://127.0.0.1:3001/api/fs/list?path=/home/akihira17"
curl -b cookies.txt -X PUT http://127.0.0.1:3001/api/fs/write \
  -H 'content-type: application/json' -H 'x-st-csrf: 1' \
  -d '{"path":"/home/akihira17/catatan.txt","content":"halo"}'
~~~

## Port

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/ports` | – | `{ ports[], generatedAt }` |
| GET | `/ports/processes` | `limit` (default 60, maks 200) | `{ rows[], system, generatedAt }` |
| POST | `/ports/kill` | `{ pid }` | kirim SIGTERM |

Baris port: `{ proto, address, port, pid, process, cmd, uptimeSec, established }`.
Baris proses: `{ pid, ppid, user, cpu, mem, rssKb, elapsed, command, args }`, plus ringkasan `system` (load, cpus, memTotal, memFree, uptime).

`kill` menolak PID 1, PID server itu sendiri, dan PID yang tidak ada. Sinyal yang dikirim SIGTERM (bukan SIGKILL).

## Nginx

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/nginx/files` | – | `{ dir, files[] }` (tiap file punya `hasBackup`) |
| GET | `/nginx/file` | `path` | `{ path, text, mtime }` |
| POST | `/nginx/file` | `{ name }` | buat file `.conf` baru dari template |
| PUT | `/nginx/file` | `{ path, content }` | simpan; isi asli disalin ke `<file>.bak` saat pertama kali |
| DELETE | `/nginx/file` | `path` | hapus file + cadangannya |
| POST | `/nginx/revert` | `{ path }` | pulihkan dari `<file>.bak`, lalu hapus cadangan |
| POST | `/nginx/test` | – | `{ ok, output }` (jalankan `nginx -t`) |

Hanya file `*.conf`, `*.bak`, `*.disabled` di dalam `ST_NGINX_DIR`. Nama saat membuat file wajib berakhiran `.conf` tanpa folder.

## Proxy

| Metode | Path | Query | Hasil |
|--------|------|-------|-------|
| GET | `/proxy` | `u` (URL ter-encode) | konten target |

Meneruskan status dan header target, melepas `X-Frame-Options`, `CSP`, dan `Set-Cookie`. Untuk HTML, disuntik `<base href>` agar aset relatif tetap termuat. Hanya host lokal/privat kecuali `ST_PROXY_ALLOW_PUBLIC=1`.

~~~bash
curl -b cookies.txt "http://127.0.0.1:3001/api/proxy?u=http%3A%2F%2Flocalhost%3A8080%2F"
~~~

### Mode subdomain (disarankan)

```
GET http://<hex>.localhost:<port>/<path...>
```

`hex` = heksadesimal dari origin target (huruf kecil, karena nama host selalu di-lowercase browser). Contoh `http://127.0.0.1:8080` → `687474703a2f2f3132372e302e302e313a38303830`.

Pada mode ini seluruh host adalah milik target: path (termasuk `/api/...` absolut), query, cookie, `localStorage`, dan WebSocket ikut apa adanya. Yang diubah hanya:

- `X-Frame-Options`, CSP, `content-encoding`, dan `content-length` dibuang (ukuran dihitung ulang)
- `Set-Cookie` kehilangan `Domain`, ditambah `SameSite=None; Secure` supaya tetap terpakai di dalam iframe (`localhost` = secure context)
- `Location` absolut ke origin target diarahkan ke host proxy

Tidak butuh sesi Super Tool: cookie aplikasi ini host-only, jadi permintaan dari subdomain tidak membawanya. Pembatasannya tetap sama — server hanya listen di `127.0.0.1` dan target wajib loopback/privat.

### Mode path (halaman statis)

```
GET /api/proxy/b/<token>/<path...>
```

`token` = base64url dari origin target, contoh `http://127.0.0.1:8080`. Middleware ini:

- melepas `X-Frame-Options`, CSP, dan menulis ulang `Set-Cookie` (Domain dilepas, Path jadi prefix proxy, Secure dilepas bila target http)
- menyuntik `<base href>` dan menulis ulang URL absolut supaya aset relatif tetap termuat
- meneruskan POST/PUT/DELETE beserta body, cookie, dan upgrade WebSocket
- menolak host publik (kecuali `ST_PROXY_ALLOW_PUBLIC=1`)

Cek cepat tanpa memuat konten:

| Metode | Path | Query | Hasil |
|--------|------|-------|-------|
| GET | `/proxy/probe` | `u` | `{ ok, status }` atau `{ ok: false, error }` |

## LLM

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/llm/models` | `key` (opsional) | `{ ok, baseUrl, models[] }` |
| POST | `/llm/explain` | `{ code, model, apiKey?, question? }` | `{ text, model }` |

Endpoint memakai API kompatibel OpenAI dari `ST_LLM_BASE_URL`. Kunci API diambil dari `apiKey` di body, kalau kosong dari `ST_LLM_API_KEY`.

```bash
curl -b cookies.txt -X POST http://127.0.0.1:3001/api/llm/explain \
  -H 'content-type: application/json' -H 'x-st-csrf: 1' \
  -d '{"code":"proxy_set_header Host $host;","model":"ocg/deepseek-flash"}'
```

## Kompresor

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/compress/info` | – | `{ image, pdf, pdfToImage, convert }` |
| GET | `/compress/job` | `id` | `{ id, state, result?, error? }` |
| POST | `/compress/image` | `{ path, quality?, maxWidth?, format? }` | `{ jobId }` |
| POST | `/compress/pdf` | `{ path, mode? }` | `{ jobId }`; ghostscript streaming tanpa batas 200 MB, fallback pdf-lib ≤50 MB |
| POST | `/compress/convert` | `{ path, target, quality?, dpi? }` | `{ jobId }` |

Proses berjalan di latar belakang: `state` bergerak `running` lalu `done` (ada `result`) atau `error` (ada `error`).

~~~bash
JOB=$(curl -s -b cookies.txt -X POST http://127.0.0.1:3001/api/compress/image \
  -H 'content-type: application/json' -H 'x-st-csrf: 1' \
  -d '{"path":"/home/akihira17/foto.jpg","quality":70}' | jq -r .jobId)
curl -s -b cookies.txt "http://127.0.0.1:3001/api/compress/job?id=$JOB"
~~~

`result`: `{ input: { path, size }, output: { path, size }, saved, percent, note }`. Target konversi: `pdf` (dari gambar), `png`/`jpg`/`webp` (dari PDF atau gambar).

## Dev Space

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| POST | `/dev/hash` | `{ text, algo, hmacKey? }` | `{ algo, hex }` |
| POST | `/dev/http` | `{ method, url, headers[], body, timeoutMs }` | `{ status, ms, size, headers, body, truncated }` |
| GET | `/dev/logs` | `path`, `lines` | `{ path, size, mtime, lines[] }` (`ST_LOG_ROOTS`, default `/var/log`, boleh di luar `ST_FS_ROOTS`) |
| GET | `/dev/logs/stream` | `path` | SSE baris baru (event `{ line }` atau `{ reset }`) |
| GET | `/dev/docker` | `view=containers` / `images` / `logs`, `id` | `{ rows[] }` atau `{ text }` |
| POST | `/dev/docker/action` | `{ action: "start"\|"stop"\|"restart"\|"remove", id }` | `{ ok, action, output }`; `remove` memakai `docker rm -f` |
| GET | `/dev/git` | `path`, `ref` (opsional) | `{ branch, head, ahead, behind, staged[], changed[], untracked[], log[], diffstat, tags[], branches[], graph, ref }` — `staged/changed/untracked` berisi `{ status, path }`, `log` berisi `{ hash, short, parents[], author, email, when, subject, refs[] }` |
| POST | `/dev/git/stage` | `{ path, files[], action: "stage"\|"unstage" }` | `{ ok, files, action }` |
| GET | `/dev/git/diff` | `path`, `file`, `staged=1` | `{ diff }` (patch working tree atau `--cached`) |
| GET | `/dev/git/show` | `path`, `hash` | `{ diff }` (patch commit) |
| GET | `/dev/cron` | – | `{ entries: [{ index, line }], raw }` |
| POST | `/dev/cron` | `{ line }` | daftar terbaru |
| DELETE | `/dev/cron` | `index` | daftar terbaru |
| GET | `/dev/dns` | `host` | `{ host, a[], aaaa[], mx[], cname[], ns[], txt[], geo }` |

`algo`: `md5`, `sha1`, `sha256`, `sha512`, `sha3-256`, `sha3-512`. Bila `hmacKey` diisi, dipakai HMAC. Regex tester dan encode/decode dasar jalan di browser, tidak butuh endpoint.

`/dev/http` menolak alamat metadata cloud (169.254.169.254), timeout maksimum 60 detik, body respons dipotong 1 MB.

`/dev/git`: `log` diambil dari `git log --all` (60 commit) atau `ref` tertentu, lengkap dengan parent untuk menghitung lane grafik di browser; `graph` tetap dikirim sebagai teks `git log --graph --oneline --decorate` untuk kompatibilitas. `branches` = daftar branch lokal (maks 30). `git stage` memakai `git add --` / `git restore --staged --`, maksimal 200 berkas per request.

## Webhook Receiver

| Metode | Path | Auth | Hasil |
|--------|------|------|-------|
| ANY | `/hook/<token>` | publik (token) | `{ ok, received }` — request disimpan ke ring buffer endpoint tersebut |
| GET | `/webhook` | login | `{ endpoints: [{ id, name, token, createdAt }], items[] }` |
| POST | `/webhook` | login + CSRF | body `{ name? }` → endpoint baru (maks 10) |
| PUT | `/webhook/e/:id` | login + CSRF | body `{ token }` → endpoint dengan URL baru; token `[A-Za-z0-9_-]{1,64}` dan unik |
| DELETE | `/webhook/e/:id` | login + CSRF | `{ endpoints, items }` — hapus endpoint + riwayatnya |
| DELETE | `/webhook/items?endpoint=<id>` | login + CSRF | `{ ok }` — kosongkan riwayat satu endpoint |
| DELETE | `/webhook` | login + CSRF | `{ ok }` — kosongkan semua riwayat |
| GET | `/webhook/stream` | login | SSE `{ endpoints, items }` setiap ada request/perubahan |

Body mentah dikumpulkan sebelum body-parser JSON (maks 10 MB, disimpan 200 KB pertama), jadi endpoint ini menerima JSON, form, teks, atau biner kecil. Tiap endpoint punya token acak 6 byte yang dibuat saat server start (atau saat endpoint ditambah); riwayat hanya di memori, total 100 item terakhir dengan `endpointId` di tiap item.

## Downloader

| Metode | Path | Auth | Body/Query | Hasil |
|--------|------|------|------------|-------|
| POST | `/downloader/info` | login + CSRF | `{ url }` | metadata: `{ title, uploader, duration, thumbnail, source, heights[], hasAudio, live }` |
| POST | `/downloader/proxy` | login + CSRF | `{ url, quality?, audioOnly? }` | stream file (`Content-Disposition: attachment`) MP4 atau MP3 |
| GET | `/downloader/proxy` | login | `url`, `quality`, `audio=1` | sama; untuk anchor/`window.location` |

Alur UI: `info` memakai yt-dlp `--dump-single-json --skip-download` agar user bisa memeriksa judul/thumbnail/durasi dan memilih resolusi sebelum mengunduh; `proxy` baru dijalankan setelah tombol Download. `quality` = `best` (default), `1080`, `720`, `480`, `360`; `audioOnly` = `true` menghasilkan MP3. Hanya host YouTube (`youtube.com`, `youtu.be`), Facebook (`facebook.com`, `fb.com`, `fb.watch`), dan Bilibili (`bilibili.com`, `b23.tv`) yang diterima; skema selain http(s), kredensial di URL, dan host lain ditolak 400. Playlist dimatikan, jadi satu URL = satu video.

`heights` berisi resolusi yang benar-benar tersedia (bisa lebih banyak dari pilihan UI; pilihan final mengikuti `best|1080|720|480|360`). Server menjalankan yt-dlp ke folder unik di `temp/` (`ST_TEMP_DIR`), menggabungkan video+audio dengan `ffmpeg-static`, lalu mengalirkan file. Folder dihapus setelah response selesai, klien memutus koneksi, atau proses gagal; folder sisa lebih dari 6 jam dibersihkan saat start. Error yt-dlp dikembalikan sebagai JSON 400 dengan pesan ringkas; file tidak pernah disimpan sebagai library permanen.

## Google Calendar

Route `/calendar/auth` dan `/calendar/events` dilindungi AuthGuard global (cookie sesi; aplikasi ini tidak memakai JWT). Callback publik dengan `state` sekali pakai. Scope OAuth adalah `https://www.googleapis.com/auth/calendar` (baca-tulis).

| Metode | Path | Auth | Hasil |
|--------|------|------|-------|
| GET | `/calendar/auth` | login | `{ url }` URL consent Google (`calendar`, `access_type=offline`, `state` 32 hex sekali pakai) |
| GET | `/calendar/auth?switch=1` | login | URL consent dengan `prompt=select_account consent` untuk berganti akun; refresh token akun lama tidak dipakai ulang |
| GET | `/calendar/callback?code=&state=` | publik (state) | 302 ke `/#/calendar?google=connected` / `denied` / `error`; menukar code dan menyimpan token ke `google_tokens` |
| GET | `/google/callback?code=&state=` | publik (state) | alias callback untuk `GOOGLE_REDIRECT_URI` lama (perilaku sama) |
| GET | `/calendar/events` | login | `timeMin?`, `timeMax?` → `{ calendarId, account, timeMin, timeMax, writeScope, events[] }`; semua kalender, default awal bulan berjalan, maks 250 |
| POST | `/calendar/events` | login + CSRF | `{ summary, start, end, timeZone?, location?, description?, allDay? }` → event baru |
| POST | `/calendar/disconnect` | login + CSRF | `{ ok: true }`; hapus baris `google_tokens` lalu cabut grant Google best-effort |

`events[]` berisi `{ id, calendarId, calendarName, summary, description, location, start, end, htmlLink, status, allDay, organizer, attendees[], conference, attachments[] }`. `description` masih berupa HTML dari Google; UI menyaring tag/atribut lewat whitelist dan hanya mengizinkan URL `http(s)`/`mailto`/`tel` sebelum dirender. `attendees` maksimal 50 orang, `attachments` maksimal 10 file, dan `conference` berisi entry point video (mis. Google Meet) atau `null`. Event digabung dari semua kalender (kalender langganan ikut; satu kalender yang gagal dilewati). `start`/`end` mengikuti format Google: `{ dateTime, timeZone }` atau `{ date }` untuk all-day. `POST` menerima ISO datetime untuk `start`/`end`; untuk `allDay: true` gunakan `YYYY-MM-DD` dan `end` eksklusif (tanggal setelah hari terakhir).

`writeScope` bernilai `false` jika token tersimpan masih memakai scope baca-saja; UI menampilkan tombol **Hubungkan ulang**. Token disimpan di satu baris tabel `google_tokens` (`access_token`, `refresh_token`, `expiry`, `scope`, `token_type`, `updated_at`). Access token di-refresh otomatis 60 detik sebelum kedaluwarsa dan refresh token lama dipertahankan; scope lama tidak ditimpa saat refresh tanpa scope. Saat mode `switch`, baris token lama dihapus lebih dulu agar refresh token akun sebelumnya tidak pernah dipakai untuk akun baru, lalu grant lama dicabut best-effort. Tanpa env `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `/calendar/auth` membalas 400 berisi instruksi; `/calendar/events` tanpa token tersimpan juga 400 dengan pesan "belum terhubung". Callback tidak memakai sesi karena consent bisa selesai di profil browser lain — keamanannya dari `state` acak 16 byte, berlaku 10 menit, dan sekali pakai.

## SQLite Viewer

Penampil database aplikasi sendiri (`ST_DATA_DIR/super-tool.db`). Semua route wajib login (AuthGuard global), dan `POST` wajib header `x-st-csrf: 1`.

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/sqlite/info` | – | `{ path, size, mtime, tables: [{ name, type, rows }] }` |
| GET | `/sqlite/table` | `name`, `limit` (maks 500), `offset` | `{ table, columns[], rows[], total, limit, offset }` |
| POST | `/sqlite/query` | `{ sql }` | `{ columns[], rows[], total, truncated }` |

Koneksi viewer dibuka **read-only** (`readOnly: true`, `PRAGMA query_only = ON`) dengan `busy_timeout = 5000`, sedangkan koneksi utama memakai `journal_mode = WAL` — jadi membaca database tidak memblokir aplikasi yang sedang menulis. `/sqlite/query` hanya menerima `SELECT` / `WITH` / `PRAGMA` / `EXPLAIN`, satu perintah per request, dan memotong hasil di 500 baris.

## Kode error

| Status | Arti |
|--------|------|
| 401 | Belum login / password salah / token kedaluwarsa |
| 403 | CSRF tidak ada, path di luar root, atau wajib ganti password |
| 404 | File/catatan tidak ditemukan, token webhook salah |
| 415/400 | Input tidak valid (JSON rusak, nama file tidak sah) |
