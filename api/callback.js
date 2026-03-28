module.exports = async (req, res) => {
  const { code, error } = req.query;

  if (error) return res.redirect('/garimpeiro.html?auth_error=' + error);
  if (!code) return res.status(400).send('Código não encontrado.');

  // Pega o verifier do cookie
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=');
  });
  const codeVerifier = cookies['pkce_verifier'];

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.ML_APP_ID,
      client_secret: process.env.ML_SECRET,
      code: code,
      redirect_uri: process.env.REDIRECT_URI
    });
    if (codeVerifier) body.set('code_verifier', codeVerifier);

    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const data = await response.json();
    if (!data.access_token) return res.status(400).send('Erro: ' + JSON.stringify(data));

    const maxAge = 60 * 60 * 24 * 180;
    res.setHeader('Set-Cookie', [
      `ml_access_token=${data.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=21600`,
      `ml_refresh_token=${data.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
      `pkce_verifier=; Path=/; Max-Age=0`
    ]);

    return res.redirect('/garimpeiro.html?auth=success');
  } catch (e) {
    return res.status(500).send('Erro: ' + e.message);
  }
};
