export async function onRequestGet({ request, env }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Configuracao do servidor incompleta' }), { status: 500, headers: { 'access-control-allow-origin': '*' } });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return new Response(JSON.stringify({ error: 'Codigo ausente' }), { status: 400, headers: { 'access-control-allow-origin': '*' } });
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tv_auth_codes?code=eq.${code.toUpperCase()}&select=status,tv_email,tv_password,owner_id`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Erro ao consultar codigo' }), { status: 500, headers: { 'access-control-allow-origin': '*' } });
    }

    const data = await res.json();
    if (!data || data.length === 0) {
      return new Response(JSON.stringify({ error: 'Codigo nao encontrado' }), { status: 404, headers: { 'access-control-allow-origin': '*' } });
    }

    const row = data[0];
    if (row.status === 'approved') {
      return new Response(JSON.stringify({
        status: 'approved',
        email: row.tv_email,
        password: row.tv_password
      }), { status: 200, headers: { 'Content-Type': 'application/json', 'access-control-allow-origin': '*' } });
    } else {
      return new Response(JSON.stringify({ status: row.status }), { status: 200, headers: { 'Content-Type': 'application/json', 'access-control-allow-origin': '*' } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'access-control-allow-origin': '*' } });
  }
}

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
