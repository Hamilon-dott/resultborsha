import type { VercelRequest, VercelResponse } from '@vercel/node';
import dns from 'dns';
import https from 'https';
import http from 'http';

const httpsIpv4Agent = new https.Agent({
  lookup: (hostname, options, callback) => {
    const opts = typeof options === 'object' ? { ...options, family: 4 } : { family: 4 };
    dns.lookup(hostname, opts, callback);
  },
  keepAlive: true,
  rejectUnauthorized: false
});

const httpIpv4Agent = new http.Agent({
  lookup: (hostname, options, callback) => {
    const opts = typeof options === 'object' ? { ...options, family: 4 } : { family: 4 };
    dns.lookup(hostname, opts, callback);
  },
  keepAlive: true
});

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

interface UpstreamConfig {
  key: string;
  baseUrl: string;
  referer: string;
  origin: string;
  buildPath: (rawPath: string) => string;
}

const UPSTREAM_CONFIGS: UpstreamConfig[] = [
  {
    key: 'eboardresults_com',
    baseUrl: 'https://eboardresults.com',
    origin: 'https://eboardresults.com',
    referer: 'https://eboardresults.com/v2/home',
    buildPath: (p) => (p.startsWith('/') ? p : '/' + p)
  },
  {
    key: 'educationboardresults_gov',
    baseUrl: 'https://educationboardresults.gov.bd',
    origin: 'https://educationboardresults.gov.bd',
    referer: 'https://educationboardresults.gov.bd/v2/home',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  },
  {
    key: 'educationboardresults_www',
    baseUrl: 'https://www.educationboardresults.gov.bd',
    origin: 'https://www.educationboardresults.gov.bd',
    referer: 'https://educationboardresults.gov.bd/v2/home',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  },
  {
    key: 'eboardresults_http',
    baseUrl: 'http://eboardresults.com',
    origin: 'http://eboardresults.com',
    referer: 'http://eboardresults.com/v2/home',
    buildPath: (p) => (p.startsWith('/') ? p : '/' + p)
  }
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'X-Set-Cookie, Set-Cookie, X-Proxy-Errors');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    const secFetchDest = req.headers['sec-fetch-dest'];
    const secFetchMode = req.headers['sec-fetch-mode'];
    if (secFetchDest === 'document' || secFetchMode === 'navigate') {
      res.status(404).end();
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

    if (!isCaptcha && !isResult) {
      res.status(404).json({ status: 1, msg: "Endpoint not found: " + pathname });
      return;
    }

    let clientCookies = (req.headers['cookie'] as string) || '';
    if (req.headers['x-cookie']) clientCookies = req.headers['x-cookie'] as string;

    let bodyBuffer: Buffer | null = null;
    if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
      bodyBuffer = await getRawBody(req);
    }

    let orderedConfigs = [...UPSTREAM_CONFIGS];

    if (clientCookies) {
      const match = clientCookies.match(/_proxy_host=([a-zA-Z0-9_]+)/);
      if (match && match[1]) {
        const preferredKey = match[1];
        const idx = orderedConfigs.findIndex(c => c.key === preferredKey);
        if (idx >= 0) {
          const [pref] = orderedConfigs.splice(idx, 1);
          orderedConfigs.unshift(pref);
        }
      }
    }

    const proxyErrors: string[] = [];

    for (const cfg of orderedConfigs) {
      const subPath = cfg.buildPath(rawPath);
      const targetUrl = `${cfg.baseUrl}${subPath}`;
      const urlTargetObj = new URL(targetUrl);
      const isHttps = urlTargetObj.protocol === 'https:';
      const client = isHttps ? https : http;
      const agent = isHttps ? httpsIpv4Agent : httpIpv4Agent;

      const headers: Record<string, string | number> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        'Referer': cfg.referer
      };
      
      if (isCaptcha) {
        headers['Accept'] = 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8';
      } else {
        headers['Accept'] = 'application/json, text/javascript, */*; q=0.01';
        headers['Origin'] = cfg.origin;
        headers['X-Requested-With'] = 'XMLHttpRequest';
      }

      if (clientCookies) {
        const cleanCookies = clientCookies
          .split(';')
          .map(c => c.trim())
          .filter(c => !c.startsWith('_proxy_host=') && !c.startsWith('_local_captcha='))
          .join('; ');
        if (cleanCookies) headers['Cookie'] = cleanCookies;
      }

      if (['POST', 'PUT', 'PATCH'].includes(req.method || '') && bodyBuffer && bodyBuffer.length > 0) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        headers['Content-Length'] = bodyBuffer.length;
      }

      try {
        const result = await new Promise<{
          statusCode: number;
          contentType: string;
          buffer: Buffer;
          rawCookies: string[];
        }>((resolve, reject) => {
          const proxyReq = client.request({
            protocol: urlTargetObj.protocol,
            hostname: urlTargetObj.hostname,
            port: urlTargetObj.port ? Number(urlTargetObj.port) : (isHttps ? 443 : 80),
            path: urlTargetObj.pathname + urlTargetObj.search,
            method: req.method || 'GET',
            agent,
            headers,
            timeout: isCaptcha ? 6000 : 12000
          }, (proxyRes) => {
            const chunks: Buffer[] = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
              const buffer = Buffer.concat(chunks);
              resolve({
                statusCode: proxyRes.statusCode || 200,
                contentType: (proxyRes.headers['content-type'] || '').toLowerCase(),
                buffer,
                rawCookies: proxyRes.headers['set-cookie'] || []
              });
            });
            proxyRes.on('error', reject);
          });
          proxyReq.on('error', reject);
          proxyReq.on('timeout', () => proxyReq.destroy(new Error(`Timeout from ${cfg.key}`)));
          if (bodyBuffer && bodyBuffer.length > 0) proxyReq.write(bodyBuffer);
          proxyReq.end();
        });

        let valid = false;
        if (isCaptcha) {
          valid = result.statusCode === 200 && !result.contentType.includes('svg') && (result.contentType.includes('image') || result.contentType.includes('octet-stream'));
        } else {
          valid = result.statusCode === 200 && !result.contentType.includes('text/html');
        }

        if (valid && (!isCaptcha || result.buffer.length >= 300)) {
          const newCookies: string[] = [`_proxy_host=${cfg.key}; Path=/; SameSite=None; Secure`];
          const minimalCookies: string[] = [`_proxy_host=${cfg.key}`];
          
          for (const c of result.rawCookies) {
            let formatted = c.replace(/Domain=[^;]+;?/i, '');
            if (!/SameSite/i.test(formatted)) formatted += '; SameSite=None';
            if (!/Secure/i.test(formatted)) formatted += '; Secure';
            newCookies.push(formatted);
            minimalCookies.push(c.split(';')[0]);
          }

          res.setHeader('Set-Cookie', newCookies);
          res.setHeader('X-Set-Cookie', minimalCookies.join('; '));
          res.setHeader('Content-Type', result.contentType || (isCaptcha ? 'image/jpeg' : 'application/json'));
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          res.status(result.statusCode).send(result.buffer);
          return;
        } else {
          proxyErrors.push(`[${cfg.key}]: invalid response (status=${result.statusCode}, ct=${result.contentType}, len=${result.buffer.length})`);
        }
      } catch (e: any) {
        proxyErrors.push(`[${cfg.key}]: ${e.message}`);
      }
    }

    if (proxyErrors.length > 0) {
      res.setHeader('X-Proxy-Errors', JSON.stringify(proxyErrors).slice(0, 300));
    }

    res.status(503).json({
      status: 1,
      msg: "The official result server is temporarily unreachable. Please click reload captcha or try again.",
      res: ""
    });
  } catch (err) {
    console.error('Vercel Proxy Error:', err);
    res.status(500).json({ status: 1, msg: "Server proxy error." });
  }
}
