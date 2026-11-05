import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'id' | 'en';

/** Kamus UI. Kunci yang belum ada di EN otomatis jatuh ke ID. */
const ID = {
  'nav.markdown': 'Markdown',
  'nav.json': 'JSON',
  'nav.types': 'JSON ke TS',
  'nav.notes': 'Catatan',
  'nav.viewer': 'URL Viewer',
  'nav.nginx': 'Nginx',
  'nav.ports': 'Port',
  'nav.files': 'File Explorer',
  'nav.compress': 'Kompresor',
  'nav.devspace': 'Dev Space',
  'nav.password': 'Ganti password',
  'nav.logout': 'Keluar',
  'nav.language': 'Bahasa',
  'common.save': 'Simpan',
  'common.cancel': 'Batal',
  'common.delete': 'Hapus',
  'common.edit': 'Edit',
  'common.reload': 'Muat ulang',
  'common.search': 'Cari',
  'common.load': 'Muat',
  'common.add': 'Tambah',
  'common.download': 'Unduh',
  'common.open': 'Buka',
  'common.send': 'Kirim',
  'common.run': 'Jalankan',
  'common.copy': 'Salin',
  'files.name': 'Nama',
  'files.size': 'Ukuran',
  'files.modified': 'Diubah',
  'files.action': 'Aksi',
  'files.searchName': 'Cari nama file',
  'files.searchContent': 'Cari isi file',
  'files.content': 'isi',
  'files.back': 'Kembali ke daftar',
  'files.upload': 'Upload file',
  'files.newFolder': 'Folder baru',
  'files.recent': 'Terakhir dibuka',
  'files.hits': 'baris cocok untuk',
  'files.clickOpen': 'klik untuk membuka berkas',
  'compress.title': 'Kompresor',
  'compress.subtitle': 'Kompres & konversi PDF dan gambar, berkas asli tidak diubah',
  'compress.compress': 'Kompres',
  'compress.convert': 'Konversi',
  'compress.drop': 'Tarik berkas ke sini atau klik untuk memilih',
  'compress.quality': 'Kualitas',
  'compress.maxWidth': 'Lebar maksimum (px)',
  'compress.format': 'Format keluaran',
  'compress.sameAsSource': 'Sama seperti asli',
  'compress.level': 'Tingkat kompresi',
  'compress.standard': 'Standar (kualitas cetak)',
  'compress.small': 'Kecil (kualitas ebook)',
  'compress.to': 'Ubah ke',
  'compress.before': 'Sebelum',
  'compress.after': 'Sesudah',
  'compress.download': 'Unduh hasil',
  'compress.notSupported': 'Konversi belum tersedia untuk jenis berkas ini.',
  'compress.hint':
    'Hasil ditulis di folder yang sama dengan akhiran -min (kompres) atau -conv (konversi). Proses berjalan di latar belakang.',
  'dev.regex': 'Regex Tester',
  'dev.encode': 'Encode/Decode & Hash',
  'dev.http': 'HTTP Client',
  'dev.logs': 'Log Tailer',
  'dev.docker': 'Docker',
  'dev.git': 'Git Status',
  'dev.cron': 'Cron Job',
  'dev.dns': 'DNS/IP Lookup',
  'dev.title': 'Dev Space',
  'dev.subtitle': 'Alat harian developer dalam satu tempat',
  'logs.path': '/var/log/nginx/error.log',
  'logs.filter': 'filter teks',
  'logs.live': 'Live',
  'logs.stop': 'Stop',
  'git.path': 'Path repositori',
  'git.suggestions': 'Folder yang ada di sini',
} as const;

type Key = keyof typeof ID;

const EN: Partial<Record<Key, string>> = {
  'nav.markdown': 'Markdown',
  'nav.json': 'JSON',
  'nav.types': 'JSON to TS',
  'nav.notes': 'Notes',
  'nav.viewer': 'URL Viewer',
  'nav.nginx': 'Nginx',
  'nav.ports': 'Ports',
  'nav.files': 'File Explorer',
  'nav.compress': 'Compressor',
  'nav.devspace': 'Dev Space',
  'nav.password': 'Change password',
  'nav.logout': 'Sign out',
  'nav.language': 'Language',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.reload': 'Reload',
  'common.search': 'Search',
  'common.load': 'Load',
  'common.add': 'Add',
  'common.download': 'Download',
  'common.open': 'Open',
  'common.send': 'Send',
  'common.run': 'Run',
  'common.copy': 'Copy',
  'files.name': 'Name',
  'files.size': 'Size',
  'files.modified': 'Modified',
  'files.action': 'Actions',
  'files.searchName': 'Search file name',
  'files.searchContent': 'Search file content',
  'files.content': 'content',
  'files.back': 'Back to list',
  'files.upload': 'Upload file',
  'files.newFolder': 'New folder',
  'files.recent': 'Recently opened',
  'files.hits': 'lines matching',
  'files.clickOpen': 'click to open the file',
  'compress.title': 'Compressor',
  'compress.subtitle': 'Compress and convert PDF and images, originals are never modified',
  'compress.compress': 'Compress',
  'compress.convert': 'Convert',
  'compress.drop': 'Drop a file here or click to choose',
  'compress.quality': 'Quality',
  'compress.maxWidth': 'Max width (px)',
  'compress.format': 'Output format',
  'compress.sameAsSource': 'Same as source',
  'compress.level': 'Compression level',
  'compress.standard': 'Standard (print quality)',
  'compress.small': 'Small (ebook quality)',
  'compress.to': 'Convert to',
  'compress.before': 'Before',
  'compress.after': 'After',
  'compress.download': 'Download result',
  'compress.notSupported': 'Conversion is not available for this file type.',
  'compress.hint':
    'Results are written next to the original with -min (compress) or -conv (convert) suffix. Processing runs in the background.',
  'dev.regex': 'Regex Tester',
  'dev.encode': 'Encode/Decode & Hash',
  'dev.http': 'HTTP Client',
  'dev.logs': 'Log Tailer',
  'dev.docker': 'Docker',
  'dev.git': 'Git Status',
  'dev.cron': 'Cron Job',
  'dev.dns': 'DNS/IP Lookup',
  'dev.title': 'Dev Space',
  'dev.subtitle': 'Everyday developer tools in one place',
  'logs.filter': 'filter text',
  'logs.live': 'Live',
  'logs.stop': 'Stop',
  'git.path': 'Repository path',
  'git.suggestions': 'Folders available here',
};

const KEY = 'st:lang';

type Ctx = { lang: Lang; setLang: (lang: Lang) => void; t: (key: Key, fallback?: string) => string };

const I18nContext = createContext<Ctx>({
  lang: 'id',
  setLang: () => undefined,
  t: (key) => ID[key],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem(KEY) === 'en' ? 'en' : 'id'));

  useEffect(() => {
    localStorage.setItem(KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const t = useCallback(
    (key: Key, fallback?: string) => {
      if (lang === 'en') return EN[key] ?? ID[key] ?? fallback ?? key;
      return ID[key] ?? fallback ?? key;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
