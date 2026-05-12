/**
 * Rutas de reportes y estadísticas.
 * Todas requieren token JWT válido (middleware authenticate).
 *
 * GET /api/reports/productivity  - Métricas de productividad por repartidor
 * GET /api/reports/eta           - Volumen de entregas por día (últimos 30 días)
 */
const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

// Aplica autenticación JWT a todas las rutas de este router
router.use(authenticate);

/**
 * Estadísticas de productividad por repartidor.
 * Calcula total de pedidos, cantidad entregada, ETA promedio y rating.
 * Admite filtros opcionales por repartidor y rango de fechas.
 *
 * Query params:
 *  - driverId  (opcional) - filtra un repartidor específico
 *  - from      (opcional) - fecha inicio (YYYY-MM-DD)
 *  - to        (opcional) - fecha fin (YYYY-MM-DD)
 */
router.get('/productivity', (req, res) => {
  const { driverId, from, to } = req.query;

  // Agrega todos los pedidos de cada repartidor en una sola fila por conductor
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

  // Agrega filtros dinámicamente según los parámetros recibidos
  if (driverId) { sql += ' AND d.id = ?';            params.push(driverId); }
  if (from)     { sql += ' AND o.received_at >= ?';  params.push(from); }
  if (to)       { sql += ' AND o.received_at <= ?';  params.push(to); }

  // Agrupa por repartidor y ordena del más productivo al menos
  sql += ' GROUP BY d.id ORDER BY delivered DESC';

  res.json(db.prepare(sql).all(...params));
});

/**
 * Volumen de entregas completadas agrupadas por día.
 * Devuelve los últimos 30 días con al menos una entrega.
 * Usado para la gráfica de línea en el panel de reportes.
 */
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
