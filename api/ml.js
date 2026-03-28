export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method === 'POST') {
    let body = '';
    await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
    const r = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    const d = await r.json();
    return res.status(r.status).json(d);
  }

  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url param required' });

  const headers = { 'Accept': 'application/json' };
  if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

  const r = await fetch(decodeURIComponent(url), { headers });
  const d = await r.json();
  return res.status(r.status).json(d);
}
