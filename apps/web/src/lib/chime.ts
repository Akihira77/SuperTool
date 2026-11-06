/**
 * Beep singkat Web Audio (tanpa file audio).
 *
 * Browser modern memblokir AudioContext yang dibuat tanpa gestur user. Context
 * yang dibuat tepat saat jadwal sholat tiba akan tetap suspended, sehingga
 * chime tidak terdengar. Karena itu context dibuat sekali setelah gestur
 * pertama (klik/keyboard) lalu dipakai ulang.
 */
type AudioContextCtor = typeof AudioContext;

let context: AudioContext | null = null;

function audioCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ??
    null
  );
}

function contextOrNull(): AudioContext | null {
  if (context) return context;
  const Ctor = audioCtor();
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

function unlock(): void {
  const ctx = contextOrNull();
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
}

if (typeof window !== 'undefined') {
  // Jangan dilepas setelah gestur pertama: kalau resume sempat gagal, gestur
  // berikutnya mencoba lagi. Saat context sudah running, ini hanya no-op.
  const onGesture = () => unlock();
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);
}

export function playChime(): void {
  const ctx = contextOrNull();
  if (!ctx) return;

  const play = (): void => {
    if (ctx.state !== 'running') return;
    try {
      [0, 0.32, 0.64].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        const start = ctx.currentTime + offset;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.22, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.28);
      });
    } catch {
      // Audio diblokir atau tidak didukung; pengingat visual tetap jalan.
    }
  };

  if (ctx.state !== 'running') {
    void ctx.resume().then(play).catch(() => undefined);
  } else {
    play();
  }
}
