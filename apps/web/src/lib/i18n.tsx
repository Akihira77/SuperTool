import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { EN } from './i18n.en';
import { ID, type Key } from './i18n.id';

export type Lang = 'id' | 'en';

const KEY = 'st:lang';

type Ctx = { lang: Lang; setLang: (lang: Lang) => void; t: (key: Key, fallback?: string) => string };

const I18nContext = createContext<Ctx>({
  lang: 'id',
  setLang: () => undefined,
  t: (key) => ID[key],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem(KEY) === 'en' ? 'en' : 'id'));

  useEffect(() => {
    localStorage.setItem(KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const t = useCallback(
    (key: Key, fallback?: string) => {
      if (lang === 'en') return EN[key] ?? ID[key] ?? fallback ?? key;
      return ID[key] ?? fallback ?? key;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
