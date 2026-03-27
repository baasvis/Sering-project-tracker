/* ========================================
   SSE — Server-Sent Events broadcast hub
   ======================================== */

const MAX_CLIENTS = 500;
const HEARTBEAT_INTERVAL = 30_000;    // 30s — keeps proxies from closing idle connections
const DEAD_CLIENT_TIMEOUT = 90_000;   // 90s — remove clients that fail 3 consecutive heartbeats

let eventId = 0;

// Track clients with last successful write timestamp
const clients = new Map(); // res -> { lastWrite: number }

// Add a new SSE client connection
function addClient(req, res) {
  if (clients.size >= MAX_CLIENTS) {
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
  clients.set(res, { lastWrite: Date.now() });

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
        meta.lastWrite = Date.now();
      } catch {
        clients.delete(client);
      }
    }
  });
}

// Heartbeat: keep connections alive + detect dead clients
setInterval(() => {
  const now = Date.now();
  for (const [client, meta] of clients) {
    try {
      client.write(':keepalive\n\n');
      meta.lastWrite = now;
    } catch {
      clients.delete(client);
      continue;
    }
    // Force-disconnect clients that haven't had a successful write in DEAD_CLIENT_TIMEOUT
    // This catches half-open TCP connections that don't trigger 'close' events
    if (now - meta.lastWrite > DEAD_CLIENT_TIMEOUT) {
      try { client.end(); } catch { /* ignore */ }
      clients.delete(client);
    }
  }
}, HEARTBEAT_INTERVAL);

// Helper: extract mutation ID from request headers
function getMutationId(req) {
  return req.headers['x-mutation-id'] || null;
}

// Get connected client count (for health/debug)
function getClientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, getMutationId, getClientCount };
