// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
/**
 * client.js — Porte para JS do cliente MovieBox (aoneroom) do MovieBox-Tui.
 * Replica: pool de hosts com retry, assinatura x-tr-signature/x-client-token,
 * bootstrap de token via header x-user, e identidade de app Android.
 *
 * Endpoints cobertos (o que o Frame precisa):
 *  - search           (achar o "subject" pelo título)
 *  - getDetails       (dados do título + seasons)
 *  - getResources     (streams diretos com resolution/size/codec)
 *  - listResolutions  (collectionResolutions)
 *  - getExtCaptions   (legendas com lanName + url)
 */

import { md5Hex, hmacMd5Base64, b64Decode, utf8Bytes } from './crypto.js';

const SECRET_KEY = '76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O';

const HOST_POOL = [
  'https://api6.aoneroom.com',
  'https://api5.aoneroom.com',
  'https://api4.aoneroom.com',
  'https://api4sg.aoneroom.com',
  'https://api3.aoneroom.com',
  'https://api6sg.aoneroom.com',
  'https://api.inmoviebox.com',
];

const RETRY_STATUS = [403, 406, 407, 429, 500, 502, 503, 504];
const SIGNATURE_BODY_MAX_BYTES = 102400;

// -------------------------------------------------------------------------
// Identidade do "app Android" (port de generate_client_info_and_ua)
// -------------------------------------------------------------------------
const ANDROID_VERSIONS = [
  ['9', 'PQ3A.190605.03081104'],
  ['10', 'QP1A.191005.007.A3'],
  ['11', 'RP1A.200720.011'],
  ['12', 'S1B.220414.015'],
  ['13', 'TQ2A.230405.003'],
];
const DEVICES = ['23078RKD5C', '2201117TY', '2201117TG', '22101316G', '21121210G', 'M2012K11AG', 'M2007J20CG'];
const VERSION_CODES = [50020042, 50020043, 50020044, 50020045, 50020046];
const NETWORKS = ['NETWORK_WIFI', 'NETWORK_MOBILE'];
const TIMEZONES = ['Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'America/New_York', 'Europe/London'];
const IP_PREFIXES = ['103.241', '49.36', '117.195', '106.198', '122.162', '157.32', '182.70', '103.58', '27.60', '59.90'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomHex = (len) => Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const randomUuid = () => [8, 4, 4, 4, 12].map(randomHex).join('-');

function generateIdentity() {
  const android = pick(ANDROID_VERSIONS);
  const device = pick(DEVICES);
  const versionCode = pick(VERSION_CODES);
  const userAgent = `com.community.oneroom/${versionCode} (Linux; U; Android ${android[0]}; en_US; ${device}; Build/${android[1]}; Cronet/135.0.7012.3)`;
  const clientInfo = JSON.stringify({
    package_name: 'com.community.oneroom',
    version_name: '3.0.03.0529.03',
    version_code: versionCode,
    os: 'android',
    os_version: android[0],
    install_ch: 'ps',
    device_id: randomHex(32),
    install_store: 'ps',
    gaid: randomUuid(),
    brand: 'Redmi',
    model: device,
    system_language: 'en',
    net: pick(NETWORKS),
    region: 'US',
    timezone: pick(TIMEZONES),
    sp_code: '40401',
    'X-Play-Mode': '2',
  });
  const spoofedIp = `${pick(IP_PREFIXES)}.${1 + Math.floor(Math.random() * 253)}.${1 + Math.floor(Math.random() * 253)}`;
  return { userAgent, clientInfo, spoofedIp };
}

// -------------------------------------------------------------------------
// Assinatura (port de build_signed_headers)
// -------------------------------------------------------------------------
function sortedQueryString(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  const entries = [];
  parsed.searchParams.forEach((value, key) => entries.push([key, value]));
  if (!entries.length) return '';
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

function buildCanonical(method, url, body, timestampMs) {
  let canonicalUrl;
  try {
    const parsed = new URL(url);
    const query = sortedQueryString(url);
    canonicalUrl = query ? `${parsed.pathname}?${query}` : parsed.pathname;
  } catch {
    canonicalUrl = url;
  }

  let bodyHash = '';
  let bodyLength = '';
  if (body != null) {
    const bytes = utf8Bytes(body);
    const truncated = bytes.length > SIGNATURE_BODY_MAX_BYTES ? bytes.subarray(0, SIGNATURE_BODY_MAX_BYTES) : bytes;
    bodyHash = md5Hex(truncated);
    bodyLength = String(bytes.length);
  }

  return [
    method.toUpperCase(),
    'application/json',
    'application/json',
    bodyLength,
    String(timestampMs),
    bodyHash,
    canonicalUrl,
  ].join('\n');
}

function buildSignedHeaders(method, url, body, authToken, identity) {
  const ts = Date.now();
  const tsStr = String(ts);
  const reversed = tsStr.split('').reverse().join('');
  const clientToken = `${tsStr},${md5Hex(reversed)}`;

  const canonical = buildCanonical(method, url, body, ts);
  const keyBytes = b64Decode(SECRET_KEY);
  const signature = `${tsStr}|2|${hmacMd5Base64(keyBytes, canonical)}`;

  const headers = {
    'User-Agent': identity.userAgent,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Connection: 'keep-alive',
    'x-client-token': clientToken,
    'x-tr-signature': signature,
    'x-client-info': identity.clientInfo,
    'x-client-status': '0',
    'x-forwarded-for': identity.spoofedIp,
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

// -------------------------------------------------------------------------
// Cliente
// -------------------------------------------------------------------------

// Por onde os pedidos saem. No app e no Worker e o `fetch` de sempre. No site,
// a API do MovieBox recusa IP de datacenter (440) e nao manda CORS, entao a
// extensao do Chrome faz o pedido do computador da pessoa e devolve a
// resposta — `usarTransporte(fn)` troca so isso, sem tocar no resto do cliente.
let transporte = (url, options) => fetch(url, options);
function usarTransporte(fn) {
  transporte = typeof fn === 'function' ? fn : (url, options) => fetch(url, options);
}

class MovieBoxClient {
  constructor() {
    this.identity = generateIdentity();
    this.token = null;
    this.activeHostIdx = 0;
  }

  async _fetchWithTimeout(url, options, timeoutMs = 12000) {
    if (typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await transporte(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }
    return transporte(url, options);
  }

  _absorbToken(response) {
    try {
      const raw = response.headers.get('x-user');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.token) this.token = parsed.token;
    } catch {
      // header ausente/inválido: sem problemas
    }
  }

  /** Bootstrap: pega o token de sessão anônima do header x-user. */
  async init() {
    await this._requestHosts('GET', '/wefeed-mobile-bff/tab-operating?page=1&tabId=0&version=', null);
    if (!this.token) throw new Error('MovieBox: token ausente após init');
  }

  async request(method, pathAndQuery, bodyObj) {
    const body = bodyObj != null ? JSON.stringify(bodyObj) : null;
    try {
      return await this._requestHosts(method, pathAndQuery, body);
    } catch (err) {
      if (!this.token) {
        // Sem token: tenta bootstrap e repete uma vez
        await this.init();
        return await this._requestHosts(method, pathAndQuery, body);
      }
      // Rede instável: um segundo passe completo após pausa
      await new Promise((r) => setTimeout(r, 1500));
      return this._requestHosts(method, pathAndQuery, body);
    }
  }

  async _requestHosts(method, pathAndQuery, body) {
    const startIdx = this.activeHostIdx;
    let lastError = null;
    // Máx. 3 hosts por passe: varrer os 7 de rajada dispara anti-bot (SYN drop)
    const maxHosts = Math.min(3, HOST_POOL.length);

    for (let i = 0; i < maxHosts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 400));
      const idx = (startIdx + i) % HOST_POOL.length;
      const url = HOST_POOL[idx] + pathAndQuery;
      const headers = buildSignedHeaders(method, url, body, this.token, this.identity);

      try {
        const resp = await this._fetchWithTimeout(url, {
          method,
          headers,
          body: method === 'POST' ? body : undefined,
        });
        this._absorbToken(resp);

        if (RETRY_STATUS.includes(resp.status)) {
          lastError = new Error(`MovieBox host ${idx} retornou ${resp.status}`);
          continue;
        }
        if (!resp.ok) {
          lastError = new Error(`MovieBox status ${resp.status}`);
          continue;
        }

        this.activeHostIdx = idx;
        const data = await resp.json();
        return data && typeof data === 'object' && 'data' in data ? data.data : data;
      } catch (err) {
        lastError = err;
        continue;
      }
    }
    throw lastError || new Error('MovieBox: hosts indisponíveis');
  }

  get(pathAndQuery) {
    return this.request('GET', pathAndQuery, null);
  }

  post(pathAndQuery, bodyObj) {
    return this.request('POST', pathAndQuery, bodyObj);
  }

  // -------------------------------------------------------------- endpoints

  search(keyword, page = 1) {
    return this.post('/wefeed-mobile-bff/subject-api/search/v2', {
      keyword,
      page,
      perPage: 20,
      subjectType: 'All',
      tabId: 'All',
    });
  }

  async getDetails(subjectId) {
    const details = await this.get(`/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`);
    const stype = Number(details.subjectType ?? details.stype ?? 1);
    if (stype === 2) {
      try {
        details.seasons = await this.get(`/wefeed-mobile-bff/subject-api/season-info?subjectId=${subjectId}`);
      } catch {
        // seasons opcionais
      }
    }
    return details;
  }

  /** Streams de um filme (se=0&ep=0) ou episódio. */
  getResources(subjectId, season = 0, episode = 0, { page = 1, perPage = 20, resolution } = {}) {
    const resParam = resolution ? `&resolution=${resolution}` : '';
    const epPart = season || episode ? `&se=${season}&ep=${episode}` : '';
    return this.get(`/wefeed-mobile-bff/subject-api/resource?subjectId=${subjectId}${epPart}&page=${page}&perPage=${perPage}${resParam}`);
  }

  async listResolutions(subjectId) {
    const res = await this.get(`/wefeed-mobile-bff/subject-api/resource?subjectId=${subjectId}&page=1&perPage=20`);
    const cols = Array.isArray(res?.collectionResolutions) ? res.collectionResolutions : [];
    const resolutions = cols.map((c) => Number(c.resolution)).filter(Boolean);
    resolutions.sort((a, b) => b - a);
    return resolutions.length ? resolutions : [1080, 720, 480, 360];
  }

  getExtCaptions(subjectId, resourceId) {
    return this.get(`/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${resourceId}`);
  }
}

export { MovieBoxClient, generateIdentity, usarTransporte };
