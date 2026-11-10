import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionsFor, findAction, TOOL_ACTIONS } from './actions';
import { onWorkflow, runWorkflow } from './workflow';

describe('action registry', () => {
  it('tidak punya aksi duplikat per tool', () => {
    const keys = TOOL_ACTIONS.map((item) => item.tool + ':' + item.action);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('memfilter aksi berdasarkan tool', () => {
    const notes = actionsFor('notes');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((item) => item.tool === 'notes')).toBe(true);
    expect(actionsFor('files')).toEqual([]);
    expect(findAction('compress', 'pick')?.tool).toBe('compress');
    expect(findAction('compress', 'nope')).toBeUndefined();
  });
});

describe('workflow lintas tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mengirim intent ke listener dan berhenti setelah unsubscribe', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const seen: unknown[] = [];
    const off = onWorkflow((intent) => seen.push(intent));
    runWorkflow({ tool: 'compress', action: 'pick', payload: '/tmp/a.png' });
    expect(seen).toEqual([{ tool: 'compress', action: 'pick', payload: '/tmp/a.png' }]);
    off();
    runWorkflow({ tool: 'json', action: 'format' });
    expect(seen).toHaveLength(1);
  });
});
