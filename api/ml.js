function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [key, ...val] = cookie.trim().split('=');
    if (key) cookies[key.trim()] = val.join('=').trim();
  });
  return cookies;
}

module.exports = async (req, res) => {
 res.setHeader('Access-Control-Allow-Origin', 'https://garimpeiro-git-main-marcola93s-projects.vercel.app');
res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method === 'POST') {
    let body = '';
    await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
    try {
      const response = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.query.action === 'token') {
    const cookies = parseCookies(req.headers.cookie);
    const accessToken = cookies['ml_access_token'];
    const refreshToken = cookies['ml_refresh_token'];

    if (accessToken) return res.status(200).json({ access_token: accessToken });

    if (refreshToken) {
      try {
        const response = await fetch('https://api.mercadolibre.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: process.env.ML_APP_ID,
            client_secret: process.env.ML_SECRET,
            refresh_token: refreshToken
          })
        });
        const data = await response.json();
        if (data.access_token) {
          res.setHeader('Set-Cookie', [
            `ml_access_token=${data.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=21600`,
            `ml_refresh_token=${data.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60*60*24*180}`
          ]);
          return res.status(200).json({ access_token: data.access_token });
        }
      } catch(e) {}
    }
    return res.status(401).json({ error: 'not_authenticated' });
  }

  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url param required' });

  const cookies = parseCookies(req.headers.cookie);
  let token = cookies['ml_access_token'] || null;
  if (!token && req.headers.authorization) token = req.headers.authorization.replace('Bearer ', '');

  if (!token && cookies['ml_refresh_token']) {
    try {
      const response = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: process.env.ML_APP_ID,
          client_secret: process.env.ML_SECRET,
          refresh_token: cookies['ml_refresh_token']
        })
      });
      const data = await response.json();
      if (data.access_token) {
        token = data.access_token;
        res.setHeader('Set-Cookie', [
          `ml_access_token=${data.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=21600`,
          `ml_refresh_token=${data.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60*60*24*180}`
        ]);
      }
    } catch(e) {}
  }

  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  try {
    const response = await fetch(decodeURIComponent(url), { headers });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
