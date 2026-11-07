import { writeFile } from 'node:fs/promises';
const response = await fetch('https://res.17track.net/asset/carrier/info/apicarrier.all.json');
if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
const items = await response.json();
if (!Array.isArray(items) || items.length < 100 || !items.some(c => c._country_iso === 'IN')) throw new Error('Invalid catalog; previous copy retained');
await writeFile('worker/catalog.json', JSON.stringify({ fetchedAt: new Date().toISOString(), items }));
await writeFile('src/catalog.json', JSON.stringify({ fetchedAt: new Date().toISOString(), items: items.map(c => ({ id: c.key, name: c._name, country: c._country_iso })) }));
console.log(`Saved official catalog: ${items.length} carriers; ${items.filter(c => c._country_iso === 'IN').length} in India.`);
