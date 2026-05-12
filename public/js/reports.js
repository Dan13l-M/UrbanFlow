const TOKEN_KEY = 'uf_token';
let token = localStorage.getItem(TOKEN_KEY);
let reportData = [];
let etaChart, volumeChart;

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
  await loadDriverFilter();
  await loadReports();
})();

function authHeaders() {
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

async function loadDriverFilter() {
  const res = await fetch('/api/drivers', { headers: authHeaders() });
  const drivers = await res.json();
  const sel = document.getElementById('rep-driver');
  drivers.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    sel.appendChild(opt);
  });
}

async function loadReports() {
  const driverId = document.getElementById('rep-driver').value;
  const from = document.getElementById('rep-from').value;
  const to = document.getElementById('rep-to').value;

  let url = '/api/reports/productivity?';
  if (driverId) url += 'driverId=' + driverId + '&';
  if (from) url += 'from=' + from + '&';
  if (to) url += 'to=' + to;

  const [prodRes, volRes] = await Promise.all([
    fetch(url, { headers: authHeaders() }),
    fetch('/api/reports/eta', { headers: authHeaders() })
  ]);

  reportData = await prodRes.json();
  const volumeData = await volRes.json();

  renderTable(reportData);
  renderEtaChart(reportData);
  renderVolumeChart(volumeData);
}

function renderTable(data) {
  document.getElementById('report-tbody').innerHTML = data.map(row => {
    const compliance = row.total_orders > 0
      ? Math.round((row.delivered / row.total_orders) * 100)
      : 0;
    const color = compliance >= 80 ? 'var(--accent-green)' : compliance >= 60 ? 'var(--accent-yellow)' : 'var(--accent-red)';
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

function renderEtaChart(data) {
  const ctx = document.getElementById('chart-eta').getContext('2d');
  const labels = data.map(d => d.name.split(' ')[0]);
  const values = data.map(d => d.total_orders > 0 ? Math.round(d.delivered / d.total_orders * 100) : 0);

  if (etaChart) etaChart.destroy();
  etaChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Cumplimiento ETA (%)',
        data: values,
        backgroundColor: values.map(v => v >= 80 ? '#3fb95088' : v >= 60 ? '#d2992288' : '#f8514988'),
        borderColor: values.map(v => v >= 80 ? '#3fb950' : v >= 60 ? '#d29922' : '#f85149'),
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

function renderVolumeChart(data) {
  const ctx = document.getElementById('chart-volume').getContext('2d');
  if (volumeChart) volumeChart.destroy();
  volumeChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.day),
      datasets: [{
        label: 'Entregas',
        data: data.map(d => d.count),
        borderColor: '#58a6ff',
        backgroundColor: '#58a6ff22',
        fill: true,
        tension: 0.4,
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
          grid: { color: '#30363d' },
          ticks: { color: '#8b949e' }
        },
        x: { grid: { display: false }, ticks: { color: '#8b949e' } }
      }
    }
  });
}

function exportCSV() {
  const header = ['Repartidor','Total Pedidos','Entregados','Cumplimiento (%)','ETA Promedio (min)','Rating'];
  const rows = reportData.map(r => [
    r.name,
    r.total_orders,
    r.delivered,
    r.total_orders > 0 ? Math.round(r.delivered / r.total_orders * 100) : 0,
    r.avg_eta ? Math.round(r.avg_eta) : '',
    r.rating
  ]);
  const csv = [header, ...rows].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'urbanflow-reporte-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}
