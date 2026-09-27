import type { VercelRequest, VercelResponse } from '@vercel/node';
import dns from 'dns';
import https from 'https';
import http from 'http';

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

function ipv4Lookup(hostname: string, options: any, callback: any) {
  let cb = callback;
  let opts: any = { family: 4 };

  if (typeof options === 'function') {
    cb = options;
  } else if (typeof options === 'object' && options !== null) {
    opts = { ...options, family: 4 };
  } else if (typeof options === 'number') {
    opts = { family: 4 };
  }

  dns.lookup(hostname, opts, (err, address, family) => {
    if (opts && opts.all) {
      cb(err, address);
    } else {
      cb(err, address, family);
    }
  });
}

const httpsIpv4Agent = new https.Agent({
  lookup: ipv4Lookup,
  keepAlive: true,
  rejectUnauthorized: false
});

const httpIpv4Agent = new http.Agent({
  lookup: ipv4Lookup,
  keepAlive: true
});

interface UpstreamResultConfig {
  key: string;
  url: string;
  referer: string;
  origin: string;
}

const UPSTREAM_RESULT_TARGETS: UpstreamResultConfig[] = [
  {
    key: 'eboardresults_com',
    url: 'https://eboardresults.com/v2/getres',
    referer: 'https://eboardresults.com/v2/home',
    origin: 'https://eboardresults.com'
  },
  {
    key: 'educationboardresults_gov',
    url: 'https://educationboardresults.gov.bd/v2/getres',
    referer: 'https://educationboardresults.gov.bd/v2/home',
    origin: 'https://educationboardresults.gov.bd'
  },
  {
    key: 'educationboardresults_www',
    url: 'https://www.educationboardresults.gov.bd/v2/getres',
    referer: 'https://www.educationboardresults.gov.bd/v2/home',
    origin: 'https://www.educationboardresults.gov.bd'
  },
  {
    key: 'eboardresults_http',
    url: 'http://eboardresults.com/v2/getres',
    referer: 'http://eboardresults.com/v2/home',
    origin: 'http://eboardresults.com'
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

function postResultNative(target: UpstreamResultConfig, body: Buffer, cleanCookies: string): Promise<{
  statusCode: number;
  body: string;
  rawCookies: string[];
}> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(target.url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsIpv4Agent : httpIpv4Agent;

    const headers: Record<string, string | number> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': target.origin,
      'Referer': target.referer,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Length': body.length
    };

    if (cleanCookies) {
      headers['Cookie'] = cleanCookies;
    }

    const req = client.request({
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      agent,
      headers,
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        const rawCookies = res.headers['set-cookie'] || [];
        resolve({
          statusCode: res.statusCode || 200,
          body: data,
          rawCookies
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout posting to ${target.key}`));
    });

    if (body.length > 0) {
      req.write(body);
    }
    req.end();
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

  const orderedTargets = [...UPSTREAM_RESULT_TARGETS];
  if (preferredKey) {
    const idx = orderedTargets.findIndex(t => t.key === preferredKey);
    if (idx >= 0) {
      const [pref] = orderedTargets.splice(idx, 1);
      orderedTargets.unshift(pref);
    }
  }

  for (const target of orderedTargets) {
    try {
      const result = await postResultNative(target, bodyBuffer, cleanCookies);

      if (result.statusCode === 200 && !result.body.includes('<!DOCTYPE') && !result.body.includes('<html')) {
        const newCookies: string[] = [`_proxy_host=${target.key}; Path=/; SameSite=None; Secure`];
        const minimalCookies: string[] = [`_proxy_host=${target.key}`];

        for (const c of result.rawCookies) {
          let formatted = c.replace(/Domain=[^;]+;?/i, '');
          if (!/SameSite/i.test(formatted)) formatted += '; SameSite=None';
          if (!/Secure/i.test(formatted)) formatted += '; Secure';
          newCookies.push(formatted);
          minimalCookies.push(c.split(';')[0]);
        }

        res.setHeader('Set-Cookie', newCookies);
        res.setHeader('X-Set-Cookie', minimalCookies.join('; '));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.status(200).send(result.body);
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
