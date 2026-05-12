const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.use(authenticate);

router.get('/', (req, res) => {
  const { status, priority } = req.query;
  let sql = `
    SELECT o.*, d.name as driver_name, v.type as vehicle_type
    FROM orders o
    LEFT JOIN drivers d ON o.driver_id = d.id
    LEFT JOIN vehicles v ON o.vehicle_id = v.id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND o.status = ?'; params.push(status); }
  if (priority) { sql += ' AND o.priority = ?'; params.push(priority); }
  sql += ' ORDER BY o.received_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { priority, category, weight_kg, destination_lat, destination_lng } = req.body;
  const result = db.prepare(`
    INSERT INTO orders (priority, category, weight_kg, destination_lat, destination_lng)
    VALUES (?,?,?,?,?)
  `).run(priority, category, weight_kg, destination_lat, destination_lng);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['IN_HUB','COLLECTED','IN_TRANSIT','DELIVERED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  const extra = status === 'DELIVERED'
    ? ", delivered_at = datetime('now')"
    : '';
  db.prepare(`UPDATE orders SET status = ?${extra} WHERE id = ?`).run(status, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM route_segments WHERE order_id=?').run(req.params.id);
  db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
