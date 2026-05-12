/**
 * Rutas de gestión de pedidos.
 * Todas requieren token JWT válido (middleware authenticate).
 *
 * GET    /api/orders             - Lista pedidos con filtros opcionales
 * POST   /api/orders             - Crea un pedido nuevo en estado IN_HUB
 * PATCH  /api/orders/:id/status  - Cambia el estado de un pedido
 * DELETE /api/orders/:id         - Elimina pedido y sus segmentos de ruta
 */
const express = require('express');
const db = require('../db');
const router = express.Router();

// Lista pedidos con JOIN a conductor y vehículo; admite filtros por estado y prioridad
router.get('/', (req, res) => {
  const { status, priority } = req.query;

  // Base de la consulta: une pedidos con conductor y vehículo asignados
  let sql = `
    SELECT o.*, d.name as driver_name, v.type as vehicle_type
    FROM orders o
    LEFT JOIN drivers d ON o.driver_id = d.id
    LEFT JOIN vehicles v ON o.vehicle_id = v.id
    WHERE 1=1
  `;
  const params = [];

  // Agrega filtros dinámicamente según los query params recibidos
  if (status)   { sql += ' AND o.status = ?';   params.push(status); }
  if (priority) { sql += ' AND o.priority = ?'; params.push(priority); }

  sql += ' ORDER BY o.received_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Crea un pedido nuevo; el estado inicial siempre es IN_HUB (en bodega)
router.post('/', (req, res) => {
  const { priority, category, weight_kg, destination_lat, destination_lng } = req.body;
  const result = db.prepare(`
    INSERT INTO orders (priority, category, weight_kg, destination_lat, destination_lng)
    VALUES (?,?,?,?,?)
  `).run(priority, category, weight_kg, destination_lat, destination_lng);
  res.status(201).json({ id: result.lastInsertRowid });
});

// Cambia el estado de un pedido; si pasa a DELIVERED registra la hora de entrega
router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['IN_HUB','COLLECTED','IN_TRANSIT','DELIVERED'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  // Al marcar como entregado se registra automáticamente la hora actual
  const extra = status === 'DELIVERED'
    ? ", delivered_at = datetime('now')"
    : '';

  db.prepare(`UPDATE orders SET status = ?${extra} WHERE id = ?`).run(status, req.params.id);
  res.json({ ok: true });
});

// Elimina un pedido y sus segmentos de ruta asociados (el motor GPS los usa)
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM route_segments WHERE order_id=?').run(req.params.id);
  db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
