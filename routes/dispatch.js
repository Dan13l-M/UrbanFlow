const express = require('express');
const fetch = require('node-fetch');
const db = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.use(authenticate);

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

router.post('/:orderId', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status !== 'IN_HUB' && order.status !== 'COLLECTED') {
    return res.status(400).json({ error: 'El pedido no está disponible para despacho' });
  }

  const drivers = db.prepare(`
    SELECT d.*, l.lat, l.lng, v.type as vehicle_type, v.capacity_kg
    FROM drivers d
    JOIN driver_locations l ON d.id = l.driver_id
    JOIN vehicles v ON d.vehicle_id = v.id
    WHERE d.is_available = 1
  `).all();

  if (!drivers.length) return res.status(409).json({ error: 'No hay repartidores disponibles' });

  const eligible = drivers
    .filter(d => d.capacity_kg >= order.weight_kg)
    .map(d => ({
      ...d,
      distance: haversine(d.lat, d.lng, order.destination_lat, order.destination_lng)
    }))
    .sort((a, b) => a.distance - b.distance);

  if (!eligible.length) return res.status(409).json({ error: 'Ningún vehículo con capacidad suficiente' });

  const driver = eligible[0];

  let path = [[driver.lng, driver.lat], [order.destination_lng, order.destination_lat]];
  let distance_m = driver.distance * 1000;
  let duration_s = Math.round(distance_m / 10);
  let eta_minutes = Math.ceil(duration_s / 60);

  try {
    const coords = `${driver.lng},${driver.lat};${order.destination_lng},${order.destination_lat}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&access_token=${process.env.MAPBOX_TOKEN}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.routes && data.routes[0]) {
      path = data.routes[0].geometry.coordinates;
      distance_m = data.routes[0].distance;
      duration_s = data.routes[0].duration;
      eta_minutes = Math.ceil(duration_s / 60);
    }
  } catch (e) {
    // fallback: straight line already set above
  }

  db.prepare(`
    INSERT INTO route_segments (order_id, path_json, distance_m, duration_s, current_step)
    VALUES (?,?,?,?,0)
  `).run(order.id, JSON.stringify(path), distance_m, duration_s);

  db.prepare(`
    UPDATE orders SET status='IN_TRANSIT', driver_id=?, vehicle_id=?,
      eta_minutes=?, assigned_at=datetime('now') WHERE id=?
  `).run(driver.id, driver.vehicle_id, eta_minutes, order.id);

  db.prepare('UPDATE drivers SET is_available=0 WHERE id=?').run(driver.id);

  res.json({ ok: true, driver_id: driver.id, eta_minutes, path_length: path.length });
});

module.exports = router;
