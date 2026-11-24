import { useEffect, useRef, type MouseEvent } from 'react';
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { cn } from './ui';

export type EditorLanguage = 'html' | 'css' | 'js';

/** Kontrak imperatif untuk consumer yang butuh seleksi (toolbar Markdown, menu konteks). */
export type CodeEditorHandle = {
  focus: () => void;
  getSelection: () => { from: number; to: number };
  setSelection: (from: number, to?: number) => void;
};

export type CodeEditorContextMenu = {
  clientX: number;
  clientY: number;
  from: number;
  to: number;
};

type Props = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  onSave?: () => void;
  className?: string;
  wrap?: boolean;
  language?: EditorLanguage;
  editorRef?: React.RefObject<CodeEditorHandle | null>;
  /** Ditempel di elemen contenteditable agar command palette bisa memfokuskannya. */
  dataAction?: string;
  onContextMenu?: (menu: CodeEditorContextMenu) => void;
  /**
   * Kunci dokumen untuk editor yang menampung beberapa tab (HTML Studio).
   * Tiap kunci menyimpan `EditorState` sendiri: history, selection, fold, dan
   * posisi scroll tidak tercampur antar dokumen.
   */
  stateKey?: string;
};

type SavedState = { state: EditorState; scrollTop: number; scrollLeft: number };

// Warna mengikuti token tema SuperTool (styles.css), termasuk kontras baris aktif.
const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--color-ink)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: '1.65rem',
      overflow: 'auto',
    },
    '.cm-content': { padding: '0.75rem', caretColor: 'var(--color-accent)' },
    '.cm-line': { padding: '0 0.25rem' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-panel)',
      color: 'color-mix(in srgb, var(--color-muted) 80%, transparent)',
      borderRight: '1px solid color-mix(in srgb, var(--color-line) 70%, transparent)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.5rem 0 0.75rem', minWidth: '3rem' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 0.25rem', color: 'var(--color-muted)' },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--color-accent)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 16%, transparent)',
      border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
      borderRadius: '4px',
      color: 'var(--color-ink)',
      margin: '0 0.25rem',
      padding: '0 0.35rem',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
      color: 'var(--color-ink)',
      boxShadow: 'inset 2px 0 0 var(--color-accent)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 26%, transparent)',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
    '.cm-foldGutter .cm-gutterElement span': { cursor: 'pointer' },
  },
  { dark: true },
);

/**
 * Skema sorot sendiri: `defaultHighlightStyle` memakai warna terang dan gagal
 * kontras WCAG AA di latar gelap. Semua warna di bawah ≥4.5:1 pada #070d14.
 */
const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#9aacbf', fontStyle: 'italic' },
  { tag: [tags.name, tags.variableName, tags.propertyName, tags.definition(tags.name)], color: '#eaf1f8' },
  { tag: [tags.tagName, tags.typeName, tags.className], color: '#8fb3ff' },
  { tag: [tags.attributeName, tags.function(tags.variableName), tags.labelName], color: '#c4b5fd' },
  { tag: [tags.attributeValue, tags.string, tags.special(tags.string)], color: '#6ee7b7' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#fbbf24' },
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: '#f0a2e8' },
  { tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator], color: '#b9c7d6' },
  { tag: [tags.meta, tags.processingInstruction], color: '#9aacbf' },
  { tag: tags.heading, color: '#8fb3ff', fontWeight: '600' },
  { tag: [tags.link, tags.url], color: '#a9c4ff', textDecoration: 'underline' },
  { tag: tags.invalid, color: '#fda4af' },
]);

function languageExtension(language?: EditorLanguage): Extension {
  if (language === 'html') return html();
  if (language === 'css') return css();
  if (language === 'js') return javascript();
  return [];
}

/** Plain-text consumer tidak punya fold range; gutter kosong hanya makan ruang. */
function foldExtension(language?: EditorLanguage): Extension {
  return language ? [foldGutter(), codeFolding()] : [];
}

/**
 * Mode baca memakai dua lapis: `EditorState.readOnly` menolak transaksi ubah,
 * `EditorView.editable(false)` melepas contenteditable sehingga input browser
 * (ketik, paste, drag/drop) tidak masuk. Seleksi dan salin tetap jalan.
 * Penanda baris aktif dimatikan supaya preview tidak terlihat seperti mode edit.
 */
function modeExtension(readOnly: boolean): Extension {
  if (readOnly) return [EditorState.readOnly.of(true), EditorView.editable.of(false)];
  return [highlightActiveLine(), highlightActiveLineGutter()];
}

function chromeExtension(placeholder?: string, dataAction?: string, readOnly = false): Extension {
  return [
    EditorView.contentAttributes.of({
      'aria-label': placeholder ?? 'Editor kode',
      // `editable(false)` melepas contenteditable; tanpa tabindex isi preview
      // tidak bisa difokuskan sehingga Ctrl+A/Ctrl+C jatuh ke seluruh halaman.
      ...(readOnly ? { 'aria-readonly': 'true', tabindex: '0' } : {}),
      ...(dataAction ? { 'data-action': dataAction } : {}),
    }),
    placeholder ? cmPlaceholder(placeholder) : [],
  ];
}

/**
 * Editor kode bersama berbasis CodeMirror 6: nomor baris, baris aktif,
 * folding per-bahasa, dan placeholder. Nilai tetap controlled dari React.
 *
 * Konfigurasi yang bisa berubah saat runtime (bahasa, wrap, read-only, label)
 * memakai `Compartment`, jadi `EditorView` tidak dibuat ulang: history,
 * selection, scroll, dan fold state bertahan. `stateKey` menyimpan satu
 * `EditorState` per dokumen untuk editor multi-tab.
 */
export function CodeEditor({
  value,
  onChange,
  readOnly,
  placeholder,
  onSave,
  className,
  wrap,
  language,
  editorRef,
  dataAction,
  onContextMenu,
  stateKey,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applying = useRef(false);
  const states = useRef(new Map<string, SavedState>());
  const activeKey = useRef(stateKey ?? '');
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // Compartment stabil: dipakai ulang oleh setiap state per tab.
  const conf = useRef({
    language: new Compartment(),
    fold: new Compartment(),
    wrap: new Compartment(),
    mode: new Compartment(),
    chrome: new Compartment(),
  }).current;

  // Nilai terbaru untuk pembuatan state di dalam effect (tanpa dependency reaktif).
  const latest = useRef({ language, wrap, readOnly, placeholder, dataAction });
  latest.current = { language, wrap, readOnly, placeholder, dataAction };

  const buildExtensions = (): Extension[] => {
    const props = latest.current;
    return [
      theme,
      lineNumbers(),
      conf.language.of(languageExtension(props.language)),
      conf.fold.of(foldExtension(props.language)),
      conf.wrap.of(props.wrap ? EditorView.lineWrapping : []),
      conf.mode.of(modeExtension(Boolean(props.readOnly))),
      conf.chrome.of(chromeExtension(props.placeholder, props.dataAction, Boolean(props.readOnly))),
      drawSelection(),
      bracketMatching(),
      indentOnInput(),
      syntaxHighlighting(highlightStyle),
      history(),
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            onSaveRef.current?.();
            return true;
          },
        },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applying.current) onChangeRef.current?.(update.state.doc.toString());
      }),
    ];
  };

  const reconfigureAndScroll = (saved?: SavedState) => {
    const view = viewRef.current;
    if (!view) return;
    const props = latest.current;
    view.dispatch({
      effects: [
        conf.language.reconfigure(languageExtension(props.language)),
        conf.fold.reconfigure(foldExtension(props.language)),
        conf.wrap.reconfigure(props.wrap ? EditorView.lineWrapping : []),
        conf.mode.reconfigure(modeExtension(Boolean(props.readOnly))),
        conf.chrome.reconfigure(chromeExtension(props.placeholder, props.dataAction, Boolean(props.readOnly))),
      ],
    });
    if (!saved) return;
    view.scrollDOM.scrollTop = saved.scrollTop;
    view.scrollDOM.scrollLeft = saved.scrollLeft;
  };

  // View dibuat sekali; sisanya dikonfigurasi lewat compartment.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions: buildExtensions() }),
      parent: host,
    });
    viewRef.current = view;
    // Scroller adalah elemen yang benar-benar menggulir; jadikan fokusabel
    // supaya aturan axe scrollable-region-focusable tetap terpenuhi.
    view.scrollDOM.setAttribute('tabindex', '0');
    activeKey.current = stateKey ?? '';
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ganti dokumen aktif: simpan state lama, pulihkan state tab tujuan.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const nextKey = stateKey ?? '';
    if (nextKey === activeKey.current) return;
    states.current.set(activeKey.current, {
      state: view.state,
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft,
    });
    activeKey.current = nextKey;
    const saved = states.current.get(nextKey);
    if (saved) {
      view.setState(saved.state);
      reconfigureAndScroll(saved);
      return;
    }
    view.setState(EditorState.create({ doc: value, extensions: buildExtensions() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  useEffect(() => {
    if (!viewRef.current) return;
    reconfigureAndScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, wrap, readOnly, placeholder, dataAction]);

  // Sinkronkan nilai dari luar (impor, format, reset, ganti tab editor).
  // `stateKey` ikut jadi dependency: setelah state tab lain dipulihkan, nilainya
  // harus dibandingkan ulang walau string `value` kebetulan sama (mis. '').
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === value) return;
    const { anchor, head } = view.state.selection.main;
    applying.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: EditorSelection.single(Math.min(anchor, value.length), Math.min(head, value.length)),
      // Penggantian dari luar (impor, format) jadi langkah undo sendiri:
      // undo setelah format mengembalikan teks sebelum format, bukan
      // mencabut ketikan pengguna sebelumnya.
      annotations: isolateHistory.of('full'),
    });
    applying.current = false;
  }, [value, stateKey]);

  useEffect(() => {
    const handle: CodeEditorHandle = {
      focus: () => viewRef.current?.focus(),
      getSelection: () => {
        const main = viewRef.current?.state.selection.main;
        return { from: main?.from ?? 0, to: main?.to ?? 0 };
      },
      setSelection: (from, to = from) => {
        const view = viewRef.current;
        if (!view) return;
        const max = view.state.doc.length;
        view.dispatch({ selection: EditorSelection.single(Math.min(from, max), Math.min(to, max)) });
      },
    };
    if (editorRef) editorRef.current = handle;
    return () => {
      if (editorRef) editorRef.current = null;
    };
  }, [editorRef]);

  return (
    <div
      ref={hostRef}
      onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
        if (!onContextMenu) return;
        const view = viewRef.current;
        if (!view) return;
        event.preventDefault();
        const { from, to } = view.state.selection.main;
        onContextMenu({ clientX: event.clientX, clientY: event.clientY, from, to });
      }}
      className={cn(
        'mono flex h-full min-h-0 flex-1 overflow-hidden rounded-panel border border-line bg-[#070d14] text-[14px] shadow-elev-1 transition-[border-color,box-shadow] focus-within:border-accent/40 focus-within:ring-1 focus-within:ring-accent/15',
        '[&_.cm-editor]:h-full [&_.cm-editor]:min-h-0',
        readOnly && 'opacity-95',
        className,
      )}
    />
  );
}
