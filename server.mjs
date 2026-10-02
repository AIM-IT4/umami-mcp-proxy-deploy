import http from 'node:http';
import { Server, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';

const PORT = Number(process.env.PORT || 10000);
const SECRET = (process.env.MCP_PATH_SECRET || '').replace(/^\/+|\/+$/g, '');
const UPSTREAM = (process.env.UMAMI_MCP_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.UMAMI_API_KEY || '';

if (!SECRET || SECRET.length < 24 || !UPSTREAM || !API_KEY) {
  throw new Error('MCP_PATH_SECRET, UMAMI_MCP_URL and UMAMI_API_KEY are required');
}

let rpcId = 1000;

function parseSse(text, wantedId) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const msg = JSON.parse(raw);
      if (wantedId === undefined || msg.id === wantedId) return msg;
    } catch {}
  }
  return null;
}

async function upstreamRpc(method, params = {}) {
  const id = ++rpcId;
  const response = await fetch(UPSTREAM, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${API_KEY}`,
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      // Umami explicitly supports the 2025 stateless compatibility path.
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Umami MCP ${method} failed: HTTP ${response.status}: ${text.slice(0, 1000)}`);
  }

  let message;
  const type = response.headers.get('content-type') || '';
  if (type.includes('text/event-stream')) {
    message = parseSse(text, id);
  } else {
    try { message = JSON.parse(text); } catch {}
  }

  if (!message) {
    throw new Error(`Umami MCP ${method} returned an unreadable response`);
  }
  if (message.error) {
    throw new Error(`Umami MCP ${method} error: ${JSON.stringify(message.error)}`);
  }
  return message.result;
}

function buildServer() {
  const server = new Server(
    { name: 'umami-analytics', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler('tools/list', async () => {
    const result = await upstreamRpc('tools/list', {});
    return { tools: result?.tools || [] };
  });

  server.setRequestHandler('tools/call', async request => {
    return await upstreamRpc('tools/call', request.params);
  });

  return server;
}

// The official MCP v2 handler serves 2026-07-28 clients and 2025-era clients
// from the same stateless endpoint.
const mcpHandler = createMcpHandler(() => buildServer(), { legacy: 'stateless' });
const nodeHandler = toNodeHandler(mcpHandler);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', bridge: 'mcp-v2', upstreamConfigured: true }));
    return;
  }

  const expected = `/${SECRET}/mcp`;
  if (url.pathname === expected || url.pathname === expected + '/') {
    void nodeHandler(req, res);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Umami MCP bridge listening on 0.0.0.0:${PORT}`);
});
