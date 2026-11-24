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
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
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
};

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

function editorChrome(placeholder?: string, dataAction?: string): Extension {
  return [
    EditorView.contentAttributes.of({
      'aria-label': placeholder ?? 'Editor kode',
      ...(dataAction ? { 'data-action': dataAction } : {}),
    }),
    placeholder ? cmPlaceholder(placeholder) : [],
  ];
}

function languageExtension(language?: EditorLanguage): Extension {
  if (language === 'html') return html();
  if (language === 'css') return css();
  if (language === 'js') return javascript();
  return [];
}

/**
 * Editor kode bersama berbasis CodeMirror 6: nomor baris, baris aktif,
 * folding per-bahasa, dan placeholder. Nilai tetap controlled dari React;
 * perubahan eksternal (impor, format, ganti tab) disinkronkan tanpa
 * memicu onChange.
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
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applying = useRef(false);
  // Atribut ARIA + placeholder bisa berubah (ganti bahasa/tab) tanpa membuat ulang dokumen.
  const chrome = useRef(new Compartment()).current;
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const extensions: Extension[] = [
      theme,
      lineNumbers(),
      // Plain-text consumer tidak punya fold range; gutter kosong hanya makan ruang.
      ...(language ? [foldGutter(), codeFolding()] : []),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      bracketMatching(),
      indentOnInput(),
      syntaxHighlighting(highlightStyle),
      history(),
      keymap.of([
        { key: 'Mod-s', run: () => {
          onSaveRef.current?.();
          return true;
        } },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
      languageExtension(language),
      chrome.of(editorChrome(placeholder, dataAction)),
    ];
    if (wrap) extensions.push(EditorView.lineWrapping);
    if (readOnly) extensions.push(EditorState.readOnly.of(true));
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applying.current) onChangeRef.current?.(update.state.doc.toString());
      }),
    );

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host,
    });
    viewRef.current = view;
    // Scroller adalah elemen yang benar-benar menggulir; jadikan fokusabel
    // supaya aturan axe scrollable-region-focusable tetap terpenuhi.
    view.scrollDOM.setAttribute('tabindex', '0');
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // View dibuat ulang hanya saat konfigurasi struktural berubah.
  }, [language, wrap, readOnly, chrome]);

  // Label aksesibel mengikuti bahasa aktif tanpa mengganggu isi dokumen.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: chrome.reconfigure(editorChrome(placeholder, dataAction)) });
  }, [placeholder, dataAction, chrome]);

  // Sinkronkan nilai dari luar (impor, format, reset, ganti tab editor).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === value) return;
    const { anchor, head } = view.state.selection.main;
    applying.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: EditorSelection.single(Math.min(anchor, value.length), Math.min(head, value.length)),
    });
    applying.current = false;
  }, [value]);

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
