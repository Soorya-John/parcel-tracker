import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { harness, password, tracking } from './harness.mjs';
import worker from '../worker/index.js';

const h = await harness();
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const result = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) }), h.env);
      res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer())); return;
    }
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/parcel-tracker\//, '');
    const path = resolve('dist', relative || 'index.html');
    if (!path.startsWith(resolve('dist') + '\\') && !path.startsWith(resolve('dist') + '/')) throw new Error('Not found');
    const body = await readFile(path);
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(path)] || 'application/octet-stream'); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
h.env.ALLOWED_ORIGIN += `,${origin}`;
const url = `${origin}/parcel-tracker/`;
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  await mkdir('test-results', { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await expect(page.getByRole('heading', { name: 'Saved parcels.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /A little desk upgrade/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.getByRole('button', { name: /A little desk upgrade/ }).click();
  await expect(page.getByRole('heading', { name: 'Scan history IST' })).toBeVisible();
  await expect(page.getByText('Shipment arrived at the delivery facility')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search all parcels' }).fill('Weekend reading');
  await expect(page.getByRole('button', { name: /Weekend reading/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search all parcels' }).fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: /Connect your account/ }).click();
  await page.getByLabel('Owner password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Your next journey starts here')).toBeVisible();
  await page.getByRole('button', { name: 'Add parcel', exact: true }).click();
  await page.getByLabel('Tracking number', { exact: true }).fill('BROWSER123456');
  await page.getByLabel('Nickname optional').fill('Persistent parcel');
  await page.getByLabel('Find a courier').fill('Delhivery');
  const delhivery = (await h.request('/carriers', { token: await h.signIn() })).data.items.find(c => c.name === 'Delhivery');
  await page.locator('#carrier').selectOption(String(delhivery.id));
  await page.getByRole('button', { name: 'Save & track parcel' }).click();
  await expect(page.getByRole('heading', { name: 'Persistent parcel' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Add parcel', exact: true }).click();
  await page.getByLabel('Tracking number', { exact: true }).fill('BROWSER123456');
  await page.getByLabel('Find a courier').fill('Delhivery'); await page.locator('#carrier').selectOption(String(delhivery.id));
  await page.getByRole('button', { name: 'Save & track parcel' }).click();
  await expect(page.getByRole('heading', { name: 'Persistent parcel' })).toBeVisible();
  expect(h.calls.filter(c => c.endpoint === 'register').length).toBe(1);
  await context.close();

  // A truly fresh browser context, with no cookies or local/session storage copied.
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const newPage = await fresh.newPage(); newPage.on('pageerror', e => errors.push(e.message)); await newPage.goto(url);
  await newPage.getByRole('button', { name: /Connect your account/ }).click();
  await newPage.getByLabel('Owner password').fill(password); await newPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await newPage.getByRole('button', { name: /Persistent parcel/ }).click();
  await expect(newPage.getByRole('heading', { name: 'Persistent parcel' })).toBeVisible();
  await expect(newPage.locator('#detail').getByText(/BROWSER123456/, { exact: false })).toBeVisible();
  await newPage.getByRole('button', { name: 'Close', exact: true }).click();
  await h.hook(tracking('BROWSER123456', 'Delivered', undefined, delhivery.id));
  await newPage.reload(); await newPage.getByRole('searchbox', { name: 'Search all parcels' }).fill('BROWSER123456');
  await newPage.getByRole('button', { name: /Persistent parcel/ }).click();
  await expect(newPage.getByText('Delivered archive · history retained')).toBeVisible();
  await expect(newPage.getByText('Delivered to recipient', { exact: true })).toBeVisible();
  await newPage.screenshot({ path: 'test-results/delivered-detail.png', fullPage: true });
  await newPage.getByRole('button', { name: 'Close', exact: true }).click();
  await newPage.getByRole('searchbox', { name: 'Search all parcels' }).fill('');
  await newPage.getByRole('button', { name: 'Delivered 1', exact: true }).click();
  await expect(newPage.getByRole('button', { name: /Persistent parcel/ })).toBeVisible();
  await expect(newPage.getByRole('heading', { name: 'Delivered archive.' })).toBeVisible();
  expect(errors).toEqual([]);
  await fresh.close();
  console.log('Browser checks passed: project subpath, desktop/mobile, full history, fresh signed-in context, duplicate registration reuse, delivered search/archive, no JS errors.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await h.close(); }
