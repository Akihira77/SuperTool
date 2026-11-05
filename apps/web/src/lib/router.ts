import { useCallback, useEffect, useState } from 'react';

function current(): string {
  // Buang query/hash lanjutan (mis. #/calendar?google=connected) supaya cocok
  // dengan id tool; komponen membaca query sendiri dari location.hash.
  const raw = location.hash.replace(/^#\/?/, '');
  return raw.split('?')[0] || 'markdown';
}

export function useRoute(): [string, (route: string) => void] {
  const [route, setRoute] = useState(current);

  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: string) => {
    location.hash = '/' + next;
  }, []);

  return [route, navigate];
}
