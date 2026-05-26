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

class Router {
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
    // Convert pattern with wildcards (*) and parameters (:param) to regex
    const regexPattern = pattern
      .replace(/\*/g, '.*') // wildcard match
      .replace(/:([^/]+)/g, '([^/]+)'); // named param match
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
    const decoded = globalThis.atob ? globalThis.atob(encoded) : Buffer.from(encoded, 'base64').toString('binary');
    const targetUrl = xorEncode(decoded, CONFIG.uvKey);
    
    // Fetch target
    const body = request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null;
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),
        'Origin': new URL(targetUrl).origin,
      },
      body,
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
      const b64 = globalThis.btoa ? globalThis.btoa(encoded) : Buffer.from(encoded, 'binary').toString('base64');
      return b64.replace(/=/g, '');
    },
    decodeUrl: (encoded) => {
      const decoded = globalThis.atob ? globalThis.atob(encoded) : Buffer.from(encoded, 'base64').toString('binary');
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

// Handle OPTIONS requests for CORS preflight
router.all('*', (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
});
