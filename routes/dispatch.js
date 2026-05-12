/**
 * Motor de despacho automático.
 * Asigna el repartidor más cercano con capacidad suficiente a un pedido,
 * obtiene la ruta real de Mapbox Directions API y registra los segmentos
 * que el motor GPS consumirá para simular el movimiento del vehículo.
 *
 * POST /api/dispatch/:orderId
 */
const express = require('express');
const fetch = require('node-fetch');
const db = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

// Aplica autenticación JWT a todas las rutas de este router
router.use(authenticate);

/**
 * Calcula la distancia en kilómetros entre dos coordenadas geográficas
 * usando la fórmula de Haversine (asume la Tierra como esfera perfecta).
 *
 * @param {number} lat1 - Latitud del punto de origen
 * @param {number} lng1 - Longitud del punto de origen
 * @param {number} lat2 - Latitud del punto de destino
 * @param {number} lng2 - Longitud del punto de destino
 * @returns {number} Distancia en kilómetros
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Despacha un pedido al repartidor óptimo disponible
router.post('/:orderId', async (req, res) => {
  // Verifica que el pedido exista y esté en un estado despachable
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status !== 'IN_HUB' && order.status !== 'COLLECTED') {
    return res.status(400).json({ error: 'El pedido no está disponible para despacho' });
  }

  // Obtiene repartidores disponibles con su vehículo y ubicación GPS actual
  const drivers = db.prepare(`
    SELECT d.*, l.lat, l.lng, v.type as vehicle_type, v.capacity_kg
    FROM drivers d
    JOIN driver_locations l ON d.id = l.driver_id
    JOIN vehicles v ON d.vehicle_id = v.id
    WHERE d.is_available = 1
  `).all();

  if (!drivers.length) return res.status(409).json({ error: 'No hay repartidores disponibles' });

  // Filtra por capacidad de carga y ordena por distancia Haversine al destino
  const eligible = drivers
    .filter(d => d.capacity_kg >= order.weight_kg)
    .map(d => ({
      ...d,
      distance: haversine(d.lat, d.lng, order.destination_lat, order.destination_lng)
    }))
    .sort((a, b) => a.distance - b.distance);

  if (!eligible.length) return res.status(409).json({ error: 'Ningún vehículo con capacidad suficiente' });

  // El primer elemento es el repartidor más cercano con capacidad
  const driver = eligible[0];

  // Valores por defecto: ruta en línea recta a 36 km/h (10 m/s)
  let path = [[driver.lng, driver.lat], [order.destination_lng, order.destination_lat]];
  let distance_m = driver.distance * 1000;
  let duration_s = Math.round(distance_m / 10);
  let eta_minutes = Math.ceil(duration_s / 60);

  try {
    // Intenta obtener ruta real de Mapbox Directions API con geometría detallada
    const coords = `${driver.lng},${driver.lat};${order.destination_lng},${order.destination_lat}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&access_token=${process.env.MAPBOX_TOKEN}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.routes && data.routes[0]) {
      // Sobreescribe los valores de fallback con los datos reales de la ruta
      path = data.routes[0].geometry.coordinates;
      distance_m = data.routes[0].distance;
      duration_s = data.routes[0].duration;
      eta_minutes = Math.ceil(duration_s / 60);
    }
  } catch (e) {
    // Si Mapbox falla (sin internet o token inválido), usa la línea recta calculada arriba
  }

  // Guarda los puntos de la ruta; el motor GPS los leerá cada 3 segundos para avanzar
  db.prepare(`
    INSERT INTO route_segments (order_id, path_json, distance_m, duration_s, current_step)
    VALUES (?,?,?,?,0)
  `).run(order.id, JSON.stringify(path), distance_m, duration_s);

  // Actualiza el pedido con conductor, vehículo y ETA calculado
  db.prepare(`
    UPDATE orders SET status='IN_TRANSIT', driver_id=?, vehicle_id=?,
      eta_minutes=?, assigned_at=datetime('now') WHERE id=?
  `).run(driver.id, driver.vehicle_id, eta_minutes, order.id);

  // Marca al repartidor como no disponible hasta que entregue el pedido
  db.prepare('UPDATE drivers SET is_available=0 WHERE id=?').run(driver.id);

  res.json({ ok: true, driver_id: driver.id, eta_minutes, path_length: path.length });
});

module.exports = router;
