export type OAuthMode = 'connect' | 'switch';

/** Mode switch wajib menampilkan pemilih akun sebelum consent. */
export function authPrompt(mode: OAuthMode): string {
  return mode === 'switch' ? 'select_account consent' : 'consent';
}
