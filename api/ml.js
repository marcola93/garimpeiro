module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // POST — token OAuth
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? req.body : new URLSearchParams(req.body).toString();
      const response = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: body
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // GET — proxy para qualquer URL do ML
  const url = req.query.url;
  if (!url) { res.status(400).json({ error: 'url param required' }); return; }

  try {
    const headers = { 'Accept': 'application/json' };
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

    const response = await fetch(decodeURIComponent(url), { headers });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
