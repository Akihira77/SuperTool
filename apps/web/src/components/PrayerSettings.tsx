import { useState } from 'react';
import { Icon, Spinner, cn } from './ui';
import { useToast } from './toast';
import { useI18n } from '../lib/i18n';
import {
  type PrayerSettings as PrayerSettingsValue,
  PRAYER_CITIES,
  loadPrayerSettings,
  markGeolocationAsked,
  requestBrowserLocation,
  savePrayerSettings,
} from '../lib/prayer';

/** Bagian Settings: lokasi manual (kota/koordinat), izin lokasi, toggle pengingat. */
export function PrayerSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const [settings, setSettings] = useState<PrayerSettingsValue>(() => loadPrayerSettings());
  const [latText, setLatText] = useState(settings.lat !== null ? String(settings.lat) : '');
  const [lonText, setLonText] = useState(settings.lon !== null ? String(settings.lon) : '');
  const [error, setError] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);

  const apply = (patch: Partial<PrayerSettingsValue>) => {
    setSettings(savePrayerSettings(patch));
  };

  const pickCity = (name: string) => {
    const city = PRAYER_CITIES.find((item) => item.name === name);
    if (!city) return;
    apply({ lat: city.lat, lon: city.lon, label: city.name });
    setLatText(String(city.lat));
    setLonText(String(city.lon));
    setError('');
    toast(t('prayer.settings.saved'), 'ok');
  };

  const saveCoords = () => {
    const lat = Number(latText.replace(',', '.'));
    const lon = Number(lonText.replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setError(t('prayer.settings.invalidCoords'));
      return;
    }
    apply({ lat, lon, label: lat.toFixed(4) + ', ' + lon.toFixed(4) });
    setError('');
    toast(t('prayer.settings.saved'), 'ok');
  };

  const useDevice = async () => {
    setGeoBusy(true);
    setError('');
    try {
      const { lat, lon } = await requestBrowserLocation();
      markGeolocationAsked();
      apply({ lat, lon, label: t('prayer.settings.device') });
      setLatText(String(lat));
      setLonText(String(lon));
      toast(t('prayer.settings.saved'), 'ok');
    } catch {
      toast(t('prayer.settings.geoDenied'), 'error');
    } finally {
      setGeoBusy(false);
    }
  };

  const coords = settings.lat !== null && settings.lon !== null
    ? settings.lat.toFixed(4) + ', ' + settings.lon.toFixed(4)
    : '';

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Icon name="bell" size={14} />
        </span>
        <div>
          <div className="text-[13px] font-medium">{t('prayer.settings.title')}</div>
          <div className="text-[11.5px] text-muted">{t('prayer.settings.desc')}</div>
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border border-line bg-panel2/40 p-2.5 text-[11.5px] sm:grid-cols-2">
        <div className="min-w-0">
          <div className="label">{t('prayer.settings.current')}</div>
          <div className="flex items-center gap-1 truncate text-ink/85" title={coords}>
            <Icon name="pin" size={12} className="shrink-0 text-accent/80" />
            <span className="truncate">{settings.label || t('prayer.settings.noLocation')}</span>
          </div>
          {coords ? <div className="mono mt-0.5 truncate text-[10.5px] text-muted/70">{coords}</div> : null}
        </div>
        <div className="min-w-0">
          <div className="label">{t('prayer.settings.method')}</div>
          <div className="text-ink/85">{t('prayer.methodNote')}</div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="label">{t('prayer.settings.city')}</span>
          <select className="input py-1.5 text-[12px]" value="" onChange={(event) => pickCity(event.target.value)}>
            <option value="">{t('prayer.settings.cityPlaceholder')}</option>
            {PRAYER_CITIES.map((city) => (
              <option key={city.name} value={city.name}>
                {city.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" className="btn cursor-pointer" onClick={() => void useDevice()} disabled={geoBusy}>
            {geoBusy ? <Spinner /> : <Icon name="pin" size={13} />} {t('prayer.settings.geo')}
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="label">{t('prayer.settings.latitude')}</span>
          <input
            className="input py-1.5 text-[12px]"
            type="number"
            step="any"
            inputMode="decimal"
            placeholder="-6.2088"
            value={latText}
            onChange={(event) => setLatText(event.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="label">{t('prayer.settings.longitude')}</span>
          <input
            className="input py-1.5 text-[12px]"
            type="number"
            step="any"
            inputMode="decimal"
            placeholder="106.8456"
            value={lonText}
            onChange={(event) => setLonText(event.target.value)}
          />
        </label>
        <div className="flex items-end">
          <button type="button" className="btn cursor-pointer" onClick={saveCoords}>
            <Icon name="check" size={13} /> {t('prayer.settings.saveCoords')}
          </button>
        </div>
      </div>
      {error ? <div className="text-[11.5px] text-bad">{error}</div> : null}

      <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
        <label className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2', settings.sound ? 'border-accent/40 bg-accent/5' : 'border-line bg-panel2/30')}>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-[12px] font-medium">
              <Icon name="volume" size={13} className="text-accent/80" /> {t('prayer.settings.sound')}
            </span>
            <span className="text-[11px] text-muted">{t('prayer.settings.soundDesc')}</span>
          </span>
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-accent"
            checked={settings.sound}
            onChange={(event) => apply({ sound: event.target.checked })}
          />
        </label>
        <label className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2', settings.popup ? 'border-accent/40 bg-accent/5' : 'border-line bg-panel2/30')}>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-[12px] font-medium">
              <Icon name="bell" size={13} className="text-accent/80" /> {t('prayer.settings.popup')}
            </span>
            <span className="text-[11px] text-muted">{t('prayer.settings.popupDesc')}</span>
          </span>
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-accent"
            checked={settings.popup}
            onChange={(event) => apply({ popup: event.target.checked })}
          />
        </label>
      </div>
    </div>
  );
}
