export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method === 'POST') {
    try {
      const response = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(req.body)
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url param required' });

  try {
    const headers = { 'Accept': 'application/json' };
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
    const response = await fetch(decodeURIComponent(url), { headers });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
