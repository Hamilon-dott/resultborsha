import type { VercelRequest, VercelResponse } from '@vercel/node';
import dns from 'dns';
import { Agent, setGlobalDispatcher } from 'undici';

// Force all outbound connections to strictly use IPv4
// (The official Bangladesh servers return 403 Forbidden on IPv6, causing Vercel Lambda dual-stack to fail)
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
} catch (e) {
  console.warn('[Captcha] IPv4 dispatcher warning:', e);
}

interface UpstreamCaptchaConfig {
  key: string;
  url: string;
  referer: string;
}

// Two primary official Bangladesh Education Board servers
const UPSTREAM_CAPTCHA_TARGETS: UpstreamCaptchaConfig[] = [
  {
    key: 'eboardresults_com',
    url: 'https://eboardresults.com/v2/captcha',
    referer: 'https://eboardresults.com/v2/home'
  },
  {
    key: 'educationboardresults_gov',
    url: 'https://educationboardresults.gov.bd/v2/captcha',
    referer: 'https://educationboardresults.gov.bd/v2/home'
  }
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Set-Cookie, Set-Cookie, X-Debug-Errors');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const queryParams = new URLSearchParams();
  if (req.query) {
    for (const [k, v] of Object.entries(req.query)) {
      if (k !== 'proxy_path' && v !== undefined && v !== null) {
        queryParams.set(k, Array.isArray(v) ? v[0] : String(v));
      }
    }
  }
  const queryString = queryParams.toString();
  const abortControllers: AbortController[] = [];
  const errors: string[] = [];

  const fetchTarget = async (target: UpstreamCaptchaConfig) => {
    const controller = new AbortController();
    abortControllers.push(controller);
    const timeoutId = setTimeout(() => controller.abort(), 7500);

    try {
      const fullUrl = target.url + (queryString ? `?${queryString}` : `?t=${Date.now()}`);
      const response = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Referer': target.referer
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${target.key}`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      // Ensure genuine raster JPEG/PNG captcha image
      if (contentType.includes('svg') || (!contentType.includes('image') && !contentType.includes('octet-stream'))) {
        throw new Error(`Non-raster image from ${target.key}`);
      }

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

      const arrayBuffer = await response.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength < 500) {
        throw new Error(`Invalid buffer from ${target.key}`);
      }

      return {
        key: target.key,
        contentType: contentType || 'image/jpeg',
        newCookies,
        minimalCookies,
        buffer: Buffer.from(arrayBuffer)
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      errors.push(`[${target.key}]: ${err.message}`);
      throw err;
    }
  };

  try {
    // Race both official domains simultaneously with forced IPv4 to return the fastest response (~2.5s)
    const winner = await Promise.any(
      UPSTREAM_CAPTCHA_TARGETS.map(t => fetchTarget(t))
    );

    // Cancel slower request
    abortControllers.forEach(c => {
      try { c.abort(); } catch (_) {}
    });

    res.setHeader('Set-Cookie', winner.newCookies);
    res.setHeader('X-Set-Cookie', winner.minimalCookies.join('; '));
    res.setHeader('Content-Type', winner.contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(200).send(winner.buffer);
  } catch (aggregateError: any) {
    abortControllers.forEach(c => {
      try { c.abort(); } catch (_) {}
    });

    console.error('All official captcha upstreams failed:', errors);
    res.setHeader('X-Debug-Errors', errors.join('; ').slice(0, 300));
    res.status(503).json({
      status: 1,
      msg: "The official captcha servers are currently busy. Please click reload to try again.",
      res: ""
    });
  }
}
