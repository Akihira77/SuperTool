/**
 * Workflow lintas tool tanpa context global: satu window event berisi
 * tool tujuan, aksi, dan payload. Shell membuka sesi tool lalu meneruskan
 * intent ke handler usePaletteIntent milik tool tersebut.
 */
export type WorkflowIntent = { tool: string; action: string; payload?: unknown };

const EVENT = 'st:workflow';

export function runWorkflow(intent: WorkflowIntent): void {
  window.dispatchEvent(new CustomEvent<WorkflowIntent>(EVENT, { detail: intent }));
}

export function onWorkflow(handler: (intent: WorkflowIntent) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<WorkflowIntent>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
