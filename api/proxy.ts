import type { VercelRequest, VercelResponse } from '@vercel/node';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
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

interface UpstreamConfig {
  key: string;
  baseUrl: string;
  referer: string;
  origin: string;
  buildPath: (rawPath: string) => string;
}

// ONLY authentic, official Bangladesh Education Board servers
const UPSTREAM_CONFIGS: UpstreamConfig[] = [
  {
    key: 'eboardresults_https',
    baseUrl: 'https://eboardresults.com',
    origin: 'https://eboardresults.com',
    referer: 'https://eboardresults.com/v2/home',
    buildPath: (p) => (p.startsWith('/') ? p : '/' + p)
  },
  {
    key: 'eboardresults_http',
    baseUrl: 'http://eboardresults.com',
    origin: 'http://eboardresults.com',
    referer: 'http://eboardresults.com/v2/home',
    buildPath: (p) => (p.startsWith('/') ? p : '/' + p)
  },
  {
    key: 'eboard_gov_www_https',
    baseUrl: 'https://www.educationboardresults.gov.bd',
    origin: 'https://www.educationboardresults.gov.bd',
    referer: 'https://www.educationboardresults.gov.bd/v2/home',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  },
  {
    key: 'eboard_gov_www_http',
    baseUrl: 'http://www.educationboardresults.gov.bd',
    origin: 'http://www.educationboardresults.gov.bd',
    referer: 'http://www.educationboardresults.gov.bd/v2/home',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  },
  {
    key: 'eboard_gov_apex_https',
    baseUrl: 'https://educationboardresults.gov.bd',
    origin: 'https://educationboardresults.gov.bd',
    referer: 'https://educationboardresults.gov.bd/v2/home',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  },
  {
    key: 'eboard_gov_apex_http',
    baseUrl: 'http://educationboardresults.gov.bd',
    origin: 'http://educationboardresults.gov.bd',
    referer: 'http://educationboardresults.gov.bd/v2/home',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
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
    let hasPreferred = false;

    if (clientCookies) {
      const match = clientCookies.match(/_proxy_host=([a-zA-Z0-9_]+)/);
      if (match && match[1]) {
        const preferredKey = match[1];
        const idx = orderedConfigs.findIndex(c => c.key === preferredKey);
        if (idx >= 0) {
          hasPreferred = true;
          const [pref] = orderedConfigs.splice(idx, 1);
          orderedConfigs.unshift(pref);
        }
      }
    }

    const proxyErrors: string[] = [];
    const abortControllers: AbortController[] = [];

    const tryFetchConfig = async (cfg: UpstreamConfig) => {
      const subPath = cfg.buildPath(rawPath);
      const targetUrl = `${cfg.baseUrl}${subPath}`;

      const headers: Record<string, string> = {
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

      if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        if (bodyBuffer && bodyBuffer.length > 0) headers['Content-Length'] = String(bodyBuffer.length);
      }

      const controller = new AbortController();
      abortControllers.push(controller);
      const timeoutMs = isCaptcha ? 8000 : 20000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const fetchOptions: RequestInit = {
          method: req.method || 'GET',
          headers,
          redirect: 'manual',
          signal: controller.signal
        };
        if (bodyBuffer && bodyBuffer.length > 0) fetchOptions.body = bodyBuffer;

        const response = await fetch(targetUrl, fetchOptions);
        clearTimeout(timeoutId);

        if (response.status >= 400 && response.status !== 404 && response.status !== 400) {
           throw new Error(`Upstream blocked with HTTP ${response.status}`);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        let valid = false;
        if (isCaptcha) {
          valid = response.status === 200 && !contentType.includes('svg') && (contentType.includes('image') || contentType.includes('octet-stream'));
        } else {
          valid = response.status === 200 && !contentType.includes('text/html');
        }

        if (valid) {
          let rawCookies: string[] = [];
          if (typeof (response.headers as any).getSetCookie === 'function') {
            rawCookies = (response.headers as any).getSetCookie();
          } else {
            const sc = response.headers.get('set-cookie');
            if (sc) rawCookies = [sc];
          }

          const newCookies: string[] = [`_proxy_host=${cfg.key}; Path=/; SameSite=None; Secure`];
          const minimalCookies: string[] = [`_proxy_host=${cfg.key}`];
          
          if (rawCookies && rawCookies.length > 0) {
            for (const c of rawCookies) {
              let formatted = c.replace(/Domain=[^;]+;?/i, '');
              if (!/SameSite/i.test(formatted)) formatted += '; SameSite=None';
              if (!/Secure/i.test(formatted)) formatted += '; Secure';
              newCookies.push(formatted);
              minimalCookies.push(c.split(';')[0]);
            }
          }

          const arrayBuffer = await response.arrayBuffer();
          if (isCaptcha && (!arrayBuffer || arrayBuffer.byteLength < 500)) {
            throw new Error(`Empty/invalid image received (${arrayBuffer?.byteLength || 0} bytes)`);
          }

          return {
            status: response.status,
            contentType: contentType || (isCaptcha ? 'image/jpeg' : 'application/json'),
            newCookies,
            minimalCookies,
            arrayBuffer
          };
        }
        throw new Error(`Invalid content-type: ${contentType} or status: ${response.status}`);
      } catch (e: any) {
        clearTimeout(timeoutId);
        throw e;
      }
    };

    let winnerResult = null;
    
    if (isCaptcha && !hasPreferred) {
      // Race all upstream configurations concurrently so the fastest official captcha returns instantly
      try {
        winnerResult = await Promise.any(
          orderedConfigs.map(cfg => tryFetchConfig(cfg))
        );
      } catch (aggregateError: any) {
        if (aggregateError && aggregateError.errors) {
          for (const err of aggregateError.errors) {
            proxyErrors.push(err.message || String(err));
          }
        }
      }
    } else {
      // Try preferred host first for session stickiness
      for (const cfg of orderedConfigs) {
        try {
          winnerResult = await tryFetchConfig(cfg);
          if (winnerResult) break;
        } catch (e: any) {
          proxyErrors.push(`[${cfg.key}]: ${e.message}`);
        }
      }
    }

    // Abort pending requests once a winner is found
    abortControllers.forEach(c => {
      try { c.abort(); } catch (_) {}
    });

    if (proxyErrors.length > 0) {
      res.setHeader('X-Proxy-Errors', JSON.stringify(proxyErrors).slice(0, 300));
    }

    if (winnerResult) {
      res.setHeader('Set-Cookie', winnerResult.newCookies);
      res.setHeader('X-Set-Cookie', winnerResult.minimalCookies.join('; '));
      res.setHeader('Content-Type', winnerResult.contentType);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.status(winnerResult.status);
      res.end(Buffer.from(winnerResult.arrayBuffer));
      return;
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
