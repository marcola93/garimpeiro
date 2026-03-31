module.exports = async (req, res) => {
  const { code, error, state } = req.query;

  if (error) return res.redirect('/garimpeiro.html?auth_error=' + error);
  if (!code) return res.status(400).send('Código não encontrado.');

  try {
    // Recupera verifier do state
    let codeVerifier = null;
    if (state) {
      try {
        const padded = state.replace(/-/g,'+').replace(/_/g,'/') + '=='.slice(0, (4 - state.length % 4) % 4);
        codeVerifier = Buffer.from(padded, 'base64').toString('utf-8');
      } catch(e) {}
    }

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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body
    });

    const data = await response.json();
    if (!data.access_token) return res.status(400).send('Erro: ' + JSON.stringify(data));

    // Busca dados do usuário
    let userId = data.user_id ? String(data.user_id) : null;
    let nickname = null;
    try {
      const userRes = await fetch(`https://api.mercadolibre.com/users/${data.user_id}`, {
        headers: { 'Authorization': `Bearer ${data.access_token}` }
      });
      const user = await userRes.json();
      userId = String(user.id);
      nickname = user.nickname;
    } catch(e) {}

    // Salva token no Supabase
    if (userId && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      try {
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/tokens`, {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify({
            plataforma: 'ml',
            user_id: userId,
            nickname: nickname,
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString(),
            updated_at: new Date().toISOString()
          })
        });
        console.log(`Token salvo no Supabase para ${nickname} (${userId})`);
      } catch(e) {
        console.error('Erro ao salvar token no Supabase:', e.message);
      }
    }

    // Salva também no cookie para o Garimpeiro
    const maxAge = 60 * 60 * 24 * 180;
    res.setHeader('Set-Cookie', [
      `ml_access_token=${data.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=21600`,
      `ml_refresh_token=${data.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
    ]);

    return res.redirect('/garimpeiro.html?auth=success');
  } catch (e) {
    return res.status(500).send('Erro callback: ' + e.message);
  }
};
