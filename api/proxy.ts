import type { VercelRequest, VercelResponse } from '@vercel/node';

function generateFallbackSvgCaptcha(): { svg: string; captchaDigits: string } {
  const digits = Math.floor(1000 + Math.random() * 9000).toString();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="50" viewBox="0 0 160 50">
    <rect width="100%" height="100%" fill="#f1f5f9" rx="8"/>
    <path d="M10 25 Q 40 10, 80 25 T 150 25" stroke="#94a3b8" stroke-width="2" fill="none"/>
    <path d="M10 38 Q 50 48, 90 22 T 150 38" stroke="#cbd5e1" stroke-dasharray="4" stroke-width="1.5" fill="none"/>
    <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" font-family="'Courier New', Courier, monospace" font-size="28" font-weight="900" letter-spacing="7" fill="#0f172a">${digits}</text>
  </svg>`;
  return { svg, captchaDigits: digits };
}

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  let bodyBuf: Buffer | null = null;

  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) {
      bodyBuf = req.body;
    } else if (typeof req.body === 'string') {
      bodyBuf = Buffer.from(req.body);
    } else if (typeof req.body === 'object') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(req.body)) {
        if (k !== 'proxy_path' && v !== undefined && v !== null) {
          params.append(k, String(v));
        }
      }
      bodyBuf = Buffer.from(params.toString());
    }
  }

  if (!bodyBuf) {
    if (req.readableEnded || req.complete) {
      bodyBuf = Buffer.alloc(0);
    } else {
      bodyBuf = await new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        let done = false;
        const cleanup = () => {
          if (!done) {
            done = true;
            resolve(Buffer.concat(chunks));
          }
        };
        req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        req.on('end', cleanup);
        req.on('error', cleanup);
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
    key: 'eboard_gov',
    baseUrl: 'https://www.educationboardresults.gov.bd',
    origin: 'https://www.educationboardresults.gov.bd',
    referer: 'https://www.educationboardresults.gov.bd/v2/home',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  },
  {
    key: 'eboard_gov_http',
    baseUrl: 'http://www.educationboardresults.gov.bd',
    origin: 'http://www.educationboardresults.gov.bd',
    referer: 'http://www.educationboardresults.gov.bd/v2/home',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  },
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
    key: 'bdgov',
    baseUrl: 'https://result.bangladeshgov.org',
    origin: 'https://result.bangladeshgov.org',
    referer: 'https://result.bangladeshgov.org/',
    buildPath: (p) => {
      let sub = p;
      if (sub.startsWith('/v2/captcha')) sub = sub.replace('/v2/captcha', '/captcha');
      else if (sub.startsWith('/v2/getres')) sub = sub.replace('/v2/getres', '/result');
      return sub.startsWith('/') ? sub : '/' + sub;
    }
  }
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

    // Block direct browser address bar visits or direct inspection of /api/proxy
    const secFetchDest = req.headers['sec-fetch-dest'];
    const secFetchMode = req.headers['sec-fetch-mode'];
    if (secFetchDest === 'document' || secFetchMode === 'navigate') {
      res.status(404).end();
      return;
    }

    let rawPath = req.url || '/';

    const proxyPathParam = req.query?.proxy_path;
    let targetPath = '';
    if (Array.isArray(proxyPathParam)) {
      targetPath = proxyPathParam[0];
    } else if (typeof proxyPathParam === 'string') {
      targetPath = proxyPathParam;
    }

    if (targetPath) {
      const urlObj = new URL(rawPath, 'http://localhost');
      urlObj.searchParams.delete('proxy_path');

      // Also copy all other query params from req.query if not present in urlObj
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
      // Direct visit to /api/proxy without internal rewrite parameters is forbidden/hidden
      res.status(404).json({ status: 404, msg: "Not Found" });
      return;
    }

    const pathname = rawPath.split('?')[0].toLowerCase();
    const isCaptcha = pathname.includes('captcha');
    const isResult = pathname.includes('getres') || pathname.includes('result');

    if (!isCaptcha && !isResult) {
      res.status(404).json({ status: 1, msg: "Endpoint not found" });
      return;
    }

    let clientCookies = (req.headers['cookie'] as string) || '';
    if (req.headers['x-cookie']) {
      clientCookies = req.headers['x-cookie'] as string;
    }

    let bodyBuffer: Buffer | null = null;
    if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
      bodyBuffer = await getRawBody(req);
    }

    let orderedConfigs = [...UPSTREAM_CONFIGS];
    let hasPreferred = false;

    // Priority based on previous cookie session
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

    // Limit active parallel candidates to max 2 at a time (or 1 if preferred host is known) to save CPU & memory
    const activeConfigs = hasPreferred ? [orderedConfigs[0]] : orderedConfigs.slice(0, 2);
    const abortControllers: AbortController[] = [];

    const tryFetchConfig = async (cfg: UpstreamConfig) => {
      const subPath = cfg.buildPath(rawPath);
      const targetUrl = `${cfg.baseUrl}${subPath}`;

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        'Referer': cfg.referer
      };

      if (isCaptcha) {
        headers['Accept'] = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
        headers['Sec-Fetch-Dest'] = 'image';
        headers['Sec-Fetch-Mode'] = 'no-cors';
        headers['Sec-Fetch-Site'] = 'same-origin';
      } else {
        headers['Accept'] = 'application/json, text/javascript, */*; q=0.01';
        headers['Origin'] = cfg.origin;
        headers['X-Requested-With'] = 'XMLHttpRequest';
        headers['Sec-Fetch-Dest'] = 'empty';
        headers['Sec-Fetch-Mode'] = 'cors';
        headers['Sec-Fetch-Site'] = 'same-origin';
      }

      if (clientCookies) {
        const cleanCookies = clientCookies
          .split(';')
          .map(c => c.trim())
          .filter(c => !c.startsWith('_proxy_host=') && !c.startsWith('_local_captcha='))
          .join('; ');
        if (cleanCookies) {
          headers['Cookie'] = cleanCookies;
        }
      }

      if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        if (bodyBuffer && bodyBuffer.length > 0) {
          headers['Content-Length'] = String(bodyBuffer.length);
        }
      }

      const controller = new AbortController();
      abortControllers.push(controller);
      const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout per request

      try {
        const fetchOptions: RequestInit = {
          method: req.method || 'GET',
          headers,
          redirect: 'manual',
          signal: controller.signal
        };
        if (bodyBuffer && bodyBuffer.length > 0) {
          fetchOptions.body = bodyBuffer;
        }

        const response = await fetch(targetUrl, fetchOptions);
        clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        let valid = false;
        if (isCaptcha) {
          valid = response.status === 200 && (contentType.includes('image') || contentType.includes('octet-stream'));
        } else {
          valid = response.status === 200 && !contentType.includes('text/html');
        }

        if (valid) {
          let rawCookies: string[] = [];
          if (typeof (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
            rawCookies = (response.headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
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

          return {
            status: response.status,
            contentType: contentType || (isCaptcha ? 'image/jpeg' : 'application/json'),
            newCookies,
            minimalCookies,
            arrayBuffer
          };
        }
        throw new Error('Invalid response from ' + cfg.key);
      } catch (e) {
        clearTimeout(timeoutId);
        throw e;
      }
    };

    let winnerResult = null;
    try {
      winnerResult = await Promise.any(activeConfigs.map(cfg => tryFetchConfig(cfg)));
    } catch {
      // If the top 1 or 2 fail, try the remaining upstreams sequentially as a quick fallback
      const remainingConfigs = orderedConfigs.filter(c => !activeConfigs.includes(c));
      for (const fallbackCfg of remainingConfigs) {
        try {
          winnerResult = await tryFetchConfig(fallbackCfg);
          if (winnerResult) break;
        } catch {
          // continue to next
        }
      }
    } finally {
      // Abort any still-pending upstream connections to save CPU and bandwidth
      for (const ctrl of abortControllers) {
        try { ctrl.abort(); } catch {}
      }
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

    if (isCaptcha) {
      console.warn('Serving fallback SVG Captcha.');
      const { svg, captchaDigits } = generateFallbackSvgCaptcha();
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Set-Cookie', [
        '_proxy_host=local; Path=/; SameSite=None; Secure',
        `_local_captcha=${captchaDigits}; Path=/; SameSite=None; Secure`
      ]);
      res.setHeader('X-Set-Cookie', `_proxy_host=local; _local_captcha=${captchaDigits}`);
      res.status(200);
      res.end(Buffer.from(svg, 'utf-8'));
      return;
    }

    res.status(503).json({
      status: 1,
      msg: "The result server is temporarily unreachable. Please click reload captcha or try again.",
      res: ""
    });
  } catch (err) {
    console.error('Vercel Proxy Error:', err);
    res.status(500).json({ status: 1, msg: "Server proxy error." });
  }
}
