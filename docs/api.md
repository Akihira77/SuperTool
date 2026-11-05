# Referensi API

Base URL: `http://127.0.0.1:3001/api` (dev: sama, di-proxy Vite).

Semua endpoint (kecuali `/auth/login`) butuh cookie `st_session`. Metode selain GET wajib menyertakan header `X-ST-CSRF: 1`.

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

## File sistem

Root yang diizinkan berasal dari `ST_FS_ROOTS`. Path di luar root → `403`.

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/fs/roots` | – | `[{ path, label }]` |
| GET | `/fs/list` | `path` | `{ path, parent, entries[], truncated }` |
| GET | `/fs/read` | `path` | `{ text, binary, size, mtime, ext, truncated }` |
| GET | `/fs/raw` | `path`, `download=1` | isi file mentah, mendukung HTTP Range (206) |
| GET | `/fs/office` | `path` | pratinjau docx/xlsx/pptx/odt/ods/odp |
| POST | `/fs/office` | `{ path, texts[] }` atau `{ path, cells[] }` | simpan hasil edit + cadangan otomatis |
| GET | `/fs/grep` | `path`, `q`, `limit` | `{ results: [{ path, line, text }], truncated }` |
| GET | `/fs/search` | `path`, `q`, `all=1` | `{ results[], truncated }` |
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
| POST | `/compress/pdf` | `{ path, mode? }` | `{ jobId }` |
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
| GET | `/dev/git` | `path` | `{ branch, ahead, behind, staged[], changed[], untracked[], commits[], diffstat, tags[] }` |
| GET | `/dev/cron` | – | `{ entries: [{ index, line }], raw }` |
| POST | `/dev/cron` | `{ line }` | daftar terbaru |
| DELETE | `/dev/cron` | `index` | daftar terbaru |
| GET | `/dev/dns` | `host` | `{ host, a[], aaaa[], mx[], cname[], ns[], txt[], geo }` |

`algo`: `md5`, `sha1`, `sha256`, `sha512`, `sha3-256`, `sha3-512`. Bila `hmacKey` diisi, dipakai HMAC. Regex tester dan encode/decode dasar jalan di browser, tidak butuh endpoint.

`/dev/http` menolak alamat metadata cloud (169.254.169.254), timeout maksimum 60 detik, body respons dipotong 1 MB.

## Kode error

| Status | Arti |
|--------|------|
| 401 | Belum login / password salah / token kedaluwarsa |
| 403 | CSRF tidak ada, path di luar root, atau wajib ganti password |
| 404 | File/catatan tidak ditemukan |
| 415/400 | Input tidak valid (JSON rusak, nama file tidak sah) |
