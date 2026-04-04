const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
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
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

module.exports = async (req, res) => {
  // CORS — só aceita do nosso domínio
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // ── GET /api/data?action=pedidos ──────────────────────────────
    if (req.method === 'GET' && action === 'pedidos') {
      const { from, to, offset = 0, limit = 1000 } = req.query;
      const fields = 'id,data_venda,plataforma,sku,titulo_anuncio,pedido_id,receita_produto,taxa_plataforma,taxa_frete,total_liquido';
      let url = `/rest/v1/pedidos?select=${fields}&order=data_venda.desc&limit=${limit}&offset=${offset}`;
      if (from) url += `&data_venda=gte.${from}`;
      if (to) url += `&data_venda=lte.${to}`;
      const result = await supaFetch(url);
      return res.status(result.status).json(result.data);
    }

    // ── GET /api/data?action=pedidos_hoje ─────────────────────────
    if (req.method === 'GET' && action === 'pedidos_hoje') {
      const hoje = new Date().toISOString().split('T')[0];
      const url = `/rest/v1/pedidos?select=data_venda,receita_produto,titulo_anuncio,sku,taxa_plataforma,taxa_frete&data_venda=gte.${hoje}&data_venda=lte.${hoje}T23:59:59&limit=500`;
      const result = await supaFetch(url);
      return res.status(result.status).json(result.data);
    }

    // ── GET /api/data?action=count ────────────────────────────────
    if (req.method === 'GET' && action === 'count') {
      const result = await supaFetch('/rest/v1/pedidos?select=count');
      return res.status(result.status).json(result.data);
    }

    // ── POST /api/data?action=custos ──────────────────────────────
    if (req.method === 'POST' && action === 'custos') {
      let body = '';
      await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
      const result = await supaFetch('/rest/v1/custos', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body
      });
      return res.status(result.status).json(result.data);
    }

    // ── DELETE /api/data?action=custos&id=xxx ─────────────────────
    if (req.method === 'DELETE' && action === 'custos') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const result = await supaFetch(`/rest/v1/custos?id=eq.${id}`, { method: 'DELETE' });
      return res.status(result.status).json({ ok: true });
    }

    // ── POST /api/data?action=importar ───────────────────────────
    if (req.method === 'POST' && action === 'importar') {
      let body = '';
      await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
      const result = await supaFetch('/rest/v1/pedidos', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body
      });
      return res.status(result.status).json({ ok: result.ok, status: result.status });
    }

    return res.status(400).json({ error: 'action not found' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
