require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database('./urbanflow.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('BICYCLE','MOTORCYCLE','VAN')),
    capacity_kg REAL NOT NULL,
    autonomy_km REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    shift TEXT NOT NULL CHECK(shift IN ('MORNING','AFTERNOON','NIGHT')),
    rating REAL DEFAULT 5.0,
    is_available INTEGER DEFAULT 1,
    vehicle_id INTEGER REFERENCES vehicles(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    priority TEXT NOT NULL CHECK(priority IN ('FLASH','STANDARD','SCHEDULED')),
    status TEXT NOT NULL DEFAULT 'IN_HUB' CHECK(status IN ('IN_HUB','COLLECTED','IN_TRANSIT','DELIVERED')),
    category TEXT NOT NULL CHECK(category IN ('ELECTRONICS','FOOD','DOCUMENTS')),
    weight_kg REAL NOT NULL,
    destination_lat REAL NOT NULL,
    destination_lng REAL NOT NULL,
    driver_id INTEGER REFERENCES drivers(id),
    vehicle_id INTEGER REFERENCES vehicles(id),
    eta_minutes INTEGER,
    received_at TEXT DEFAULT (datetime('now')),
    assigned_at TEXT,
    delivered_at TEXT
  );

  CREATE TABLE IF NOT EXISTS driver_locations (
    driver_id INTEGER PRIMARY KEY REFERENCES drivers(id),
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    speed_kmh REAL DEFAULT 0,
    heading_deg REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS route_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id),
    path_json TEXT NOT NULL,
    distance_m REAL,
    duration_s INTEGER,
    current_step INTEGER DEFAULT 0
  );
`);

function seed() {
  const count = db.prepare('SELECT COUNT(*) as n FROM vehicles').get();
  if (count.n > 0) return;

  const insertVehicle = db.prepare(
    'INSERT INTO vehicles (type, capacity_kg, autonomy_km) VALUES (?,?,?)'
  );
  insertVehicle.run('MOTORCYCLE', 30, 80);
  insertVehicle.run('MOTORCYCLE', 30, 80);
  insertVehicle.run('BICYCLE', 15, 30);
  insertVehicle.run('BICYCLE', 15, 30);
  insertVehicle.run('VAN', 500, 300);

  const insertDriver = db.prepare(
    'INSERT INTO drivers (name, shift, rating, is_available, vehicle_id) VALUES (?,?,?,?,?)'
  );
  const drivers = [
    ['Carlos Mendoza', 'MORNING', 4.8, 1, 1],
    ['Ana García', 'MORNING', 4.9, 1, 2],
    ['Luis Torres', 'AFTERNOON', 4.7, 1, 3],
    ['María López', 'AFTERNOON', 4.6, 1, 4],
    ['Pedro Ramírez', 'NIGHT', 4.5, 1, 5],
    ['Sofía Castro', 'MORNING', 4.9, 0, 1],
    ['Diego Flores', 'AFTERNOON', 4.7, 0, 3],
    ['Elena Vega', 'NIGHT', 4.8, 1, 2],
  ];
  drivers.forEach(d => insertDriver.run(...d));

  const insertLoc = db.prepare(
    'INSERT INTO driver_locations (driver_id, lat, lng) VALUES (?,?,?)'
  );
  const locs = [
    [1, 19.4326, -99.1332],
    [2, 19.4200, -99.1450],
    [3, 19.4400, -99.1200],
    [4, 19.4100, -99.1600],
    [5, 19.4500, -99.1100],
    [6, 19.4350, -99.1380],
    [7, 19.4250, -99.1500],
    [8, 19.4450, -99.1250],
  ];
  locs.forEach(l => insertLoc.run(...l));

  const insertOrder = db.prepare(`
    INSERT INTO orders (priority, status, category, weight_kg, destination_lat, destination_lng, driver_id, vehicle_id, eta_minutes, assigned_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);

  insertOrder.run('FLASH', 'IN_TRANSIT', 'FOOD', 2.5, 19.4300, -99.1400, 6, 1, 15, datetime('now'));
  insertOrder.run('STANDARD', 'IN_TRANSIT', 'DOCUMENTS', 0.5, 19.4150, -99.1550, 7, 3, 25, datetime('now'));
  insertOrder.run('FLASH', 'IN_TRANSIT', 'ELECTRONICS', 3.0, 19.4480, -99.1180, null, null, 20, null);
  insertOrder.run('STANDARD', 'IN_HUB', 'FOOD', 1.0, 19.4350, -99.1300, null, null, null, null);
  insertOrder.run('SCHEDULED', 'IN_HUB', 'DOCUMENTS', 0.3, 19.4230, -99.1420, null, null, null, null);
  insertOrder.run('FLASH', 'IN_HUB', 'ELECTRONICS', 5.0, 19.4410, -99.1350, null, null, null, null);

  const delivered = db.prepare(`
    INSERT INTO orders (priority, status, category, weight_kg, destination_lat, destination_lng, driver_id, vehicle_id, received_at, assigned_at, delivered_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now','-3 hours'),datetime('now','-2 hours'),datetime('now','-30 minutes'))
  `);
  delivered.run('STANDARD', 'DELIVERED', 'DOCUMENTS', 0.4, 19.4280, -99.1460, 1, 1);
  delivered.run('FLASH', 'DELIVERED', 'FOOD', 1.5, 19.4390, -99.1310, 2, 2);

  insertOrder.run('STANDARD', 'COLLECTED', 'ELECTRONICS', 2.0, 19.4320, -99.1380, 3, 3, 30, datetime('now'));
  insertOrder.run('SCHEDULED', 'COLLECTED', 'DOCUMENTS', 0.8, 19.4260, -99.1440, 4, 4, 40, datetime('now'));
}

function datetime(expr) {
  return db.prepare(`SELECT datetime('${expr}') as v`).get().v;
}

seed();

module.exports = db;
