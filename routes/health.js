const { Router } = require('express');
const { getClientCount } = require('../lib/sse');

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    sseClients: getClientCount(),
    uptime: Math.floor(process.uptime()),
  });
});

module.exports = router;
