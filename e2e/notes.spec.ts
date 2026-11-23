import { readFile } from 'node:fs/promises';
import { expect, test } from './support/fixtures';
import { openTool, signIn } from './support/auth';

test('E2E-04 catatan: autosave, persistence setelah reload, unduh .md', async ({ page, app }) => {
  const marker = Math.random().toString(36).slice(2, 10);
  const title = `E2E catatan ${marker}`;
  const body = `# ${title}\n\nbaris unik ${marker}\nbaris kedua ${marker}\n`;

  await signIn(page, app);
  await openTool(page, 'Catatan');
  const notes = page.locator('#notes-panel-notes');

  const saved = page.waitForResponse(
    (response) => response.url().includes('/api/notes/') && response.request().method() === 'PUT' && response.ok(),
  );

  await page.getByRole('button', { name: 'Baru', exact: true }).click();
  await notes.getByLabel('Judul catatan').fill(title);
  await notes.getByLabel('Tulis apa saja di sini...').fill(body);

  await saved;
  await expect(notes.getByRole('status').filter({ hasText: 'Tersimpan otomatis' })).toBeVisible();

  await page.reload();
  await openTool(page, 'Catatan');
  await page.locator('#notes-panel-notes').getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.getByLabel('Judul catatan')).toHaveValue(title);
  await expect(page.getByLabel('Tulis apa saja di sini...')).toHaveValue(body);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Unduh catatan (.md)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${title}.md`);
  const file = await download.path();
  expect(file).not.toBeNull();
  const content = await readFile(file as string, 'utf8');
  expect(content).toBe(body);
  expect(content).not.toContain('E2E catatan lain');
});
