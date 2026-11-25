const SUPABASE_URL = 'https://rzhtwibrpgfnpzptbndb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Bg_kJnug1LVWc86dLp3gvw_Vcat5he6';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);

const currencies = {
  BRL: { locale: 'pt-BR' },
  USD: { locale: 'en-US' },
  EUR: { locale: 'de-DE' },
  PEN: { locale: 'es-PE' }
};

const benefitNames = {
  VR: 'Vale-refeição',
  VA: 'Vale-alimentação',
  HOME_OFFICE: 'Auxílio home office',
  TRANSPORT: 'Vale-transporte',
  HEALTH: 'Auxílio saúde',
  BONUS: 'Bônus',
  COMMISSION: 'Comissão',
  PLR: 'Participação nos lucros',
  OTHER: 'Outro benefício'
};

let currentUser = null;
let transactions = [];
let recurringRules = [];
let debts = [];
let skips = new Set();
let signupMode = false;
let calendarDate = new Date();
let calendarSelectedDate = new Date();

// ============ UTILITÁRIOS ============

function money(value, currency) {
  return new Intl.NumberFormat(currencies[currency].locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(Number(value) || 0);
}

function localISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function dateFromISO(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDaysISO(value, amount) {
  const date = dateFromISO(value);
  date.setDate(date.getDate() + amount);
  return localISO(date);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

let toastTimer;
function notify(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3500);
}

// Um lançamento conta no saldo se não é previsto OU se a data já passou.
function isSettled(t) {
  return !t.is_future || t.transaction_date <= localISO();
}

function resetState() {
  currentUser = null;
  transactions = [];
  recurringRules = [];
  debts = [];
  skips = new Set();
}

// ============ AUTENTICAÇÃO ============

$('toggleAuth').addEventListener('click', () => {
  signupMode = !signupMode;
  $('authButton').textContent = signupMode ? 'Criar minha conta' : 'Entrar';
  $('toggleAuth').textContent = signupMode
    ? 'Já tem uma conta? Entrar'
    : 'Não tem uma conta? Criar conta';
  $('password').autocomplete = signupMode ? 'new-password' : 'current-password';
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
      $('authMessage').textContent = '';
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

  await refresh();
}

$('logout').addEventListener('click', async () => {
  await db.auth.signOut();
  showAuth();
});

function showAuth() {
  resetState();
  $('app').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
}

// ============ CARREGAMENTO DE DADOS ============

// Busca todas as linhas (o Supabase limita 1000 por consulta).
async function fetchAll(table, orderColumn, ascending) {
  let all = [];
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from(table)
      .select('*')
      .eq('user_id', currentUser.id)
      .order(orderColumn, { ascending })
      .order('id')
      .range(from, from + 999);

    if (error) throw error;

    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  return all;
}

async function loadRecurringRules() {
  recurringRules = await fetchAll('recurring_rules', 'created_at', false);
}

async function loadTransactions() {
  transactions = await fetchAll('transactions', 'transaction_date', false);
}

async function loadDebts() {
  debts = await fetchAll('debts', 'created_at', true);
}

async function loadSkips() {
  const { data, error } = await db
    .from('recurring_skips')
    .select('recurrence_key')
    .eq('user_id', currentUser.id)
    .limit(5000);

  if (error) throw error;
  skips = new Set((data || []).map(x => x.recurrence_key));
}

async function refresh({ generate = true } = {}) {
  if (!currentUser) return;

  try {
    await Promise.all([loadRecurringRules(), loadSkips()]);
    if (generate) await generateRecurringOccurrences();
    await Promise.all([loadTransactions(), loadDebts()]);
  } catch (error) {
    notify('Erro ao carregar dados: ' + error.message);
  }

  render();
}

async function saveTransaction(transaction) {
  const { error } = await db.from('transactions').insert({
    user_id: currentUser.id,
    type: transaction.type,
    description: transaction.description,
    amount: transaction.amount,
    currency: transaction.currency,
    category: transaction.category,
    transaction_date: transaction.transaction_date,
    is_future: transaction.is_future,
    is_benefit: transaction.is_benefit,
    benefit_type: transaction.benefit_type,
    recurrence_id: null,
    recurrence_key: null
  });

  if (error) throw error;
  await refresh({ generate: false });
}

// ============ RECORRÊNCIAS ============

function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function getBusinessDay(year, month, position) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  let found = 0;

  for (let day = lastDay; day >= 1; day--) {
    const date = new Date(year, month, day);

    if (isBusinessDay(date)) {
      found++;
      if (position === 'last_business' && found === 1) return localISO(date);
      if (position === 'penultimate_business' && found === 2) return localISO(date);
    }
  }

  return null;
}

function getMonthlyOccurrence(rule, year, month) {
  if (rule.monthly_position === 'last_business') {
    return getBusinessDay(year, month, 'last_business');
  }

  if (rule.monthly_position === 'penultimate_business') {
    return getBusinessDay(year, month, 'penultimate_business');
  }

  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(Number(rule.monthly_day), lastDay);

  return localISO(new Date(year, month, day));
}

function getRuleOccurrences(rule, today) {
  const dates = [];
  const daily = rule.frequency === 'daily';

  // Regras diárias geram menos linhas para não pesar o banco.
  const horizon = addDaysISO(today, daily ? 90 : 365);
  const earliest = addDaysISO(today, daily ? -60 : -730);

  const start = rule.start_date > earliest ? rule.start_date : earliest;
  const end = rule.end_date && rule.end_date < horizon ? rule.end_date : horizon;

  if (start > end) return dates;

  if (daily) {
    let current = start;
    while (current <= end) {
      dates.push(current);
      current = addDaysISO(current, 1);
    }
    return dates;
  }

  const startDate = dateFromISO(start);
  const endDate = dateFromISO(end);

  let year = startDate.getFullYear();
  let month = startDate.getMonth();

  while (
    year < endDate.getFullYear() ||
    (year === endDate.getFullYear() && month <= endDate.getMonth())
  ) {
    const occurrence = getMonthlyOccurrence(rule, year, month);

    if (occurrence && occurrence >= start && occurrence <= end) {
      dates.push(occurrence);
    }

    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  return dates;
}

async function generateRecurringOccurrences() {
  if (!currentUser || !recurringRules.length) return;

  const today = localISO();
  const rows = [];

  recurringRules
    .filter(rule => rule.active)
    .forEach(rule => {
      getRuleOccurrences(rule, today).forEach(date => {
        const key = `${rule.id}:${date}`;
        if (skips.has(key)) return; // ocorrência excluída pelo usuário

        rows.push({
          user_id: currentUser.id,
          type: rule.type,
          description: rule.description,
          amount: rule.amount,
          currency: rule.currency,
          category: rule.category,
          transaction_date: date,
          is_future: date > today,
          is_benefit: rule.is_benefit,
          benefit_type: rule.benefit_type,
          recurrence_id: rule.id,
          recurrence_key: key
        });
      });
    });

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from('transactions')
      .upsert(rows.slice(i, i + 500), {
        onConflict: 'recurrence_key',
        ignoreDuplicates: true
      });

    if (error) throw error;
  }
}

async function deleteFutureOccurrences(ruleId) {
  const { error } = await db
    .from('transactions')
    .delete()
    .eq('recurrence_id', ruleId)
    .eq('user_id', currentUser.id)
    .eq('is_future', true)
    .gt('transaction_date', localISO());

  if (error) throw error;
}

async function createRecurringRule(transaction) {
  const frequency = $('recurrenceFrequency').value;
  const position = frequency === 'monthly' ? $('monthlyPosition').value : null;

  const startDate = $('recurrenceStart').value;
  const endDate = $('recurrenceEnd').value || null;

  if (!startDate) {
    throw new Error('Informe a data de início da recorrência.');
  }

  if (endDate && endDate < startDate) {
    throw new Error('A data final não pode ser anterior à inicial.');
  }

  const rule = {
    user_id: currentUser.id,
    type: transaction.type,
    description: transaction.description,
    amount: transaction.amount,
    currency: transaction.currency,
    category: transaction.category,
    is_benefit: transaction.is_benefit,
    benefit_type: transaction.benefit_type,
    frequency,
    monthly_position: position,
    monthly_day: frequency === 'monthly' && position === 'fixed'
      ? Number($('monthlyDay').value)
      : null,
    start_date: startDate,
    end_date: endDate,
    active: true
  };

  const { error } = await db.from('recurring_rules').insert(rule);
  if (error) throw error;

  await refresh();
}

async function setRuleStatus(id, active) {
  const rule = recurringRules.find(r => r.id === id);
  if (!rule) return;

  const question = active
    ? 'Deseja reativar esta recorrência?'
    : 'Deseja cancelar esta recorrência? Os lançamentos passados serão mantidos e os futuros ainda não realizados serão removidos.';

  if (!confirm(question)) return;

  try {
    const { error } = await db
      .from('recurring_rules')
      .update({ active })
      .eq('id', id)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    if (!active) await deleteFutureOccurrences(id);

    notify(active ? 'Recorrência reativada.' : 'Recorrência cancelada. Histórico preservado.');
  } catch (error) {
    notify('Erro ao atualizar recorrência: ' + error.message);
  }

  await refresh();
}

// ============ EDIÇÃO DE REGRA ============

function populateDays(selectId) {
  $(selectId).innerHTML = Array.from({ length: 31 }, (_, i) =>
    `<option value="${i + 1}">${i + 1}º dia</option>`
  ).join('');
}

function updateEditRuleFields() {
  const monthly = $('editRuleFrequency').value === 'monthly';
  const fixed = $('editRulePosition').value === 'fixed';

  $('editMonthlyFields').classList.toggle('hidden', !monthly);
  $('editRuleDayWrap').classList.toggle('hidden', !monthly || !fixed);
}

function openEditRule(id) {
  const rule = recurringRules.find(r => r.id === id);
  if (!rule) return;

  $('editRuleId').value = rule.id;
  $('editRuleDescription').value = rule.description;
  $('editRuleAmount').value = rule.amount;
  $('editRuleCurrency').value = rule.currency;
  $('editRuleCategory').value = rule.category;
  $('editRuleFrequency').value = rule.frequency;
  $('editRulePosition').value = rule.monthly_position || 'fixed';
  $('editRuleDay').value = rule.monthly_day || 1;
  $('editRuleStart').value = rule.start_date;
  $('editRuleEnd').value = rule.end_date || '';
  $('editRuleMessage').textContent = '';

  updateEditRuleFields();
  $('editRuleModal').classList.remove('hidden');
}

function closeEditRule() {
  $('editRuleModal').classList.add('hidden');
}

$('closeEditRule').addEventListener('click', closeEditRule);
$('editRuleModal').addEventListener('click', e => {
  if (e.target === $('editRuleModal')) closeEditRule();
});
$('editRuleFrequency').addEventListener('change', updateEditRuleFields);
$('editRulePosition').addEventListener('change', updateEditRuleFields);

$('editRuleForm').addEventListener('submit', async e => {
  e.preventDefault();

  const id = $('editRuleId').value;
  if (!recurringRules.find(r => r.id === id)) return;

  const startDate = $('editRuleStart').value;
  const endDate = $('editRuleEnd').value || null;

  if (!startDate || (endDate && endDate < startDate)) {
    $('editRuleMessage').textContent = 'Confira as datas informadas.';
    return;
  }

  const frequency = $('editRuleFrequency').value;
  const position = frequency === 'monthly' ? $('editRulePosition').value : null;

  const updatedRule = {
    description: $('editRuleDescription').value.trim(),
    amount: Number($('editRuleAmount').value),
    currency: $('editRuleCurrency').value,
    category: $('editRuleCategory').value,
    frequency,
    monthly_position: position,
    monthly_day: frequency === 'monthly' && position === 'fixed'
      ? Number($('editRuleDay').value)
      : null,
    start_date: startDate,
    end_date: endDate
  };

  if (!updatedRule.description || !(updatedRule.amount > 0)) {
    $('editRuleMessage').textContent = 'Informe descrição e valor válidos.';
    return;
  }

  $('saveRuleChanges').disabled = true;
  $('saveRuleChanges').textContent = 'Salvando...';

  try {
    const { error } = await db
      .from('recurring_rules')
      .update(updatedRule)
      .eq('id', id)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    // Remove as ocorrências futuras ainda previstas; o refresh as recria
    // com as novas regras. O histórico (passado/efetivado) é preservado.
    await deleteFutureOccurrences(id);

    closeEditRule();
    await refresh();
    notify('Recorrência atualizada com sucesso.');
  } catch (error) {
    $('editRuleMessage').textContent = error.message;
  } finally {
    $('saveRuleChanges').disabled = false;
    $('saveRuleChanges').textContent = 'Salvar alterações';
  }
});

// ============ AÇÕES EM MOVIMENTAÇÕES ============

async function deleteTransaction(id) {
  const t = transactions.find(x => x.id === id);
  if (!t) return;

  const question = t.recurrence_key
    ? 'Excluir somente esta ocorrência da recorrência? Ela não será recriada. (Para parar de gerar, cancele a regra na aba Recorrências.)'
    : 'Deseja excluir esta movimentação?';

  if (!confirm(question)) return;

  try {
    if (t.recurrence_key) {
      const { error: skipError } = await db
        .from('recurring_skips')
        .upsert(
          { user_id: currentUser.id, recurrence_key: t.recurrence_key },
          { onConflict: 'user_id,recurrence_key', ignoreDuplicates: true }
        );

      if (skipError) throw skipError;
    }

    const { error } = await db
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    notify('Movimentação excluída.');
  } catch (error) {
    notify('Erro ao excluir: ' + error.message);
  }

  await refresh({ generate: false });
}

// Marca um lançamento previsto como pago/recebido hoje.
async function markPaid(id) {
  const t = transactions.find(x => x.id === id);
  if (!t) return;

  const today = localISO();
  const date = t.transaction_date > today ? today : t.transaction_date;

  const { error } = await db
    .from('transactions')
    .update({ is_future: false, transaction_date: date })
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) {
    notify('Erro: ' + error.message);
    return;
  }

  notify(t.type === 'income' ? 'Marcado como recebido.' : 'Marcado como pago.');
  await refresh({ generate: false });
}

// ============ INDICADORES ============

function filteredTransactions() {
  const currency = $('currencyFilter').value;
  if (currency === 'ALL') return transactions;
  return transactions.filter(t => t.currency === currency);
}

function totals(list, currency) {
  const relevant = list.filter(t => t.currency === currency && !t.is_benefit);

  const income = relevant
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + Number(t.amount), 0);

  const expense = relevant
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + Number(t.amount), 0);

  return { income, expense, balance: income - expense };
}

function benefitTotals(list, currency) {
  return list
    .filter(t => t.currency === currency && t.is_benefit && t.type === 'income')
    .reduce((s, t) => s + Number(t.amount), 0);
}

function render() {
  if (!currentUser) return;

  const list = filteredTransactions();
  const currency = $('currencyFilter').value;
  const now = localISO();
  const start = monthStart();

  const current = list.filter(isSettled);
  const future = list.filter(t => !isSettled(t));

  const month = current.filter(t =>
    t.transaction_date >= start && t.transaction_date <= now
  );

  if (currency === 'ALL') {
    ['currentBalance', 'incomeTotal', 'expenseTotal', 'futureBalance', 'benefitsTotal']
      .forEach(id => { $(id).textContent = 'Multimoeda'; });
  } else {
    const currentTotals = totals(current, currency);
    const monthTotals = totals(month, currency);
    const futureTotals = totals(future, currency);

    $('currentBalance').textContent = money(currentTotals.balance, currency);
    $('incomeTotal').textContent = money(monthTotals.income, currency);
    $('expenseTotal').textContent = money(monthTotals.expense, currency);
    $('futureBalance').textContent =
      money(currentTotals.balance + futureTotals.balance, currency);
    $('benefitsTotal').textContent =
      money(benefitTotals(month, currency), currency);
  }

  $('overviewCurrencies').classList.toggle('hidden', currency !== 'ALL');

  renderCurrencyOverview();
  renderDailyLimit();
  renderCategories(month);
  renderRecent(list);
  renderUpcoming(list);
  renderAll(list);
  renderRecurringRules();
  renderDebts();
}

function renderCurrencyOverview() {
  const now = localISO();
  const start = monthStart();
  const settled = transactions.filter(isSettled);

  $('overviewCurrencies').innerHTML = Object.keys(currencies).map(code => {
    const t = totals(settled, code);
    const benefits = benefitTotals(
      settled.filter(x => x.transaction_date >= start && x.transaction_date <= now),
      code
    );

    return `
      <div class="currency-chip">
        <span>${code} · Saldo atual</span>
        <strong>${money(t.balance, code)}</strong>
        <span class="currency-benefit">Benefícios no mês: ${money(benefits, code)}</span>
      </div>
    `;
  }).join('');
}

// Limite diário = (saldo - contas previstas até o fim do mês) / dias restantes
function renderDailyLimit() {
  const filter = $('currencyFilter').value;
  const cur = filter === 'ALL' ? 'BRL' : filter;

  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endISO = localISO(last);
  const days = last.getDate() - now.getDate() + 1;

  const mine = transactions.filter(t => t.currency === cur && !t.is_benefit);
  const balance = totals(mine.filter(isSettled), cur).balance;
  const pending = mine.filter(t => !isSettled(t) && t.transaction_date <= endISO);

  const sumType = type => pending
    .filter(t => t.type === type)
    .reduce((s, t) => s + Number(t.amount), 0);

  const bills = sumType('expense');
  const incoming = sumType('income');
  const limit = (balance - bills) / days;

  $('dailyLimit').textContent = `${money(limit, cur)} / dia`;
  $('dailyLimit').className = limit >= 0 ? 'green' : 'red';
  $('dailyLimitNote').textContent =
    `${cur}: saldo ${money(balance, cur)} − contas previstas ${money(bills, cur)} ÷ ${days} dia(s) restante(s). ` +
    `A receber até o fim do mês (não incluído): ${money(incoming, cur)}.`;
}

function renderCategories(month) {
  const filter = $('currencyFilter').value;
  const cur = filter === 'ALL' ? 'BRL' : filter;

  const byCat = {};
  month
    .filter(t => t.currency === cur && t.type === 'expense' && !t.is_benefit)
    .forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount); });

  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  $('categoryBreakdown').innerHTML = entries.length
    ? entries.map(([cat, value]) => `
        <div class="cat-row"><strong>${escapeHTML(cat)}</strong><span>${money(value, cur)} · ${(value / total * 100).toFixed(0)}%</span></div>
        <div class="progress-track cat-bar"><div style="width:${(value / total * 100).toFixed(1)}%"></div></div>
      `).join('')
    : `<div class="empty">Nenhum gasto efetivado neste mês (${cur}).</div>`;
}

// ============ LISTAS DE MOVIMENTAÇÕES ============

function transactionHTML(t, { del = false, pay = false } = {}) {
  const income = t.type === 'income';
  const future = !isSettled(t);
  const benefit = t.is_benefit;
  const recurring = Boolean(t.recurrence_id);

  const badges = `
    <div class="transaction-badges">
      ${future ? '<span class="mini-badge">PREVISTO</span>' : ''}
      ${benefit ? `<span class="mini-badge benefit">${escapeHTML(benefitNames[t.benefit_type] || 'BENEFÍCIO')}</span>` : ''}
      ${recurring ? '<span class="mini-badge recurring">RECORRENTE</span>' : ''}
    </div>
  `;

  const actions = (pay && future) || del ? `
    <div class="transaction-actions">
      ${pay && future ? `<button class="pay-btn" data-action="pay" data-id="${t.id}" title="Marcar como ${income ? 'recebido' : 'pago'}">${income ? 'Receber' : 'Pagar'}</button>` : ''}
      ${del ? `<button class="delete-btn" data-action="delete" data-id="${t.id}" title="Excluir">✕</button>` : ''}
    </div>
  ` : '';

  return `
    <div class="transaction-row">
      <div class="transaction-icon">${benefit ? '✳' : (income ? '↗' : '↘')}</div>
      <div class="transaction-info">
        <strong>${escapeHTML(t.description)}</strong>
        <small>${escapeHTML(t.category)} · ${formatDate(t.transaction_date)} · ${t.currency}</small>
        ${badges}
      </div>
      <div class="transaction-amount ${income ? 'green' : 'red'}">
        ${income ? '+' : '-'}${money(t.amount, t.currency)}
      </div>
      ${actions}
    </div>
  `;
}

function renderRecent(list) {
  const recent = list
    .filter(isSettled)
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    .slice(0, 6);

  $('recentTransactions').innerHTML = recent.length
    ? recent.map(t => transactionHTML(t)).join('')
    : '<div class="empty">Nenhuma movimentação registrada.</div>';
}

function renderUpcoming(list) {
  const upcoming = list
    .filter(t => !isSettled(t))
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
    .slice(0, 8);

  $('upcomingTransactions').innerHTML = upcoming.length
    ? upcoming.map(t => transactionHTML(t, { pay: true })).join('')
    : '<div class="empty">Nenhum lançamento futuro.</div>';
}

function applyFilters(list) {
  const q = $('searchInput').value.trim().toLowerCase();
  const month = $('monthFilter').value; // AAAA-MM
  const type = $('typeFilter').value;

  return list.filter(t => {
    if (q && !`${t.description} ${t.category}`.toLowerCase().includes(q)) return false;
    if (month && !t.transaction_date.startsWith(month)) return false;
    if (type === 'income' && t.type !== 'income') return false;
    if (type === 'expense' && t.type !== 'expense') return false;
    if (type === 'future' && isSettled(t)) return false;
    if (type === 'benefit' && !t.is_benefit) return false;
    return true;
  });
}

function renderAll(list) {
  const sorted = applyFilters(list).sort((a, b) =>
    b.transaction_date.localeCompare(a.transaction_date)
  );

  $('allTransactions').innerHTML = sorted.length
    ? sorted.map(t => transactionHTML(t, { del: true, pay: true })).join('')
    : '<div class="empty">Nenhuma movimentação encontrada.</div>';
}

['searchInput', 'monthFilter', 'typeFilter'].forEach(id => {
  $(id).addEventListener('input', () => renderAll(filteredTransactions()));
});

function exportCsv() {
  const rows = applyFilters(filteredTransactions());
  const safe = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas no Excel
    return `"${s.replace(/"/g, '""')}"`;
  };

  const header = ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Moeda', 'Benefício', 'Previsto'];
  const lines = [header, ...rows.map(t => [
    t.transaction_date,
    t.description,
    t.category,
    t.type === 'income' ? 'Entrada' : 'Saída',
    Number(t.amount).toFixed(2).replace('.', ','),
    t.currency,
    t.is_benefit ? 'Sim' : 'Não',
    isSettled(t) ? 'Não' : 'Sim'
  ])].map(r => r.map(safe).join(';'));

  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `orbit-movimentacoes-${localISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('exportCsv').addEventListener('click', exportCsv);

// ============ RENDER DE RECORRÊNCIAS ============

function recurrenceDescription(rule) {
  if (rule.frequency === 'daily') return 'Todos os dias';
  if (rule.monthly_position === 'last_business') return 'Último dia útil de cada mês';
  if (rule.monthly_position === 'penultimate_business') return 'Penúltimo dia útil de cada mês';
  return `Todo dia ${rule.monthly_day} de cada mês`;
}

function renderRecurringRules() {
  const active = recurringRules.filter(r => r.active);
  const paused = recurringRules.filter(r => !r.active);

  $('activeRulesCount').textContent = active.length;
  $('pausedRulesCount').textContent = paused.length;

  if (!recurringRules.length) {
    $('recurringRulesList').innerHTML = `
      <div class="rule-empty">
        <strong>Nenhuma recorrência cadastrada</strong>
        <p>Crie sua primeira regra para automatizar salários, contas e benefícios.</p>
      </div>
    `;
    return;
  }

  $('recurringRulesList').innerHTML = recurringRules.map(rule => {
    const isIncome = rule.type === 'income';
    const benefit = rule.is_benefit
      ? `<span class="mini-badge benefit">${escapeHTML(benefitNames[rule.benefit_type] || 'BENEFÍCIO')}</span>`
      : '';

    return `
      <div class="rule-card">
        <div class="rule-main">
          <div class="rule-icon">${isIncome ? '↗' : '↘'}</div>
          <div class="rule-info">
            <strong>${escapeHTML(rule.description)}</strong>
            <small>${escapeHTML(rule.category)} · ${escapeHTML(recurrenceDescription(rule))}</small>
            <small>
              Início: ${formatDate(rule.start_date)}
              ${rule.end_date ? ` · Término: ${formatDate(rule.end_date)}` : ' · Sem data final'}
            </small>
            <div class="transaction-badges">
              ${benefit}
              <span class="rule-status ${rule.active ? '' : 'paused'}">${rule.active ? 'Ativa' : 'Pausada'}</span>
            </div>
          </div>
          <div class="rule-amount ${isIncome ? 'green' : 'red'}">
            ${money(rule.amount, rule.currency)}
          </div>
        </div>

        <div class="rule-actions">
          <button class="rule-action" data-action="edit-rule" data-id="${rule.id}">Editar</button>
          ${rule.active
            ? `<button class="rule-action danger" data-action="rule-status" data-id="${rule.id}" data-active="false">Cancelar</button>`
            : `<button class="rule-action" data-action="rule-status" data-id="${rule.id}" data-active="true">Reativar</button>`}
        </div>
      </div>
    `;
  }).join('');
}

// ============ DÍVIDAS ============

$('debtForm').addEventListener('submit', async e => {
  e.preventDefault();

  const { error } = await db.from('debts').insert({
    user_id: currentUser.id,
    name: $('debtName').value.trim(),
    balance: Number($('debtBalance').value),
    monthly_rate: Number($('debtRate').value),
    min_payment: Number($('debtMin').value)
  });

  if (error) {
    notify('Erro ao salvar dívida: ' + error.message);
    return;
  }

  e.target.reset();
  notify('Dívida adicionada.');
  await refresh({ generate: false });
});

async function deleteDebt(id) {
  if (!confirm('Excluir esta dívida?')) return;

  const { error } = await db
    .from('debts')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) {
    notify('Erro: ' + error.message);
    return;
  }

  await refresh({ generate: false });
}

function simulateDebts(budget, method) {
  const d = debts.map(x => ({
    name: x.name,
    rate: Number(x.monthly_rate),
    min: Number(x.min_payment),
    bal: Number(x.balance),
    end: null
  }));

  let months = 0;
  let interest = 0;

  while (d.some(x => x.bal > 0.005) && months < 600) {
    months++;

    d.forEach(x => {
      if (x.bal > 0) {
        const j = x.bal * x.rate / 100;
        x.bal += j;
        interest += j;
      }
    });

    let left = budget;

    d.forEach(x => {
      if (x.bal > 0) {
        const p = Math.min(x.min, x.bal);
        x.bal -= p;
        left -= p;
      }
    });

    d.filter(x => x.bal > 0)
      .sort((a, b) => method === 'snowball' ? a.bal - b.bal : b.rate - a.rate)
      .forEach(x => {
        if (left > 0) {
          const p = Math.min(left, x.bal);
          x.bal -= p;
          left -= p;
        }
      });

    d.forEach(x => {
      if (x.bal <= 0.005 && x.end === null) x.end = months;
    });
  }

  return { d, months, interest, ok: !d.some(x => x.bal > 0.005) };
}

function renderDebts() {
  const total = debts.reduce((s, x) => s + Number(x.balance), 0);
  const mins = debts.reduce((s, x) => s + Number(x.min_payment), 0);

  $('debtList').innerHTML = debts.length
    ? debts.map(x => `
        <div class="transaction-row">
          <div class="transaction-icon">▤</div>
          <div class="transaction-info">
            <strong>${escapeHTML(x.name)}</strong>
            <small>Juros ${Number(x.monthly_rate)}% a.m. · mínima ${money(x.min_payment, 'BRL')}</small>
          </div>
          <div class="transaction-amount red">${money(x.balance, 'BRL')}</div>
          <div class="transaction-actions">
            <button class="delete-btn" data-action="del-debt" data-id="${x.id}" title="Excluir">✕</button>
          </div>
        </div>
      `).join('') +
      `<div class="empty">Total: <b>${money(total, 'BRL')}</b> · mínimas somam ${money(mins, 'BRL')}/mês</div>`
    : '<div class="empty">Nenhuma dívida cadastrada.</div>';

  const budget = Number($('debtBudget').value) || 0;

  if (!debts.length || !budget) {
    $('debtPlan').innerHTML =
      '<p class="muted">Cadastre dívidas e informe quanto pode pagar por mês.</p>';
    return;
  }

  const method = $('debtMethod').value;
  const r = simulateDebts(budget, method);

  let html = budget < mins
    ? `<p class="red">O valor é menor que a soma das mínimas (${money(mins, 'BRL')}).</p>`
    : '';

  html += r.ok
    ? `<div class="investment-total">${r.months} meses</div>
       <div class="result-line"><span>Juros pagos no período</span><strong class="red">${money(r.interest, 'BRL')}</strong></div>`
    : '<p class="red">Com esse valor os juros superam os pagamentos. Aumente o valor mensal.</p>';

  const order = r.d.slice().sort((a, b) =>
    method === 'snowball' ? a.bal - b.bal : b.rate - a.rate
  );

  html += order.map(x => `
    <div class="result-line">
      <span>${escapeHTML(x.name)} (${x.rate}% a.m.)</span>
      <strong>${x.end !== null ? 'quitada no mês ' + x.end : '—'}</strong>
    </div>
  `).join('');

  $('debtPlan').innerHTML = html;
}

$('debtBudget').addEventListener('input', renderDebts);
$('debtMethod').addEventListener('change', renderDebts);

// ============ MODAL DE MOVIMENTAÇÃO ============

function updateRecurrenceFields() {
  const recurring = $('isRecurring').checked;
  const monthly = $('recurrenceFrequency').value === 'monthly';
  const fixed = $('monthlyPosition').value === 'fixed';

  $('recurrenceFields').classList.toggle('hidden', !recurring);
  $('monthlyFields').classList.toggle('hidden', !monthly);
  $('monthlyDayWrap').classList.toggle('hidden', !monthly || !fixed);
  $('futureWrap').classList.toggle('hidden', recurring);
}

function updateBenefitFields() {
  const isIncome = $('transactionType').value === 'income';
  const checked = $('isBenefit').checked && isIncome;

  $('benefitToggleWrap').classList.toggle('hidden', !isIncome);
  $('benefitFields').classList.toggle('hidden', !checked);

  if (checked) $('category').value = 'Benefícios';
}

function updateCalendarLabel(value) {
  $('transactionDate').dataset.value = value;
  $('transactionDateLabel').textContent = formatDate(value);
}

function openModal() {
  $('transactionModal').classList.remove('hidden');
  $('transactionMessage').textContent = '';
  $('transactionForm').reset();

  calendarSelectedDate = new Date();
  calendarDate = new Date();

  const today = localISO(calendarSelectedDate);

  updateCalendarLabel(today);
  $('recurrenceStart').value = today;
  $('recurrenceEnd').value = '';
  $('calendar').classList.add('hidden');

  updateRecurrenceFields();
  updateBenefitFields();
}

function closeModal() {
  $('transactionModal').classList.add('hidden');
  $('calendar').classList.add('hidden');
}

$('newTransaction').addEventListener('click', openModal);
$('newTransaction2').addEventListener('click', openModal);
$('newRecurringFromPage').addEventListener('click', () => {
  openModal();
  $('isRecurring').checked = true;
  updateRecurrenceFields();
});
$('closeModal').addEventListener('click', closeModal);

$('transactionModal').addEventListener('click', e => {
  if (e.target === $('transactionModal')) closeModal();
});

$('transactionType').addEventListener('change', updateBenefitFields);
$('isBenefit').addEventListener('change', updateBenefitFields);
$('isRecurring').addEventListener('change', updateRecurrenceFields);
$('recurrenceFrequency').addEventListener('change', updateRecurrenceFields);
$('monthlyPosition').addEventListener('change', updateRecurrenceFields);

$('transactionForm').addEventListener('submit', async e => {
  e.preventDefault();

  const isBenefit = $('isBenefit').checked && $('transactionType').value === 'income';
  const isRecurring = $('isRecurring').checked;
  const date = $('transactionDate').dataset.value;

  const transaction = {
    type: $('transactionType').value,
    description: $('description').value.trim(),
    amount: Number($('amount').value),
    currency: $('transactionCurrency').value,
    category: isBenefit ? 'Benefícios' : $('category').value,
    transaction_date: date,
    // Data futura vira "prevista" automaticamente.
    is_future: $('isFuture').checked || date > localISO(),
    is_benefit: isBenefit,
    benefit_type: isBenefit ? $('benefitType').value : null
  };

  if (!transaction.transaction_date || !(transaction.amount > 0) || !transaction.description) {
    $('transactionMessage').textContent = 'Confira a descrição, a data e o valor.';
    return;
  }

  $('saveTransaction').disabled = true;
  $('saveTransaction').textContent = 'Salvando...';

  try {
    if (isRecurring) {
      $('recurrenceStart').value = transaction.transaction_date;
      await createRecurringRule(transaction);
      notify('Recorrência criada com sucesso.');
    } else {
      await saveTransaction(transaction);
      notify('Movimentação salva com sucesso.');
    }

    closeModal();
  } catch (error) {
    $('transactionMessage').textContent = error.message;
  } finally {
    $('saveTransaction').disabled = false;
    $('saveTransaction').textContent = 'Salvar movimentação';
  }
});

// ============ CALENDÁRIO ORBIT ============

$('transactionDate').addEventListener('click', () => {
  $('calendar').classList.toggle('hidden');

  if (!$('calendar').classList.contains('hidden')) {
    const value = $('transactionDate').dataset.value || localISO();
    calendarSelectedDate = dateFromISO(value);
    calendarDate = new Date(
      calendarSelectedDate.getFullYear(),
      calendarSelectedDate.getMonth(),
      1
    );
    renderCalendar();
  }
});

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const today = localISO();
  const selected = localISO(calendarSelectedDate);

  const monthName = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric'
  }).format(calendarDate);

  let html = `
    <div class="calendar-header">
      <strong class="calendar-month">${monthName}</strong>
      <div class="calendar-nav">
        <button type="button" id="prevMonth" aria-label="Mês anterior">‹</button>
        <button type="button" id="nextMonth" aria-label="Próximo mês">›</button>
      </div>
    </div>
    <div class="calendar-grid">
      ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<span class="weekday">${d}</span>`).join('')}
  `;

  for (let i = 0; i < firstDay; i++) html += '<span class="empty-day"></span>';

  for (let d = 1; d <= days; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const classes = [
      date === selected ? 'selected' : '',
      date === today ? 'today' : ''
    ].filter(Boolean).join(' ');

    html += `<button type="button" class="${classes}" data-date="${date}">${d}</button>`;
  }

  html += `
    </div>
    <div class="calendar-footer">
      <button type="button" id="calendarToday">Hoje</button>
      <div>
        <button type="button" id="calendarClose">Fechar</button>
        <button type="button" class="calendar-confirm" id="calendarConfirm">Confirmar</button>
      </div>
    </div>
  `;

  $('calendar').innerHTML = html;

  $('prevMonth').addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderCalendar();
  });

  $('nextMonth').addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderCalendar();
  });

  $('calendar').querySelectorAll('[data-date]').forEach(button => {
    button.addEventListener('click', () => {
      calendarSelectedDate = dateFromISO(button.dataset.date);
      renderCalendar();
    });
  });

  $('calendarToday').addEventListener('click', () => {
    calendarSelectedDate = new Date();
    calendarDate = new Date(
      calendarSelectedDate.getFullYear(),
      calendarSelectedDate.getMonth(),
      1
    );
    renderCalendar();
  });

  $('calendarClose').addEventListener('click', () => {
    $('calendar').classList.add('hidden');
  });

  $('calendarConfirm').addEventListener('click', () => {
    const value = localISO(calendarSelectedDate);
    updateCalendarLabel(value);
    if ($('isRecurring').checked) $('recurrenceStart').value = value;
    $('calendar').classList.add('hidden');
  });
}

// ============ INVESTIMENTOS ============

function calculateInvestment() {
  const currency = $('investmentCurrency').value;
  const initial = Math.max(0, Number($('initialInvestment').value));
  const monthly = Math.max(0, Number($('monthlyInvestment').value));
  const typed = Math.max(0, Number($('interestRate').value)) / 100;
  const months = Number($('investmentPeriod').value);

  // Taxa anual é convertida para a taxa mensal equivalente.
  const rate = $('rateType').value === 'year'
    ? Math.pow(1 + typed, 1 / 12) - 1
    : typed;

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

[
  'initialInvestment', 'monthlyInvestment', 'interestRate',
  'rateType', 'investmentPeriod', 'investmentCurrency'
].forEach(id => $(id).addEventListener('change', calculateInvestment));

// ============ NAVEGAÇÃO ============

function navigate(page) {
  const pageElement = $(`${page}Page`);
  if (!pageElement) return;

  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  pageElement.classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });

  const titles = {
    dashboard: 'Visão geral',
    transactions: 'Movimentações',
    recurrences: 'Recorrências',
    debts: 'Dívidas',
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

// Cliques nos botões gerados dinamicamente
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const { action, id } = el.dataset;

  if (action === 'delete') deleteTransaction(id);
  else if (action === 'pay') markPaid(id);
  else if (action === 'edit-rule') openEditRule(id);
  else if (action === 'rule-status') setRuleStatus(id, el.dataset.active === 'true');
  else if (action === 'del-debt') deleteDebt(id);
});

// ============ INICIALIZAÇÃO ============

async function initialize() {
  calculateInvestment();
  populateDays('monthlyDay');
  populateDays('editRuleDay');
  updateRecurrenceFields();
  updateBenefitFields();
  updateEditRuleFields();

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

db.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') showAuth();
});

initialize();
