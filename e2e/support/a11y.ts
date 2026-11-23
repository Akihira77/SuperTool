import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export type AxeException = { rule: string; matches: string; reason: string };

/**
 * Pengecualian yang disengaja: tab sesi punya tombol tutup di dalam item yang
 * sama secara visual. axe menolak anak tablist selain `role=tab`, padahal
 * tombol tutup per-tab adalah pola UI yang lazim dan tetap punya accessible
 * name. Pengecualian dibatasi ke satu rule + satu elemen, bukan rule global.
 */
export const SESSION_TABLIST_EXCEPTION: AxeException = {
  rule: 'aria-required-children',
  matches: 'aria-label="Sesi Super Tool"',
  reason: 'tombol tutup per-tab di dalam tablist (pola closable tabs)',
};

/**
 * Audit axe dengan standar WCAG yang dipakai roadmap. Hanya critical/serious
 * yang menggagalkan test; moderate/minor tetap dilampirkan ke report.
 */
export async function audit(
  page: Page,
  label: string,
  options: { exclude?: string[]; allow?: AxeException[] } = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  const results = await builder.analyze();

  const details = results.violations.map((violation) => ({
    impact: violation.impact,
    id: violation.id,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
  }));
  await test.info().attach(`axe-${label}`, {
    body: JSON.stringify(details, null, 2),
    contentType: 'application/json',
  });

  const blocking = results.violations
    .map((violation) => {
      const allowed = (options.allow ?? []).filter((entry) => entry.rule === violation.id);
      const nodes = violation.nodes.filter(
        (node) =>
          !allowed.some((entry) => (node.target.join(' ') + ' ' + node.html).includes(entry.matches)),
      );
      return { violation, nodes };
    })
    .filter((entry) => entry.violation.impact === 'critical' || entry.violation.impact === 'serious')
    .filter((entry) => entry.nodes.length > 0);

  expect(
    blocking.map((entry) => `${entry.violation.impact} ${entry.violation.id} (${entry.nodes.length} node)`),
    `Pelanggaran axe critical/serious pada "${label}"`,
  ).toEqual([]);
}
