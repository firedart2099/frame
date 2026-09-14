// Sobe o APK pro Storage do Supabase (bucket publico "app"). R2 nao esta
// ligado na conta do Cloudflare e o Pages recusa arquivo > 25 MB.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const env = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
const key = /SUPABASE_SERVICE_ROLE_KEY=(.+)/.exec(env)[1].trim();
const url = 'https://viigaxgbimmjudbuhoqh.supabase.co';
const sb = createClient(url, key, { auth: { persistSession: false } });
(async () => {
  const [arquivo, nome] = process.argv.slice(2);
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets.some((b) => b.name === 'app')) {
    const { error } = await sb.storage.createBucket('app', { public: true, allowedMimeTypes: ['application/vnd.android.package-archive'] });
    if (error) throw error;
    console.log('bucket "app" criado');
  }
  const bytes = fs.readFileSync(arquivo);
  const { error } = await sb.storage.from('app').upload(nome, bytes, { contentType: 'application/vnd.android.package-archive', upsert: true, cacheControl: '3600' });
  if (error) throw error;
  const { data } = sb.storage.from('app').getPublicUrl(nome);
  console.log('ok', bytes.length, data.publicUrl);
})().catch((e) => { console.error('ERRO', e.message || e); process.exit(1); });
