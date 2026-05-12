/**
 * admin.js — Lógica del panel de administración de flota.
 *
 * Responsabilidades:
 *  - Autenticación con la API y almacenamiento del JWT en localStorage
 *  - Gestión CRUD de vehículos (listar, crear, editar, eliminar)
 *  - Gestión CRUD de repartidores (listar, crear, editar, eliminar)
 *  - Paginación de 10 registros por página en ambas tablas
 *  - Navegación por pestañas (Vehículos / Personal)
 */

const TOKEN_KEY = 'uf_token';
let token = localStorage.getItem(TOKEN_KEY);
let vehicles = [], drivers = []; // Cachés locales de los datos cargados desde la API
const PAGE_SIZE = 10;            // Registros visibles por página en las tablas
let vPage = 1, dPage = 1;        // Página actual de vehículos y repartidores

// ── Inicialización ───────────────────────────────────────────────────────────

// Al cargar: autentica si no hay token y carga los datos de ambas tablas
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

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
  if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); token = null; location.reload(); return null; }
  return res;
}

/**
 * Cambia la pestaña visible entre "Vehículos" y "Personal".
 * Muestra el contenedor correspondiente y marca el botón activo.
 *
 * @param {string} tab - 'vehicles' o 'drivers'
 */
function switchTab(tab) {
  document.getElementById('tab-vehicles').style.display = tab === 'vehicles' ? 'block' : 'none';
  document.getElementById('tab-drivers').style.display  = tab === 'drivers'  ? 'block' : 'none';
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0 && tab === 'vehicles') || (i === 1 && tab === 'drivers'));
  });
}

// ── VEHÍCULOS ────────────────────────────────────────────────────────────────

// Carga todos los vehículos desde la API y actualiza la tabla
async function loadVehicles() {
  const res = await apiFetch('/api/vehicles');
  if (!res || !res.ok) return;
  vehicles = await res.json();
  renderVehicles();
}

/**
 * Renderiza la página actual de la tabla de vehículos.
 * Muestra tipo (con ícono), capacidad y autonomía; incluye botones de editar/eliminar.
 */
function renderVehicles() {
  const start = (vPage - 1) * PAGE_SIZE;
  const page  = vehicles.slice(start, start + PAGE_SIZE);
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

/**
 * Abre el modal de vehículo en modo creación o edición.
 * Si recibe un objeto vehículo, pre-llena el formulario con sus datos.
 *
 * @param {Object|null} v - Vehículo a editar, o null para crear uno nuevo
 */
function openVehicleModal(v = null) {
  document.getElementById('vehicle-modal-title').textContent = v ? 'Editar Vehículo' : 'Agregar Vehículo';
  document.getElementById('vehicle-edit-id').value  = v ? v.id : '';
  document.getElementById('v-type').value           = v ? v.type : 'MOTORCYCLE';
  document.getElementById('v-capacity').value       = v ? v.capacity_kg : 30;
  document.getElementById('v-autonomy').value       = v ? v.autonomy_km : 80;
  document.getElementById('modal-vehicle').classList.add('visible');
}

// Busca el vehículo por ID en el caché local y abre el modal en modo edición
function editVehicle(id) {
  openVehicleModal(vehicles.find(v => v.id === id));
}

// Elimina un vehículo tras confirmación y recarga la tabla
async function deleteVehicle(id) {
  if (!confirm('¿Eliminar este vehículo?')) return;
  await apiFetch('/api/vehicles/' + id, { method: 'DELETE' });
  await loadVehicles();
}

/**
 * Valida y envía el formulario de vehículo (crear o actualizar).
 * Verifica que capacidad y autonomía sean valores positivos.
 */
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
    type:        document.getElementById('v-type').value,
    capacity_kg: capacity,
    autonomy_km: autonomy
  };

  // Si hay ID en el campo oculto es actualización (PUT), si no es creación (POST)
  if (id) {
    await apiFetch('/api/vehicles/' + id, { method: 'PUT', body: JSON.stringify(body) });
  } else {
    await apiFetch('/api/vehicles', { method: 'POST', body: JSON.stringify(body) });
  }
  closeModal('modal-vehicle');
  await loadVehicles();
}

// ── REPARTIDORES ─────────────────────────────────────────────────────────────

// Carga todos los repartidores desde la API, actualiza la tabla y el selector de vehículos
async function loadDrivers() {
  const res = await apiFetch('/api/drivers');
  if (!res || !res.ok) return;
  drivers = await res.json();
  renderDrivers();
  populateVehicleSelect();
}

/**
 * Renderiza la página actual de la tabla de repartidores.
 * Muestra nombre, turno, rating, disponibilidad y tipo de vehículo asignado.
 */
function renderDrivers() {
  const start = (dPage - 1) * PAGE_SIZE;
  const page  = drivers.slice(start, start + PAGE_SIZE);
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

// Llena el selector de vehículos del modal de repartidor con los vehículos disponibles
function populateVehicleSelect() {
  const sel = document.getElementById('d-vehicle');
  sel.innerHTML = '<option value="">Sin vehículo</option>' +
    vehicles.map(v => `<option value="${v.id}">${v.type} #${v.id}</option>`).join('');
}

/**
 * Abre el modal de repartidor en modo creación o edición.
 *
 * @param {Object|null} d - Repartidor a editar, o null para crear uno nuevo
 */
function openDriverModal(d = null) {
  document.getElementById('driver-modal-title').textContent = d ? 'Editar Repartidor' : 'Agregar Repartidor';
  document.getElementById('driver-edit-id').value  = d ? d.id : '';
  document.getElementById('d-name').value          = d ? d.name : '';
  document.getElementById('d-shift').value         = d ? d.shift : 'MORNING';
  document.getElementById('d-vehicle').value       = d ? (d.vehicle_id || '') : '';
  document.getElementById('d-available').value     = d ? d.is_available : 1;
  document.getElementById('modal-driver').classList.add('visible');
}

// Busca el repartidor por ID en el caché local y abre el modal en modo edición
function editDriver(id) {
  openDriverModal(drivers.find(d => d.id === id));
}

// Elimina un repartidor tras confirmación y recarga la tabla
async function deleteDriver(id) {
  if (!confirm('¿Eliminar este repartidor?')) return;
  await apiFetch('/api/drivers/' + id, { method: 'DELETE' });
  await loadDrivers();
}

/**
 * Valida y envía el formulario de repartidor (crear o actualizar).
 * Solo valida que el nombre no esté vacío.
 */
async function submitDriver() {
  const name = document.getElementById('d-name').value.trim();
  if (!name) { document.getElementById('err-d-name').style.display='block'; return; }
  document.getElementById('err-d-name').style.display='none';

  const id = document.getElementById('driver-edit-id').value;
  const body = {
    name,
    shift:        document.getElementById('d-shift').value,
    vehicle_id:   document.getElementById('d-vehicle').value || null,
    is_available: parseInt(document.getElementById('d-available').value)
  };

  // Si hay ID en el campo oculto es actualización (PUT), si no es creación (POST)
  if (id) {
    await apiFetch('/api/drivers/' + id, { method: 'PUT', body: JSON.stringify(body) });
  } else {
    await apiFetch('/api/drivers', { method: 'POST', body: JSON.stringify(body) });
  }
  closeModal('modal-driver');
  await loadDrivers();
}

// ── Paginación ───────────────────────────────────────────────────────────────

/**
 * Renderiza los botones de paginación en el contenedor indicado.
 * No muestra nada si todos los registros caben en una sola página.
 *
 * @param {string}   containerId - ID del elemento donde se insertan los botones
 * @param {number}   total       - Total de registros a paginar
 * @param {number}   current     - Página actualmente activa
 * @param {Function} onPage      - Callback que recibe el número de página al hacer clic
 */
function renderPagination(containerId, total, current, onPage) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) { document.getElementById(containerId).innerHTML = ''; return; }
  document.getElementById(containerId).innerHTML = Array.from({ length: pages }, (_, i) =>
    `<button class="page-btn ${i+1===current?'active':''}" onclick="(${onPage.toString()})(${i+1})">${i+1}</button>`
  ).join('');
}

// Oculta un modal dado su ID
function closeModal(id) {
  document.getElementById(id).classList.remove('visible');
}
