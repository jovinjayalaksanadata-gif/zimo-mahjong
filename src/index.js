// Worker utama: /api/* ditangani API, sisanya file statis dari folder public/
import { onRequest } from './api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return onRequest({ request, env, ctx });
    return env.ASSETS.fetch(request);
  },
};
