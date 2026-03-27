/* ========================================
   SSE — Server-Sent Events broadcast hub
   ======================================== */

const clients = new Set();
let eventId = 0;
const MAX_CLIENTS = 500;

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
    'X-Accel-Buffering': 'no',        // Nginx/Railway: disable proxy buffering
    'Content-Encoding': 'identity',    // Bypass compression middleware
  });

  // Initial connection comment
  res.write(':connected\n\n');

  clients.add(res);

  // Clean up on disconnect
  req.on('close', () => {
    clients.delete(res);
  });
}

// Broadcast an event to all connected clients
function broadcast(type, payload, mutationId) {
  eventId++;
  const data = { ...payload };
  if (mutationId) data._mutationId = mutationId;

  const message = `id: ${eventId}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) {
    try {
      client.write(message);
    } catch (e) {
      // Dead connection — remove it
      clients.delete(client);
    }
  }
}

// Heartbeat every 30s to keep connections alive through proxies
setInterval(() => {
  for (const client of clients) {
    try {
      client.write(':keepalive\n\n');
    } catch (e) {
      clients.delete(client);
    }
  }
}, 30000);

// Helper: extract mutation ID from request headers
function getMutationId(req) {
  return req.headers['x-mutation-id'] || null;
}

// Get connected client count (for health/debug)
function getClientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, getMutationId, getClientCount };
