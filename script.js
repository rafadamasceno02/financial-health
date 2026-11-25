
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
let signupMode = false;
let calendarDate = new Date();
let calendarSelectedDate = null;
let recurringRules = [];
let currentPage = 'dashboard';

// UTILITÁRIOS

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

function notify(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 3000);
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

  await loadRecurringRules();
  await generateRecurringOccurrences();
  await loadTransactions();
  render();
  renderRecurringRules();
}

$('logout').addEventListener('click', async () => {
  await db.auth.signOut();
  currentUser = null;
  transactions = [];
  recurringRules = [];
  $('app').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
});

// BANCO DE DADOS

async function loadRecurringRules() {
  const { data, error } = await db
    .from('recurring_rules')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    notify('Erro ao carregar recorrências: ' + error.message);
    recurringRules = [];
    return;
  }

  recurringRules = data || [];
}

async function loadTransactions() {
  const { data, error } = await db
    .from('transactions')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('transaction_date', { ascending: false });

  if (error) {
    notify('Erro ao carregar movimentações: ' + error.message);
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
      is_future: transaction.is_future,
      is_benefit: transaction.is_benefit,
      benefit_type: transaction.benefit_type,
      recurrence_id: null,
      recurrence_key: null
    });

  if (error) throw error;

  await loadTransactions();
  render();
}

// RECORRÊNCIAS

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

      if (position === 'last_business' && found === 1) {
        return localISO(date);
      }

      if (position === 'penultimate_business' && found === 2) {
        return localISO(date);
      }
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
  const horizon = addDaysISO(today, 365);
  const earliest = addDaysISO(today, -730);

  const start = rule.start_date > earliest
    ? rule.start_date
    : earliest;

  const end = rule.end_date && rule.end_date < horizon
    ? rule.end_date
    : horizon;

  if (start > end) return dates;

  if (rule.frequency === 'daily') {
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
      const dates = getRuleOccurrences(rule, today);

      dates.forEach(date => {
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
          recurrence_key: `${rule.id}:${date}`
        });
      });
    });

  if (!rows.length) return;

  const { error } = await db
    .from('transactions')
    .upsert(rows, {
      onConflict: 'recurrence_key',
      ignoreDuplicates: true
    });

  if (error) {
    notify('Erro ao gerar recorrências: ' + error.message);
  }
}

async function createRecurringRule(transaction) {
  const frequency = $('recurrenceFrequency').value;
  const position = frequency === 'monthly'
    ? $('monthlyPosition').value
    : null;

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

  const { error } = await db
    .from('recurring_rules')
    .insert(rule);

  if (error) throw error;

  await loadRecurringRules();
  await generateRecurringOccurrences();
  await loadTransactions();
  render();
  renderRecurringRules();
}

// CANCELAR / REATIVAR REGRA

async function setRuleStatus(id, active) {
  const rule = recurringRules.find(r => r.id === id);
  if (!rule) return;

  const question = active
    ? 'Deseja reativar esta recorrência?'
    : 'Deseja cancelar esta recorrência? Os lançamentos já criados serão mantidos.';

  if (!confirm(question)) return;

  const { error } = await db
    .from('recurring_rules')
    .update({ active })
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) {
    notify('Erro ao atualizar recorrência: ' + error.message);
    return;
  }

  await loadRecurringRules();

  if (active) {
    await generateRecurringOccurrences();
    notify('Recorrência reativada.');
  } else {
    notify('Recorrência cancelada. Histórico preservado.');
  }

  await loadTransactions();
  render();
  renderRecurringRules();
}

// EDIÇÃO DE REGRA

function populateEditRuleDays() {
  $('editRuleDay').innerHTML = Array.from({ length: 31 }, (_, i) => {
    const day = i + 1;
    return `<option value="${day}">${day}º dia</option>`;
  }).join('');
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

  populateEditRuleDays();

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
  const rule = recurringRules.find(r => r.id === id);

  if (!rule) return;

  const startDate = $('editRuleStart').value;
  const endDate = $('editRuleEnd').value || null;

  if (!startDate || (endDate && endDate < startDate)) {
    $('editRuleMessage').textContent = 'Confira as datas informadas.';
    return;
  }

  const frequency = $('editRuleFrequency').value;
  const position = frequency === 'monthly'
    ? $('editRulePosition').value
    : null;

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

  if (!updatedRule.description || updatedRule.amount <= 0) {
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

    // Atualiza somente ocorrências futuras.
    // O histórico passado permanece intacto.
    const today = localISO();

    const { error: transactionError } = await db
      .from('transactions')
      .update({
        description: updatedRule.description,
        amount: updatedRule.amount,
        currency: updatedRule.currency,
        category: updatedRule.category,
        is_future: true
      })
      .eq('recurrence_id', id)
      .eq('user_id', currentUser.id)
      .gte('transaction_date', addDaysISO(today, 1));

    if (transactionError) throw transactionError;

    await loadRecurringRules();
    await generateRecurringOccurrences();
    await loadTransactions();

    render();
    renderRecurringRules();
    closeEditRule();

    notify('Recorrência atualizada com sucesso.');
  } catch (error) {
    $('editRuleMessage').textContent = error.message;
  } finally {
    $('saveRuleChanges').disabled = false;
    $('saveRuleChanges').textContent = 'Salvar alterações';
  }
});

// EXCLUSÃO DE MOVIMENTAÇÃO

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
  const relevant = list.filter(t =>
    t.currency === currency && !t.is_benefit
  );

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
    .filter(t =>
      t.currency === currency &&
      t.is_benefit &&
      t.type === 'income'
    )
    .reduce((s, t) => s + Number(t.amount), 0);
}

function render() {
  if (!currentUser) return;

  const list = filteredTransactions();
  const currency = $('currencyFilter').value;
  const now = localISO();
  const start = monthStart();

  const current = list.filter(t => !t.is_future);
  const future = list.filter(t =>
    t.is_future && t.transaction_date >= now
  );

  const month = current.filter(t =>
    t.transaction_date >= start &&
    t.transaction_date <= now
  );

  const monthBenefits = month.filter(t => t.is_benefit);

  if (currency === 'ALL') {
    $('currentBalance').textContent = 'Multimoeda';
    $('incomeTotal').textContent = 'Multimoeda';
    $('expenseTotal').textContent = 'Multimoeda';
    $('futureBalance').textContent = 'Multimoeda';
    $('benefitsTotal').textContent = 'Multimoeda';
  } else {
    const currentTotals = totals(current, currency);
    const monthTotals = totals(month, currency);
    const futureTotals = totals(future, currency);
    const benefits = benefitTotals(monthBenefits, currency);

    $('currentBalance').textContent =
      money(currentTotals.balance, currency);

    $('incomeTotal').textContent =
      money(monthTotals.income, currency);

    $('expenseTotal').textContent =
      money(monthTotals.expense, currency);

    $('futureBalance').textContent =
      money(currentTotals.balance + futureTotals.balance, currency);

    $('benefitsTotal').textContent =
      money(benefits, currency);
  }

  // Os cartões das outras moedas aparecem somente na visão geral.
  $('overviewCurrencies').classList.toggle(
    'hidden',
    currency !== 'ALL'
  );

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

    const benefits = benefitTotals(
      transactions.filter(x =>
        !x.is_future &&
        x.transaction_date >= monthStart() &&
        x.transaction_date <= localISO()
      ),
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

// LISTAS DE MOVIMENTAÇÕES

function transactionHTML(t, showDelete = false) {
  const income = t.type === 'income';
  const future = t.is_future;
  const benefit = t.is_benefit;
  const recurring = Boolean(t.recurrence_id);

  const badges = `
    <div class="transaction-badges">
      ${future ? '<span class="mini-badge">PREVISTO</span>' : ''}
      ${benefit ? `<span class="mini-badge benefit">${escapeHTML(benefitNames[t.benefit_type] || 'BENEFÍCIO')}</span>` : ''}
      ${recurring ? '<span class="mini-badge recurring">RECORRENTE</span>' : ''}
    </div>
  `;

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
      ${showDelete ? `
        <div class="transaction-actions">
          <button class="delete-btn" data-delete="${t.id}" title="Excluir ocorrência">✕</button>
        </div>
      ` : ''}
    </div>
  `;
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
    .slice(0, 8);

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

// RENDERIZAÇÃO DA ABA DE RECORRÊNCIAS

function recurrenceDescription(rule) {
  if (rule.frequency === 'daily') return 'Todos os dias';

  if (rule.monthly_position === 'last_business') {
    return 'Último dia útil de cada mês';
  }

  if (rule.monthly_position === 'penultimate_business') {
    return 'Penúltimo dia útil de cada mês';
  }

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
    const status = rule.active ? 'Ativa' : 'Pausada';
    const benefit = rule.is_benefit
      ? `<span class="mini-badge benefit">${escapeHTML(benefitNames[rule.benefit_type] || 'BENEFÍCIO')}</span>`
      : '';

    return `
      <div class="rule-card">
        <div class="rule-main">
          <div class="rule-icon">${isIncome ? '↗' : '↘'}</div>
          <div class="rule-info">
            <strong>${escapeHTML(rule.description)}</strong>
            <small>
              ${escapeHTML(rule.category)} · ${escapeHTML(recurrenceDescription(rule))}
            </small>
            <small>
              Início: ${formatDate(rule.start_date)}
              ${rule.end_date ? ` · Término: ${formatDate(rule.end_date)}` : ' · Sem data final'}
            </small>
            <div class="transaction-badges">
              ${benefit}
              <span class="rule-status ${rule.active ? '' : 'paused'}">${status}</span>
            </div>
          </div>
          <div class="rule-amount ${isIncome ? 'green' : 'red'}">
            ${money(rule.amount, rule.currency)}
          </div>
        </div>

        <div class="rule-actions">
          <button class="rule-action" data-edit-rule="${rule.id}">Editar</button>
          ${
            rule.active
              ? `<button class="rule-action danger" data-rule-status="${rule.id}" data-active="false">Cancelar</button>`
              : `<button class="rule-action" data-rule-status="${rule.id}" data-active="true">Reativar</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('[data-edit-rule]').forEach(button => {
    button.addEventListener('click', () => {
      openEditRule(button.dataset.editRule);
    });
  });

  document.querySelectorAll('[data-rule-status]').forEach(button => {
    button.addEventListener('click', () => {
      setRuleStatus(
        button.dataset.ruleStatus,
        button.dataset.active === 'true'
      );
    });
  });
}

// MODAL DE MOVIMENTAÇÃO

function populateMonthlyDays() {
  $('monthlyDay').innerHTML = Array.from({ length: 31 }, (_, i) => {
    const day = i + 1;
    return `<option value="${day}">${day}º dia</option>`;
  }).join('');
}

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

  if (checked) {
    $('category').value = 'Benefícios';
  }
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

  populateMonthlyDays();
  updateRecurrenceFields();
  updateBenefitFields();
  renderCalendar();
}

function closeModal() {
  $('transactionModal').classList.add('hidden');
  $('calendar').classList.add('hidden');
}

$('newTransaction').addEventListener('click', openModal);
$('newTransaction2').addEventListener('click', openModal);
$('newRecurringFromPage').addEventListener('click', openModal);
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

  const isBenefit = $('isBenefit').checked &&
    $('transactionType').value === 'income';

  const isRecurring = $('isRecurring').checked;

  const transaction = {
    type: $('transactionType').value,
    description: $('description').value.trim(),
    amount: Number($('amount').value),
    currency: $('transactionCurrency').value,
    category: isBenefit ? 'Benefícios' : $('category').value,
    transaction_date: $('transactionDate').dataset.value,
    is_future: $('isFuture').checked,
    is_benefit: isBenefit,
    benefit_type: isBenefit ? $('benefitType').value : null
  };

  if (!transaction.transaction_date || transaction.amount <= 0) {
    $('transactionMessage').textContent = 'Confira a data e o valor.';
    return;
  }

  if (!isRecurring && !transaction.is_future &&
      transaction.transaction_date > localISO()) {
    $('transactionMessage').textContent =
      'Para uma data futura, marque a opção de movimentação prevista.';
    return;
  }

  if (isRecurring && $('recurrenceStart').value === '') {
    $('transactionMessage').textContent =
      'Informe a data de início da recorrência.';
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

// CALENDÁRIO PERSONALIZADO ORBIT

function updateCalendarLabel(value) {
  $('transactionDate').dataset.value = value;
  $('transactionDateLabel').textContent = formatDate(value);
}

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
      ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
        .map(d => `<span class="weekday">${d}</span>`).join('')}
  `;

  for (let i = 0; i < firstDay; i++) {
    html += '<span class="empty-day"></span>';
  }

  for (let d = 1; d <= days; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const classes = [
      date === selected ? 'selected' : '',
      date === today ? 'today' : ''
    ].filter(Boolean).join(' ');

    html += `
      <button type="button" class="${classes}" data-date="${date}">
        ${d}
      </button>
    `;
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
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendar();
  });

  $('nextMonth').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
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

    if ($('isRecurring').checked) {
      $('recurrenceStart').value = value;
    }

    $('calendar').classList.add('hidden');
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

[
  'initialInvestment',
  'monthlyInvestment',
  'interestRate',
  'investmentPeriod',
  'investmentCurrency'
].forEach(id => {
  $(id).addEventListener('change', calculateInvestment);
});

// NAVEGAÇÃO

function navigate(page) {
  const pageElement = $(`${page}Page`);
  if (!pageElement) return;

  currentPage = page;

  document.querySelectorAll('.page').forEach(p => {
    p.classList.add('hidden');
  });

  pageElement.classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });

  const titles = {
    dashboard: 'Visão geral',
    transactions: 'Movimentações',
    recurrences: 'Recorrências',
    investments: 'Investimentos'
  };

  $('pageTitle').textContent = titles[page];

  if (page === 'recurrences') {
    renderRecurringRules();
  }
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
  populateMonthlyDays();
  populateEditRuleDays();
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

db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    transactions = [];
    recurringRules = [];
    $('app').classList.add('hidden');
    $('authScreen').classList.remove('hidden');
  }
});

initialize();
