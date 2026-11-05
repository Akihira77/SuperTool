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

## File sistem

Root yang diizinkan berasal dari `ST_FS_ROOTS`. Path di luar root → `403`.

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/fs/roots` | – | `[{ path, label }]` |
| GET | `/fs/list` | `path` | `{ path, parent, entries[], truncated }` |
| GET | `/fs/read` | `path` | `{ text, binary, size, mtime, ext, truncated }` |
| GET | `/fs/raw` | `path`, `download=1` | isi file mentah |
| GET | `/fs/search` | `path`, `q`, `all=1` | `{ results[], truncated }` |
| GET | `/fs/du` | `path` | `{ bytes, files, truncated }` |
| PUT | `/fs/write` | `{ path, content }` | `{ ok, size }` |
| POST | `/fs/mkdir` | `{ path }` | `{ ok, path }` |
| POST | `/fs/rename` | `{ path, name }` | `{ ok, path }` |
| POST | `/fs/upload` | multipart `file` + query `path` | `{ ok, path, size }` |
| DELETE | `/fs` | `path` | `{ ok }` |

Entri berisi `{ name, path, dir, size, mtime, ext, hidden }`. File > 2 MB dipotong (`truncated: true`), file biner mengembalikan `binary: true` tanpa isi.

Contoh:

~~~bash
curl -b cookies.txt "http://127.0.0.1:3001/api/fs/list?path=/home/akihira17"
curl -b cookies.txt -X PUT http://127.0.0.1:3001/api/fs/write \
  -H 'content-type: application/json' -H 'x-st-csrf: 1' \
  -d '{"path":"/home/akihira17/catatan.txt","content":"halo"}'
~~~

## Port

| Metode | Path | Hasil |
|--------|------|-------|
| GET | `/ports` | `{ ports[], generatedAt }` |

Setiap baris: `{ proto, address, port, pid, process, cmd, uptimeSec, established }`.

## Nginx

| Metode | Path | Query/Body | Hasil |
|--------|------|------------|-------|
| GET | `/nginx/files` | – | `{ dir, files[] }` |
| GET | `/nginx/file` | `path` | `{ path, text, mtime }` |
| PUT | `/nginx/file` | `{ path, content }` | `{ ok, path }` |
| POST | `/nginx/test` | – | `{ ok, output }` |

Hanya file `*.conf`, `*.bak`, `*.disabled` di dalam `ST_NGINX_DIR`.

## Proxy

| Metode | Path | Query | Hasil |
|--------|------|-------|-------|
| GET | `/proxy` | `u` (URL ter-encode) | konten target |

Meneruskan status dan header target, melepas `X-Frame-Options`, `CSP`, dan `Set-Cookie`. Untuk HTML, disuntik `<base href>` agar aset relatif tetap termuat. Hanya host lokal/privat kecuali `ST_PROXY_ALLOW_PUBLIC=1`.

~~~bash
curl -b cookies.txt "http://127.0.0.1:3001/api/proxy?u=http%3A%2F%2Flocalhost%3A8080%2F"
~~~

## Kode error

| Status | Arti |
|--------|------|
| 401 | Belum login / password salah / token kedaluwarsa |
| 403 | CSRF tidak ada, path di luar root, atau wajib ganti password |
| 404 | File/catatan tidak ditemukan |
| 415/400 | Input tidak valid (JSON rusak, nama file tidak sah) |
