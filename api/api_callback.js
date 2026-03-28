module.exports = async (req, res) => {
  const { code, error, state } = req.query;

  if (error) return res.redirect('/garimpeiro.html?auth_error=' + error);
  if (!code) return res.status(400).send('Código de autorização não encontrado.');

  const codeVerifier = state;
  if (!codeVerifier) return res.status(400).send('code_verifier não encontrado no state.');

  try {
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.ML_APP_ID,
        client_secret: process.env.ML_SECRET,
        code: code,
        redirect_uri: process.env.REDIRECT_URI,
        code_verifier: codeVerifier
      })
    });

    const data = await response.json();

    if (!data.access_token) {
      return res.status(400).send('Erro ao obter token: ' + JSON.stringify(data));
    }

    const maxAge = 60 * 60 * 24 * 180;
    res.setHeader('Set-Cookie', [
      `ml_access_token=${data.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=21600`,
      `ml_refresh_token=${data.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
    ]);

    return res.redirect('/garimpeiro.html?auth=success');
  } catch (e) {
    return res.status(500).send('Erro: ' + e.message);
  }
};
