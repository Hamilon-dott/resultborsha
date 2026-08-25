export interface Env {
  ASSETS: {
    fetch: (request: Request | string) => Promise<Response>;
  };
}

function generateFallbackSvgCaptcha(): { svg: string; captchaDigits: string } {
  const digits = Math.floor(1000 + Math.random() * 9000).toString();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="50" viewBox="0 0 160 50">
    <rect width="100%" height="100%" fill="#f8fafc" rx="6"/>
    <path d="M10 25 Q 40 10, 80 25 T 150 25" stroke="#cbd5e1" stroke-width="2" fill="none"/>
    <path d="M10 35 Q 50 45, 90 20 T 150 35" stroke="#94a3b8" stroke-dasharray="4" stroke-width="1.5" fill="none"/>
    <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" font-family="'Courier New', monospace" font-size="28" font-weight="bold" letter-spacing="8" fill="#0f172a">${digits}</text>
  </svg>`;
  return { svg, captchaDigits: digits };
}

interface UpstreamConfig {
  key: string;
  baseUrl: string;
  origin: string;
  referer: string;
  host: string;
  buildPath: (rawPath: string) => string;
}

const UPSTREAM_CONFIGS: UpstreamConfig[] = [
  {
    key: 'eboard_gov',
    baseUrl: 'https://www.educationboardresults.gov.bd',
    origin: 'https://www.educationboardresults.gov.bd',
    referer: 'https://www.educationboardresults.gov.bd/v2/home',
    host: 'www.educationboardresults.gov.bd',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  },
  {
    key: 'eboard_com',
    baseUrl: 'https://eboardresults.com',
    origin: 'https://eboardresults.com',
    referer: 'https://eboardresults.com/v2/home',
    host: 'eboardresults.com',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  }
];

export async function proxyToEboard(request: Request, pathWithQuery: string): Promise<Response> {
  try {
    const urlObj = new URL(request.url);
    let rawPath = pathWithQuery;

    if (rawPath.startsWith('/api/proxy')) {
      const proxyPath = urlObj.searchParams.get('proxy_path');
      if (proxyPath) {
        const searchParams = new URLSearchParams(urlObj.searchParams);
        searchParams.delete('proxy_path');
        const qs = searchParams.toString();
        rawPath = '/' + proxyPath + (qs ? '?' + qs : '');
      } else {
        rawPath = urlObj.pathname.replace('/api/proxy', '') + urlObj.search || '/';
      }
    }

    const pathname = rawPath.split('?')[0];
    const isCaptcha = pathname.includes('captcha');
    let clientCookies = request.headers.get('cookie') || '';
    if (request.headers.get('x-cookie')) {
      clientCookies = request.headers.get('x-cookie') as string;
    }

    let bodyBuffer: ArrayBuffer | null = null;
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      bodyBuffer = await request.arrayBuffer();
    }

    let orderedConfigs = [...UPSTREAM_CONFIGS];
    if (clientCookies) {
      const match = clientCookies.match(/_proxy_host=([a-zA-Z0-9_]+)/);
      if (match && match[1]) {
        const preferredKey = match[1];
        const idx = orderedConfigs.findIndex(c => c.key === preferredKey);
        if (idx > 0) {
          const [pref] = orderedConfigs.splice(idx, 1);
          orderedConfigs.unshift(pref);
        }
      }
    }

    for (const cfg of orderedConfigs) {
      const subPath = cfg.buildPath(rawPath);
      const targetUrl = `${cfg.baseUrl}${subPath}`;

      const headers = new Headers();
      const allowedHeaders = [
        'accept', 'accept-language', 'content-type', 'user-agent',
        'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
        'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'x-requested-with'
      ];

      for (const [key, value] of request.headers.entries()) {
        if (allowedHeaders.includes(key.toLowerCase())) {
          headers.set(key, value);
        }
      }

      headers.set('host', cfg.host);
      headers.set('referer', cfg.referer);
      headers.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36');
      headers.set('accept-language', 'en-US,en;q=0.9,bn;q=0.8');

      if (isCaptcha) {
        headers.set('accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8');
      } else {
        headers.set('accept', 'application/json, text/plain, */*');
      }

      if (clientCookies) {
        const cleanCookies = clientCookies
          .split(';')
          .map(c => c.trim())
          .filter(c => !c.startsWith('_proxy_host=') && !c.startsWith('_local_captcha='))
          .join('; ');
        if (cleanCookies) {
          headers.set('cookie', cleanCookies);
        }
      }

      if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
        headers.set('origin', cfg.origin);
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/x-www-form-urlencoded');
        }
      }

      const fetchOptions: RequestInit = {
        method: request.method,
        headers,
        redirect: 'manual'
      };

      if (bodyBuffer && bodyBuffer.byteLength > 0) {
        fetchOptions.body = bodyBuffer;
      }

      try {
        const response = await fetch(targetUrl, fetchOptions);
        const contentType = response.headers.get('content-type') || '';

        let valid = false;
        if (isCaptcha) {
          valid = response.status === 200 && contentType.includes('image');
        } else {
          valid = response.status === 200;
        }

        if (valid) {
          const newHeaders = new Headers();
          response.headers.forEach((value, key) => {
            const lowerKey = key.toLowerCase();
            if (!['content-encoding', 'content-length', 'set-cookie', 'transfer-encoding'].includes(lowerKey)) {
              newHeaders.set(key, value);
            }
          });

          let rawCookies: string[] = [];
          if (typeof (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
            rawCookies = (response.headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
          } else {
            const sc = response.headers.get('set-cookie');
            if (sc) rawCookies = [sc];
          }

          const minimalCookies: string[] = [`_proxy_host=${cfg.key}`];
          newHeaders.append('Set-Cookie', `_proxy_host=${cfg.key}; Path=/; SameSite=None; Secure`);
          if (rawCookies && rawCookies.length > 0) {
            for (const c of rawCookies) {
              let formatted = c.replace(/Domain=[^;]+;?/i, '');
              if (!/SameSite/i.test(formatted)) formatted += '; SameSite=None';
              if (!/Secure/i.test(formatted)) formatted += '; Secure';
              newHeaders.append('Set-Cookie', formatted);
              minimalCookies.push(c.split(';')[0]);
            }
          }

          newHeaders.set('X-Set-Cookie', minimalCookies.join('; '));
          newHeaders.set('Access-Control-Expose-Headers', 'X-Set-Cookie');

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
          });
        }
      } catch (e) {
        console.warn(`Upstream target ${cfg.key} failed in worker:`, e);
      }
    }

    if (isCaptcha) {
      console.warn('All upstreams failed for captcha. Serving local SVG captcha in worker.');
      const { svg, captchaDigits } = generateFallbackSvgCaptcha();
      const headers = new Headers();
      headers.set('Content-Type', 'image/svg+xml');
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      headers.append('Set-Cookie', `_proxy_host=local; Path=/; SameSite=None; Secure`);
      headers.append('Set-Cookie', `_local_captcha=${captchaDigits}; Path=/; SameSite=None; Secure`);
      headers.set('X-Set-Cookie', `_proxy_host=local; _local_captcha=${captchaDigits}`);
      headers.set('Access-Control-Expose-Headers', 'X-Set-Cookie');
      return new Response(svg, { status: 200, headers });
    }

    return new Response(JSON.stringify({
      status: 1,
      msg: "The result service is currently busy. Please try again in a moment.",
      res: ""
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Proxy Error:', err);
    return new Response(JSON.stringify({ status: 1, msg: "Proxy Error" }), { status: 500 });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.startsWith('/v2') || pathname.startsWith('/app')) {
      return proxyToEboard(request, pathname + url.search);
    }

    if (pathname.startsWith('/api/proxy')) {
      const proxyPath = url.searchParams.get('proxy_path');
      let target = '';
      if (proxyPath) {
        target = '/' + proxyPath;
        const searchParams = new URLSearchParams(url.searchParams);
        searchParams.delete('proxy_path');
        const qs = searchParams.toString();
        if (qs) target += '?' + qs;
      } else {
        target = pathname.replace('/api/proxy', '') + url.search;
      }
      return proxyToEboard(request, target || '/');
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
