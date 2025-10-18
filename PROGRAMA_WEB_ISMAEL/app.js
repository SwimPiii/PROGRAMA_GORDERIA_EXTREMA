import { loadState, saveState, getDefaultState, defaultOptions } from './storage.js';

const cfg = window.SORTEO_CONFIG || {};

const UI = {
  result: document.getElementById('result'),
  optionsList: document.getElementById('options-list'),
  btnDraw: document.getElementById('btn-draw'),
  btnSanchesco: document.getElementById('btn-sanchesco'),
  sanchescoPanel: document.getElementById('sanchesco-panel'),
  manualChoices: document.getElementById('manual-choices'),
  btnApplySanchesco: document.getElementById('btn-apply-sanchesco'),
  btnCancelSanchesco: document.getElementById('btn-cancel-sanchesco'),
  weightsEditor: document.getElementById('weights-editor'),
  btnSaveWeights: document.getElementById('btn-save-weights'),
  btnResetDefaults: document.getElementById('btn-reset-defaults'),
  toggleDrive: document.getElementById('toggle-drive'),
  driveSignin: document.getElementById('btn-drive-signin'),
  driveSignout: document.getElementById('btn-drive-signout'),
  driveStatus: document.getElementById('drive-status'),
  driveClientId: document.getElementById('drive-client-id'),
  btnSaveClientId: document.getElementById('btn-save-clientid'),
  version: document.getElementById('version'),
  historyList: document.getElementById('history-list'),
  btnExportHistory: document.getElementById('btn-export-history'),
  btnClearHistory: document.getElementById('btn-clear-history'),
};

let appState = getDefaultState();

function sumWeights(opts) {
  return opts.reduce((acc, o) => acc + Math.max(0, o.weight|0), 0);
}

function percentages(opts) {
  const total = sumWeights(opts) || 1;
  return opts.map(o => ({ key: o.key, pct: (100 * Math.max(0, o.weight|0) / total) }));
}

function weightedPick(opts) {
  const total = sumWeights(opts);
  if (total <= 0) return null;
  const r = Math.floor(Math.random() * total);
  let acc = 0;
  for (const o of opts) {
    const w = Math.max(0, o.weight|0);
    acc += w;
    if (r < acc) return o;
  }
  return opts[opts.length - 1];
}

// Reglas del usuario:
// - Todos empiezan con 20, especial 0.
// - Cuando sale una opción X (no especial): X pierde 4 puntos; esos 4 se reparten entre los demás excepto especial (equidad simple +1 a 4 opciones al azar o +1 a 4 determinadas?)
//   Interpretación preferida: repartir equitativo a los demás excepto especial. Como son 5 opciones (si X no especial) -> +1 a cada una de las 5 restantes menos especial? Eso sería +1 a 4 opciones (excluyendo X y especial). Confirmado por tu texto: "se reparten entre todos los demas excepto especial" -> los demás no especiales.
//   Entonces: si sale X no especial -> X -= 4; para cada otro no especial (4 restantes) +1.
// - Especial siempre incrementa en +3 cada vez que hay sorteo y no sale especial.
// - Cuando sale especial, especial vuelve a 0.

function applyRulesAfterPick(state, pickedKey) {
  const opts = state.options;
  const picked = opts.find(o => o.key === pickedKey);
  const isEspecial = picked && picked.key === 'especial';

  if (!picked) return state;

  if (isEspecial) {
    // Especial a 0
    picked.weight = 0;
  } else {
    // Quitar 4 al elegido (no bajamos de 0 por sanidad)
    picked.weight = Math.max(0, (picked.weight|0) - 4);
    // Repartir +1 a los demás no especiales y distintos del elegido
    for (const o of opts) {
      if (o.key !== 'especial' && o.key !== picked.key) {
        o.weight = (o.weight|0) + 1;
      }
    }
    // Especial +3
    const esp = opts.find(o => o.key === 'especial');
    if (esp) esp.weight = (esp.weight|0) + 3;
  }

  state.history.push({ date: new Date().toISOString(), pickedKey });
  state.lastUpdated = new Date().toISOString();
  return state;
}

function renderOptions() {
  const pcts = new Map(percentages(appState.options).map(o => [o.key, o.pct]));
  UI.optionsList.innerHTML = '';
  for (const o of appState.options) {
    const pct = pcts.get(o.key) || 0;
    const item = document.createElement('div');
    item.className = 'option';
    item.innerHTML = `
      <div class="option-header">
        <div class="option-name">${o.name}</div>
        <div class="pill">${pct.toFixed(1)}%</div>
      </div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="stat">Peso: <strong>${o.weight}</strong></div>
    `;
    UI.optionsList.appendChild(item);
  }
}

function renderSanchescoEditor() {
  // Elección manual
  UI.manualChoices.innerHTML = '';
  for (const o of appState.options) {
    const row = document.createElement('label');
    row.className = 'choice';
    row.innerHTML = `
      <input type="radio" name="manual-pick" value="${o.key}">
      <span>${o.name}</span>
    `;
    UI.manualChoices.appendChild(row);
  }
  // Editor de pesos
  UI.weightsEditor.innerHTML = '';
  for (const o of appState.options) {
    const wrap = document.createElement('div');
    wrap.className = 'weight-item';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:600;">${o.name}</div>
        <input type="number" step="1" min="0" value="${o.weight}" data-key="${o.key}">
      </div>
    `;
    UI.weightsEditor.appendChild(wrap);
  }
}

function setResult(text, tone = 'info') {
  const color = tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : 'var(--warning)';
  UI.result.innerHTML = `<strong style="color:${color}">${text}</strong>`;
}

function renderHistory() {
  if (!UI.historyList) return;
  const nameByKey = new Map(appState.options.map(o => [o.key, o.name]));
  UI.historyList.innerHTML = '';
  if (!appState.history || appState.history.length === 0) {
    UI.historyList.innerHTML = '<div class="muted">Sin registros todavía.</div>';
    return;
  }
  // Mostrar últimos 50 (del más reciente al más antiguo)
  const items = [...appState.history].slice(-50).reverse();
  for (const h of items) {
    const div = document.createElement('div');
    div.className = 'history-item';
    const dt = new Date(h.date);
    const label = nameByKey.get(h.pickedKey) || h.pickedKey;
    div.innerHTML = `
      <div class="picked">${label}</div>
      <div class="date">${dt.toLocaleString()}</div>
    `;
    UI.historyList.appendChild(div);
  }
}

async function refreshPersistenceUI() {
  const useDrive = UI.toggleDrive.checked && !!cfg.googleClientId;
  const signed = window.driveApi && window.driveApi.isSignedIn && window.driveApi.isSignedIn();
  UI.driveStatus.textContent = useDrive ? (signed ? 'Conectado' : 'Desconectado') : 'LocalStorage';
}

async function init() {
  UI.version.textContent = cfg.version || '';
  const preferDrive = !!cfg.googleClientId; // si hay clientId, permitimos toggle
  UI.toggleDrive.checked = preferDrive;

  appState = await loadState(UI.toggleDrive.checked);
  renderOptions();
  renderHistory();
  await refreshPersistenceUI();

  UI.btnDraw.addEventListener('click', async () => {
    const picked = weightedPick(appState.options);
    if (!picked) return setResult('No hay pesos válidos', 'danger');
    setResult(`Ha salido: ${picked.name} 🎉`, 'success');
    applyRulesAfterPick(appState, picked.key);
    renderOptions();
    renderHistory();
    await saveState(appState, UI.toggleDrive.checked);
    await refreshPersistenceUI();
  });

  UI.btnSanchesco.addEventListener('click', () => {
    UI.sanchescoPanel.hidden = false;
    renderSanchescoEditor();
  });

  UI.btnCancelSanchesco.addEventListener('click', () => {
    UI.sanchescoPanel.hidden = true;
    setResult('');
  });

  UI.btnApplySanchesco.addEventListener('click', async () => {
    const sel = UI.manualChoices.querySelector('input[name="manual-pick"]:checked');
    if (!sel) return setResult('Elige una opción para el sorteo sanchesco.', 'danger');
    const key = sel.value;
    const picked = appState.options.find(o => o.key === key);
    setResult(`Elegido manualmente: ${picked ? picked.name : key} 🧙‍♂️`, 'success');
    applyRulesAfterPick(appState, key);
    UI.sanchescoPanel.hidden = true;
    renderOptions();
    renderHistory();
    await saveState(appState, UI.toggleDrive.checked);
    await refreshPersistenceUI();
  });

  UI.btnSaveWeights.addEventListener('click', async () => {
    const inputs = UI.weightsEditor.querySelectorAll('input[type="number"]');
    for (const input of inputs) {
      const key = input.dataset.key;
      const val = Math.max(0, parseInt(input.value || '0', 10));
      const o = appState.options.find(x => x.key === key);
      if (o) o.weight = val;
    }
    setResult('Pesos actualizados.', 'success');
    renderOptions();
    await saveState(appState, UI.toggleDrive.checked);
  });

  UI.btnResetDefaults.addEventListener('click', async () => {
    appState.options = JSON.parse(JSON.stringify(defaultOptions));
    setResult('Valores iniciales restaurados.', 'warning');
    renderOptions();
    await saveState(appState, UI.toggleDrive.checked);
  });

  UI.toggleDrive.addEventListener('change', async () => {
    await refreshPersistenceUI();
  });

  if (UI.driveSignin) {
    UI.driveSignin.addEventListener('click', async () => {
      if (!cfg.googleClientId) {
        alert('Configura googleClientId en config.js para usar Drive.');
        return;
      }
      try {
        await window.driveApi.signIn();
        await refreshPersistenceUI();
        // Recargar desde Drive si procede
        if (UI.toggleDrive.checked) {
          const s = await loadState(true);
          appState = s;
          renderOptions();
          renderHistory();
        }
      } catch (e) {
        alert('No se pudo conectar a Drive. Revisa permisos.');
        console.error(e);
      }
    });
  }
  if (UI.driveSignout) {
    UI.driveSignout.addEventListener('click', async () => {
      try {
        await window.driveApi.signOut();
      } catch {}
      await refreshPersistenceUI();
    });
  }

  if (UI.btnSaveClientId && UI.driveClientId) {
    // Permitir inyectar el Client ID sin editar el archivo
    UI.driveClientId.value = cfg.googleClientId || '';
    UI.btnSaveClientId.addEventListener('click', async () => {
      const id = (UI.driveClientId.value || '').trim();
      if (!id) {
        alert('Introduce un Client ID válido.');
        return;
      }
      window.SORTEO_CONFIG.googleClientId = id;
      // Refrescar estado de persistencia (el toggle define preferencia, no cambia aquí)
      await refreshPersistenceUI();
      alert('Client ID guardado en memoria. Recarga la página para persistir en config.js si lo deseas.');
    });
  }

  if (UI.btnExportHistory) {
    UI.btnExportHistory.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(appState.history || [], null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'historial_sorteos.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  if (UI.btnClearHistory) {
    UI.btnClearHistory.addEventListener('click', async () => {
      if (!confirm('¿Seguro que deseas borrar el histórico? Esta acción no se puede deshacer.')) return;
      appState.history = [];
      await saveState(appState, UI.toggleDrive.checked);
      renderHistory();
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
