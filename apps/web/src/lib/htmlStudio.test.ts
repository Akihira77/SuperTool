import { describe, expect, it } from 'vitest';
import {
  PREVIEW_CSP,
  composeDocument,
  createBaseline,
  dirtyState,
  parseImportPayload,
} from './htmlStudio';

describe('composeDocument', () => {
  it('membungkus fragmen menjadi dokumen dengan CSP', () => {
    const doc = composeDocument('<p>halo</p>', '', '');
    expect(doc).toContain('<html><head>');
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain(PREVIEW_CSP);
    expect(doc).toContain('<body><p>halo</p></body>');
  });

  it('menyisipkan gaya di head dan skrip di akhir body', () => {
    const doc = composeDocument('<!doctype html><html><head><title>x</title></head><body><p>a</p></body></html>', 'p{color:red}', 'x()');
    expect(doc.indexOf('<style')).toBeLessThan(doc.indexOf('</head>'));
    expect(doc.indexOf('<script')).toBeGreaterThan(doc.indexOf('<p>a</p>'));
    expect(doc.indexOf('<script')).toBeLessThan(doc.indexOf('</body>'));
  });

  it('mempertahankan gaya dan skrip inline milik dokumen sumber', () => {
    const source = '<html><head><style>.a{}</style></head><body><script>let a=1</script></body></html>';
    const doc = composeDocument(source, 'body{margin:0}', 'launch()');
    expect(doc).toContain('.a{}');
    expect(doc).toContain('let a=1');
    expect(doc.match(/launch\(\)/g)).toHaveLength(1);
  });

  it('tidak menduplikasi blok hasil suntikan saat disusun ulang', () => {
    const once = composeDocument('<body><p>x</p></body>', 'p{color:red}', 'run()');
    const twice = composeDocument(once, 'p{color:red}', 'run()');
    expect(twice).toBe(once);
    expect(twice.match(/data-st-html-studio/g)).toHaveLength(2);
  });

  it('menetralkan penutup tag di dalam CSS dan JS', () => {
    const doc = composeDocument('<body></body>', 'a{content:"</style>"}', 'const s = "</script>";');
    expect(doc).not.toContain('"</style>"');
    expect(doc).not.toContain('"</script>"');
  });

  it('menerima masukan kosong atau HTML tidak lengkap', () => {
    expect(composeDocument('', '', '')).toContain('<body></body>');
    expect(composeDocument('<div><span>', '', '')).toContain('<div><span>');
    expect(() => composeDocument('<p>ok</p>', '', '')).not.toThrow();
  });

  it('membuang meta refresh agar pratinjau tidak menjelajah keluar', () => {
    const doc = composeDocument('<head><meta http-equiv="refresh" content="0;url=https://example.com"></head><body></body>', '', '');
    expect(doc.toLowerCase()).not.toContain('http-equiv="refresh"');
  });
});

describe('parseImportPayload', () => {
  const valid = { path: '/root/demo.html', name: 'demo.html', content: '<h1>x</h1>', truncated: false };

  it('menerima payload HTML valid', () => {
    expect(parseImportPayload(valid)).toEqual(valid);
  });

  it('menurunkan nama dari path bila nama tidak ada', () => {
    expect(parseImportPayload({ path: '/root/a.htm', content: '' })?.name).toBe('a.htm');
  });

  it('menolak payload cacat atau bukan HTML', () => {
    expect(parseImportPayload(null)).toBeNull();
    expect(parseImportPayload('x')).toBeNull();
    expect(parseImportPayload({ path: '', content: '' })).toBeNull();
    expect(parseImportPayload({ path: '/root/a.txt', content: '' })).toBeNull();
    expect(parseImportPayload({ path: '/root/a.html' })).toBeNull();
  });
});

describe('dirtyState', () => {
  const baseline = createBaseline('<h1>a</h1>', 'p{margin:0}', 'run()');

  it('bersih saat semua editor sama dengan baseline', () => {
    expect(dirtyState({ html: '<h1>a</h1>', css: 'p{margin:0}', js: 'run()' }, baseline)).toEqual({
      sourceDirty: false,
      workspaceDirty: false,
    });
  });

  it('perubahan CSS saja menandai workspace, bukan berkas sumber', () => {
    expect(dirtyState({ html: '<h1>a</h1>', css: 'p{margin:1px}', js: 'run()' }, baseline)).toEqual({
      sourceDirty: false,
      workspaceDirty: true,
    });
  });

  it('perubahan JavaScript saja menandai workspace, bukan berkas sumber', () => {
    expect(dirtyState({ html: '<h1>a</h1>', css: 'p{margin:0}', js: 'run(1)' }, baseline)).toEqual({
      sourceDirty: false,
      workspaceDirty: true,
    });
  });

  it('perubahan HTML menandai keduanya', () => {
    expect(dirtyState({ html: '<h1>b</h1>', css: 'p{margin:0}', js: 'run()' }, baseline)).toEqual({
      sourceDirty: true,
      workspaceDirty: true,
    });
  });

  it('menyimpan HTML tidak membersihkan CSS/JS yang masih berubah', () => {
    const content = { html: '<h1>b</h1>', css: 'p{margin:1px}', js: 'run()' };
    const afterSave = { ...baseline, html: content.html };
    expect(dirtyState(content, afterSave)).toEqual({ sourceDirty: false, workspaceDirty: true });
  });

  it('baseline bawaan membuat template awal dianggap bersih', () => {
    const starter = createBaseline();
    expect(dirtyState({ html: starter.html, css: starter.css, js: starter.js }, starter)).toEqual({
      sourceDirty: false,
      workspaceDirty: false,
    });
  });
});
