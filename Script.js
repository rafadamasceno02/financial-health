
const SUPABASE_URL = 'https://rzhtwibrpgfnpzptbndb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Bg_kJnug1LVWc86dLp3gvw_Vcat5he6';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);
const currencies = {
  BRL: { locale: 'pt-BR', symbol: 'R$' },
  USD: { locale: 'en-US', symbol: '$' },
  EUR: { locale: 'de-DE', symbol: '€' },
  PEN: { locale: 'es-PE', symbol: 'S/' }
};

let currentUser = null;
let transactions = [];
let signupMode = false;
let calendarDate = new Date();
let selectedDate = null;

function money(value, currency) {
  return new Intl.NumberFormat(currencies[currency].locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(Number(value) || 0);
}

function formatDate(date) {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

function localISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function notify(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2600);
}

// AUTENTICAÇÃO

$('toggleAuth').addEventListener('click', () => {
  signupMode = !signupMode;
  $('authButton').textContent = signupMode ? 'Criar minha conta' : 'Entrar';
  $('toggleAuth').textContent = signupMode
    ? 'Já tem uma conta? Entrar'
    : 'Não tem uma conta? Criar conta';
  $('authMessage').textContent = '';
});

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();

  const email = $('email').value.trim();
  const password = $('password').value;

  $('authButton').disabled = true;
  $('authMessage').textContent = 'Conectando...';

  try {
    let result;

    if (signupMode) {
      result = await db.auth.signUp({ email, password });

      if (!result.error && !result.data.session) {
        $('authMessage').textContent =
          'Conta criada! Verifique seu e-mail para confirmar o cadastro.';
        return;
      }
    } else {
      result = await db.auth.signInWithPassword({ email, password });
    }

    if (result.error) throw result.error;

    if (result.data.session) {
      currentUser = result.data.user;
      await enterApp();
    }
  } catch (error) {
    $('authMessage').textContent = error.message;
  } finally {
    $('authButton').disabled = false;
  }
});

async function enterApp() {
  $('authScreen').classList.add('hidden');
  $('app').classList.remove('hidden');

  $('userEmail').textContent = currentUser.email;
  $('avatar').textContent = currentUser.email[0].toUpperCase();

  $('today').textContent = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full'
  }).format(new Date());

  await loadTransactions();
  render();
}

$('logout').addEventListener('click', async () => {
  await db.auth.signOut();
  currentUser = null;
  transactions = [];
  $('app').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
});

// BANCO DE DADOS

async function loadTransactions() {
  const { data, error } = await db
    .from('transactions')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('transaction_date', { ascending: false });

  if (error) {
    notify('Erro ao carregar dados: ' + error.message);
    return;
  }

  transactions = data || [];
}

async function saveTransaction(transaction) {
  const { error } = await db
    .from('transactions')
    .insert({
      user_id: currentUser.id,
      type: transaction.type,
      description: transaction.description,
      amount: transaction.amount,
      currency: transaction.currency,
      category: transaction.category,
      transaction_date: transaction.transaction_date,
      is_future: transaction.is_future
    });

  if (error) throw error;

  await loadTransactions();
  render();
}

async function deleteTransaction(id) {
  if (!confirm('Deseja excluir esta movimentação?')) return;

  const { error } = await db
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) {
    notify('Erro ao excluir: ' + error.message);
    return;
  }

  await loadTransactions();
  render();
  notify('Movimentação excluída.');
}

// MOEDA E INDICADORES

function filteredTransactions() {
  const currency = $('currencyFilter').value;

  if (currency === 'ALL') return transactions;

  return transactions.filter(t => t.currency === currency);
}

function totals(list, currency) {
  const relevant = list.filter(t => t.currency === currency);
  const income = relevant
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + Number(t.amount), 0);

  const expense = relevant
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + Number(t.amount), 0);

  return { income, expense, balance: income - expense };
}

function render() {
  if (!currentUser) return;

  const list = filteredTransactions();
  const currency = $('currencyFilter').value;

  const now = localISO();
  const start = monthStart();

  const current = list.filter(t => !t.is_future);
  const future = list.filter(t => t.is_future);

  const month = current.filter(t =>
    t.transaction_date >= start &&
    t.transaction_date <= now
  );

  const currentTotals = currency === 'ALL'
    ? null
    : totals(current, currency);

  const monthTotals = currency === 'ALL'
    ? null
    : totals(month, currency);

  const futureTotals = currency === 'ALL'
    ? null
    : totals(future, currency);

  $('currentBalance').textContent = currency === 'ALL'
    ? 'Multimoeda'
    : money(currentTotals.balance, currency);

  $('incomeTotal').textContent = currency === 'ALL'
    ? 'Multimoeda'
    : money(monthTotals.income, currency);

  $('expenseTotal').textContent = currency === 'ALL'
    ? 'Multimoeda'
    : money(monthTotals.expense, currency);

  $('futureBalance').textContent = currency === 'ALL'
    ? 'Multimoeda'
    : money(currentTotals.balance + futureTotals.balance, currency);

  renderCurrencyOverview();
  renderRecent(list);
  renderUpcoming(list);
  renderAll(list);
}

function renderCurrencyOverview() {
  const codes = Object.keys(currencies);

  $('overviewCurrencies').innerHTML = codes.map(code => {
    const t = totals(
      transactions.filter(x => !x.is_future),
      code
    );

    return `
      <div class="currency-chip">
        <span>${code} · Saldo atual</span>
        <strong>${money(t.balance, code)}</strong>
      </div>
    `;
  }).join('');
}

// LISTAS

function transactionHTML(t, showDelete = false) {
  const income = t.type === 'income';
  const future = t.is_future;

  return `
    <div class="transaction-row">
      <div class="transaction-icon">${income ? '↗' : '↘'}</div>
      <div class="transaction-info">
        <strong>${escapeHTML(t.description)}</strong>
        <small>${escapeHTML(t.category)} · ${formatDate(t.transaction_date)} · ${t.currency}</small>
        ${future ? '<div class="status">PREVISTO</div>' : ''}
      </div>
      <div class="transaction-amount ${income ? 'green' : 'red'}">
        ${income ? '+' : '-'}${money(t.amount, t.currency)}
      </div>
      ${showDelete ? `
        <div class="transaction-actions">
          <button class="delete-btn" data-delete="${t.id}" title="Excluir">✕</button>
        </div>
      ` : ''}
    </div>
  `;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function renderRecent(list) {
  const recent = list
    .filter(t => !t.is_future)
    .slice()
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    .slice(0, 6);

  $('recentTransactions').innerHTML = recent.length
    ? recent.map(t => transactionHTML(t)).join('')
    : '<div class="empty">Nenhuma movimentação registrada.</div>';
}

function renderUpcoming(list) {
  const today = localISO();

  const upcoming = list
    .filter(t => t.is_future && t.transaction_date >= today)
    .slice()
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
    .slice(0, 6);

  $('upcomingTransactions').innerHTML = upcoming.length
    ? upcoming.map(t => transactionHTML(t)).join('')
    : '<div class="empty">Nenhum lançamento futuro.</div>';
}

function renderAll(list) {
  const sorted = list.slice().sort((a, b) =>
    b.transaction_date.localeCompare(a.transaction_date)
  );

  $('allTransactions').innerHTML = sorted.length
    ? sorted.map(t => transactionHTML(t, true)).join('')
    : '<div class="empty">Você ainda não possui movimentações.</div>';

  document.querySelectorAll('[data-delete]').forEach(button => {
    button.addEventListener('click', () =>
      deleteTransaction(button.dataset.delete)
    );
  });
}

// MODAL DE MOVIMENTAÇÃO

function openModal() {
  $('transactionModal').classList.remove('hidden');
  $('transactionMessage').textContent = '';
  $('transactionForm').reset();

  selectedDate = new Date();
  calendarDate = new Date();

  $('transactionDate').value = localISO(selectedDate);
  renderCalendar();
}

function closeModal() {
  $('transactionModal').classList.add('hidden');
  $('calendar').classList.add('hidden');
}

$('newTransaction').addEventListener('click', openModal);
$('newTransaction2').addEventListener('click', openModal);
$('closeModal').addEventListener('click', closeModal);

$('transactionModal').addEventListener('click', e => {
  if (e.target === $('transactionModal')) closeModal();
});

$('transactionForm').addEventListener('submit', async e => {
  e.preventDefault();

  const transaction = {
    type: $('transactionType').value,
    description: $('description').value.trim(),
    amount: Number($('amount').value),
    currency: $('transactionCurrency').value,
    category: $('category').value,
    transaction_date: $('transactionDate').value,
    is_future: $('isFuture').checked
  };

  if (!transaction.transaction_date || transaction.amount <= 0) {
    $('transactionMessage').textContent = 'Confira a data e o valor.';
    return;
  }

  if (!transaction.is_future && transaction.transaction_date > localISO()) {
    $('transactionMessage').textContent =
      'Para uma data futura, marque a opção de movimentação prevista.';
    return;
  }

  $('saveTransaction').disabled = true;
  $('saveTransaction').textContent = 'Salvando...';

  try {
    await saveTransaction(transaction);
    closeModal();
    notify('Movimentação salva com sucesso.');
  } catch (error) {
    $('transactionMessage').textContent = error.message;
  } finally {
    $('saveTransaction').disabled = false;
    $('saveTransaction').textContent = 'Salvar movimentação';
  }
});

// CALENDÁRIO PERSONALIZADO

$('transactionDate').addEventListener('click', () => {
  $('calendar').classList.toggle('hidden');
  renderCalendar();
});

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const today = localISO();

  const monthName = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric'
  }).format(calendarDate);

  let html = `
    <div class="calendar-header">
      <button type="button" id="prevMonth">‹</button>
      <strong>${monthName}</strong>
      <button type="button" id="nextMonth">›</button>
    </div>
    <div class="calendar-grid">
      ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<span>${d}</span>`).join('')}
  `;

  for (let i = 0; i < firstDay; i++) html += '<span></span>';

  for (let d = 1; d <= days; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    const selected = $('transactionDate').value === date;
    const isToday = today === date;

    html += `
      <button type="button"
        class="${selected ? 'selected' : ''} ${isToday ? 'today' : ''}"
        data-date="${date}">${d}</button>
    `;
  }

  html += '</div>';

  $('calendar').innerHTML = html;

  $('prevMonth').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendar();
  });

  $('nextMonth').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderCalendar();
  });

  $('calendar').querySelectorAll('[data-date]').forEach(button => {
    button.addEventListener('click', () => {
      $('transactionDate').value = button.dataset.date;
      $('calendar').classList.add('hidden');
    });
  });
}

// INVESTIMENTOS

function calculateInvestment() {
  const currency = $('investmentCurrency').value;
  const initial = Math.max(0, Number($('initialInvestment').value));
  const monthly = Math.max(0, Number($('monthlyInvestment').value));
  const rate = Math.max(0, Number($('interestRate').value)) / 100;
  const months = Number($('investmentPeriod').value);

  if (![initial, monthly, rate, months].every(Number.isFinite) || months <= 0) {
    notify('Informe valores válidos.');
    return;
  }

  let balance = initial;

  for (let i = 0; i < months; i++) {
    balance *= 1 + rate;
    balance += monthly;
  }

  const invested = initial + monthly * months;
  const profit = balance - invested;
  const returnRate = invested > 0 ? profit / invested * 100 : 0;

  $('projectedTotal').textContent = money(balance, currency);
  $('investedTotal').textContent = money(invested, currency);
  $('investmentProfit').textContent = money(profit, currency);
  $('investmentReturn').textContent = returnRate.toFixed(2) + '%';

  $('investmentProgress').style.width =
    `${balance > 0 ? Math.max(0, Math.min(100, profit / balance * 100)) : 0}%`;
}

$('investmentForm').addEventListener('submit', e => {
  e.preventDefault();
  calculateInvestment();
});

['initialInvestment', 'monthlyInvestment', 'interestRate',
 'investmentPeriod', 'investmentCurrency'].forEach(id => {
  $(id).addEventListener('change', calculateInvestment);
});

// NAVEGAÇÃO

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  $(`${page}Page`).classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });

  const titles = {
    dashboard: 'Visão geral',
    transactions: 'Movimentações',
    investments: 'Investimentos'
  };

  $('pageTitle').textContent = titles[page];
}

document.querySelectorAll('.nav-item').forEach(button => {
  button.addEventListener('click', () => navigate(button.dataset.page));
});

document.querySelectorAll('[data-goto]').forEach(button => {
  button.addEventListener('click', () => navigate(button.dataset.goto));
});

$('currencyFilter').addEventListener('change', render);

// INICIALIZAÇÃO

async function initialize() {
  calculateInvestment();

  const { data, error } = await db.auth.getSession();

  if (error) {
    notify('Não foi possível verificar a sessão.');
    return;
  }

  if (data.session) {
    currentUser = data.session.user;
    await enterApp();
  }
}

db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    transactions = [];
    $('app').classList.add('hidden');
    $('authScreen').classList.remove('hidden');
  }
});

initialize();
