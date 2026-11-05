export function bytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / Math.pow(1024, i);
  return (i === 0 ? String(value) : value.toFixed(value >= 100 ? 0 : 1)) + ' ' + units[i];
}

export function timeAgo(ms: number): string {
  if (!ms) return '-';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return min + ' menit lalu';
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours + ' jam lalu';
  const days = Math.floor(hours / 24);
  if (days < 30) return days + ' hari lalu';
  return new Date(ms).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function duration(sec: number | null): string {
  if (sec === null || sec === undefined) return '-';
  if (sec < 60) return sec + 's';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm';
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours + 'j ' + (min % 60) + 'm';
  return Math.floor(hours / 24) + 'h ' + (hours % 24) + 'j';
}
