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

interface UpstreamCaptchaConfig {
  key: string;
  url: string;
  referer: string;
}

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
  },
  {
    key: 'educationboardresults_www',
    url: 'https://www.educationboardresults.gov.bd/v2/captcha',
    referer: 'https://www.educationboardresults.gov.bd/v2/home'
  },
  {
    key: 'eboardresults_http',
    url: 'http://eboardresults.com/v2/captcha',
    referer: 'http://eboardresults.com/v2/home'
  }
];

function fetchCaptchaSingle(target: UpstreamCaptchaConfig, queryString: string): Promise<{
  key: string;
  contentType: string;
  newCookies: string[];
  minimalCookies: string[];
  buffer: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const fullUrl = target.url + (queryString ? `?${queryString}` : `?t=${Date.now()}`);
    const urlObj = new URL(fullUrl);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsIpv4Agent : httpIpv4Agent;

    const req = client.get({
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': target.referer
      },
      timeout: 6000
    }, (res) => {
      // If server returns redirect (301, 302, 307)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, fullUrl).toString();
        return fetchCaptchaSingle({ ...target, url: nextUrl }, '').then(resolve).catch(reject);
      }

      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${target.key}`));
      }

      const contentType = (res.headers['content-type'] || '').toLowerCase();
      if (contentType.includes('svg') || (!contentType.includes('image') && !contentType.includes('octet-stream'))) {
        res.resume();
        return reject(new Error(`Non-raster (${contentType}) from ${target.key}`));
      }

      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length < 300) {
          return reject(new Error(`Small buffer (${buffer.length}b) from ${target.key}`));
        }

        const rawCookies = res.headers['set-cookie'] || [];
        const newCookies: string[] = [`_proxy_host=${target.key}; Path=/; SameSite=None; Secure`];
        const minimalCookies: string[] = [`_proxy_host=${target.key}`];

        for (const c of rawCookies) {
          let formatted = c.replace(/Domain=[^;]+;?/i, '');
          if (!/SameSite/i.test(formatted)) formatted += '; SameSite=None';
          if (!/Secure/i.test(formatted)) formatted += '; Secure';
          newCookies.push(formatted);
          minimalCookies.push(c.split(';')[0]);
        }

        resolve({
          key: target.key,
          contentType: contentType || 'image/jpeg',
          newCookies,
          minimalCookies,
          buffer
        });
      });
      res.on('error', reject);
    });

    req.on('error', (e) => reject(new Error(`${target.key} network error: ${e.message}`)));
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout connecting to ${target.key}`));
    });
  });
}

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

  try {
    // Race all 4 official endpoints simultaneously with forced IPv4 for sub-second response
    const winner = await Promise.any(
      UPSTREAM_CAPTCHA_TARGETS.map(t => fetchCaptchaSingle(t, queryString))
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

    console.error('All official captcha upstreams failed:', errorDetails);
    res.setHeader('X-Debug-Errors', String(errorDetails).slice(0, 300));
    res.status(503).json({
      status: 1,
      msg: "The official captcha servers are currently busy. Please click reload to try again.",
      res: ""
    });
  }
}
