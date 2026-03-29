/* ========================================
   SSE — Server-Sent Events broadcast hub
   ======================================== */

const { MAX_SSE_CONNECTIONS, SSE_HEARTBEAT_MS, SSE_DEAD_CLIENT_MS } = require('./config');

let eventId = 0;

// Track clients with last broadcast write timestamp (not heartbeat)
const clients = new Map(); // res -> { lastBroadcast: number }

// Add a new SSE client connection
function addClient(req, res) {
  if (clients.size >= MAX_SSE_CONNECTIONS) {
    res.status(503).json({ error: 'Too many connections' });
    return;
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity',
  });

  res.write(':connected\n\n');
  clients.set(res, { lastBroadcast: Date.now() });

  // Clean up on disconnect
  req.on('close', () => {
    clients.delete(res);
  });
}

// Broadcast an event to all connected clients (non-blocking via setImmediate)
function broadcast(type, payload, mutationId) {
  eventId++;
  const data = { ...payload };
  if (mutationId) data._mutationId = mutationId;

  const message = `id: ${eventId}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  // Use setImmediate to avoid blocking the event loop when writing to 300+ sockets
  setImmediate(() => {
    for (const [client, meta] of clients) {
      try {
        client.write(message);
        meta.lastBroadcast = Date.now();
      } catch {
        clients.delete(client);
      }
    }
  });
}

// Heartbeat: keep connections alive + detect dead clients
const _heartbeatInterval = setInterval(() => {
  const now = Date.now();
  for (const [client, meta] of clients) {
    // Force-disconnect clients that haven't had a successful broadcast in DEAD_CLIENT_TIMEOUT
    // (checks before heartbeat write so we detect truly dead connections)
    if (now - meta.lastBroadcast > SSE_DEAD_CLIENT_MS) {
      try { client.end(); } catch { /* ignore */ }
      clients.delete(client);
      continue;
    }
    try {
      client.write(':keepalive\n\n');
    } catch {
      clients.delete(client);
    }
  }
}, SSE_HEARTBEAT_MS);

// Close all SSE clients and clear heartbeat (for graceful shutdown)
function shutdown() {
  clearInterval(_heartbeatInterval);
  for (const [client] of clients) {
    try { client.end(); } catch { /* ignore */ }
  }
  clients.clear();
}

// Helper: extract mutation ID from request headers
function getMutationId(req) {
  return req.headers['x-mutation-id'] || null;
}

// Get connected client count (for health/debug)
function getClientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, getMutationId, getClientCount, shutdown };
