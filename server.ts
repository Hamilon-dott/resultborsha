import express from "express";
import path from "path";
import fs from "fs";
import dns from "dns";
import { Agent, setGlobalDispatcher } from "undici";
import { createServer as createViteServer } from "vite";

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
    baseUrl: 'https://www.educationboardresults.gov.bd',
    origin: 'https://www.educationboardresults.gov.bd',
    referer: 'https://www.educationboardresults.gov.bd/v2/home',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  },
  {
    key: 'educationboardresults_apex',
    baseUrl: 'https://educationboardresults.gov.bd',
    origin: 'https://educationboardresults.gov.bd',
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.raw({ type: '*/*', limit: '10mb' }));

  app.all(['/v2/*', '/app/*', '/api/proxy', '/api/proxy/*', '/api/captcha', '/api/result'], async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'X-Set-Cookie, Set-Cookie');

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
    const proxyPathParam = req.query.proxy_path;
    let targetPath = '';
    if (Array.isArray(proxyPathParam)) {
      targetPath = proxyPathParam[0] as string;
    } else if (typeof proxyPathParam === 'string') {
      targetPath = proxyPathParam;
    }

    if (targetPath) {
      const urlObj = new URL(rawPath, 'http://localhost');
      urlObj.searchParams.delete('proxy_path');

      if (req.query) {
        for (const [k, v] of Object.entries(req.query)) {
          if (k !== 'proxy_path' && v !== undefined && !urlObj.searchParams.has(k)) {
            urlObj.searchParams.set(k, Array.isArray(v) ? (v[0] as string) : String(v));
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
    } else if (rawPath.startsWith('/api/captcha')) {
      rawPath = rawPath.replace('/api/captcha', '/v2/captcha');
    } else if (rawPath.startsWith('/api/result')) {
      rawPath = rawPath.replace('/api/result', '/v2/getres');
    } else if (rawPath.startsWith('/api/proxy')) {
      res.status(404).json({ status: 404, msg: "Not Found" });
      return;
    }

    const pathname = rawPath.split('?')[0].toLowerCase();
    const isCaptcha = pathname.includes('captcha');
    const isResult = pathname.includes('getres') || pathname.includes('result') || pathname.includes('list');

    if (!isCaptcha && !isResult) {
      res.status(404).json({ status: 1, msg: "Endpoint not found" });
      return;
    }

    let clientCookies = (req.headers['cookie'] as string) || '';
    if (req.headers['x-cookie']) {
      clientCookies = req.headers['x-cookie'] as string;
    }

    let bodyBuffer: Buffer | null = null;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (Buffer.isBuffer(req.body)) {
        bodyBuffer = req.body;
      } else if (typeof req.body === 'string') {
        bodyBuffer = Buffer.from(req.body);
      } else if (typeof req.body === 'object' && req.body !== null) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(req.body)) {
          if (k !== 'proxy_path' && v !== undefined && v !== null) {
            params.append(k, String(v));
          }
        }
        bodyBuffer = Buffer.from(params.toString());
      }
    }

    if (bodyBuffer && bodyBuffer.length > 0) {
      const str = bodyBuffer.toString('utf-8');
      if (str.includes('proxy_path=')) {
        const params = new URLSearchParams(str);
        params.delete('proxy_path');
        bodyBuffer = Buffer.from(params.toString());
      }
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

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        'Referer': cfg.referer
      };

      if (isCaptcha) {
        headers['Accept'] = 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8';
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

      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      }

      const controller = new AbortController();
      const timeoutMs = isCaptcha ? 4000 : 15000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const fetchOptions: RequestInit = {
          method: req.method,
          headers,
          redirect: 'manual',
          signal: controller.signal
        };

        if (bodyBuffer && bodyBuffer.length > 0) {
          fetchOptions.body = bodyBuffer;
        }

        const response = await fetch(targetUrl, fetchOptions);
        clearTimeout(timeoutId);

        const contentType = (response.headers.get('content-type') || '').toLowerCase();

        let valid = false;
        if (isCaptcha) {
          valid = response.status === 200 && !contentType.includes('svg') && (contentType.includes('image') || contentType.includes('octet-stream'));
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
          if (isCaptcha && (!arrayBuffer || arrayBuffer.byteLength < 500)) {
            throw new Error(`Empty image (${arrayBuffer?.byteLength || 0} bytes)`);
          }

          res.setHeader('Set-Cookie', newCookies);
          res.setHeader('X-Set-Cookie', minimalCookies.join('; '));
          res.setHeader('Content-Type', contentType || (isCaptcha ? 'image/jpeg' : 'application/json'));
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          res.status(response.status);
          res.end(Buffer.from(arrayBuffer));
          return;
        }
      } catch (e) {
        clearTimeout(timeoutId);
      }
    }

    res.status(503).json({
      status: 1,
      msg: "The official result server is temporarily unreachable. Please click reload captcha or try again.",
      res: ""
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));

    // Redirect legacy and common 404 paths permanently
    app.get(['/home', '/index.html', '/index.php', '/legal/privacy-policy', '/legal/terms', '/privacy-policy', '/terms'], (req, res) => {
      res.redirect(301, '/');
    });

    app.get('*', (req, res) => {
      const cleanPath = req.path.replace(/^\/+|\/+$/g, '');
      if (cleanPath) {
        const nestedHtml = path.join(distPath, cleanPath, 'index.html');
        const flatHtml = path.join(distPath, `${cleanPath}.html`);
        if (fs.existsSync(nestedHtml)) {
          res.sendFile(nestedHtml);
          return;
        }
        if (fs.existsSync(flatHtml)) {
          res.sendFile(flatHtml);
          return;
        }
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
