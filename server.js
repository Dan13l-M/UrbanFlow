require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Security middleware
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for Mapbox inline scripts
app.use(cors({ origin: 'http://localhost:' + (process.env.PORT || 3000) }));
app.use(express.json({ limit: '10kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// Static files
app.use(express.static('public'));

// Auth login endpoint (no JWT required)
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

// Routes
app.use('/api/orders', require('./routes/orders'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/dispatch', require('./routes/dispatch'));
app.use('/api/reports', require('./routes/reports'));

// Redirect root paths to index
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/reports', (req, res) => res.redirect('/reports.html'));

// Socket.IO
io.on('connection', (socket) => {
  socket.on('join:operators', () => socket.join('operators'));
});

// GPS Simulation Engine
const STEPS = { BICYCLE: 1, MOTORCYCLE: 2, VAN: 2 };

setInterval(() => {
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
      db.prepare("UPDATE orders SET status='DELIVERED', delivered_at=datetime('now') WHERE id=?").run(order.order_id);
      db.prepare('UPDATE drivers SET is_available=1 WHERE id=?').run(order.driver_id);
      db.prepare('DELETE FROM route_segments WHERE id=?').run(order.seg_id);

      const [lng, lat] = path[path.length - 1];
      db.prepare("UPDATE driver_locations SET lat=?, lng=?, updated_at=datetime('now') WHERE driver_id=?")
        .run(lat, lng, order.driver_id);

      io.to('operators').emit('order:delivered', { orderId: order.order_id, driverId: order.driver_id });
      io.to('operators').emit('order:updated', { orderId: order.order_id, status: 'DELIVERED' });
    } else {
      db.prepare('UPDATE route_segments SET current_step=? WHERE id=?').run(next, order.seg_id);

      const [lng, lat] = path[next];
      const [prevLng, prevLat] = path[Math.max(0, next - 1)];
      const heading = Math.atan2(lng - prevLng, lat - prevLat) * 180 / Math.PI;

      db.prepare("UPDATE driver_locations SET lat=?, lng=?, heading_deg=?, updated_at=datetime('now') WHERE driver_id=?")
        .run(lat, lng, heading, order.driver_id);

      io.to('operators').emit('fleet:position', {
        driverId: order.driver_id,
        lat, lng,
        heading,
        speed: order.vehicle_type === 'BICYCLE' ? 15 : 40
      });
    }
  }
}, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`UrbanFlow running on http://localhost:${PORT}`));
