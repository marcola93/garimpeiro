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
  const r = await supaFetch('/rest/v1/tokens?plataforma=eq.ml&select=user_id,access_token,refresh_token,expires_at,nickname');
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
  // Busca pedidos com paginação (50 por vez)
  let allOrders = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const url = `https://api.mercadolibre.com/orders/search?seller=${userId}&order.date_created.from=${encodeURIComponent(dateFrom)}&sort=date_desc&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) return { synced: 0, error: res.status };
    const data = await res.json();
    const orders = data.results || [];
    allOrders = allOrders.concat(orders);
    if (orders.length < limit) break;
    offset += limit;
    // Limite de segurança: máximo 500 pedidos por sync
    if (allOrders.length >= 500) break;
  }
  const orders = allOrders;
  if (!orders.length) return { synced: 0 };

  const rows = [];
  for (const order of orders) {
    const items = order.order_items || [];
    const isCancelled = order.status === 'cancelled';
    
    // Sempre uma linha por pedido (compatível com XLSX)
    // Para pedidos com múltiplos SKUs: soma receita total, registra SKUs separados por vírgula
    const receitaTotal = items.reduce((a, i) => a + (parseFloat(i.unit_price||0) * parseInt(i.quantity||1)), 0);
    const unidadesTotal = items.reduce((a, i) => a + parseInt(i.quantity||1), 0);
    const skuPrincipal = items[0]?.item?.seller_sku || items[0]?.item?.id || '';
    const skus = items.map(i => i.item?.seller_sku || i.item?.id || '').filter(Boolean).join(', ');
    const tituloPrincipal = items.length > 1
      ? `Kit: ${items.map(i => i.item?.title||'').join(' + ')}`.substring(0, 80)
      : (items[0]?.item?.title || '');

    rows.push({
      plataforma: 'ml',
      pedido_id: String(order.id), // sempre o ID limpo para compatibilidade com XLSX
      data_venda: order.date_created,
      status: order.status,
      sku: skus || skuPrincipal, // todos os SKUs separados por vírgula
      titulo_anuncio: tituloPrincipal,
      variacao: '',
      unidades: unidadesTotal,
      receita_produto: isCancelled ? 0 : receitaTotal,
      acrescimo_preco: 0,
      taxa_parcelamento: 0,
      taxa_plataforma: 0, // preenchido pelo XLSX mensal
      receita_frete: 0,
      taxa_frete: 0,
      cancelamento: isCancelled ? -receitaTotal : 0,
      total_liquido: isCancelled ? 0 : receitaTotal,
      devolvido: false,
      tipo_anuncio: items[0]?.listing_type_id || '',
      tipo_entrega: order.shipping?.logistic_type || '',
      cidade_comprador: order.shipping?.receiver_address?.city?.name || '',
      estado_comprador: order.shipping?.receiver_address?.state?.name || '',
      canal_venda: 'Mercado Livre',
      venda_publicidade: false,
    });
  }

  if (!rows.length) return { synced: 0 };

  // Salva em lotes de 50 para evitar timeout
  let totalSynced = 0;
  let lastStatus = 200;
  let lastError = null;
  const batchSize = 50;
  
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const r = await supaFetch('/rest/v1/pedidos', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch)
    });
    lastStatus = r.status;
    if (r.ok || r.status === 409) {
      totalSynced += batch.length;
    } else {
      lastError = JSON.stringify(r.data).substring(0, 200);
      console.error('Supabase error:', r.status, lastError);
    }
  }

  return { synced: totalSynced, orders: orders.length, status: lastStatus, error: lastError };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Período de sync — padrão últimos 7 dias
    const days = parseInt(req.query.days || '7');
    // Usa formato UTC explícito para a API do ML
    const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace('.000Z', '.000-00:00');

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
