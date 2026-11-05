import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { highlightLine } from '../lib/highlight';
import { cn } from './ui';

const ROW = 22;
const MAX_WIDTH_CH = 2000;

/** Penampil kode read-only yang hanya merender baris di viewport (untuk berkas besar). */
export function VirtualCode({ value, ext = '', className }: { value: string; ext?: string; className?: string }) {
  const lines = useMemo(() => value.split('\n'), [value]);
  const maxLen = useMemo(() => lines.reduce((max, line) => Math.max(max, line.length), 0), [lines]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 20,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [value]);

  const width = Math.min(Math.max(maxLen + 10, 40), MAX_WIDTH_CH) + 'ch';

  return (
    <div data-vcode className={cn('mono flex h-full min-h-0 overflow-hidden rounded-lg border border-line bg-[#0b1118] text-[12.5px]', className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="relative min-w-full" style={{ height: virtualizer.getTotalSize(), width }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-code-line={row.index + 1}
              className="absolute inset-x-0 flex"
              style={{ top: row.start, height: ROW, lineHeight: ROW + 'px' }}
            >
              <span className="sticky left-0 z-10 w-14 shrink-0 select-none border-r border-line/50 bg-panel pr-2 text-right text-[11px] text-muted/50">
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
