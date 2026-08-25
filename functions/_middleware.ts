import { proxyToEboard } from './_proxy';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  if (pathname.startsWith('/v2') || pathname.startsWith('/app')) {
    return proxyToEboard(context.request, pathname + url.search);
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
    return proxyToEboard(context.request, target || '/');
  }

  return context.next();
};
