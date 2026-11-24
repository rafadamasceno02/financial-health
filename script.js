
const STORAGE_KEY = 'orbit_finance_v1';

const DEFAULT_DATA = {
  transactions: [],
  reserve: 0,
  target: 45000
};

let data = loadData();
let flowChart = null;
let categoryChart = null;

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved
      ? { ...DEFAULT_DATA, ...JSON.parse(saved) }
      : structuredClone(DEFAULT_DATA);
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

function localDate() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000)
    .toISOString().slice(0, 10);
}

function currentMonth(tx) {
  const now = new Date();
  const d = new Date(tx.date + 'T12:00:00');

  return d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
}

function formatDate(date) {
  return new Date(date + 'T12:00:00')
    .toLocaleDateString('pt-BR');
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function render() {
  const transactions = data.transactions;
  const month = transactions.filter(currentMonth);

  const income = month
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);

  const expenses = month
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  const allIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);

  const allExpenses = transactions
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  const balance = allIncome - allExpenses;
  const rate = income > 0
    ? ((income - expenses) / income) * 100
    : 0;

  document.getElementById('balance').textContent = money(balance);
  document.getElementById('income').textContent = money(income);
  document.getElementById('expenses').textContent = money(expenses);
  document.getElementById('savingRate').textContent =
    Math.max(0, rate).toFixed(1) + '%';

  renderTransactions();
  renderCharts();
  renderGoal();
}

function renderTransactions() {
  const list = [...data.transactions]
    .sort((a, b) => b.date.localeCompare(a.date));

  const container = document.getElementById('transactions');

  if (!list.length) {
    container.innerHTML =
      '<div class="empty">Nenhuma movimentação cadastrada ainda.</div>';
    return;
  }

  container.innerHTML = list.slice(0, 8).map(t => `
    <div class="transaction">
      <div>
        <div class="tx-name">${escapeHTML(t.description)}</div>
        <div class="tx-meta">
          ${escapeHTML(t.category)} ·
          ${escapeHTML(t.account)} ·
          ${formatDate(t.date)}
        </div>
      </div>
      <div class="tx-actions">
        <span class="tx-amount ${t.type === 'income' ? 'green' : 'red'}">
          ${t.type === 'income' ? '+' : '-'} ${money(t.amount)}
        </span>
        <button class="delete" title="Excluir"
          onclick="deleteTransaction('${t.id}')">×</button>
      </div>
    </div>
  `).join('');
}

function isMonth(t, m) {
  const d = new Date(t.date + 'T12:00:00');

  return d.getMonth() === m.month &&
    d.getFullYear() === m.year;
}

function renderCharts() {
  if (typeof Chart === 'undefined') return;

  const months = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);

    months.push({
      label: d.toLocaleDateString('pt-BR', { month: 'short' }),
      month: d.getMonth(),
      year: d.getFullYear()
    });
  }

  const income = months.map(m =>
    data.transactions
      .filter(t => t.type === 'income' && isMonth(t, m))
      .reduce((s, t) => s + t.amount, 0)
  );

  const expenses = months.map(m =>
    data.transactions
      .filter(t => t.type === 'expense' && isMonth(t, m))
      .reduce((s, t) => s + t.amount, 0)
  );

  if (flowChart) flowChart.destroy();

  flowChart = new Chart(document.getElementById('flowChart'), {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        {
          label: 'Receitas',
          data: income,
          backgroundColor: '#42dda0',
          borderRadius: 5
        },
        {
          label: 'Despesas',
          data: expenses,
          backgroundColor: '#ff7185',
          borderRadius: 5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#8793aa',
            font: { family: 'DM Sans' }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#8793aa' },
          grid: { display: false }
        },
        y: {
          ticks: { color: '#8793aa' },
          grid: { color: '#26334b' }
        }
      }
    }
  });

  const expensesByCategory = {};

  data.transactions
    .filter(t => t.type === 'expense' && currentMonth(t))
    .forEach(t => {
      expensesByCategory[t.category] =
        (expensesByCategory[t.category] || 0) + t.amount;
    });

  if (categoryChart) categoryChart.destroy();

  const labels = Object.keys(expensesByCategory);

  categoryChart = new Chart(
    document.getElementById('categoryChart'),
    {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['Sem despesas'],
        datasets: [{
          data: labels.length
            ? Object.values(expensesByCategory)
            : [1],
          backgroundColor: [
            '#42dda0', '#6d9bff', '#ff7185',
            '#e5b65e', '#a98bff', '#4bc7d1', '#e28bcb'
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#8793aa',
              padding: 15,
              font: { family: 'DM Sans', size: 10 }
            }
          }
        }
      }
    }
  );
}

function renderGoal() {
  const percent = data.target > 0
    ? Math.min(100, data.reserve / data.target * 100)
    : 0;

  document.getElementById('goalPercent').textContent =
    percent.toFixed(1) + '%';

  document.getElementById('goalBar').style.width =
    percent + '%';

  document.getElementById('goalCurrent').textContent =
    money(data.reserve);

  document.getElementById('goalTarget').textContent =
    money(data.target);

  document.getElementById('reserveInput').value = data.reserve;
  document.getElementById('targetInput').value = data.target;
}

document.getElementById('transactionForm')
  .addEventListener('submit', event => {
    event.preventDefault();

    const amount = Number(
      document.getElementById('amount').value
    );

    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Informe um valor válido.');
      return;
    }

    data.transactions.push({
      id: crypto.randomUUID(),
      description: document.getElementById('description').value.trim(),
      amount,
      type: document.getElementById('type').value,
      category: document.getElementById('category').value,
      account: document.getElementById('account').value,
      date: document.getElementById('date').value
    });

    saveData();
    event.target.reset();

    document.getElementById('date').value = localDate();

    render();
    alert('Movimentação salva!');
  });

function deleteTransaction(id) {
  if (!confirm('Deseja excluir esta movimentação?')) return;

  data.transactions = data.transactions.filter(t => t.id !== id);

  saveData();
  render();
}

function saveGoal() {
  const reserve = Number(
    document.getElementById('reserveInput').value
  );

  const target = Number(
    document.getElementById('targetInput').value
  );

  if (!Number.isFinite(reserve) || reserve < 0 ||
      !Number.isFinite(target) || target <= 0) {
    alert('Informe valores válidos.');
    return;
  }

  data.reserve = reserve;
  data.target = target;

  saveData();
  renderGoal();
}

function exportData() {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: 'application/json' }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = 'orbit-backup.json';
  a.click();

  URL.revokeObjectURL(url);
}

function resetData() {
  if (!confirm(
    'Isso apagará todos os dados salvos neste navegador. Continuar?'
  )) return;

  data = structuredClone(DEFAULT_DATA);

  saveData();
  render();
}

document.getElementById('today').textContent =
  new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

document.getElementById('date').value = localDate();

render();
