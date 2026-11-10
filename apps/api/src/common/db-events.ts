const replacedListeners = new Set<() => void>();

/** Daftar callback yang harus membuang cache in-memory setelah database diganti. */
export function onDatabaseReplaced(listener: () => void): void {
  replacedListeners.add(listener);
}

/** Dipanggil setelah database baru aktif; listener yang gagal tidak membatalkan restore. */
export function notifyDatabaseReplaced(): void {
  for (const listener of replacedListeners) {
    try {
      listener();
    } catch {
      // cache yang gagal dibersihkan tidak boleh membatalkan restore
    }
  }
}
