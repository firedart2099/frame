export async function onRequestPost({ request, env }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Configuracao do servidor incompleta' }), { status: 500, headers: { 'access-control-allow-origin': '*' } });
  }

  try {
    const { codigo } = await request.json();
    const tokenTelefone = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!codigo || !tokenTelefone) {
      return new Response(JSON.stringify({ error: 'Codigo ou token ausente' }), { status: 400, headers: { 'access-control-allow-origin': '*' } });
    }
    // O codigo vai cru pra dentro de filtros do PostgREST mais abaixo —
    // validar o formato aqui fecha a porta pra injecao de query.
    if (!/^[A-Z2-9]{6}$/.test(codigo.toUpperCase())) {
      return new Response(JSON.stringify({ error: 'Codigo invalido' }), { status: 400, headers: { 'access-control-allow-origin': '*' } });
    }

    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${tokenTelefone}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }
    });
    if (!authRes.ok) {
      return new Response(JSON.stringify({ error: 'Nao autorizado pelo celular' }), { status: 401, headers: { 'access-control-allow-origin': '*' } });
    }
    const userData = await authRes.json();
    const donoId = userData.id;

    // Confere que o codigo existe e ainda esta pendente ANTES de criar
    // qualquer coisa — um codigo digitado errado (ou ja usado) nao pode
    // criar uma conta fantasma que nunca vai ser aprovada.
    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/tv_auth_codes?code=eq.${codigo.toUpperCase()}&select=status`, {
      headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }
    });
    const checkData = await checkRes.json().catch(() => []);
    if (!checkData.length) {
      return new Response(JSON.stringify({ error: 'Codigo nao encontrado ou expirado' }), { status: 404, headers: { 'access-control-allow-origin': '*' } });
    }
    if (checkData[0].status === 'approved') {
      return new Response(JSON.stringify({ error: 'Esse codigo ja foi usado' }), { status: 409, headers: { 'access-control-allow-origin': '*' } });
    }

    const tvEmail = `tv_${codigo.toLowerCase()}_${Date.now()}@tv.frame.app`;
    const tvPassword = crypto.randomUUID();

    // O gatilho de allowlist (allowed_emails) bloqueia qualquer email novo
    // que nao esteja convidado - inclusive o email fantasma da TV, que nunca
    // vira um convite de verdade. Libera o proprio email antes de criar.
    await fetch(`${SUPABASE_URL}/rest/v1/allowed_emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ email: tvEmail, note: 'tv' })
    });

    const createUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: tvEmail,
        password: tvPassword,
        email_confirm: true,
        user_metadata: { is_tv: true, owner_id: donoId }
      })
    });

    if (!createUserRes.ok) {
      const err = await createUserRes.text();
      return new Response(JSON.stringify({ error: 'Erro ao criar usuario da TV', detail: err }), { status: 500, headers: { 'access-control-allow-origin': '*' } });
    }

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/tv_auth_codes?code=eq.${codigo.toUpperCase()}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        status: 'approved',
        tv_email: tvEmail,
        tv_password: tvPassword,
        owner_id: donoId
      })
    });

    const updated = await updateRes.json().catch(() => []);
    if (!updateRes.ok || !updated.length) {
      // PATCH sem linha correspondente nao da erro HTTP sozinho — sem essa
      // checagem o celular via "sucesso" com a TV esperando pra sempre.
      return new Response(JSON.stringify({ error: 'Erro ao aprovar codigo' }), { status: 500, headers: { 'access-control-allow-origin': '*' } });
    }

    return new Response(JSON.stringify({ success: true }), {
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
      'access-control-allow-headers': 'content-type, authorization',
    },
  });
