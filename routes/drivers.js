/**
 * Rutas de gestión de repartidores.
 * Todas requieren token JWT válido (middleware authenticate).
 *
 * GET    /api/drivers      - Lista repartidores con vehículo y ubicación GPS
 * POST   /api/drivers      - Crea un repartidor e inicializa su ubicación
 * PUT    /api/drivers/:id  - Actualiza datos del repartidor
 * DELETE /api/drivers/:id  - Elimina repartidor y su registro de ubicación
 */
const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

// Aplica autenticación JWT a todas las rutas de este router
router.use(authenticate);

// Lista todos los repartidores con su vehículo asignado y posición GPS actual
router.get('/', (req, res) => {
  const drivers = db.prepare(`
    SELECT d.*, v.type as vehicle_type,
           l.lat, l.lng, l.speed_kmh, l.heading_deg
    FROM drivers d
    LEFT JOIN vehicles v ON d.vehicle_id = v.id
    LEFT JOIN driver_locations l ON d.id = l.driver_id
  `).all();
  res.json(drivers);
});

// Crea un repartidor nuevo e inserta su ubicación inicial en el centro de CDMX
router.post('/', (req, res) => {
  const { name, shift, vehicle_id } = req.body;

  // Valida que el turno sea uno de los tres valores permitidos
  if (!['MORNING','AFTERNOON','NIGHT'].includes(shift)) {
    return res.status(400).json({ error: 'Turno inválido' });
  }

  const result = db.prepare(
    'INSERT INTO drivers (name, shift, vehicle_id) VALUES (?,?,?)'
  ).run(name, shift, vehicle_id || null);

  // Crea el registro de ubicación GPS con coordenadas del hub central (CDMX)
  // INSERT OR IGNORE evita duplicados si el registro ya existiera
  db.prepare(
    'INSERT OR IGNORE INTO driver_locations (driver_id, lat, lng) VALUES (?,?,?)'
  ).run(result.lastInsertRowid, 19.4326, -99.1332);

  res.status(201).json({ id: result.lastInsertRowid, name, shift });
});

// Actualiza nombre, turno, vehículo asignado y disponibilidad del repartidor
router.put('/:id', (req, res) => {
  const { name, shift, vehicle_id, is_available } = req.body;
  db.prepare(
    'UPDATE drivers SET name=?, shift=?, vehicle_id=?, is_available=? WHERE id=?'
  ).run(name, shift, vehicle_id || null, is_available ?? 1, req.params.id);
  res.json({ ok: true });
});

// Elimina repartidor y limpia su registro de ubicación GPS (cascade manual)
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM driver_locations WHERE driver_id=?').run(req.params.id);
  db.prepare('DELETE FROM drivers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
