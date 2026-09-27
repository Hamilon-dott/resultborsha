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

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  let bodyBuf: Buffer | null = null;
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) bodyBuf = req.body;
    else if (typeof req.body === 'string') bodyBuf = Buffer.from(req.body);
    else if (typeof req.body === 'object') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(req.body)) {
        if (k !== 'proxy_path' && v !== undefined && v !== null) params.append(k, String(v));
      }
      bodyBuf = Buffer.from(params.toString());
    }
  }
  if (!bodyBuf) {
    if (req.readableEnded || req.complete) bodyBuf = Buffer.alloc(0);
    else {
      bodyBuf = await new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        let done = false;
        const cleanup = () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } };
        req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        req.on('end', cleanup); req.on('error', cleanup);
        setTimeout(cleanup, 1000);
      });
    }
  }
  if (bodyBuf && bodyBuf.length > 0) {
    const str = bodyBuf.toString('utf-8');
    if (str.includes('proxy_path=')) {
      const params = new URLSearchParams(str);
      params.delete('proxy_path');
      return Buffer.from(params.toString());
    }
  }
  return bodyBuf || Buffer.alloc(0);
}

const UPSTREAM_HOSTS = [
  'https://eboardresults.com',
  'http://eboardresults.com'
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'X-Set-Cookie, Set-Cookie');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    let rawPath = req.url || '/';
    const urlObj = new URL(rawPath, 'http://localhost');
    const proxyPathParam = req.query?.proxy_path;
    let targetPath = (Array.isArray(proxyPathParam) ? proxyPathParam[0] : (typeof proxyPathParam === 'string' ? proxyPathParam : '')) || urlObj.searchParams.get('proxy_path') || '';

    if (targetPath) {
      urlObj.searchParams.delete('proxy_path');
      if (req.query) {
        for (const [k, v] of Object.entries(req.query)) {
          if (k !== 'proxy_path' && v !== undefined && !urlObj.searchParams.has(k)) {
            urlObj.searchParams.set(k, Array.isArray(v) ? v[0] : String(v));
          }
        }
      }
      const [pathOnly, existingQuery] = targetPath.split('?');
      if (existingQuery) {
        const extraParams = new URLSearchParams(existingQuery);
        extraParams.forEach((v, k) => urlObj.searchParams.set(k, v));
      }
      const finalQuery = urlObj.searchParams.toString();
      rawPath = '/' + pathOnly.replace(/^\/+/, '') + (finalQuery ? '?' + finalQuery : '');
    } else {
      urlObj.searchParams.delete('proxy_path');
      let cleaned = urlObj.pathname.replace(/^\/api\/proxy\/?/, '/');
      if (!cleaned.startsWith('/')) cleaned = '/' + cleaned;
      const finalQuery = urlObj.searchParams.toString();
      rawPath = cleaned + (finalQuery ? '?' + finalQuery : '');
    }

    const pathname = rawPath.split('?')[0].toLowerCase();
    const isCaptcha = pathname.includes('captcha');
    const isResult = pathname.includes('getres') || pathname.includes('result') || pathname.includes('list');

    let clientCookies = (req.headers['cookie'] as string) || '';
    if (req.headers['x-cookie']) clientCookies = req.headers['x-cookie'] as string;

    const cleanCookies = clientCookies
      .split(';')
      .map(c => c.trim())
      .filter(c => !c.startsWith('_proxy_host=') && !c.startsWith('_local_captcha=') && c.length > 0)
      .join('; ');

    let bodyBuffer: Buffer | null = null;
    if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
      bodyBuffer = await getRawBody(req);
    }

    for (const base of UPSTREAM_HOSTS) {
      const targetUrl = `${base}${rawPath.startsWith('/') ? rawPath : '/' + rawPath}`;

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        'Referer': `${base}/v2/home`
      };

      if (isCaptcha) {
        headers['Accept'] = 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8';
      } else {
        headers['Accept'] = 'application/json, text/javascript, */*; q=0.01';
        headers['Origin'] = base;
        headers['X-Requested-With'] = 'XMLHttpRequest';
      }

      if (cleanCookies) {
        headers['Cookie'] = cleanCookies;
      }

      if (bodyBuffer && bodyBuffer.length > 0) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      }

      try {
        const fetchRes = await fetch(targetUrl, {
          method: req.method || 'GET',
          headers,
          body: bodyBuffer && bodyBuffer.length > 0 ? bodyBuffer : undefined,
          signal: AbortSignal.timeout(isCaptcha ? 4500 : 7000)
        });

        const contentType = (fetchRes.headers.get('content-type') || '').toLowerCase();
        let valid = false;
        if (isCaptcha) {
          valid = fetchRes.ok && (contentType.includes('image') || contentType.includes('octet-stream'));
        } else {
          valid = fetchRes.ok && !contentType.includes('text/html');
        }

        if (valid) {
          const arrayBuf = await fetchRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);

          if (!isCaptcha || buffer.length >= 300) {
            const rawSetCookie = fetchRes.headers.get('set-cookie') || '';
            const newCookies: string[] = ['_proxy_host=eboardresults_com; Path=/; SameSite=None; Secure'];
            const minimalCookies: string[] = ['_proxy_host=eboardresults_com'];

            if (rawSetCookie) {
              const parts = rawSetCookie.split(/,\s*(?=[A-Za-z0-9_-]+=)/);
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
            res.setHeader('Content-Type', contentType || (isCaptcha ? 'image/jpeg' : 'application/json'));
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.status(fetchRes.status).send(buffer);
            return;
          }
        }
      } catch (err: any) {
        console.warn(`Upstream proxy attempt to ${targetUrl} failed:`, err.message);
      }
    }

    res.status(503).json({
      status: 1,
      msg: "The official result server is temporarily busy. Please reload captcha or try again.",
      res: ""
    });
  } catch (err) {
    console.error('Vercel Proxy Error:', err);
    res.status(500).json({ status: 1, msg: "Server proxy error." });
  }
}
