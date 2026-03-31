const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ML_APP_ID = process.env.ML_APP_ID;
const ML_SECRET = process.env.ML_SECRET;

async function supabase(path, opts = {}) {
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
  try { return JSON.parse(text); } catch { return text; }
}

async function getToken(userId) {
  const rows = await supabase(`/rest/v1/tokens?user_id=eq.${userId}&plataforma=eq.ml&limit=1`);
  if (!rows || !rows[0]) return null;
  const token = rows[0];

  // Verifica se expirou e renova
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    try {
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
        await supabase(`/rest/v1/tokens?user_id=eq.${userId}&plataforma=eq.ml`, {
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
    } catch (e) {}
  }
  return token.access_token;
}

async function fetchOrder(orderId, accessToken) {
  const res = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  return res.json();
}

async function saveOrder(order, userId) {
  if (!order || !order.id) return;

  const items = order.order_items || [];
  const rows = items.map(item => ({
    plataforma: 'ml',
    pedido_id: String(order.id),
    data_venda: order.date_created,
    status: order.status,
    sku: item.item?.seller_sku || item.item?.id || '',
    titulo_anuncio: item.item?.title || '',
    variacao: '',
    unidades: item.quantity || 1,
    receita_produto: parseFloat(item.unit_price) * parseInt(item.quantity),
    taxa_plataforma: -(parseFloat(order.payments?.[0]?.marketplace_fee || 0)),
    receita_frete: parseFloat(order.shipping?.base_cost || 0),
    taxa_frete: -(parseFloat(order.shipping?.shipping_cost || 0)),
    cancelamento: 0,
    total_liquido: parseFloat(order.total_amount || 0),
    tipo_anuncio: item.listing_type_id || '',
    tipo_entrega: order.shipping?.logistic_type || '',
    cidade_comprador: order.shipping?.receiver_address?.city?.name || '',
    estado_comprador: order.shipping?.receiver_address?.state?.name || '',
    canal_venda: 'Mercado Livre',
    venda_publicidade: false,
  }));

  if (!rows.length) return;

  await supabase('/rest/v1/pedidos', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
}

module.exports = async (req, res) => {
  // ML envia GET para verificar o endpoint
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', app: 'GestãoPro' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = '';
    await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
    const notification = JSON.parse(body);

    console.log('Webhook recebido:', JSON.stringify(notification));

    // ML envia: { resource: "/orders/123", user_id: 201177396, topic: "orders_v2", ... }
    const { resource, user_id, topic } = notification;

    // Só processa notificações de pedidos
    if (!topic || !topic.includes('orders')) {
      return res.status(200).json({ status: 'ignored', topic });
    }

    if (!resource || !user_id) {
      return res.status(200).json({ status: 'ignored', reason: 'missing fields' });
    }

    // Extrai o order_id do resource (/orders/123456)
    const orderId = resource.split('/').pop();
    if (!orderId || isNaN(orderId)) {
      return res.status(200).json({ status: 'ignored', reason: 'invalid order_id' });
    }

    // Busca o token da conta
    const accessToken = await getToken(String(user_id));
    if (!accessToken) {
      console.error('Token não encontrado para user_id:', user_id);
      return res.status(200).json({ status: 'no_token', user_id });
    }

    // Busca detalhes do pedido
    const order = await fetchOrder(orderId, accessToken);
    if (order.error) {
      console.error('Erro ao buscar pedido:', order);
      return res.status(200).json({ status: 'order_error', error: order.error });
    }

    // Salva no Supabase
    await saveOrder(order, String(user_id));

    console.log(`Pedido ${orderId} salvo com sucesso`);
    return res.status(200).json({ status: 'ok', order_id: orderId });

  } catch (e) {
    console.error('Webhook error:', e.message);
    return res.status(200).json({ status: 'error', message: e.message });
  }
};
