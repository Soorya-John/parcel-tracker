import catalog from './catalog.json';
const scan = (time, status, description, location) => ({ time, status, description, location });
const seeds = [
  { id: 'demo-1', number: 'DEMO482910573', carrier: 100003, nickname: 'A little desk upgrade', status: 'InTransit', delivered: 0, scans: [scan('2026-11-08T07:15:00Z', 'InTransit', 'Shipment arrived at the delivery facility', 'Bengaluru, Karnataka'), scan('2026-11-07T20:40:00Z', 'InTransit', 'Departed from sorting centre', 'Mumbai, Maharashtra'), scan('2026-11-06T04:10:00Z', 'PickedUp', 'Shipment picked up', 'Mumbai, Maharashtra')] },
  { id: 'demo-2', number: 'DEMOEE923840IN', carrier: 60, nickname: 'Something from home', status: 'OutForDelivery', delivered: 0, scans: [scan('2026-11-08T03:30:00Z', 'OutForDelivery', 'Your parcel is out for delivery', 'Kochi, Kerala'), scan('2026-11-07T10:20:00Z', 'InTransit', 'Received at delivery post office', 'Kochi, Kerala')] },
  { id: 'demo-3', number: 'DEMOLX782394CN', carrier: 3011, nickname: 'Keyboard parts', status: 'InTransit', delivered: 0, scans: [scan('2026-11-07T18:45:00Z', 'InTransit', 'Arrived at destination airport', 'New Delhi, India'), scan('2026-11-05T06:30:00Z', 'Departure', 'Departed from origin airport', 'Shenzhen, China')] },
  { id: 'demo-4', number: 'DEMO758392104', carrier: 100001, nickname: 'Weekend reading', status: 'Delivered', delivered: 1, scans: [scan('2026-11-05T09:42:00Z', 'Delivered', 'Delivered to recipient', 'Bengaluru, Karnataka'), scan('2026-11-05T03:00:00Z', 'OutForDelivery', 'Out for delivery', 'Bengaluru, Karnataka')] }
];
// Resolve demo names from the actual catalog rather than inventing carrier IDs.
for (const [i, name] of ['Delhivery', 'India Post', 'China Post', 'Blue Dart'].entries()) seeds[i].carrier = catalog.items.find(c => c.name.toLowerCase() === name.toLowerCase())?.id || seeds[i].carrier;
export const demoCatalog = catalog;
const read = () => JSON.parse(localStorage.getItem('parcel-demo-v1') || 'null') || seeds.map(p => ({ ...p, registration: 'registered', updated_at: p.scans[0].time }));
export function demoRequest(path, options = {}) {
  const parcels = read();
  if (path === '/carriers') return demoCatalog;
  if (path === '/me') return { email: 'Demo workspace' };
  if (path === '/health') return { lastDigest: null };
  if (path === '/parcels' && !options.method) return parcels;
  if (path === '/parcels' && options.method === 'POST') {
    const data = JSON.parse(options.body), carrier = Number(data.carrier || demoCatalog.items.find(c => c.name === 'India Post')?.id || 0);
    const existing = parcels.find(p => p.number === data.number.trim().toUpperCase() && p.carrier === carrier);
    if (existing) return { id: existing.id, reused: true };
    const parcel = { ...data, id: crypto.randomUUID(), number: data.number.trim().toUpperCase(), carrier, status: 'InfoReceived', registration: 'registered', delivered: 0, updated_at: new Date().toISOString(), scans: [] };
    parcels.unshift(parcel); localStorage.setItem('parcel-demo-v1', JSON.stringify(parcels)); return { id: parcel.id };
  }
  const id = path.split('/')[2], parcel = parcels.find(p => p.id === id);
  if (!parcel) throw new Error('Parcel not found');
  if (options.method === 'PATCH') {
    parcel.carrier = Number(JSON.parse(options.body).carrier);
    localStorage.setItem('parcel-demo-v1', JSON.stringify(parcels));
    return { id };
  }
  return parcel;
}
