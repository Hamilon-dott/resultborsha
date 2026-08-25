const fs = require('fs');
let code = fs.readFileSync('api/proxy.ts', 'utf-8');

const replacement = `
    const fetchPromises = orderedConfigs.map(async (cfg) => {
      const subPath = cfg.buildPath(rawPath);
      const targetUrl = \`\${cfg.baseUrl}\${subPath}\`;

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
          .filter(c => !c.startsWith('_proxy_host='))
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
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout per request

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

          const newCookies: string[] = [\`_proxy_host=\${cfg.key}; Path=/; SameSite=None; Secure\`];
          const minimalCookies: string[] = [\`_proxy_host=\${cfg.key}\`];
          
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
    });

    try {
      const winner = await Promise.any(fetchPromises);
      res.setHeader('Set-Cookie', winner.newCookies);
      res.setHeader('X-Set-Cookie', winner.minimalCookies.join('; '));
      res.setHeader('Content-Type', winner.contentType);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.status(winner.status);
      res.send(Buffer.from(winner.arrayBuffer));
      return;
    } catch (aggregateError) {
      console.warn(\`All upstreams failed\`, aggregateError);
    }
`;

const loopRegex = /for\s*\(const\s+cfg\s+of\s+orderedConfigs\)\s*\{([\s\S]+?)\}\s*res\.status\(503\)\.json\(\{/m;
code = code.replace(loopRegex, replacement + '\n    res.status(503).json({');
fs.writeFileSync('api/proxy.ts', code);
console.log('patched to parallel');
