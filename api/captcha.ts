import type { VercelRequest, VercelResponse } from '@vercel/node';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_) {}

interface UpstreamCaptchaConfig {
  key: string;
  url: string;
  referer: string;
}

const UPSTREAM_CAPTCHA_TARGETS: UpstreamCaptchaConfig[] = [
  {
    key: 'zahid_worker',
    url: 'https://result2ready.zahidulta.workers.dev/v2/captcha',
    referer: 'https://result2ready.zahidulta.workers.dev/'
  },
  {
    key: 'bdgov',
    url: 'https://result.bangladeshgov.org/captcha',
    referer: 'https://result.bangladeshgov.org/'
  },
  {
    key: 'eboardresults_https',
    url: 'https://eboardresults.com/v2/captcha',
    referer: 'https://eboardresults.com/v2/home'
  },
  {
    key: 'eboard_gov',
    url: 'https://www.educationboardresults.gov.bd/v2/captcha',
    referer: 'https://www.educationboardresults.gov.bd/v2/home'
  }
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Set-Cookie, Set-Cookie');

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

  const fetchCaptcha = async (target: UpstreamCaptchaConfig) => {
    const controller = new AbortController();
    abortControllers.push(controller);
    // 8s timeout to safely finish within Vercel's Hobby 10s limit
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const fullUrl = target.url + (queryString ? `?${queryString}` : `?t=${Date.now()}`);
      const response = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Referer': target.referer
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Upstream ${target.key} returned HTTP ${response.status}`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('image') && !contentType.includes('octet-stream')) {
        throw new Error(`Upstream ${target.key} returned invalid content-type: ${contentType}`);
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
      if (!arrayBuffer || arrayBuffer.byteLength < 50) {
        throw new Error(`Upstream ${target.key} returned empty image data`);
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
      throw err;
    }
  };

  try {
    // Race all official servers simultaneously
    const winner = await Promise.any(
      UPSTREAM_CAPTCHA_TARGETS.map(target => fetchCaptcha(target))
    );

    // Abort other slower pending requests
    abortControllers.forEach(c => {
      try { c.abort(); } catch (_) {}
    });

    res.setHeader('Set-Cookie', winner.newCookies);
    res.setHeader('X-Set-Cookie', winner.minimalCookies.join('; '));
    res.setHeader('Content-Type', winner.contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.status(200).end(winner.buffer);
  } catch (aggregateError: any) {
    abortControllers.forEach(c => {
      try { c.abort(); } catch (_) {}
    });

    console.error('All captcha upstreams failed:', aggregateError);
    res.status(503).json({
      status: 1,
      msg: "The official captcha servers are currently busy. Please click reload to try again.",
      res: ""
    });
  }
}
