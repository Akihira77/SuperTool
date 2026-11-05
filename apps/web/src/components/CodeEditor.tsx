import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { cn } from './ui';

type Props = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  onSave?: () => void;
  className?: string;
  wrap?: boolean;
  areaRef?: RefObject<HTMLTextAreaElement | null>;
  onContextMenu?: (event: React.MouseEvent<HTMLTextAreaElement>) => void;
};

export function CodeEditor({ value, onChange, readOnly, placeholder, onSave, className, wrap, areaRef, onContextMenu }: Props) {
  const inner = useRef<HTMLTextAreaElement>(null);
  const areaRef_ = areaRef ?? inner;
  const setArea = (el: HTMLTextAreaElement | null) => {
    inner.current = el;
    if (areaRef) areaRef.current = el;
  };
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = value.split('\n').length;

  useEffect(() => {
    const gutter = gutterRef.current;
    const area = inner.current;
    if (!gutter || !area) return;
    gutter.scrollTop = area.scrollTop;
  }, [value]);

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    void areaRef_;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      onSave?.();
      return;
    }
    if (event.key === 'Tab' && !readOnly && onChange) {
      event.preventDefault();
      const area = event.currentTarget;
      const start = area.selectionStart;
      const end = area.selectionEnd;
      const next = value.slice(0, start) + '  ' + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        area.selectionStart = area.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div className={cn('flex min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-[#0b1118]', className)}>
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="mono shrink-0 select-none overflow-hidden border-r border-line/70 bg-panel/40 px-2 py-3 text-right text-[12px] leading-[1.55rem] text-muted/50"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={setArea}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={handleKey}
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onContextMenu={onContextMenu}
        className={cn(
          'mono min-h-0 flex-1 resize-none bg-transparent px-3 py-3 text-[12.5px] leading-[1.55rem] text-ink/90 outline-none placeholder:text-muted/50',
          wrap ? 'whitespace-pre-wrap' : 'whitespace-pre',
        )}
      />
    </div>
  );
}
