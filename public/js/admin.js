const TOKEN_KEY = 'uf_token';
let token = localStorage.getItem(TOKEN_KEY);
let vehicles = [], drivers = [];
const PAGE_SIZE = 10;
let vPage = 1, dPage = 1;

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
    token = (await res.json()).token;
    localStorage.setItem(TOKEN_KEY, token);
  }
  await loadVehicles();
  await loadDrivers();
})();

function authHeaders() {
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

function switchTab(tab) {
  document.getElementById('tab-vehicles').style.display = tab === 'vehicles' ? 'block' : 'none';
  document.getElementById('tab-drivers').style.display = tab === 'drivers' ? 'block' : 'none';
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0 && tab === 'vehicles') || (i === 1 && tab === 'drivers'));
  });
}

// ─── VEHICLES ───
async function loadVehicles() {
  const res = await fetch('/api/vehicles', { headers: authHeaders() });
  vehicles = await res.json();
  renderVehicles();
}

function renderVehicles() {
  const start = (vPage - 1) * PAGE_SIZE;
  const page = vehicles.slice(start, start + PAGE_SIZE);
  const typeLabel = { BICYCLE: '🚲 Bicicleta', MOTORCYCLE: '🏍 Motocicleta', VAN: '🚐 Camioneta' };

  document.getElementById('vehicles-tbody').innerHTML = page.map(v => `
    <tr>
      <td>${v.id}</td>
      <td><img src="/icons/${v.type.toLowerCase()}.svg" width="18" style="vertical-align:middle;margin-right:6px">${typeLabel[v.type]}</td>
      <td>${v.capacity_kg} kg</td>
      <td>${v.autonomy_km} km</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="editVehicle(${v.id})">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteVehicle(${v.id})">Eliminar</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="color:var(--text-muted);text-align:center;padding:20px">Sin vehículos</td></tr>';

  renderPagination('vehicles-pagination', vehicles.length, vPage, p => { vPage = p; renderVehicles(); });
}

function openVehicleModal(v = null) {
  document.getElementById('vehicle-modal-title').textContent = v ? 'Editar Vehículo' : 'Agregar Vehículo';
  document.getElementById('vehicle-edit-id').value = v ? v.id : '';
  document.getElementById('v-type').value = v ? v.type : 'MOTORCYCLE';
  document.getElementById('v-capacity').value = v ? v.capacity_kg : 30;
  document.getElementById('v-autonomy').value = v ? v.autonomy_km : 80;
  document.getElementById('modal-vehicle').classList.add('visible');
}

function editVehicle(id) {
  openVehicleModal(vehicles.find(v => v.id === id));
}

async function deleteVehicle(id) {
  if (!confirm('¿Eliminar este vehículo?')) return;
  await fetch('/api/vehicles/' + id, { method: 'DELETE', headers: authHeaders() });
  await loadVehicles();
}

async function submitVehicle() {
  const capacity = parseFloat(document.getElementById('v-capacity').value);
  const autonomy = parseFloat(document.getElementById('v-autonomy').value);
  let valid = true;
  if (!capacity || capacity <= 0) { document.getElementById('err-v-capacity').style.display='block'; valid=false; }
  else document.getElementById('err-v-capacity').style.display='none';
  if (!autonomy || autonomy <= 0) { document.getElementById('err-v-autonomy').style.display='block'; valid=false; }
  else document.getElementById('err-v-autonomy').style.display='none';
  if (!valid) return;

  const id = document.getElementById('vehicle-edit-id').value;
  const body = {
    type: document.getElementById('v-type').value,
    capacity_kg: capacity,
    autonomy_km: autonomy
  };
  if (id) {
    await fetch('/api/vehicles/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  } else {
    await fetch('/api/vehicles', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  }
  closeModal('modal-vehicle');
  await loadVehicles();
}

// ─── DRIVERS ───
async function loadDrivers() {
  const res = await fetch('/api/drivers', { headers: authHeaders() });
  drivers = await res.json();
  renderDrivers();
  populateVehicleSelect();
}

function renderDrivers() {
  const start = (dPage - 1) * PAGE_SIZE;
  const page = drivers.slice(start, start + PAGE_SIZE);
  const shiftLabel = { MORNING: 'Mañana', AFTERNOON: 'Tarde', NIGHT: 'Noche' };

  document.getElementById('drivers-tbody').innerHTML = page.map(d => `
    <tr>
      <td>${d.id}</td>
      <td>${d.name}</td>
      <td>${shiftLabel[d.shift]}</td>
      <td>⭐ ${d.rating}</td>
      <td><span class="badge ${d.is_available ? 'badge-DELIVERED' : 'badge-IN_TRANSIT'}">${d.is_available ? 'Sí' : 'No'}</span></td>
      <td>${d.vehicle_type || '—'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="editDriver(${d.id})">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteDriver(${d.id})">Eliminar</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" style="color:var(--text-muted);text-align:center;padding:20px">Sin repartidores</td></tr>';

  renderPagination('drivers-pagination', drivers.length, dPage, p => { dPage = p; renderDrivers(); });
}

function populateVehicleSelect() {
  const sel = document.getElementById('d-vehicle');
  sel.innerHTML = '<option value="">Sin vehículo</option>' +
    vehicles.map(v => `<option value="${v.id}">${v.type} #${v.id}</option>`).join('');
}

function openDriverModal(d = null) {
  document.getElementById('driver-modal-title').textContent = d ? 'Editar Repartidor' : 'Agregar Repartidor';
  document.getElementById('driver-edit-id').value = d ? d.id : '';
  document.getElementById('d-name').value = d ? d.name : '';
  document.getElementById('d-shift').value = d ? d.shift : 'MORNING';
  document.getElementById('d-vehicle').value = d ? (d.vehicle_id || '') : '';
  document.getElementById('d-available').value = d ? d.is_available : 1;
  document.getElementById('modal-driver').classList.add('visible');
}

function editDriver(id) {
  openDriverModal(drivers.find(d => d.id === id));
}

async function deleteDriver(id) {
  if (!confirm('¿Eliminar este repartidor?')) return;
  await fetch('/api/drivers/' + id, { method: 'DELETE', headers: authHeaders() });
  await loadDrivers();
}

async function submitDriver() {
  const name = document.getElementById('d-name').value.trim();
  if (!name) { document.getElementById('err-d-name').style.display='block'; return; }
  document.getElementById('err-d-name').style.display='none';

  const id = document.getElementById('driver-edit-id').value;
  const body = {
    name,
    shift: document.getElementById('d-shift').value,
    vehicle_id: document.getElementById('d-vehicle').value || null,
    is_available: parseInt(document.getElementById('d-available').value)
  };
  if (id) {
    await fetch('/api/drivers/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  } else {
    await fetch('/api/drivers', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  }
  closeModal('modal-driver');
  await loadDrivers();
}

// ─── Pagination ───
function renderPagination(containerId, total, current, onPage) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) { document.getElementById(containerId).innerHTML = ''; return; }
  document.getElementById(containerId).innerHTML = Array.from({ length: pages }, (_, i) =>
    `<button class="page-btn ${i+1===current?'active':''}" onclick="(${onPage.toString()})(${i+1})">${i+1}</button>`
  ).join('');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('visible');
}
