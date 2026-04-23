/* ============================================================
   CONFIGURAÇÃO — proxy Cloudflare Worker
   ============================================================ */
const API_URL = 'https://salacop-proxy.denis-carvalho.workers.dev';
/* ============================================================ */

let calendar;
let reservas        = [];
let currentSha      = null;
let selectedEventId = null;

/* ============================================================
   Utilitários
   ============================================================ */

function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function showAlert(message, type = 'danger') {
  const area = document.getElementById('alert-area');
  area.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show" role="alert">
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Fechar"></button>
    </div>`;
  area.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hasConflict(data, horaInicio, horaFim, excludeId = null) {
  const newStart = timeToMinutes(horaInicio);
  const newEnd   = timeToMinutes(horaFim);

  return reservas.some(r => {
    if (excludeId && r.id === excludeId) return false;
    if (r.data !== data) return false;
    const rStart = timeToMinutes(r.horaInicio);
    const rEnd   = timeToMinutes(r.horaFim);
    return newStart < rEnd && newEnd > rStart;
  });
}

/* ============================================================
   Cloudflare Worker Proxy — Leitura e Escrita
   ============================================================ */

async function fetchReservas() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`Status ${res.status}`);

    const data = await res.json();
    currentSha = data.sha;

    const decoded = decodeURIComponent(
      escape(atob(data.content.replace(/\n/g, '')))
    );
    reservas = JSON.parse(decoded);
    return reservas;

  } catch (err) {
    console.error('Erro ao carregar reservas:', err);
    showAlert(
      `⚠️ <strong>Não foi possível carregar as reservas.</strong><br>
       <small class="text-muted">${err.message}</small>`,
      'warning'
    );
    return [];
  }
}

async function saveReservas() {
  const jsonStr = JSON.stringify(reservas, null, 2);
  const encoded = btoa(unescape(encodeURIComponent(jsonStr)));

  const res = await fetch(API_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `[Sistema] Reserva atualizada em ${new Date().toLocaleString('pt-BR')}`,
      content: encoded,
      sha: currentSha
    })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${res.status}`);
  }

  const resData = await res.json();
  currentSha    = resData.content.sha;
}

/* ============================================================
   FullCalendar
   ============================================================ */

function initCalendar() {
  const calendarEl = document.getElementById('calendar');

  calendar = new FullCalendar.Calendar(calendarEl, {
    locale: 'pt-br',
    initialView: 'dayGridMonth',
    height: 'auto',
    headerToolbar: {
      left:   'prev,next today',
      center: 'title',
      right:  'dayGridMonth,timeGridWeek,timeGridDay'
    },
    buttonText: {
      today: 'Hoje',
      month: 'Mês',
      week:  'Semana',
      day:   'Dia'
    },
    events: [],
    eventClick: function (info) {
      openEventModal(info.event);
    },
    dateClick: function (info) {
      const dataInput = document.getElementById('dataInicio');
      dataInput.value = info.dateStr;
      document.getElementById('reservaForm').scrollIntoView({ behavior: 'smooth' });
    }
  });

  calendar.render();
}

function populateCalendar() {
  calendar.removeAllEvents();
  reservas.forEach(r => calendar.addEvent(reservaToEvent(r)));
}

function reservaToEvent(r) {
  return {
    id:    r.id,
    title: `${r.horaInicio}–${r.horaFim} | ${r.descricao}`,
    start: `${r.data}T${r.horaInicio}`,
    end:   `${r.data}T${r.horaFim}`,
    extendedProps: { reserva: r }
  };
}

/* ============================================================
   Modal de Detalhes / Exclusão
   ============================================================ */

function openEventModal(event) {
  const r = event.extendedProps.reserva;
  selectedEventId = r.id;

  const dataFormatada = new Date(`${r.data}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  document.getElementById('modal-reserva-detalhes').innerHTML = `
    <div class="detail-row">
      <span class="detail-label">👤 Responsável</span>
      <span class="detail-value">${r.nome}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">🏢 Setor</span>
      <span class="detail-value">${r.setor}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">📞 Telefone</span>
      <span class="detail-value">${r.telefone}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">✉️ E-mail</span>
      <span class="detail-value">${r.email}</span>
    </div>
    <hr class="my-2">
    <div class="detail-row">
      <span class="detail-label">📋 Descrição</span>
      <span class="detail-value">${r.descricao}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">📅 Data</span>
      <span class="detail-value">${dataFormatada}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">⏰ Horário</span>
      <span class="detail-value"><strong>${r.horaInicio}</strong> às <strong>${r.horaFim}</strong></span>
    </div>`;

  const modal = new bootstrap.Modal(document.getElementById('modalDetalhes'));
  modal.show();
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  bootstrap.Modal.getInstance(document.getElementById('modalDetalhes')).hide();
  document.getElementById('inputPinDelete').value = '';
  document.getElementById('pinErro').classList.add('d-none');
  new bootstrap.Modal(document.getElementById('modalConfirmDelete')).show();
});

document.getElementById('btnFinalDelete').addEventListener('click', async function () {
  const pinDigitado = document.getElementById('inputPinDelete').value.trim();
  const reserva     = reservas.find(r => r.id === selectedEventId);
  const pinErroEl   = document.getElementById('pinErro');

  if (!pinDigitado) {
    pinErroEl.classList.remove('d-none');
    return;
  }

  // Verifica PIN da própria reserva (local)
  let autorizado = pinDigitado === reserva?.pin;

  // Se não bater, consulta PIN admin no Worker
  if (!autorizado) {
    try {
      const res  = await fetch(`${API_URL}/validate-admin`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pin: pinDigitado })
      });
      const data = await res.json();
      autorizado = data.ok;
    } catch {
      autorizado = false;
    }
  }

  if (!autorizado) {
    pinErroEl.classList.remove('d-none');
    return;
  }

  pinErroEl.classList.add('d-none');

  const btn = this;
  btn.disabled    = true;
  btn.textContent = 'Excluindo...';

  try {
    await fetchReservas();
    reservas = reservas.filter(r => r.id !== selectedEventId);
    await saveReservas();

    calendar.getEventById(selectedEventId)?.remove();
    bootstrap.Modal.getInstance(document.getElementById('modalConfirmDelete')).hide();
    showAlert('✅ Reserva excluída com sucesso!', 'success');

  } catch (err) {
    console.error('Erro ao excluir:', err);
    showAlert(`❌ Erro ao excluir reserva: ${err.message}`);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Confirmar Exclusão';
  }
});

/* ============================================================
   Formulário
   ============================================================ */

function populateTimeSelects() {
  const inicioSel = document.getElementById('inicio');
  const fimSel    = document.getElementById('fim');

  for (let h = 7; h <= 22; h++) {
    for (const m of [0, 30]) {
      if (h === 22 && m === 30) continue;
      const hh  = String(h).padStart(2, '0');
      const mm  = String(m).padStart(2, '0');
      const val = `${hh}:${mm}`;
      inicioSel.add(new Option(val, val));
      fimSel.add(new Option(val, val));
    }
  }

  inicioSel.value = '08:00';
  fimSel.value    = '09:00';
}

document.getElementById('reservaForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const nome       = document.getElementById('nome').value.trim();
  const setor      = document.getElementById('setor').value.trim();
  const telefone   = document.getElementById('telefone').value.trim();
  const email      = document.getElementById('email').value.trim();
  const descricao  = document.getElementById('descricao').value.trim();
  const pin        = document.getElementById('pin').value.trim();
  const dataInicio = document.getElementById('dataInicio').value;
  const horaInicio = document.getElementById('inicio').value;
  const horaFim    = document.getElementById('fim').value;

  if (!nome || !setor || !telefone || !email || !descricao || !dataInicio || !pin) {
    showAlert('⚠️ Preencha todos os campos obrigatórios antes de confirmar.');
    return;
  }

  if (!/^\d{4}$/.test(pin)) {
    showAlert('⚠️ O PIN deve conter exatamente <strong>4 dígitos numéricos</strong>.');
    return;
  }

  if (timeToMinutes(horaFim) <= timeToMinutes(horaInicio)) {
    showAlert('⚠️ A <strong>Hora de Fim</strong> deve ser posterior à Hora de Início.');
    return;
  }

  if (hasConflict(dataInicio, horaInicio, horaFim)) {
    const dataFormatada = new Date(`${dataInicio}T12:00:00`).toLocaleDateString('pt-BR');
    showAlert(`
      🚫 <strong>Conflito de horário detectado!</strong><br>
      Já existe uma reserva em <strong>${dataFormatada}</strong>
      entre <strong>${horaInicio}</strong> e <strong>${horaFim}</strong>.<br>
      Por favor, escolha outro horário.`);
    return;
  }

  const btn     = document.getElementById('btnReservar');
  const btnText = document.getElementById('btnText');
  const spinner = document.getElementById('btnSpinner');
  btn.disabled  = true;
  btnText.textContent = 'Salvando...';
  spinner.classList.remove('d-none');

  try {
    await fetchReservas();

    if (hasConflict(dataInicio, horaInicio, horaFim)) {
      const dataFormatada = new Date(`${dataInicio}T12:00:00`).toLocaleDateString('pt-BR');
      showAlert(`
        🚫 <strong>Conflito identificado após sincronização!</strong><br>
        Outro usuário acabou de reservar <strong>${dataFormatada}</strong>
        no mesmo horário. Escolha outro período.`);
      return;
    }

    const novaReserva = {
      id: gerarId(),
      nome, setor, telefone, email, descricao, pin,
      data: dataInicio, horaInicio, horaFim
    };

    reservas.push(novaReserva);
    await saveReservas();

    calendar.addEvent(reservaToEvent(novaReserva));
    showAlert('✅ <strong>Reserva registrada com sucesso!</strong><br>Guarde seu PIN — ele será necessário para cancelar a reserva.', 'success');
    this.reset();

  } catch (err) {
    console.error('Erro ao salvar reserva:', err);
    showAlert(`❌ <strong>Erro ao salvar a reserva:</strong> ${err.message}`);
  } finally {
    btn.disabled = false;
    btnText.textContent = '✅ Confirmar Reserva';
    spinner.classList.add('d-none');
  }
});

/* ============================================================
   Inicialização
   ============================================================ */

async function init() {
  populateTimeSelects();

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('dataInicio').min = today;

  initCalendar();

  const dados = await fetchReservas();
  if (dados.length > 0) {
    populateCalendar();
  }
}

init();