const https = require('https');
const http = require('http');
const url_module = require('url');
const querystring = require('querystring');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // POST: OAuth token
  if (req.method === 'POST') {
    return new Promise((resolve) => {
      let rawBody = '';
      req.on('data', chunk => rawBody += chunk);
      req.on('end', () => {
        const postData = rawBody || querystring.stringify({
          grant_type: 'client_credentials',
          client_id: req.body && req.body.client_id,
          client_secret: req.body && req.body.client_secret
        });

        const options = {
          hostname: 'api.mercadolibre.com',
          path: '/oauth/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'Accept': 'application/json'
          }
        };

        const proxyReq = https.request(options, (proxyRes) => {
          let data = '';
          proxyRes.on('data', chunk => data += chunk);
          proxyRes.on('end', () => {
            res.status(proxyRes.statusCode).json(JSON.parse(data));
            resolve();
          });
        });

        proxyReq.on('error', (e) => {
          res.status(500).json({ error: e.message });
          resolve();
        });

        proxyReq.write(postData);
        proxyReq.end();
      });
    });
  }

  // GET: proxy para ML
  const targetUrl = req.query.url;
  if (!targetUrl) {
    res.status(400).json({ error: 'url param required' });
    return;
  }

  return new Promise((resolve) => {
    const decoded = decodeURIComponent(targetUrl);
    const parsed = url_module.parse(decoded);
    const protocol = parsed.protocol === 'https:' ? https : http;

    const headers = { 'Accept': 'application/json' };
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }

    const options = {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'GET',
      headers
    };

    const proxyReq = protocol.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        try {
          res.status(proxyRes.statusCode).json(JSON.parse(data));
        } catch(e) {
          res.status(500).json({ error: 'Invalid JSON response', raw: data.substring(0, 200) });
        }
        resolve();
      });
    });

    proxyReq.on('error', (e) => {
      res.status(500).json({ error: e.message });
      resolve();
    });

    proxyReq.end();
  });
};
