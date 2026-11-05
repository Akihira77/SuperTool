import { useCallback, useEffect, useState } from 'react';

function current(): string {
  return location.hash.replace(/^#\/?/, '') || 'markdown';
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
