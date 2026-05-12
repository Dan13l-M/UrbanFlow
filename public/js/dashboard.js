const TOKEN_KEY = 'uf_token';
let token = localStorage.getItem(TOKEN_KEY);
let allOrders = [];
let selectedOrderId = null;
let map, driversLayer = {};

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
  setInterval(loadOrders, 10000);
})();

function authHeaders() {
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

function initMap() {
  mapboxgl.accessToken = window.__MAPBOX_TOKEN__ || '';
  map = new mapboxgl.Map({
    container: 'map-urbanflow',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-99.1332, 19.4326],
    zoom: 12
  });

  map.on('load', () => {
    map.addSource('orders-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'demand-heatmap',
      type: 'heatmap',
      source: 'orders-source',
      paint: {
        'heatmap-intensity': 1.2,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.4, 'rgba(88,166,255,0.4)',
          1, 'rgba(248,81,73,0.9)'
        ],
        'heatmap-radius': 25
      }
    });

    map.addSource('fleet-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  });
}

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
}

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

function updateKPIs(orders) {
  const active = orders.filter(o => o.status === 'IN_TRANSIT').length;
  const flash = orders.filter(o => o.priority === 'FLASH' && o.status !== 'DELIVERED').length;
  const withETA = orders.filter(o => o.eta_minutes);
  const avgETA = withETA.length ? Math.round(withETA.reduce((s,o)=>s+o.eta_minutes,0)/withETA.length) : '—';
  const delivered = orders.filter(o => o.status === 'DELIVERED').length;
  const compliance = orders.length ? Math.round(delivered/orders.length*100) + '%' : '—';

  document.getElementById('kpi-active').textContent = active;
  document.getElementById('kpi-flash').textContent = flash;
  document.getElementById('kpi-eta').textContent = avgETA === '—' ? '—' : avgETA + 'm';
  document.getElementById('kpi-compliance').textContent = compliance;
  document.getElementById('foot-delivered').textContent = delivered;
  document.getElementById('foot-compliance').textContent = compliance;
}

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

async function loadDrivers() {
  const res = await fetch('/api/drivers', { headers: authHeaders() });
  if (!res.ok) return;
  const drivers = await res.json();

  const active = drivers.filter(d => !d.is_available).length;
  document.getElementById('foot-fleet').textContent = active + '/' + drivers.length;

  if (!map) return;
  map.once('load', () => placeDriverMarkers(drivers));
  if (map.loaded()) placeDriverMarkers(drivers);
}

function placeDriverMarkers(drivers) {
  drivers.forEach(d => {
    if (!d.lat || !d.lng) return;
    const iconSrc = '/icons/' + (d.vehicle_type || 'motorcycle').toLowerCase() + '.svg';
    if (driversLayer[d.id]) {
      driversLayer[d.id].setLngLat([d.lng, d.lat]);
    } else {
      const el = document.createElement('div');
      el.style.cssText = 'width:28px;height:28px;cursor:pointer';
      el.innerHTML = `<img src="${iconSrc}" width="28" height="28" title="${d.name}">`;
      driversLayer[d.id] = new mapboxgl.Marker({ element: el })
        .setLngLat([d.lng, d.lat])
        .setPopup(new mapboxgl.Popup({ offset: 15 }).setHTML(`<b>${d.name}</b><br>${d.vehicle_type}`))
        .addTo(map);
    }
  });
}

function connectSocket() {
  const socket = io();
  socket.emit('join:operators');

  socket.on('fleet:position', ({ driverId, lat, lng }) => {
    if (driversLayer[driverId]) {
      driversLayer[driverId].setLngLat([lng, lat]);
    }
  });

  socket.on('order:updated', ({ orderId, status }) => {
    const idx = allOrders.findIndex(o => o.id === orderId);
    if (idx !== -1) { allOrders[idx].status = status; renderOrders(allOrders); }
  });

  socket.on('order:delivered', ({ orderId }) => {
    loadOrders();
    if (selectedOrderId === orderId) closeOverlay();
  });
}

function selectOrder(id) {
  selectedOrderId = id;
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  document.getElementById('overlay-id').textContent = 'Pedido #' + o.id;
  document.getElementById('overlay-category').textContent = labelCategory(o.category);
  document.getElementById('overlay-driver').textContent = o.driver_name || 'Sin asignar';
  document.getElementById('overlay-status').innerHTML = `<span class="badge badge-${o.status}">${labelStatus(o.status)}</span>`;
  document.getElementById('overlay-eta').textContent = o.eta_minutes || '—';
  document.getElementById('overlay-new-status').value = o.status;
  document.getElementById('order-overlay').classList.add('visible');

  if (o.destination_lat && map) {
    map.flyTo({ center: [o.destination_lng, o.destination_lat], zoom: 14, speed: 1.2 });
  }
}

function closeOverlay() {
  selectedOrderId = null;
  document.getElementById('order-overlay').classList.remove('visible');
}

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

function openNewOrderModal() {
  document.getElementById('modal-new-order').classList.add('visible');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('visible');
}

async function submitNewOrder() {
  const weight = parseFloat(document.getElementById('new-weight').value);
  const lat = parseFloat(document.getElementById('new-lat').value);
  const lng = parseFloat(document.getElementById('new-lng').value);

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
      priority: document.getElementById('new-priority').value,
      category: document.getElementById('new-category').value,
      weight_kg: weight,
      destination_lat: lat,
      destination_lng: lng
    })
  });
  closeModal('modal-new-order');
  loadOrders();
}

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

document.getElementById('filter-priority').addEventListener('change', loadOrders);
document.getElementById('filter-status').addEventListener('change', loadOrders);

function labelPriority(p) { return { FLASH:'Flash', STANDARD:'Estándar', SCHEDULED:'Programado' }[p] || p; }
function labelStatus(s) { return { IN_HUB:'En Hub', COLLECTED:'Recogido', IN_TRANSIT:'En Camino', DELIVERED:'Entregado' }[s] || s; }
function labelCategory(c) { return { FOOD:'Alimentos', ELECTRONICS:'Electrónica', DOCUMENTS:'Documentos' }[c] || c; }
