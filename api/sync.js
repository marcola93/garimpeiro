const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ML_APP_ID = process.env.ML_APP_ID;
const ML_SECRET = process.env.ML_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://garimpeiro-marcola93s-projects.vercel.app';

async function supaFetch(path, opts = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

async function getTokens() {
  const r = await supaFetch('/rest/v1/tokens?plataforma=eq.ml&ativo=eq.true&select=user_id,access_token,refresh_token,expires_at,nickname');
  return r.data || [];
}

async function refreshToken(token) {
  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: ML_APP_ID,
      client_secret: ML_SECRET,
      refresh_token: token.refresh_token
    })
  });
  const data = await res.json();
  if (data.access_token) {
    await supaFetch(`/rest/v1/tokens?user_id=eq.${token.user_id}&plataforma=eq.ml`, {
      method: 'PATCH',
      body: JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString()
      })
    });
    return data.access_token;
  }
  return token.access_token;
}

async function syncOrders(accessToken, userId, dateFrom) {
  // Busca pedidos recentes do ML
  const url = `https://api.mercadolibre.com/orders/search?seller=${userId}&order.date_created.from=${dateFrom}&sort=date_desc&limit=50`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) return { synced: 0, error: res.status };

  const data = await res.json();
  const orders = data.results || [];
  if (!orders.length) return { synced: 0 };

  const rows = [];
  for (const order of orders) {
    const items = order.order_items || [];
    for (const item of items) {
      rows.push({
        plataforma: 'ml',
        pedido_id: String(order.id),
        data_venda: order.date_created,
        status: order.status,
        sku: item.item?.seller_sku || item.item?.id || '',
        titulo_anuncio: item.item?.title || '',
        variacao: '',
        unidades: item.quantity || 1,
        receita_produto: parseFloat(item.unit_price) * parseInt(item.quantity || 1),
        acrescimo_preco: 0,
        taxa_parcelamento: 0,
        taxa_plataforma: -(parseFloat(order.payments?.[0]?.marketplace_fee || 0)),
        receita_frete: parseFloat(order.shipping?.base_cost || 0),
        taxa_frete: -(parseFloat(order.shipping?.shipping_cost || 0)),
        cancelamento: order.status === 'cancelled' ? -(parseFloat(item.unit_price) * parseInt(item.quantity || 1)) : 0,
        total_liquido: order.status === 'cancelled' ? 0 : parseFloat(order.total_amount || 0),
        devolvido: false,
        tipo_anuncio: item.listing_type_id || '',
        tipo_entrega: order.shipping?.logistic_type || '',
        cidade_comprador: order.shipping?.receiver_address?.city?.name || '',
        estado_comprador: order.shipping?.receiver_address?.state?.name || '',
        canal_venda: 'Mercado Livre',
        venda_publicidade: false,
      });
    }
  }

  if (!rows.length) return { synced: 0 };

  const r = await supaFetch('/rest/v1/pedidos', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });

  return { synced: rows.length, orders: orders.length, status: r.status };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Período de sync — padrão últimos 7 dias
    const days = parseInt(req.query.days || '7');
    const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const tokens = await getTokens();
    if (!tokens.length) return res.status(200).json({ ok: false, error: 'no_tokens' });

    const results = [];
    for (const token of tokens) {
      // Renova token se necessário
      let accessToken = token.access_token;
      if (token.expires_at && new Date(token.expires_at) < new Date()) {
        accessToken = await refreshToken(token);
      }

      const result = await syncOrders(accessToken, token.user_id, dateFrom);
      results.push({ user: token.nickname, ...result });
    }

    return res.status(200).json({ ok: true, synced_at: new Date().toISOString(), results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
