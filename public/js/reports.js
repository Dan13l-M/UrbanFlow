/**
 * reports.js — Lógica del panel de reportes y estadísticas.
 *
 * Responsabilidades:
 *  - Carga del selector de repartidores para filtrar reportes
 *  - Peticiones paralelas a /productivity y /eta para optimizar carga
 *  - Renderizado de tabla de productividad con cumplimiento ETA coloreado
 *  - Gráfica de barras (cumplimiento por repartidor) con Chart.js
 *  - Gráfica de línea (volumen de entregas por día) con Chart.js
 *  - Exportación de datos a archivo CSV descargable
 */

let reportData = [];    // Datos de productividad, usados también en exportCSV
let etaChart, volumeChart; // Referencias a los charts para poder destruirlos al actualizar

// ── Inicialización ───────────────────────────────────────────────────────────

(async function init() {
  await loadDriverFilter();
  await loadReports();
})();

// ── Filtros ──────────────────────────────────────────────────────────────────

/**
 * Carga la lista de repartidores y llena el selector de filtro.
 * El selector siempre incluye la opción "Todos" al inicio.
 */
async function loadDriverFilter() {
  const res = await fetch('/api/drivers');
  const drivers = await res.json();
  const sel = document.getElementById('rep-driver');
  drivers.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    sel.appendChild(opt);
  });
}

// ── Carga de datos ───────────────────────────────────────────────────────────

/**
 * Carga los reportes aplicando los filtros activos del formulario.
 * Hace dos peticiones en paralelo para reducir el tiempo de espera:
 *  - /productivity: estadísticas por repartidor (filtrable)
 *  - /eta: volumen diario de entregas de los últimos 30 días (sin filtro)
 */
async function loadReports() {
  const driverId = document.getElementById('rep-driver').value;
  const from     = document.getElementById('rep-from').value;
  const to       = document.getElementById('rep-to').value;

  // Construye la URL de productividad con los filtros seleccionados
  let url = '/api/reports/productivity?';
  if (driverId) url += 'driverId=' + driverId + '&';
  if (from)     url += 'from=' + from + '&';
  if (to)       url += 'to=' + to;

  // Las dos peticiones corren en paralelo con Promise.all para mayor rendimiento
  const [prodRes, volRes] = await Promise.all([
    fetch(url),
    fetch('/api/reports/eta')
  ]);

  reportData = await prodRes.json();
  const volumeData = await volRes.json();

  renderTable(reportData);
  renderEtaChart(reportData);
  renderVolumeChart(volumeData);
}

// ── Tabla de productividad ───────────────────────────────────────────────────

/**
 * Renderiza la tabla de productividad por repartidor.
 * El porcentaje de cumplimiento ETA se colorea según umbrales:
 *  - >= 80%: verde (buen desempeño)
 *  - >= 60%: amarillo (desempeño aceptable)
 *  - <  60%: rojo (desempeño bajo)
 *
 * @param {Array} data - Array de objetos con estadísticas por repartidor
 */
function renderTable(data) {
  document.getElementById('report-tbody').innerHTML = data.map(row => {
    const compliance = row.total_orders > 0
      ? Math.round((row.delivered / row.total_orders) * 100)
      : 0;
    const color = compliance >= 80
      ? 'var(--accent-green)'
      : compliance >= 60
        ? 'var(--accent-yellow)'
        : 'var(--accent-red)';

    return `
      <tr>
        <td>${row.name}</td>
        <td>${row.total_orders}</td>
        <td>${row.delivered}</td>
        <td style="color:${color};font-weight:700">${compliance}%</td>
        <td>${row.avg_eta ? Math.round(row.avg_eta) + ' min' : '—'}</td>
        <td>⭐ ${row.rating}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" style="color:var(--text-muted);text-align:center;padding:20px">Sin datos</td></tr>';
}

// ── Gráficas (Chart.js) ──────────────────────────────────────────────────────

/**
 * Renderiza la gráfica de barras de cumplimiento ETA por repartidor.
 * El color de cada barra refleja el mismo umbral de colores que la tabla.
 * Si ya existía una gráfica previa, la destruye antes de crear la nueva.
 *
 * @param {Array} data - Datos de productividad por repartidor
 */
function renderEtaChart(data) {
  const ctx    = document.getElementById('chart-eta').getContext('2d');
  const labels = data.map(d => d.name.split(' ')[0]); // Solo el primer nombre para que quepa
  const values = data.map(d => d.total_orders > 0 ? Math.round(d.delivered / d.total_orders * 100) : 0);

  // Destruye la instancia anterior para evitar superposición de gráficas
  if (etaChart) etaChart.destroy();

  etaChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Cumplimiento ETA (%)',
        data: values,
        // Color semitransparente para relleno y sólido para el borde
        backgroundColor: values.map(v => v >= 80 ? '#3fb95088' : v >= 60 ? '#d2992288' : '#f8514988'),
        borderColor:     values.map(v => v >= 80 ? '#3fb950'   : v >= 60 ? '#d29922'   : '#f85149'),
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true, max: 100,
          grid: { color: '#30363d' },
          ticks: { color: '#8b949e', callback: v => v + '%' }
        },
        x: { grid: { display: false }, ticks: { color: '#8b949e' } }
      }
    }
  });
}

/**
 * Renderiza la gráfica de línea con el volumen de entregas por día.
 * Muestra los últimos 30 días con área rellena debajo de la línea.
 * Si ya existía una gráfica previa, la destruye antes de crear la nueva.
 *
 * @param {Array} data - Array de objetos { day, count } ordenados por fecha
 */
function renderVolumeChart(data) {
  const ctx = document.getElementById('chart-volume').getContext('2d');

  // Destruye la instancia anterior para evitar superposición de gráficas
  if (volumeChart) volumeChart.destroy();

  volumeChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.day),
      datasets: [{
        label: 'Entregas',
        data: data.map(d => d.count),
        borderColor:      '#58a6ff',
        backgroundColor:  '#58a6ff22',
        fill: true,      // Área rellena bajo la línea
        tension: 0.4,    // Curva suavizada (0 = líneas rectas, 1 = muy curvo)
        pointBackgroundColor: '#58a6ff',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          grid:  { color: '#30363d' },
          ticks: { color: '#8b949e' }
        },
        x: { grid: { display: false }, ticks: { color: '#8b949e' } }
      }
    }
  });
}

// ── Exportación ──────────────────────────────────────────────────────────────

/**
 * Genera y descarga un archivo CSV con los datos de productividad visibles en la tabla.
 * Usa los datos en caché (reportData) para no necesitar una petición adicional.
 * El archivo se nombra con la fecha actual para facilitar su identificación.
 */
function exportCSV() {
  const header = ['Repartidor','Total Pedidos','Entregados','Cumplimiento (%)','ETA Promedio (min)','Rating'];
  const rows   = reportData.map(r => [
    r.name,
    r.total_orders,
    r.delivered,
    r.total_orders > 0 ? Math.round(r.delivered / r.total_orders * 100) : 0,
    r.avg_eta ? Math.round(r.avg_eta) : '',
    r.rating
  ]);

  // Une cabecera y filas en texto CSV, luego crea un Blob descargable
  const csv  = [header, ...rows].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);

  // Crea un enlace invisible, lo activa para disparar la descarga y lo limpia
  const a = document.createElement('a');
  a.href = url;
  a.download = 'urbanflow-reporte-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}
