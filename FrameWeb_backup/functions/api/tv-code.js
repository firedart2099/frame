export async function onRequestPost({ request, env }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Configuracao do servidor incompleta' }), { status: 500, headers: { 'access-control-allow-origin': '*' } });
  }

  try {
    const { deviceId } = await request.json();
    if (!deviceId) {
      return new Response(JSON.stringify({ error: 'deviceId ausente' }), { status: 400, headers: { 'access-control-allow-origin': '*' } });
    }

    const codigo = Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const res = await fetch(`${SUPABASE_URL}/rest/v1/tv_auth_codes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        code: codigo,
        device_id: deviceId,
        expires_at: expiresAt,
        status: 'pending'
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: 'Erro ao registrar codigo', detail: err }), { status: 500, headers: { 'access-control-allow-origin': '*' } });
    }

    return new Response(JSON.stringify({ code: codigo }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'access-control-allow-origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'access-control-allow-origin': '*' } });
  }
}

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
