require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const server = http.createServer(app);

// Socket.IO montado sobre el mismo servidor HTTP; permite conexiones desde cualquier origen
const io = new Server(server, { cors: { origin: '*' } });

// ── Seguridad ────────────────────────────────────────────────────────────────

// Helmet añade cabeceras HTTP de seguridad (X-Frame-Options, HSTS, etc.)
// CSP deshabilitado porque Mapbox GL JS requiere scripts inline
app.use(helmet({ contentSecurityPolicy: false }));

// CORS restringido al mismo host; evita peticiones de otros orígenes
app.use(cors({ origin: 'http://localhost:' + (process.env.PORT || 3000) }));

// Limita el tamaño del body a 10 kb para prevenir ataques de payload gigante
app.use(express.json({ limit: '10kb' }));

// Rate limiting: máximo 300 peticiones por IP cada 15 minutos
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// ── Inyección del token de Mapbox en el HTML ─────────────────────────────────
const fs = require('fs');

/**
 * Genera un handler Express que sirve un archivo HTML con el token de Mapbox
 * inyectado como variable global antes del cierre de </head>.
 *
 * El token no puede estar en el HTML estático porque es una variable de entorno;
 * esta función lo inserta en tiempo de ejecución antes de enviar la respuesta.
 *
 * @param {string} filename - Nombre del archivo HTML dentro de /public
 * @returns {Function} Handler (req, res) listo para usar en app.get()
 */
function injectToken(filename) {
  return (req, res) => {
    const html = fs.readFileSync('./public/' + filename, 'utf8');
    const injected = html.replace('</head>',
      `<script>window.__MAPBOX_TOKEN__="${process.env.MAPBOX_TOKEN}"</script></head>`);
    res.send(injected);
  };
}

// Las rutas HTML deben registrarse ANTES de express.static para que el middleware
// de inyección intercepte la petición antes de que el servidor de archivos estáticos
// devuelva el HTML crudo sin el token
app.get('/', injectToken('index.html'));
app.get('/index.html', injectToken('index.html'));
app.get('/admin.html', injectToken('admin.html'));
app.get('/reports.html', injectToken('reports.html'));

// Archivos estáticos (CSS, JS, íconos); se registra después de las rutas HTML
app.use(express.static('public'));

// ── Rutas de la API ──────────────────────────────────────────────────────────
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/drivers',  require('./routes/drivers'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/dispatch', require('./routes/dispatch'));
app.use('/api/reports',  require('./routes/reports'));

// Rutas de acceso directo sin extensión .html
app.get('/admin',   (req, res) => res.redirect('/admin.html'));
app.get('/reports', (req, res) => res.redirect('/reports.html'));

// ── Socket.IO ────────────────────────────────────────────────────────────────

// Cada cliente del dashboard se une a la sala "operators" al conectarse.
// El motor GPS usa esta sala para hacer broadcast solo a clientes del panel.
io.on('connection', (socket) => {
  socket.on('join:operators', () => socket.join('operators'));
});

// ── Motor GPS (simulación de movimiento) ─────────────────────────────────────

// Pasos que avanza cada vehículo por tick (3 segundos):
// Bicicleta más lenta (1 paso), moto y camioneta más rápidas (2 pasos)
const STEPS = { BICYCLE: 1, MOTORCYCLE: 2, VAN: 2 };

// El motor corre cada 3 segundos y procesa todos los pedidos en tránsito
setInterval(() => {
  // Obtiene todos los pedidos activos con su ruta y posición actual en la trayectoria
  const activeOrders = db.prepare(`
    SELECT o.id as order_id, o.driver_id, v.type as vehicle_type,
           rs.id as seg_id, rs.path_json, rs.current_step
    FROM orders o
    JOIN route_segments rs ON rs.order_id = o.id
    JOIN drivers d ON d.id = o.driver_id
    JOIN vehicles v ON v.id = o.vehicle_id
    WHERE o.status = 'IN_TRANSIT' AND o.driver_id IS NOT NULL
  `).all();

  for (const order of activeOrders) {
    const path = JSON.parse(order.path_json);
    const steps = STEPS[order.vehicle_type] || 1;
    const next = order.current_step + steps;

    if (next >= path.length) {
      // El vehículo llegó al destino: marca el pedido como entregado
      db.prepare("UPDATE orders SET status='DELIVERED', delivered_at=datetime('now') WHERE id=?").run(order.order_id);
      db.prepare('UPDATE drivers SET is_available=1 WHERE id=?').run(order.driver_id);
      db.prepare('DELETE FROM route_segments WHERE id=?').run(order.seg_id);

      // Fija la posición GPS del repartidor en el punto final de la ruta
      const [lng, lat] = path[path.length - 1];
      db.prepare("UPDATE driver_locations SET lat=?, lng=?, updated_at=datetime('now') WHERE driver_id=?")
        .run(lat, lng, order.driver_id);

      // Notifica al dashboard que el pedido fue entregado
      io.to('operators').emit('order:delivered', { orderId: order.order_id, driverId: order.driver_id });
      io.to('operators').emit('order:updated', { orderId: order.order_id, status: 'DELIVERED' });
    } else {
      // Avanza la posición en la trayectoria guardada
      db.prepare('UPDATE route_segments SET current_step=? WHERE id=?').run(next, order.seg_id);

      const [lng, lat] = path[next];
      const [prevLng, prevLat] = path[Math.max(0, next - 1)];

      // Calcula el ángulo de orientación del vehículo respecto al paso anterior
      const heading = Math.atan2(lng - prevLng, lat - prevLat) * 180 / Math.PI;

      // Actualiza la ubicación GPS del repartidor en la base de datos
      db.prepare("UPDATE driver_locations SET lat=?, lng=?, heading_deg=?, updated_at=datetime('now') WHERE driver_id=?")
        .run(lat, lng, heading, order.driver_id);

      // Emite la posición actualizada al dashboard para mover el marcador en el mapa
      io.to('operators').emit('fleet:position', {
        driverId: order.driver_id,
        lat, lng,
        heading,
        speed: order.vehicle_type === 'BICYCLE' ? 15 : 40
      });
    }
  }
}, 3000);

// ── Inicio del servidor ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`UrbanFlow running on http://localhost:${PORT}`));
