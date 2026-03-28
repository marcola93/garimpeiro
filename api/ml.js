export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method === 'POST') {
    try {
      const body = Object.keys(req.body).map(k => k+'='+encodeURIComponent(req.body[k])).join('&');
      const r = await fetch('https://api.mercadolibre.com/oauth/token', {
        method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body
      });
      return res.status(r.status).json(await r.json());
    } catch(e) { return res.status(500).json({error:e.message}); }
  }
  const url = req.query.url;
  if (!url) return res.status(400).json({error:'url param required'});
  try {
    const h = {'Accept':'application/json'};
    if (req.headers.authorization) h['Authorization'] = req.headers.authorization;
    const r = await fetch(decodeURIComponent(url), {headers:h});
    return res.status(r.status).json(await r.json());
  } catch(e) { return res.status(500).json({error:e.message}); }
}
