const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.use(authenticate);

router.get('/', (req, res) => {
  const vehicles = db.prepare('SELECT * FROM vehicles').all();
  res.json(vehicles);
});

router.post('/', (req, res) => {
  const { type, capacity_kg, autonomy_km } = req.body;
  if (!['BICYCLE','MOTORCYCLE','VAN'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  const result = db.prepare(
    'INSERT INTO vehicles (type, capacity_kg, autonomy_km) VALUES (?,?,?)'
  ).run(type, capacity_kg, autonomy_km);
  res.status(201).json({ id: result.lastInsertRowid, type, capacity_kg, autonomy_km });
});

router.put('/:id', (req, res) => {
  const { type, capacity_kg, autonomy_km } = req.body;
  db.prepare(
    'UPDATE vehicles SET type=?, capacity_kg=?, autonomy_km=? WHERE id=?'
  ).run(type, capacity_kg, autonomy_km, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM vehicles WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
