# UrbanFlow

Sistema de gestión de flota urbana de última milla. Permite crear pedidos, asignar repartidores automáticamente, rastrear vehículos en tiempo real sobre un mapa interactivo y consultar reportes de productividad.

---

## Arquitectura

```
UrbanFlow/
├── server.js              # Punto de entrada: Express + Socket.IO + motor GPS
├── db.js                  # Conexión SQLite, esquema DDL y datos iniciales
├── routes/
│   ├── orders.js          # CRUD de pedidos + cambio de estado
│   ├── drivers.js         # CRUD de repartidores
│   ├── vehicles.js        # CRUD de vehículos
│   ├── dispatch.js        # Motor de despacho automático
│   └── reports.js         # Reportes de productividad y volumen
└── public/
    ├── index.html          # Dashboard principal
    ├── admin.html          # Administración de flota
    ├── reports.html        # Panel de reportes
    ├── css/style.css       # Estilos globales (tema oscuro)
    ├── js/
    │   ├── dashboard.js    # Mapa Mapbox, pedidos, Socket.IO
    │   ├── admin.js        # CRUD frontend de vehículos y repartidores
    │   └── reports.js      # Gráficas y exportación CSV
    └── icons/              # SVG de bicicleta, motocicleta y camioneta
```

### Patrón de capas

| Capa | Responsabilidad |
|------|----------------|
| **Rutas** (`routes/`) | Controladores HTTP — validan entrada, ejecutan consultas, devuelven JSON |
| **Modelo** (`db.js`) | Esquema SQLite y seed de datos iniciales; expone la conexión sincrónica |
| **Vista** (`public/`) | HTML + JS + CSS del cliente; consume la API REST y Socket.IO |

### Flujo de un pedido

```
Cliente → POST /api/orders
        → POST /api/dispatch/:id
              ├─ Haversine: filtra repartidores por distancia y capacidad
              ├─ Mapbox Directions API: obtiene ruta real (fallback línea recta)
              └─ Guarda route_segments, actualiza order + driver
        → setInterval(3 s): avanza current_step en route_segments
              └─ Socket.IO "fleet:position" → marcador del mapa se mueve
        → step >= path.length → order DELIVERED, driver disponible
```

### Comunicación en tiempo real

El servidor mantiene una sala Socket.IO llamada `operators`. El cliente se une al conectar (`join:operators`). El motor GPS emite eventos cada 3 segundos:

- `fleet:position` — lat/lng/heading/speed de cada vehículo en tránsito
- `order:delivered` — notifica entrega completada
- `order:updated` — cambio de estado de un pedido

---

## Tecnología

| Tecnología | Versión | Por qué |
|---|---|---|
| **Node.js + Express** | 4.x | Servidor HTTP minimalista; ideal para APIs REST pequeñas sin overhead de frameworks grandes |
| **better-sqlite3** | 9.x | SQLite sincrónico — elimina callbacks/promises en consultas DB, simplifica la lógica del motor GPS que corre en `setInterval` |
| **Socket.IO** | 4.x | WebSocket con fallback automático a long-polling; sala `operators` permite broadcast selectivo sin mantener estado de sesión |
| **helmet** | 7.x | Cabeceras HTTP de seguridad (X-Frame-Options, HSTS, etc.) con un solo `use()` |
| **express-rate-limit** | 7.x | Protege endpoints contra abuso; 300 req / 15 min por IP |
| **cors** | 2.x | Restringe origen al mismo `localhost:PORT` |
| **dotenv** | 16.x | Variables de entorno fuera del código fuente |
| **Mapbox GL JS** | 3.3.0 (CDN) | Mapa vectorial dark-mode, capa heatmap y marcadores SVG animados sin dependencia npm en el cliente |
| **Chart.js** | 4.4.0 (CDN) | Gráficas de barras y línea responsivas con mínimo código de configuración |

**SQLite** se eligió sobre una base de datos cliente-servidor porque el proyecto es de entorno local / académico — no hay múltiples procesos escribiendo concurrentemente y `WAL mode` es suficiente para las escrituras del motor GPS.

---

## Requisitos

- Node.js 18 o superior
- Una cuenta gratuita en [mapbox.com](https://www.mapbox.com/) para obtener un access token

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone <url-del-repositorio>
cd UrbanFlow
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Copia el archivo de ejemplo y edítalo:

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Abre `.env` y completa los valores:

```env
MAPBOX_TOKEN=pk.eyJ1...    # Token de Mapbox (público, empieza con pk.)
PORT=3000
```

> **Cómo obtener el token de Mapbox:**  
> Inicia sesión en mapbox.com → Account → Tokens → copia el "Default public token" o crea uno nuevo.

### 4. Iniciar el servidor

```bash
npm start
```

O en modo desarrollo con recarga automática:

```bash
npm run dev
```

La base de datos `urbanflow.db` se crea automáticamente al primer inicio con datos de prueba (8 repartidores, 5 vehículos, 10 pedidos en distintos estados).

---

## Uso

Abre el navegador en `http://localhost:3000`.

### Páginas disponibles

| URL | Descripción |
|-----|-------------|
| `/` | Dashboard — mapa en vivo, KPIs, tabla de pedidos |
| `/admin.html` | Administración de vehículos y repartidores |
| `/reports.html` | Reportes de productividad con gráficas y exportación CSV |

### Flujo de prueba básico

1. Abre el **Dashboard** (`/`)
2. Haz clic en **+ Nuevo Pedido** y completa el formulario
3. Con el pedido creado (estado `IN_HUB`), haz clic en **Despachar** en la fila de la tabla
4. El sistema asigna automáticamente al repartidor más cercano con capacidad disponible
5. El marcador del vehículo comienza a moverse en el mapa cada 3 segundos
6. Cuando llega al destino, el estado cambia a `DELIVERED` y el marcador desaparece
7. Consulta el panel de **Reportes** (`/reports.html`) para ver estadísticas

### Administración de flota

Desde `/admin.html` puedes:

- Agregar, editar y eliminar vehículos (BICYCLE / MOTORCYCLE / VAN)
- Agregar, editar y eliminar repartidores con asignación de turno y vehículo
- Navegar por páginas (10 registros por página)

---

## Estructura de la base de datos

```sql
vehicles        -- id, type, capacity_kg, autonomy_km
drivers         -- id, name, shift, rating, is_available, vehicle_id
orders          -- id, priority, status, category, weight_kg, destination, driver_id, vehicle_id, eta
driver_locations -- driver_id (PK), lat, lng, heading_deg, updated_at
route_segments  -- id, order_id, path_json, current_step
```

---

## Variables de entorno

| Variable | Descripción | Requerida |
|---|---|---|
| `MAPBOX_TOKEN` | Access token público de Mapbox | Sí |
| `PORT` | Puerto HTTP (default: 3000) | No |
