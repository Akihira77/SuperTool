import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Audit axe dengan standar WCAG yang dipakai roadmap. Hanya critical/serious
 * yang menggagalkan test; moderate/minor tetap dilampirkan ke report.
 */
export async function audit(page: Page, label: string, options: { exclude?: string[] } = {}): Promise<void> {
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
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .filter((violation) => violation.nodes.length > 0);

  expect(
    blocking.map((violation) => `${violation.impact} ${violation.id} (${violation.nodes.length} node)`),
    `Pelanggaran axe critical/serious pada "${label}"`,
  ).toEqual([]);
}
