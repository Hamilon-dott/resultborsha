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

// Sequential priority list: single session generation without race condition collisions
const UPSTREAM_CAPTCHA_TARGETS: UpstreamCaptchaConfig[] = [
  {
    key: 'eboardresults_com',
    url: 'https://eboardresults.com/v2/captcha',
    referer: 'https://eboardresults.com/v2/home'
  },
  {
    key: 'educationboardresults_gov',
    url: 'https://www.educationboardresults.gov.bd/v2/captcha',
    referer: 'https://www.educationboardresults.gov.bd/v2/home'
  },
  {
    key: 'educationboardresults_apex',
    url: 'https://educationboardresults.gov.bd/v2/captcha',
    referer: 'https://educationboardresults.gov.bd/v2/home'
  },
  {
    key: 'eboardresults_http',
    url: 'http://eboardresults.com/v2/captcha',
    referer: 'http://eboardresults.com/v2/home'
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

  // Try each official upstream server sequentially so only ONE active session is created
  for (const target of UPSTREAM_CAPTCHA_TARGETS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

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
        continue;
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      // Ensure genuine raster JPEG/PNG captcha image
      if (contentType.includes('svg') || (!contentType.includes('image') && !contentType.includes('octet-stream'))) {
        continue;
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
        continue;
      }

      res.setHeader('Set-Cookie', newCookies);
      res.setHeader('X-Set-Cookie', minimalCookies.join('; '));
      res.setHeader('Content-Type', contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.status(200).end(Buffer.from(arrayBuffer));
      return;
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.warn(`Upstream captcha failed for ${target.key}:`, err.message);
    }
  }

  res.status(503).json({
    status: 1,
    msg: "The official captcha servers are currently busy. Please click reload to try again.",
    res: ""
  });
}
