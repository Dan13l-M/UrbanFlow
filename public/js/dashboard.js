/**
 * dashboard.js — Lógica principal del panel de operaciones.
 *
 * Responsabilidades:
 *  - Autenticación con la API y almacenamiento del JWT en localStorage
 *  - Inicialización del mapa Mapbox con capa heatmap de demanda
 *  - Carga y renderizado de pedidos con filtros de prioridad y estado
 *  - Actualización de KPIs (tarjetas de métricas)
 *  - Marcadores de vehículos (íconos SVG) y marcadores de destino (ping animado)
 *  - Conexión Socket.IO para recibir posiciones GPS y cambios de estado en tiempo real
 *  - Panel lateral de detalles de pedido y formulario de nuevo pedido
 */

const TOKEN_KEY = 'uf_token';
let token = localStorage.getItem(TOKEN_KEY);
let allOrders = [];       // Caché local de todos los pedidos cargados
let selectedOrderId = null;
let map;
let driversLayer = {};        // { driverId: mapboxgl.Marker } — marcadores de vehículos
let destinationMarkers = {};  // { orderId: mapboxgl.Marker }  — marcadores de destino

// ── Inicialización ───────────────────────────────────────────────────────────

// Al cargar la página: autentica si no hay token, luego arranca todos los módulos
(async function init() {
  if (!token) {
    const pwd = prompt('Contraseña de acceso:');
    if (!pwd) return;
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    if (!res.ok) { alert('Contraseña incorrecta'); return; }
    const data = await res.json();
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
  }
  initMap();
  loadOrders();
  loadDrivers();
  connectSocket();
  // Refresca la lista de pedidos cada 10 segundos para mantener los datos actualizados
  setInterval(loadOrders, 10000);
})();

// Devuelve las cabeceras HTTP con el token JWT para peticiones autenticadas
function authHeaders() {
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

// ── Mapa Mapbox ──────────────────────────────────────────────────────────────

/**
 * Inicializa el mapa Mapbox GL JS con tema oscuro.
 * Agrega una capa heatmap que muestra la concentración de destinos de pedidos.
 * El token se inyecta desde el servidor como window.__MAPBOX_TOKEN__.
 */
function initMap() {
  mapboxgl.accessToken = window.__MAPBOX_TOKEN__ || '';
  map = new mapboxgl.Map({
    container: 'map-urbanflow',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-99.1332, 19.4326], // Centro de CDMX
    zoom: 12
  });

  map.on('load', () => {
    // Fuente de datos GeoJSON para el heatmap; se actualiza al cargar pedidos
    map.addSource('orders-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    // Capa heatmap: muestra dónde se concentran los destinos de entrega
    map.addLayer({
      id: 'demand-heatmap',
      type: 'heatmap',
      source: 'orders-source',
      paint: {
        'heatmap-intensity': 1.2,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0,   'rgba(0,0,0,0)',
          0.4, 'rgba(88,166,255,0.4)',
          1,   'rgba(248,81,73,0.9)'
        ],
        'heatmap-radius': 25
      }
    });

    map.addSource('fleet-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    // Si los pedidos cargaron antes de que el mapa terminara de inicializarse,
    // coloca los marcadores de destino ahora que el mapa está listo
    updateDestinationMarkers(allOrders);
  });
}

// ── Pedidos ──────────────────────────────────────────────────────────────────

/**
 * Carga pedidos desde la API aplicando los filtros activos del formulario.
 * Actualiza la tabla, los KPIs, el heatmap y los marcadores de destino.
 */
async function loadOrders() {
  const prio = document.getElementById('filter-priority').value;
  const stat = document.getElementById('filter-status').value;
  let url = '/api/orders?';
  if (prio) url += 'priority=' + prio + '&';
  if (stat) url += 'status=' + stat;

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return;
  allOrders = await res.json();
  renderOrders(allOrders);
  updateKPIs(allOrders);
  updateHeatmap(allOrders);
  updateDestinationMarkers(allOrders);
}

/**
 * Renderiza la tabla de pedidos en el panel lateral izquierdo.
 * Cada fila es clicable y abre el overlay con los detalles del pedido.
 */
function renderOrders(orders) {
  document.getElementById('orders-count').textContent = orders.length + ' pedidos';
  const tbody = document.getElementById('orders-tbody');
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted);text-align:center;padding:20px">Sin pedidos</td></tr>';
    return;
  }
  tbody.innerHTML = orders.map(o => `
    <tr onclick="selectOrder(${o.id})" style="${selectedOrderId===o.id?'background:var(--bg-card)':''}">
      <td>#${o.id}</td>
      <td><span class="badge badge-${o.priority}">${labelPriority(o.priority)}</span></td>
      <td><span class="badge badge-${o.status}">${labelStatus(o.status)}</span></td>
      <td>${o.weight_kg}kg</td>
    </tr>
  `).join('');
}

/**
 * Actualiza las cuatro tarjetas de métricas (KPIs) en el encabezado del panel.
 *  - Pedidos activos (IN_TRANSIT)
 *  - Pedidos Flash pendientes
 *  - ETA promedio de todos los pedidos con tiempo asignado
 *  - Porcentaje de cumplimiento (entregados / total)
 */
function updateKPIs(orders) {
  const active    = orders.filter(o => o.status === 'IN_TRANSIT').length;
  const flash     = orders.filter(o => o.priority === 'FLASH' && o.status !== 'DELIVERED').length;
  const withETA   = orders.filter(o => o.eta_minutes);
  const avgETA    = withETA.length
    ? Math.round(withETA.reduce((s, o) => s + o.eta_minutes, 0) / withETA.length)
    : '—';
  const delivered   = orders.filter(o => o.status === 'DELIVERED').length;
  const compliance  = orders.length ? Math.round(delivered / orders.length * 100) + '%' : '—';

  document.getElementById('kpi-active').textContent     = active;
  document.getElementById('kpi-flash').textContent      = flash;
  document.getElementById('kpi-eta').textContent        = avgETA === '—' ? '—' : avgETA + 'm';
  document.getElementById('kpi-compliance').textContent = compliance;
  document.getElementById('foot-delivered').textContent = delivered;
  document.getElementById('foot-compliance').textContent = compliance;
}

/**
 * Actualiza la fuente de datos del heatmap con los destinos de los pedidos actuales.
 * Cada pedido con coordenadas agrega un punto de calor en el mapa.
 */
function updateHeatmap(orders) {
  if (!map || !map.getSource('orders-source')) return;
  const features = orders
    .filter(o => o.destination_lat && o.destination_lng)
    .map(o => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [o.destination_lng, o.destination_lat] },
      properties: {}
    }));
  map.getSource('orders-source').setData({ type: 'FeatureCollection', features });
}

// ── Marcadores de repartidores ───────────────────────────────────────────────

/**
 * Carga repartidores desde la API, actualiza el contador de flota activa
 * y coloca sus marcadores en el mapa. Espera a que el mapa esté listo.
 */
async function loadDrivers() {
  const res = await fetch('/api/drivers', { headers: authHeaders() });
  if (!res.ok) return;
  const drivers = await res.json();

  // Muestra cuántos repartidores están en ruta vs el total
  const active = drivers.filter(d => !d.is_available).length;
  document.getElementById('foot-fleet').textContent = active + '/' + drivers.length;

  if (!map) return;
  map.once('load', () => placeDriverMarkers(drivers));
  if (map.loaded()) placeDriverMarkers(drivers);
}

/**
 * Crea o mueve los marcadores SVG de cada repartidor en el mapa.
 * Si el marcador ya existe, solo actualiza su posición (evita recrearlo).
 * Cada marcador muestra un popup con nombre, tipo de vehículo y disponibilidad.
 */
function placeDriverMarkers(drivers) {
  const vehicleEmoji = { BICYCLE: '🚲', MOTORCYCLE: '🏍', VAN: '🚐' };

  drivers.forEach(d => {
    if (!d.lat || !d.lng) return;
    const iconSrc = '/icons/' + (d.vehicle_type || 'motorcycle').toLowerCase() + '.svg';

    if (driversLayer[d.id]) {
      // El marcador ya existe: solo actualiza su posición GPS
      driversLayer[d.id].setLngLat([d.lng, d.lat]);
    } else {
      // Crea el elemento HTML del marcador con el ícono SVG del vehículo
      const el = document.createElement('div');
      el.style.cssText = 'width:28px;height:28px;cursor:pointer';
      el.innerHTML = `<img src="${iconSrc}" width="28" height="28" title="${d.name}">`;

      const emoji = vehicleEmoji[d.vehicle_type] || '🚗';
      const statusColor = d.is_available ? 'var(--accent-green)' : 'var(--accent-yellow)';
      const statusLabel = d.is_available ? 'Disponible' : 'En tránsito';

      // Popup con información del repartidor; usa clases CSS del tema oscuro
      const popup = new mapboxgl.Popup({ offset: 20, closeButton: true })
        .setHTML(`
          <div class="popup-name">${d.name}</div>
          <div class="popup-sub">${emoji} ${d.vehicle_type}</div>
          <div class="popup-status" style="color:${statusColor}">${statusLabel}</div>
        `);

      driversLayer[d.id] = new mapboxgl.Marker({ element: el })
        .setLngLat([d.lng, d.lat])
        .setPopup(popup)
        .addTo(map);
    }
  });
}

// ── Marcadores de destino ────────────────────────────────────────────────────

// SVG de ícono de paquete (Feather Icons) que se muestra dentro del marcador azul
const PKG_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';

/**
 * Sincroniza los marcadores de destino en el mapa con el estado actual de los pedidos.
 *
 * - Elimina marcadores de pedidos que ya fueron entregados o que no existen
 * - Agrega marcadores nuevos para pedidos activos sin marcador
 * - Cada marcador es un punto azul pulsante con ícono de paquete;
 *   al hacer clic abre el overlay de detalles del pedido
 */
function updateDestinationMarkers(orders) {
  if (!map || !map.loaded()) return;

  // Calcula qué IDs deben tener marcador (todos excepto los entregados)
  const activeIds = new Set(
    orders.filter(o => o.status !== 'DELIVERED').map(o => o.id)
  );

  // Remueve marcadores de pedidos que ya no están activos
  Object.keys(destinationMarkers).forEach(id => {
    if (!activeIds.has(parseInt(id))) {
      destinationMarkers[id].remove();
      delete destinationMarkers[id];
    }
  });

  // Agrega marcadores para pedidos activos que aún no tienen marcador
  orders
    .filter(o => o.status !== 'DELIVERED' && !destinationMarkers[o.id])
    .forEach(o => {
      if (!o.destination_lat || !o.destination_lng) return;

      // El marcador tiene dos capas: el anillo de ping (animado) y el punto central con ícono
      const el = document.createElement('div');
      el.className = 'dest-marker';
      el.innerHTML = `<div class="dest-ping"></div><div class="dest-dot">${PKG_SVG}</div>`;

      // Al hacer clic en el destino se abre el panel lateral con los detalles del pedido
      el.addEventListener('click', () => selectOrder(o.id));

      destinationMarkers[o.id] = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([o.destination_lng, o.destination_lat])
        .addTo(map);
    });
}

// ── Socket.IO (tiempo real) ──────────────────────────────────────────────────

/**
 * Conecta al servidor Socket.IO y se une a la sala "operators".
 * Escucha tres eventos:
 *  - fleet:position  → mueve el marcador del vehículo en el mapa
 *  - order:updated   → actualiza el estado de un pedido en la tabla sin recargar todo
 *  - order:delivered → recarga la lista completa y cierra el overlay si corresponde
 */
function connectSocket() {
  const socket = io();
  socket.emit('join:operators'); // Se une al canal de operadores para recibir eventos de flota

  socket.on('fleet:position', ({ driverId, lat, lng }) => {
    // Mueve el marcador del repartidor a la nueva coordenada GPS
    if (driversLayer[driverId]) {
      driversLayer[driverId].setLngLat([lng, lat]);
    }
  });

  socket.on('order:updated', ({ orderId, status }) => {
    // Actualiza solo el pedido afectado en el array local y vuelve a renderizar
    const idx = allOrders.findIndex(o => o.id === orderId);
    if (idx !== -1) { allOrders[idx].status = status; renderOrders(allOrders); }
  });

  socket.on('order:delivered', ({ orderId }) => {
    // Recarga datos frescos y cierra el overlay si el pedido entregado estaba seleccionado
    loadOrders();
    if (selectedOrderId === orderId) closeOverlay();
  });
}

// ── Panel lateral de detalles ────────────────────────────────────────────────

/**
 * Abre el overlay lateral con los detalles del pedido seleccionado.
 * Mueve el mapa para centrar el destino del pedido.
 *
 * @param {number} id - ID del pedido a mostrar
 */
function selectOrder(id) {
  selectedOrderId = id;
  const o = allOrders.find(x => x.id === id);
  if (!o) return;

  document.getElementById('overlay-id').textContent       = 'Pedido #' + o.id;
  document.getElementById('overlay-category').textContent = labelCategory(o.category);
  document.getElementById('overlay-driver').textContent   = o.driver_name || 'Sin asignar';
  document.getElementById('overlay-status').innerHTML     = `<span class="badge badge-${o.status}">${labelStatus(o.status)}</span>`;
  document.getElementById('overlay-eta').textContent      = o.eta_minutes || '—';
  document.getElementById('overlay-new-status').value     = o.status;
  document.getElementById('order-overlay').classList.add('visible');

  // Centra el mapa en el destino del pedido con zoom
  if (o.destination_lat && map) {
    map.flyTo({ center: [o.destination_lng, o.destination_lat], zoom: 14, speed: 1.2 });
  }
}

// Cierra el panel lateral de detalles
function closeOverlay() {
  selectedOrderId = null;
  document.getElementById('order-overlay').classList.remove('visible');
}

/**
 * Envía el cambio de estado del pedido seleccionado a la API
 * y recarga la lista al confirmar.
 */
async function updateSelectedStatus() {
  if (!selectedOrderId) return;
  const status = document.getElementById('overlay-new-status').value;
  await fetch('/api/orders/' + selectedOrderId + '/status', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status })
  });
  loadOrders();
  closeOverlay();
}

// ── Modal de nuevo pedido ────────────────────────────────────────────────────

// Muestra el modal para crear un pedido nuevo
function openNewOrderModal() {
  document.getElementById('modal-new-order').classList.add('visible');
}

// Oculta cualquier modal dado su ID
function closeModal(id) {
  document.getElementById(id).classList.remove('visible');
}

/**
 * Valida y envía el formulario de nuevo pedido.
 * Verifica peso positivo y coordenadas dentro de rango válido.
 */
async function submitNewOrder() {
  const weight = parseFloat(document.getElementById('new-weight').value);
  const lat    = parseFloat(document.getElementById('new-lat').value);
  const lng    = parseFloat(document.getElementById('new-lng').value);

  let valid = true;
  if (!weight || weight <= 0) {
    document.getElementById('err-weight').style.display = 'block'; valid = false;
  } else { document.getElementById('err-weight').style.display = 'none'; }
  if (lat < -90 || lat > 90) {
    document.getElementById('err-lat').style.display = 'block'; valid = false;
  } else { document.getElementById('err-lat').style.display = 'none'; }
  if (lng < -180 || lng > 180) {
    document.getElementById('err-lng').style.display = 'block'; valid = false;
  } else { document.getElementById('err-lng').style.display = 'none'; }

  if (!valid) return;

  await fetch('/api/orders', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      priority:        document.getElementById('new-priority').value,
      category:        document.getElementById('new-category').value,
      weight_kg:       weight,
      destination_lat: lat,
      destination_lng: lng
    })
  });
  closeModal('modal-new-order');
  loadOrders();
}

// ── Auto-despacho ────────────────────────────────────────────────────────────

/**
 * Despacha automáticamente el primer pedido en estado IN_HUB.
 * Llama al endpoint de dispatch que asigna al repartidor más cercano disponible.
 */
async function autoDispatch() {
  const hub = allOrders.find(o => o.status === 'IN_HUB');
  if (!hub) { alert('No hay pedidos en hub disponibles'); return; }

  const btn = document.getElementById('btn-dispatch');
  btn.disabled = true;
  btn.textContent = 'Despachando...';

  const res = await fetch('/api/dispatch/' + hub.id, { method: 'POST', headers: authHeaders() });
  btn.disabled = false;
  btn.textContent = '⚡ Auto-despachar';

  if (!res.ok) {
    const err = await res.json();
    alert(err.error || 'Error al despachar');
    return;
  }
  loadOrders();
}

// Reactiva la carga al cambiar los filtros del formulario
document.getElementById('filter-priority').addEventListener('change', loadOrders);
document.getElementById('filter-status').addEventListener('change', loadOrders);

// ── Helpers de etiquetas ─────────────────────────────────────────────────────
function labelPriority(p) { return { FLASH:'Flash', STANDARD:'Estándar', SCHEDULED:'Programado' }[p] || p; }
function labelStatus(s)   { return { IN_HUB:'En Hub', COLLECTED:'Recogido', IN_TRANSIT:'En Camino', DELIVERED:'Entregado' }[s] || s; }
function labelCategory(c) { return { FOOD:'Alimentos', ELECTRONICS:'Electrónica', DOCUMENTS:'Documentos' }[c] || c; }
