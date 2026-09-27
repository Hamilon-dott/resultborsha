import type { VercelRequest, VercelResponse } from '@vercel/node';

interface CaptchaTarget {
  key: string;
  url: string;
  referer: string;
}

const CAPTCHA_TARGETS: CaptchaTarget[] = [
  {
    key: 'eboardresults_https',
    url: 'https://eboardresults.com/v2/captcha',
    referer: 'https://eboardresults.com/v2/home'
  },
  {
    key: 'eboardresults_http',
    url: 'http://eboardresults.com/v2/captcha',
    referer: 'http://eboardresults.com/v2/home'
  }
];

async function fetchSingleCaptcha(target: CaptchaTarget, queryString: string) {
  const fullUrl = target.url + (queryString ? `?${queryString}` : `?t=${Date.now()}`);

  const res = await fetch(fullUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': target.referer
    },
    signal: AbortSignal.timeout(4500)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${target.key}`);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('image') && !contentType.includes('octet-stream')) {
    throw new Error(`Non-image (${contentType}) from ${target.key}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (buffer.length < 300) {
    throw new Error(`Small buffer (${buffer.length}b) from ${target.key}`);
  }

  // Extract set-cookie
  const rawSetCookie = res.headers.get('set-cookie') || '';
  const newCookies: string[] = ['_proxy_host=eboardresults_com; Path=/; SameSite=None; Secure'];
  const minimalCookies: string[] = ['_proxy_host=eboardresults_com'];

  if (rawSetCookie) {
    // rawSetCookie might have multiple cookies separated by comma or semicolon
    const parts = rawSetCookie.split(/,\s*(?=[A-Za-z0-9_-]+=)/);
    for (const c of parts) {
      let formatted = c.replace(/Domain=[^;]+;?/i, '');
      if (!/SameSite/i.test(formatted)) formatted += '; SameSite=None';
      if (!/Secure/i.test(formatted)) formatted += '; Secure';
      newCookies.push(formatted);
      minimalCookies.push(c.split(';')[0]);
    }
  }

  return {
    key: target.key,
    contentType: contentType || 'image/jpeg',
    newCookies,
    minimalCookies,
    buffer
  };
}

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

  try {
    // Race HTTPS and HTTP for sub-second delivery
    const winner = await Promise.any(
      CAPTCHA_TARGETS.map(t => fetchSingleCaptcha(t, queryString))
    );

    res.setHeader('Set-Cookie', winner.newCookies);
    res.setHeader('X-Set-Cookie', winner.minimalCookies.join('; '));
    res.setHeader('Content-Type', winner.contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(200).send(winner.buffer);
  } catch (err: any) {
    const errorDetails = Array.isArray(err?.errors)
      ? err.errors.map((e: any) => e?.message || String(e)).join(' ; ')
      : err?.message || String(err);

    console.error('Official captcha fetch failed:', errorDetails);
    res.status(503).json({
      status: 1,
      msg: "The official captcha servers are currently busy. Please click reload to try again.",
      res: ""
    });
  }
}
