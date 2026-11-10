import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { highlightLine } from '../lib/highlight';
import { cn } from './ui';

const ROW = 24;
const MAX_WIDTH_CH = 2000;

/** Penampil kode read-only yang hanya merender baris di viewport (untuk berkas besar). */
export function VirtualCode({ value, ext = '', className, resetKey }: { value: string; ext?: string; className?: string; resetKey?: string }) {
  const lines = useMemo(() => value.split('\n'), [value]);
  const maxLen = useMemo(() => lines.reduce((max, line) => Math.max(max, line.length), 0), [lines]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 20,
  });

  // Reset hanya saat berpindah berkas; chunk tambahan tidak boleh menggeser posisi baca.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  const width = Math.min(Math.max(maxLen + 10, 40), MAX_WIDTH_CH) + 'ch';

  return (
    <div data-vcode className={cn('mono flex h-full min-h-0 overflow-hidden rounded-[11px] border border-line bg-[#070d14] text-[14px] shadow-[inset_0_1px_0_rgb(255_255_255/0.02)]', className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-scroll">
        <div className="relative min-w-full" style={{ height: virtualizer.getTotalSize(), width }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-code-line={row.index + 1}
              className="absolute inset-x-0 flex"
              style={{ top: row.start, height: ROW, lineHeight: ROW + 'px' }}
            >
              <span className="sticky left-0 z-10 w-14 shrink-0 select-none border-r border-line/50 bg-panel pr-2 text-right text-[12.5px] text-muted/50">
                {row.index + 1}
              </span>
              <span
                className="min-w-0 whitespace-pre pr-4 pl-3 text-ink/90"
                dangerouslySetInnerHTML={{ __html: highlightLine(lines[row.index] ?? '', ext) || ' ' }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}