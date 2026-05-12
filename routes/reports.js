const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.use(authenticate);

router.get('/productivity', (req, res) => {
  const { driverId, from, to } = req.query;
  let sql = `
    SELECT d.id, d.name, d.rating,
           COUNT(o.id) as total_orders,
           SUM(CASE WHEN o.status='DELIVERED' THEN 1 ELSE 0 END) as delivered,
           AVG(o.eta_minutes) as avg_eta
    FROM drivers d
    LEFT JOIN orders o ON o.driver_id = d.id
    WHERE 1=1
  `;
  const params = [];
  if (driverId) { sql += ' AND d.id = ?'; params.push(driverId); }
  if (from) { sql += ' AND o.received_at >= ?'; params.push(from); }
  if (to) { sql += ' AND o.received_at <= ?'; params.push(to); }
  sql += ' GROUP BY d.id ORDER BY delivered DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/eta', (req, res) => {
  const rows = db.prepare(`
    SELECT date(received_at) as day, COUNT(*) as count
    FROM orders
    WHERE status = 'DELIVERED'
    GROUP BY day
    ORDER BY day ASC
    LIMIT 30
  `).all();
  res.json(rows);
});

module.exports = router;
