import type { VercelRequest, VercelResponse } from '@vercel/node';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_) {}

interface UpstreamResultConfig {
  key: string;
  url: string;
  referer: string;
  origin: string;
}

const UPSTREAM_RESULT_TARGETS: UpstreamResultConfig[] = [
  {
    key: 'zahid_worker',
    url: 'https://result2ready.zahidulta.workers.dev/v2/getres',
    referer: 'https://result2ready.zahidulta.workers.dev/',
    origin: 'https://result2ready.zahidulta.workers.dev'
  },
  {
    key: 'bdgov',
    url: 'https://result.bangladeshgov.org/result',
    referer: 'https://result.bangladeshgov.org/',
    origin: 'https://result.bangladeshgov.org'
  },
  {
    key: 'eboardresults_https',
    url: 'https://eboardresults.com/v2/getres',
    referer: 'https://eboardresults.com/v2/home',
    origin: 'https://eboardresults.com'
  },
  {
    key: 'eboard_gov',
    url: 'https://www.educationboardresults.gov.bd/v2/getres',
    referer: 'https://www.educationboardresults.gov.bd/v2/home',
    origin: 'https://www.educationboardresults.gov.bd'
  }
];

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);
    if (typeof req.body === 'object') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(req.body)) {
        if (k !== 'proxy_path' && v !== undefined && v !== null) {
          params.append(k, String(v));
        }
      }
      return Buffer.from(params.toString());
    }
  }

  if (req.readableEnded || req.complete) return Buffer.alloc(0);

  return new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    let done = false;
    const cleanup = () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } };
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', cleanup);
    req.on('error', cleanup);
    setTimeout(cleanup, 1000);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Set-Cookie, Set-Cookie');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  let clientCookies = (req.headers['cookie'] as string) || '';
  if (req.headers['x-cookie']) {
    clientCookies = req.headers['x-cookie'] as string;
  }

  let preferredKey = '';
  if (clientCookies) {
    const match = clientCookies.match(/_proxy_host=([a-zA-Z0-9_]+)/);
    if (match && match[1]) preferredKey = match[1];
  }

  const cleanCookies = clientCookies
    .split(';')
    .map(c => c.trim())
    .filter(c => !c.startsWith('_proxy_host=') && !c.startsWith('_local_captcha='))
    .join('; ');

  const bodyBuffer = await getRawBody(req);

  // Reorder targets so preferred host (which generated the captcha) comes first
  const orderedTargets = [...UPSTREAM_RESULT_TARGETS];
  if (preferredKey) {
    const idx = orderedTargets.findIndex(t => t.key === preferredKey);
    if (idx >= 0) {
      const [pref] = orderedTargets.splice(idx, 1);
      orderedTargets.unshift(pref);
    }
    if (preferredKey === 'zahid_worker' || preferredKey === 'bdgov') {
      const siblingKey = preferredKey === 'zahid_worker' ? 'bdgov' : 'zahid_worker';
      const sibIdx = orderedTargets.findIndex(t => t.key === siblingKey);
      if (sibIdx > 1) {
        const [sib] = orderedTargets.splice(sibIdx, 1);
        orderedTargets.splice(1, 0, sib);
      }
    }
  }

  for (const target of orderedTargets) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const upstreamHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': target.origin,
        'Referer': target.referer,
        'X-Requested-With': 'XMLHttpRequest'
      };

      if (cleanCookies) {
        upstreamHeaders['Cookie'] = cleanCookies;
      }
      if (bodyBuffer.length > 0) {
        upstreamHeaders['Content-Length'] = String(bodyBuffer.length);
      }

      const response = await fetch(target.url, {
        method: 'POST',
        headers: upstreamHeaders,
        body: bodyBuffer,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (response.ok && !contentType.includes('text/html')) {
        let rawCookies: string[] = [];
        if (typeof (response.headers as any).getSetCookie === 'function') {
          rawCookies = (response.headers as any).getSetCookie();
        } else {
          const sc = response.headers.get('set-cookie');
          if (sc) rawCookies = [sc];
        }

        const newCookies: string[] = [`_proxy_host=${target.key}; Path=/; SameSite=None; Secure`];
        const minimalCookies: string[] = [`_proxy_host=${target.key}`];

        if (rawCookies && rawCookies.length > 0) {
          for (const c of rawCookies) {
            let formatted = c.replace(/Domain=[^;]+;?/i, '');
            if (!/SameSite/i.test(formatted)) formatted += '; SameSite=None';
            if (!/Secure/i.test(formatted)) formatted += '; Secure';
            newCookies.push(formatted);
            minimalCookies.push(c.split(';')[0]);
          }
        }

        const resData = await response.text();
        res.setHeader('Set-Cookie', newCookies);
        res.setHeader('X-Set-Cookie', minimalCookies.join('; '));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.status(response.status).send(resData);
        return;
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      console.warn(`Upstream result check failed for ${target.key}:`, e.message);
    }
  }

  res.status(503).json({
    status: 1,
    msg: "Unable to contact official result server. Please reload captcha and try again.",
    res: ""
  });
}
