// Cloudflare Workers Backend for AMONGUSGXMES
// Supports: Ultraviolet, Rammerhead, Scramjet

import { Router } from './router.js';

// Configuration
const CONFIG = {
  // Frontend domain (for CORS)
  frontend: 'https://amongusgxmes.placeholderbot-69.workers.dev',
  // UV password/key for encoding
  uvKey: 'uv',
  // Rammerhead session password
  rhPassword: 'sharkie4life',
};

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': CONFIG.frontend,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const router = new Router();
  constructor() {
    this.routes = new Map();
  }

  get(path, handler) {
    this.routes.set(`GET:${path}`, handler);
  }

  post(path, handler) {
    this.routes.set(`POST:${path}`, handler);
  }

  all(path, handler) {
    this.routes.set(`GET:${path}`, handler);
    this.routes.set(`POST:${path}`, handler);
  }

  async handle(request) {
    const url = new URL(request.url);
    const key = `${request.method}:${url.pathname}`;
    
    // Check for exact match
    if (this.routes.has(key)) {
      return this.routes.get(key)(request);
    }

    // Check for pattern match
    for (const [routeKey, handler] of this.routes) {
      const [method, path] = routeKey.split(':');
      if (method === request.method && this.matchPath(path, url.pathname)) {
        return handler(request, url);
      }
    }

    return new Response('Not Found', { status: 404 });
  }

  matchPath(pattern, actual) {
    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/:([^/]+)/g, '([^/]+)');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(actual);
  }
}

const router = new Router();

// ==================== ULTRAVIOLET ====================

// XOR encode/decode for UV
function xorEncode(str, key) {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    result += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

// UV service endpoint
router.get('/uv/service/:encoded', async (request, url) => {
  const encoded = url.pathname.split('/').pop();
  
  try {
    // Decode
    const decoded = atob(encoded);
    const targetUrl = xorEncode(decoded, CONFIG.uvKey);
    
    // Fetch target
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),
        'Origin': new URL(targetUrl).origin,
      },
      body: request.body,
    });

    // Clone and modify response
    const modified = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...Object.fromEntries(response.headers),
        ...corsHeaders,
        'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval';",
      },
    });

    return modified;
  } catch (e) {
    return new Response('Invalid URL', { 
      status: 400,
      headers: corsHeaders 
    });
  }
});

// UV config endpoint
router.get('/uv/config', () => {
  return new Response(JSON.stringify({
    bare: '/bare/',
    prefix: '/uv/service/',
    encodeUrl: (url) => {
      const encoded = xorEncode(url, CONFIG.uvKey);
      return btoa(encoded).replace(/=/g, '');
    },
    decodeUrl: (encoded) => {
      const decoded = atob(encoded);
      return xorEncode(decoded, CONFIG.uvKey);
    }
  }), {
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
});

// ==================== RAMMERHEAD ====================

// Session storage (in-memory, will reset on worker restart)
const sessions = new Map();

// Generate session ID
function generateSessionId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Rammerhead main endpoint
router.get('/rammerhead/:sessionId*', async (request, url) => {
  const pathParts = url.pathname.split('/').filter(Boolean);
  const sessionId = pathParts[1] || generateSessionId();
  const targetPath = pathParts.slice(2).join('/');

  // If no session, create one
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      created: Date.now(),
      cookies: new Map(),
      storage: new Map(),
    });
  }

  const session = sessions.get(sessionId);

  // Decode target URL from sessionId if it's base64
  let targetUrl;
  try {
    targetUrl = atob(sessionId);
    if (!targetUrl.startsWith('http')) {
      throw new Error('Invalid URL');
    }
  } catch {
    // Not a URL, use default or return session page
    return new Response(`
      <html>
        <head><title>Rammerhead Session</title></head>
        <body>
          <h1>Session: ${sessionId}</h1>
          <p>Navigate to /rammerhead/[base64url] to browse</p>
        </body>
      </html>
    `, {
      headers: {
        'Content-Type': 'text/html',
        ...corsHeaders
      }
    });
  }

  // Fetch target
  try {
    const targetResponse = await fetch(targetUrl, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),
        'Cookie': Array.from(session.cookies.entries())
          .map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: request.body,
    });

    // Store cookies
    const setCookie = targetResponse.headers.get('set-cookie');
    if (setCookie) {
      setCookie.split(',').forEach(cookie => {
        const [name, ...rest] = cookie.split('=');
        session.cookies.set(name.trim(), rest.join('=').split(';')[0].trim());
      });
    }

    // Modify response
    const body = await targetResponse.text();
    const modifiedBody = body
      .replace(/href="([^"]*)"/g, (match, url) => {
        if (url.startsWith('http')) {
          const encoded = btoa(url).replace(/=/g, '');
          return `href="/rammerhead/${encoded}/"`;
        }
        return match;
      })
      .replace(/src="([^"]*)"/g, (match, url) => {
        if (url.startsWith('http')) {
          const encoded = btoa(url).replace(/=/g, '');
          return `src="/rammerhead/${encoded}/"`;
        }
        return match;
      });

    return new Response(modifiedBody, {
      status: targetResponse.status,
      headers: {
        'Content-Type': targetResponse.headers.get('content-type') || 'text/html',
        ...corsHeaders,
      },
    });
  } catch (e) {
    return new Response('Proxy Error: ' + e.message, { 
      status: 500,
      headers: corsHeaders 
    });
  }
});

// Rammerhead password check
router.post('/rammerhead/session', async (request) => {
  const body = await request.json();
  if (body.password !== CONFIG.rhPassword) {
    return new Response('Invalid password', { 
      status: 401,
      headers: corsHeaders 
    });
  }

  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    created: Date.now(),
    cookies: new Map(),
    storage: new Map(),
  });

  return new Response(JSON.stringify({ sessionId }), {
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
});

// ==================== SCRAMJET ====================

// Scramjet service endpoint
router.get('/scramjet/service/:url*', async (request, url) => {
  const targetUrl = decodeURIComponent(url.pathname.replace('/scramjet/service/', ''));
  
  if (!targetUrl) {
    return new Response('No URL provided', { 
      status: 400,
      headers: corsHeaders 
    });
  }

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),
        'Origin': new URL(targetUrl).origin,
      },
      body: request.body,
    });

    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('text/html')) {
      let body = await response.text();
      
      // Basic Scramjet rewriting
      body = body
        // Rewrite URLs
        .replace(/(href|src|action)="([^"]*)"/g, (match, attr, url) => {
          if (url.startsWith('http')) {
            return `${attr}="/scramjet/service/${encodeURIComponent(url)}"`;
          }
          if (url.startsWith('/')) {
            const base = new URL(targetUrl).origin;
            return `${attr}="/scramjet/service/${encodeURIComponent(base + url)}"`;
          }
          return match;
        })
        // Rewrite window.location
        .replace(/window\.location/g, 'window.__scramjet$location')
        // Rewrite document.location
        .replace(/document\.location/g, 'document.__scramjet$location');

      // Inject Scramjet runtime
      const script = `
        <script>
          (() => {
            window.__scramjet$location = new Proxy(window.location, {
              get(target, prop) {
                if (prop === 'href') return '${targetUrl}';
                return target[prop];
              },
              set(target, prop, value) {
                if (prop === 'href') {
                  window.location.href = '/scramjet/service/' + encodeURIComponent(value);
                  return true;
              }
                target[prop] = value;
                return true;
              }
            });
            
            document.__scramjet$location = window.__scramjet$location;
            
            // Intercept fetch
            const originalFetch = window.fetch;
            window.fetch = function(url, options) {
              if (typeof url === 'string' && url.startsWith('http')) {
                url = '/scramjet/service/' + encodeURIComponent(url);
              }
              return originalFetch.call(this, url, options);
            };
            
            // Intercept XMLHttpRequest
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...args) {
              if (url.startsWith('http')) {
                url = '/scramjet/service/' + encodeURIComponent(url);
              }
              return originalOpen.call(this, method, url, ...args);
            };
          })();
        </script>
      `;

      body = body.replace('<head>', `<head>${script}`);

      return new Response(body, {
        status: response.status,
        headers: {
          'Content-Type': 'text/html',
          ...corsHeaders,
        },
      });
    }

    // Pass through non-HTML responses
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...Object.fromEntries(response.headers),
        ...corsHeaders,
      },
    });
  } catch (e) {
    return new Response('Proxy Error: ' + e.message, { 
      status: 500,
      headers: corsHeaders 
    });
  }
});

// ==================== BARE SERVER (for UV) ====================

router.post('/bare/', async (request) => {
  const body = await request.json();
  const targetUrl = body.url;

  try {
    const response = await fetch(targetUrl, {
      method: body.method || 'GET',
      headers: body.headers || {},
      body: body.body,
    });

    const responseBody = await response.arrayBuffer();

    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        ...corsHeaders,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }
});

router.options('/bare/', () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
});

// ==================== HEALTH CHECK ====================

router.get('/health', () => {
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp: Date.now(),
    version: '1.0.0',
  }), {
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
});

// ==================== MAIN HANDLER ====================

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Route request
    const response = await router.handle(request);

    // Add CORS to all responses
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  },
};
