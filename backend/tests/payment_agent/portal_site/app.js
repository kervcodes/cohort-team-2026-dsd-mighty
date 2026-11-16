// A stand-in for the DSD demo utility portals (https://<company>-utility-demo.vercel.app),
// written for the payment agent's tests. It keeps the DOM contract the agent's
// Playwright driver relies on (labels, roles, button text, headings, table
// headers, dl pairs, routes) and the behaviour that makes the real portals
// tricky, read from their public bundle on 2026-11-15:
//   - one login, several service accounts, one picked in "Property / service account";
//   - #pay/<bill>, #statement/<bill> and #receipt/<id> switch the picked account to the
//     first account that has that bill or payment;
//   - billing "direct" (Pay bill), "statement" (View statement, then Pay this statement)
//     or "center" (lands on #billing after sign-in);
//   - review false ("Pay $x") or true ("Review payment", then "Submit payment");
//   - required ACH fields and the authorize checkbox (the browser blocks the submit
//     without them), "Use sample details", and a "Simulated result" select.
// The data lives in the test's server (fake_portal.py), behind /api like the real one.

const company = window.COMPANY;
const app = document.querySelector('#app');
let portfolio = null;
let selected = '';
let flash = '';

const money = cents => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = value => new Date(value.length === 10 ? value + 'T12:00:00' : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = status => `<span class="badge ${status}">${({ unpaid: 'Due', paid: 'Paid', succeeded: 'Completed', declined: 'Declined', overdue: 'Overdue' })[status]}</span>`;
const today = () => new Date().toLocaleDateString('en-CA');

function account() { return portfolio.serviceAccounts.find(a => a.id === selected) || portfolio.serviceAccounts[0]; }
function bills() { return portfolio.bills.filter(b => b.serviceAccountId === account().id); }
function payments() { return portfolio.payments.filter(p => p.serviceAccountId === account().id); }

async function api(url, data) {
  const response = await fetch('/api/' + url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function notify(message) {
  const target = document.querySelector('#message');
  if (target) { target.className = 'notice error'; target.textContent = message; }
}

function nav() {
  const a = account();
  const options = portfolio.serviceAccounts.map(s => `<option value="${esc(s.id)}" ${s.id === a.id ? 'selected' : ''}>${esc(s.propertyName)} · Whole property · ${esc(s.name)} · ${esc(s.number)}</option>`).join('');
  return `<nav><a href="#account">Account overview</a><a href="#history">Payment history</a><a href="#controls">Test controls</a><button id="logout">Sign out</button></nav>`
    + `<div id="message" class="notice" role="status" tabindex="-1">${esc(flash)}</div>`
    + `<section class="account-context"><label class="field">Property / service account<select id="account-selector">${options}</select></label><p>${esc(a.address)}</p></section>`;
}
function login() {
  return `<section class="panel login-panel"><h2>Sign in to your account</h2><div id="message" class="notice" role="status" tabindex="-1"></div>`
    + `<form id="login-form"><label class="field">Email address<input name="email" type="email" required></label>`
    + `<label class="field">Password<input name="password" type="password" required></label><button class="button full">Sign in</button></form></section>`;
}
function billLink(b) { return `#${company.billing === 'statement' ? 'statement' : 'pay'}/${b.id}`; }
function shownStatus(b) { return b.status === 'unpaid' && b.dueDate < today() ? 'overdue' : b.status; }
function overview() {
  const label = company.billing === 'statement' ? 'View statement' : 'Pay bill';
  const rows = bills().map(b => `<tr><td>${esc(b.description)}<span class="small">${esc(b.id)}</span></td><td>${day(b.dueDate)}</td><td>${money(b.amountCents)}</td><td>${badge(shownStatus(b))}</td>`
    + `<td>${b.status === 'unpaid' ? `<a class="button" href="${billLink(b)}" aria-label="${label} ${esc(b.id)}">${label}</a>` : 'View receipt'}</td></tr>`).join('');
  return nav() + `<h1>Welcome, ${esc(account().name)}.</h1><div class="account-number">Account number<br><strong>${esc(account().number)}</strong></div>`
    + `<h3>${esc(company.addressLabel)}</h3><h2>${company.billing === 'statement' ? 'Your statements' : 'Your bills'}</h2>`
    + `<table><thead><tr><th>Bill</th><th>Due date</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function billingCenter() {
  return nav() + `<h1>Billing & payments</h1>` + bills().map(b => `<section class="panel"><h2>${esc(b.description)}</h2><p>${esc(b.id)}</p><div>${money(b.amountCents)}</div></section>`).join('');
}
function statement(id) {
  const b = bills().find(b => b.id === id);
  if (!b) return nav() + '<h1>Statement not found</h1>';
  return nav() + `<section class="panel statement bill-summary"><h1>Your billing statement</h1><p>Account ${esc(account().number)}</p>`
    + `<dl><dt>Statement number</dt><dd>${esc(b.id)}</dd><dt>${esc(company.addressLabel)}</dt><dd>${esc(account().address)}</dd><dt>Status</dt><dd>${badge(b.status)}</dd></dl>`
    + `<div class="total-line"><span>Amount due</span><strong>${money(b.amountCents)}</strong></div>`
    + (b.status === 'unpaid' ? `<a class="button" href="#pay/${b.id}">Pay this statement</a>` : '<p>This statement has been paid.</p>') + '</section>';
}
function paymentPage(id) {
  const b = bills().find(b => b.id === id);
  if (!b || b.status === 'paid') return nav() + '<h1>Bill unavailable</h1><p>This bill has already been paid or no longer exists.</p>';
  return nav() + `<h1>Make a payment</h1><section class="panel"><form id="payment-form" data-bill-id="${esc(b.id)}" autocomplete="off">`
    + `<label class="field">Payment method<select name="method"><option value="bank">Bank account (one-time ACH)</option><option value="card">Credit or debit card</option></select></label>`
    + `<button type="button" id="sample-details">Use sample details</button>`
    + `<fieldset id="bank-fields"><legend>One-time ACH details</legend>`
    + `<label class="field">Account holder name<input name="bankName" required></label>`
    + `<label class="field">Routing number<input name="routingNumber" pattern="[0-9]{9}" required></label>`
    + `<label class="field">Account number<input name="accountNumber" required></label>`
    + `<label class="field">Confirm account number<input name="confirmAccountNumber" required></label>`
    + `<label class="check-field"><input name="authorized" type="checkbox" required><span>I authorize this simulated one-time ACH payment for the total shown.</span></label></fieldset>`
    + `<fieldset id="card-fields" hidden disabled><legend>Card details</legend><label class="field">Card number<input name="cardNumber" required></label></fieldset>`
    + `<label class="field">Simulated result<select name="scenario"><option value="success">Successful payment</option><option value="decline">Declined payment</option></select></label>`
    + `<button type="submit" class="button full">${company.payButtonLabel ?? (company.review ? 'Review payment' : `Pay ${money(company.payButtonCents ?? b.amountCents)}`)}</button></form></section>`
    + `<section class="panel bill-summary"><h2>Bill summary</h2><dl><dt>Bill number</dt><dd>${esc(b.id)}</dd><dt>Due date</dt><dd>${day(b.dueDate)}</dd></dl>`
    + `<div class="total-line"><span>Total payment</span><strong>${money(b.amountCents)}</strong></div></section>`;
}
function receipt(id) {
  const p = payments().find(p => p.id === id);
  if (!p) return nav() + '<h1>Receipt not found</h1>';
  const ok = p.status === 'succeeded';
  return nav() + `<section class="panel receipt"><h1>${ok ? 'Payment complete.' : 'Payment declined.'}</h1>`
    + `<dl><dt>Confirmation number</dt><dd>${esc(p.id)}</dd><dt>Bill number</dt><dd>${esc(p.billId)}</dd><dt>Account</dt><dd>${esc(account().name)}</dd>`
    + `<dt>Amount</dt><dd><strong>${money(p.amountCents)}</strong></dd><dt>Payment method</dt><dd>${esc(p.method)}</dd><dt>Date</dt><dd>${day(p.createdAt)}</dd><dt>Status</dt><dd>${badge(p.status)}</dd></dl></section>`;
}
function history() {
  const list = payments();
  return nav() + '<h1>Payment history</h1>' + (list.length
    ? `<table><thead><tr><th>Payment</th><th>Date</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody>${list.map(p => `<tr><td>${esc(p.id)}<span class="small">${esc(p.billId)}</span></td><td>${day(p.createdAt)}</td><td>${money(p.amountCents)}</td><td>${badge(p.status)}</td><td><a href="#receipt/${p.id}">View receipt</a></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No payments yet. Pay a bill to see it here.</div>');
}

function render() {
  const [page = '', id] = location.hash.slice(1).split('/');
  if (portfolio) {
    // Like the real portal: a bill or receipt route picks the first account that has it.
    const item = page === 'receipt' ? portfolio.payments.find(p => p.id === id) : ['pay', 'statement'].includes(page) ? portfolio.bills.find(b => b.id === id) : null;
    if (item && item.serviceAccountId !== account().id) selected = item.serviceAccountId;
  }
  if (!portfolio) app.innerHTML = login();
  else if (page === 'pay') app.innerHTML = paymentPage(id);
  else if (page === 'statement') app.innerHTML = statement(id);
  else if (page === 'receipt') app.innerHTML = receipt(id);
  else if (page === 'history') app.innerHTML = history();
  else if (page === 'billing') app.innerHTML = billingCenter();
  else app.innerHTML = overview();
  flash = '';
  bind();
}
function destination() { return company.billing === 'center' ? 'billing' : 'account'; }

function bind() {
  document.querySelector('#account-selector')?.addEventListener('change', event => { selected = event.target.value; location.hash = 'account'; render(); });
  document.querySelector('#login-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api('login', Object.fromEntries(new FormData(event.currentTarget)));
      portfolio = await api('account');
      location.hash = destination();
      render();
    } catch (error) { notify(error.message); }
  });
  const form = document.querySelector('#payment-form');
  if (!form) return;
  form.elements.method.addEventListener('change', () => {
    for (const method of ['bank', 'card']) {
      const fields = document.querySelector(`#${method}-fields`);
      fields.hidden = form.elements.method.value !== method;
      fields.disabled = fields.hidden;
    }
  });
  document.querySelector('#sample-details').addEventListener('click', () => {
    const samples = { bankName: 'Demo Business', routingNumber: '110000000', accountNumber: '000123456789', confirmAccountNumber: '000123456789' };
    for (const [name, value] of Object.entries(samples)) form.elements[name].value = value;
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const payload = { billId: form.dataset.billId, serviceAccountId: account().id, method: data.method, scenario: data.scenario, details: { name: data.bankName, routingNumber: data.routingNumber, accountNumber: data.accountNumber, authorized: data.authorized === 'on' } };
    if (!company.review) { complete(payload); return; }
    const b = bills().find(b => b.id === payload.billId);
    form.hidden = true;
    const review = document.createElement('section');
    review.id = 'payment-review';
    review.innerHTML = `<h2>Review your payment</h2><p><strong>${money(company.reviewCents ?? b.amountCents)}</strong> for ${esc(company.reviewBillId ?? b.id)}</p><p>One-time ACH ending in ${esc(data.accountNumber.slice(-4))}</p>`
      + `<button type="button" id="confirm-payment">${esc(company.submitButtonLabel ?? 'Submit payment')}</button><button type="button" id="edit-payment">Edit details</button>`;
    form.after(review);
    document.querySelector('#confirm-payment').addEventListener('click', () => complete(payload));
  });
}
async function complete(payload) {
  try {
    const { payment } = await api('payments', payload);
    portfolio = await api('account');
    location.hash = `receipt/${payment.id}`;
  } catch (error) { notify(error.message); }
}

window.addEventListener('hashchange', render);
(async () => {
  try { portfolio = await api('account'); } catch { portfolio = null; }
  render();
})();
