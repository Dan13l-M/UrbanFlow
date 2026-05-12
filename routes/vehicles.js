/**
 * Rutas de gestión de vehículos.
 * Todas requieren token JWT válido (middleware authenticate).
 *
 * GET  /api/vehicles        - Lista todos los vehículos
 * POST /api/vehicles        - Crea un vehículo nuevo
 * PUT  /api/vehicles/:id    - Actualiza un vehículo existente
 * DELETE /api/vehicles/:id  - Elimina un vehículo
 */
const express = require('express');
const db = require('../db');
const router = express.Router();

// Lista todos los vehículos registrados en el sistema
router.get('/', (req, res) => {
  const vehicles = db.prepare('SELECT * FROM vehicles').all();
  res.json(vehicles);
});

// Crea un vehículo nuevo validando que el tipo sea uno de los tres permitidos
router.post('/', (req, res) => {
  const { type, capacity_kg, autonomy_km } = req.body;

  // Solo se aceptan estos tres tipos de vehículo
  if (!['BICYCLE','MOTORCYCLE','VAN'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }

  const result = db.prepare(
    'INSERT INTO vehicles (type, capacity_kg, autonomy_km) VALUES (?,?,?)'
  ).run(type, capacity_kg, autonomy_km);

  res.status(201).json({ id: result.lastInsertRowid, type, capacity_kg, autonomy_km });
});

// Actualiza capacidad, autonomía y tipo de un vehículo por su ID
router.put('/:id', (req, res) => {
  const { type, capacity_kg, autonomy_km } = req.body;
  db.prepare(
    'UPDATE vehicles SET type=?, capacity_kg=?, autonomy_km=? WHERE id=?'
  ).run(type, capacity_kg, autonomy_km, req.params.id);
  res.json({ ok: true });
});

// Elimina un vehículo por su ID
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM vehicles WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
