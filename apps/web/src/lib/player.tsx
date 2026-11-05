import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, cn } from '../components/ui';

const RAW = '/api/fs/raw?path=';
const VOLUME_KEY = 'st:media:volume';

export type Track = { path: string; name: string; ext: string; kind: 'audio' | 'video' };

type PlayerApi = {
  track: Track | null;
  playing: boolean;
  expanded: boolean;
  time: number;
  duration: number;
  volume: number;
  play: (track: Track) => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  setVolume: (value: number) => void;
  expand: () => void;
  minimize: () => void;
  close: () => void;
};

const Ctx = createContext<PlayerApi>({
  track: null,
  playing: false,
  expanded: false,
  time: 0,
  duration: 0,
  volume: 1,
  play: () => undefined,
  toggle: () => undefined,
  seek: () => undefined,
  setVolume: () => undefined,
  expand: () => undefined,
  minimize: () => undefined,
  close: () => undefined,
});

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
};

/** Pemutar media global: elemen tetap hidup saat pindah menu, volume disimpan. */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const playerRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLVideoElement>(null);
  const lastPath = useRef<string | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [volume, setVolumeState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(VOLUME_KEY) ?? '1');
      return Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 1;
    } catch {
      return 1;
    }
  });

  useEffect(() => {
    const element = mediaRef.current;
    if (!element || !track) return;
    if (lastPath.current !== track.path) {
      lastPath.current = track.path;
      element.currentTime = 0;
      setTime(0);
      setDuration(0);
    }
    setError('');
    void element.play().catch(() => setPlaying(false));
  }, [track]);

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.volume = volume;
  }, [volume, track]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const play = useCallback((next: Track) => {
    setExpanded(next.kind === 'video');
    setTrack(next);
    // Berkas yang sama dan sedang tampil (mis. dijeda) → lanjutkan tanpa reset.
    if (mediaRef.current && lastPath.current === next.path) {
      void mediaRef.current.play().catch(() => setPlaying(false));
    }
  }, []);

  const expand = useCallback(() => setExpanded(true), []);
  const minimize = useCallback(() => setExpanded(false), []);

  const toggleFullscreen = useCallback(() => {
    const panel = playerRef.current;
    if (!panel) return;
    if (document.fullscreenElement === panel) {
      void document.exitFullscreen();
    } else {
      void panel.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  const toggle = useCallback(() => {
    const element = mediaRef.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const element = mediaRef.current;
    if (!element) return;
    element.currentTime = Math.max(0, seconds);
    setTime(element.currentTime);
  }, []);

  const setVolume = useCallback((value: number) => {
    const next = Math.min(1, Math.max(0, value));
    setVolumeState(next);
    try {
      localStorage.setItem(VOLUME_KEY, String(next));
    } catch {
      // localStorage penuh/private mode: volume tetap berlaku untuk sesi ini
    }
  }, []);

  const close = useCallback(() => {
    if (document.fullscreenElement === playerRef.current) void document.exitFullscreen();
    mediaRef.current?.pause();
    lastPath.current = null;
    setTrack(null);
    setPlaying(false);
    setExpanded(false);
    setTime(0);
    setDuration(0);
    setError('');
  }, []);

  const value = useMemo(
    () => ({ track, playing, expanded, time, duration, volume, play, toggle, seek, setVolume, expand, minimize, close }),
    [track, playing, expanded, time, duration, volume, play, toggle, seek, setVolume, expand, minimize, close],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {track ? (
        <div
          ref={playerRef}
          data-player="dock"
          data-mode={expanded ? 'full' : 'mini'}
          role="region"
          aria-label="Pemutar media"
          className={cn(
            'fixed bottom-4 z-50 overflow-hidden border border-line bg-panel/95 shadow-2xl backdrop-blur',
            expanded
              ? 'inset-x-4 mx-auto max-w-5xl rounded-2xl'
              : 'right-4 z-40 w-[320px] rounded-xl',
          )}
        >
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Icon name={track.kind === 'video' ? 'play' : 'music'} size={14} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium" title={track.path}>
              {track.name}
            </span>
            {track.kind === 'video' ? (
              <button
                type="button"
                className="btn btn-ghost shrink-0 px-1.5 py-0.5"
                onClick={toggleFullscreen}
                title={fullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
                aria-label={fullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
              >
                <Icon name={fullscreen ? 'fullscreenExit' : 'fullscreen'} size={13} />
              </button>
            ) : null}
            {track.kind === 'video' ? (
              <button
                type="button"
                className="btn btn-ghost shrink-0 px-1.5 py-0.5"
                onClick={expanded ? minimize : expand}
                title={expanded ? 'Kecilkan' : 'Perbesar'}
                aria-label={expanded ? 'Kecilkan' : 'Perbesar'}
              >
                <Icon name={expanded ? 'minimize' : 'maximize'} size={13} />
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost shrink-0 px-1.5 py-0.5" onClick={close} title="Tutup" aria-label="Tutup">
              <Icon name="x" size={13} />
            </button>
          </div>
          <video
            ref={mediaRef}
            src={RAW + encodeURIComponent(track.path)}
            preload="metadata"
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onDurationChange={(event) => setDuration(event.currentTarget.duration)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setPlaying(false);
              setError('Tidak bisa memutar berkas ini (codec tidak didukung?)');
            }}
            className={cn(
              track.kind === 'video'
                ? expanded
                  ? 'max-h-[62vh] w-full bg-black object-contain'
                  : 'max-h-44 w-full bg-black object-contain'
                : 'hidden',
            )}
          />
          <div className="space-y-2 px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  'btn btn-primary shrink-0 justify-center rounded-full p-0',
                  expanded ? 'h-10 w-10' : 'h-8 w-8',
                )}
                onClick={toggle}
                title={playing ? 'Jeda' : 'Putar'}
                aria-label={playing ? 'Jeda' : 'Putar'}
              >
                <Icon name={playing ? 'pause' : 'play'} size={expanded ? 16 : 14} />
              </button>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={duration ? Math.min(time, duration) : 0}
                onChange={(event) => seek(Number(event.target.value))}
                disabled={!duration}
                className="min-w-0 flex-1 accent-accent"
                aria-label="Posisi"
              />
              <span className="mono w-16 shrink-0 text-right text-[10.5px] text-muted">
                {clock(time)} / {clock(duration)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Icon name="volume" size={13} className="shrink-0 text-muted" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                className="min-w-0 flex-1 accent-accent"
                aria-label="Volume"
              />
              <span className="mono w-9 shrink-0 text-right text-[10.5px] text-muted">{Math.round(volume * 100)}%</span>
            </div>
            {error ? <div className="text-[11px] text-bad">{error}</div> : null}
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

export const usePlayer = () => useContext(Ctx);