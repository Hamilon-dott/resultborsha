import type { VercelRequest, VercelResponse } from '@vercel/node';
import dns from 'dns';
import { Agent, setGlobalDispatcher } from 'undici';

try {
  dns.setDefaultResultOrder('ipv4first');
  const ipv4Agent = new Agent({
    connect: {
      lookup: (hostname, opts, cb) => {
        dns.lookup(hostname, { ...opts, family: 4 }, cb);
      }
    }
  });
  setGlobalDispatcher(ipv4Agent);
} catch (_) {}

interface ResultTarget {
  key: string;
  url: string;
  referer: string;
  origin: string;
}

const RESULT_TARGETS: ResultTarget[] = [
  {
    key: 'eboardresults_https',
    url: 'https://eboardresults.com/v2/getres',
    referer: 'https://eboardresults.com/v2/home',
    origin: 'https://eboardresults.com'
  },
  {
    key: 'eboardresults_http',
    url: 'http://eboardresults.com/v2/getres',
    referer: 'http://eboardresults.com/v2/home',
    origin: 'http://eboardresults.com'
  }
];

async function getRawBodyString(req: VercelRequest): Promise<string> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf-8');
    if (typeof req.body === 'object') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(req.body)) {
        if (k !== 'proxy_path' && v !== undefined && v !== null) {
          params.append(k, String(v));
        }
      }
      return params.toString();
    }
  }

  if (req.readableEnded || req.complete) return '';

  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let done = false;
    const cleanup = () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    };
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', cleanup);
    req.on('error', cleanup);
    setTimeout(cleanup, 1000);
  });
}

async function postResultSingle(target: ResultTarget, bodyString: string, cleanCookies: string) {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': target.origin,
    'Referer': target.referer,
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
  };

  if (cleanCookies) {
    headers['Cookie'] = cleanCookies;
  }

  const res = await fetch(target.url, {
    method: 'POST',
    headers,
    body: bodyString,
    signal: AbortSignal.timeout(8500)
  });

  const text = await res.text();
  const rawSetCookie = res.headers.get('set-cookie') || '';

  return {
    status: res.status,
    text,
    rawSetCookie
  };
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

  const cleanCookies = clientCookies
    .split(';')
    .map(c => c.trim())
    .filter(c => !c.startsWith('_proxy_host=') && !c.startsWith('_local_captcha=') && c.length > 0)
    .join('; ');

  const bodyString = await getRawBodyString(req);

  for (const target of RESULT_TARGETS) {
    try {
      const result = await postResultSingle(target, bodyString, cleanCookies);

      if (result.status === 200 && !result.text.includes('<!DOCTYPE') && !result.text.includes('<html')) {
        const newCookies: string[] = ['_proxy_host=eboardresults_com; Path=/; SameSite=None; Secure'];
        const minimalCookies: string[] = ['_proxy_host=eboardresults_com'];

        if (result.rawSetCookie) {
          const parts = result.rawSetCookie.split(/,\s*(?=[A-Za-z0-9_-]+=)/);
          for (const c of parts) {
            let formatted = c.replace(/Domain=[^;]+;?/i, '');
            if (!/SameSite/i.test(formatted)) formatted += '; SameSite=None';
            if (!/Secure/i.test(formatted)) formatted += '; Secure';
            newCookies.push(formatted);
            minimalCookies.push(c.split(';')[0]);
          }
        }

        res.setHeader('Set-Cookie', newCookies);
        res.setHeader('X-Set-Cookie', minimalCookies.join('; '));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.status(200).send(result.text);
        return;
      }
    } catch (e: any) {
      console.warn(`Upstream result check failed for ${target.key}:`, e.message);
    }
  }

  res.status(503).json({
    status: 1,
    msg: "Unable to contact official result server. Please reload captcha and try again.",
    res: ""
  });
}
