// drive.js - integración opcional con Google Drive (gapi)
// Requiere configurar window.SORTEO_CONFIG.googleClientId y haber cargado https://apis.google.com/js/api.js

(function(){
  const cfg = window.SORTEO_CONFIG || {};
  const state = {
    gapiLoaded: false,
    clientInitialized: false,
    signedIn: false,
    fileId: null,
    folderId: null,
    lastError: null,
  };
  let tokenClient = null; // GIS token client (oauth2)

  async function waitForGIS(timeoutMs = 5000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      (function loop(){
        if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve(true);
        if (Date.now() - start > timeoutMs) return reject(new Error('GIS no cargó'));
        setTimeout(loop, 100);
      })();
    });
  }

  async function loadGapi() {
    if (state.gapiLoaded) return;
    await new Promise((resolve) => {
      function chk(){
        if (window.gapi && window.gapi.load) resolve();
        else setTimeout(chk, 100);
      }
      chk();
    });
    state.gapiLoaded = true;
  }

  async function initClient() {
    if (!cfg.googleClientId) return false;
    await loadGapi();
    return new Promise((resolve, reject) => {
      window.gapi.load('client', async () => {
        try {
          await window.gapi.client.init({
            apiKey: undefined, // no hace falta para drive.file con oauth
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
          });
          state.clientInitialized = true;
          resolve(true);
        } catch (e) {
          console.error('Error init gapi client', e);
          reject(e);
        }
      });
    });
  }

  // Prepara gapi y GIS en segundo plano para que al pulsar el botón
  // podamos llamar requestAccessToken inmediatamente (sin perder el gesto)
  async function prepare() {
    try {
      // Inicializar gapi client (descubrimiento Drive)
      await initClient();
    } catch (e) {
      // Se volverá a intentar si es necesario
      state.lastError = e;
    }
    try {
      // Esperar a GIS y crear token client si hay Client ID
      if (cfg.googleClientId) {
        await waitForGIS();
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: cfg.googleClientId,
          scope: cfg.googleScopes,
          callback: '', // se asigna justo antes de cada petición
          use_fedcm_for_prompt: true
        });
      }
    } catch (e) {
      state.lastError = e;
    }
  }

  // Inicia sesión provocando popup inmediatamente en el gesto de click
  // Importante: no hacer awaits antes de requestAccessToken para no perder el gesto
  function signIn() {
    if (!cfg.googleClientId) return Promise.reject(new Error('Client ID no configurado'));
    // Si no está preparado aún, intentamos crear tokenClient en caliente.
    if (!tokenClient && window.google && window.google.accounts && window.google.accounts.oauth2) {
      try {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: cfg.googleClientId,
          scope: cfg.googleScopes,
          callback: '',
          use_fedcm_for_prompt: true
        });
      } catch (e) {
        state.lastError = e;
      }
    }
    if (!tokenClient) {
      // No podemos abrir popup sin GIS, avisar al usuario.
      alert('Cargando servicios de Google… espera 1-2 segundos y vuelve a pulsar Conectar.');
      return Promise.reject(new Error('GIS no listo'));
    }
    return new Promise((resolve, reject) => {
      tokenClient.callback = async (resp) => {
        try {
          if (resp && resp.access_token) {
            // Asegurar gapi listo (esto no abre ventanas)
            try { await initClient(); } catch {}
            window.gapi.client.setToken({ access_token: resp.access_token });
            state.signedIn = true;
            try { await ensureFolderAndFile(); } catch {}
            resolve(true);
          } else {
            state.lastError = resp || new Error('No se obtuvo access_token');
            reject(state.lastError);
          }
        } catch (e) {
          state.lastError = e;
          reject(e);
        }
      };
      try {
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } catch (e) {
        state.lastError = e;
        reject(e);
      }
    });
  }

  // Intenta iniciar sesión sin interacción (si ya diste consentimiento antes)
  async function trySilentSignIn() {
    if (!cfg.googleClientId) return false;
    try {
      await initClient();
      await waitForGIS();
      // Reutilizar o crear tokenClient (no abre popup con prompt:none)
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: cfg.googleClientId,
          scope: cfg.googleScopes,
          callback: '',
          use_fedcm_for_prompt: true
        });
      }
      const ok = await new Promise((resolve) => {
        tokenClient.callback = async (resp) => {
          if (resp && resp.access_token) {
            try {
              window.gapi.client.setToken({ access_token: resp.access_token });
              state.signedIn = true;
              await ensureFolderAndFile();
              resolve(true);
            } catch {
              resolve(false);
            }
          } else {
            state.lastError = resp || new Error('Silent login sin token');
            resolve(false);
          }
        };
        try {
          tokenClient.requestAccessToken({ prompt: 'none' }); // sin UI si es posible
        } catch (e) {
          state.lastError = e;
          resolve(false);
        }
      });
      return ok;
    } catch (e) {
      state.lastError = e;
      return false;
    }
  }

  async function signOut() {
    try {
      const token = window.gapi.client.getToken();
      if (token) {
        await google.accounts.oauth2.revoke(token.access_token);
        window.gapi.client.setToken('');
      }
    } catch {}
    state.signedIn = false;
    state.fileId = null;
    state.folderId = null;
  }

  async function ensureFolderAndFile() {
    const folderId = await getOrCreateFolder(cfg.driveFolderName);
    state.folderId = folderId;
    const fileId = await getOrCreateFile(cfg.driveFileName, folderId);
    state.fileId = fileId;
  }

  async function getOrCreateFolder(name) {
    const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await gapi.client.drive.files.list({ q, pageSize: 1, fields: 'files(id,name)' });
    if (res.result.files && res.result.files.length) return res.result.files[0].id;
    const create = await gapi.client.drive.files.create({
      resource: { name, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id'
    });
    return create.result.id;
  }

  async function getOrCreateFile(name, folderId) {
    const q = `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
    const res = await gapi.client.drive.files.list({ q, pageSize: 1, fields: 'files(id,name)' });
    if (res.result.files && res.result.files.length) return res.result.files[0].id;
    const create = await gapi.client.drive.files.create({
      resource: { name, mimeType: 'application/json', parents: [folderId] },
      fields: 'id'
    });
    // Inicializar vacío
    await uploadContent(create.result.id, JSON.stringify({}));
    return create.result.id;
  }

  async function uploadContent(fileId, content) {
    const boundary = 'xxxxxxxxxx_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;
    const meta = { name: cfg.driveFileName, mimeType: 'application/json' };
    const body =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      content +
      closeDelim;

    const res = await gapi.client.request({
      path: `/upload/drive/v3/files/${fileId}`,
      method: 'PATCH',
      params: { uploadType: 'multipart' },
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return res;
  }

  function isNotFoundError(err) {
    const code = err && (err.status || (err.result && err.result.error && err.result.error.code));
    return code === 404;
  }

  async function downloadContent(fileId) {
    const res = await gapi.client.drive.files.get({ fileId, alt: 'media' });
    return res.result; // JSON
  }

  async function loadFromDrive() {
    if (!state.signedIn) throw new Error('No autenticado');
    if (!state.fileId) await ensureFolderAndFile();
    try {
      const data = await downloadContent(state.fileId);
      return data && Object.keys(data).length ? data : null;
    } catch (e) {
      if (isNotFoundError(e)) {
        // El archivo puede haberse borrado: recrear y devolver null (estado por defecto usará local o se guardará luego)
        try {
          state.fileId = await getOrCreateFile(cfg.driveFileName, state.folderId || await getOrCreateFolder(cfg.driveFolderName));
        } catch {}
        return null;
      }
      throw e;
    }
  }

  async function saveToDrive(stateObj) {
    if (!state.signedIn) throw new Error('No autenticado');
    if (!state.fileId) await ensureFolderAndFile();
    try {
      await uploadContent(state.fileId, JSON.stringify(stateObj));
    } catch (e) {
      if (isNotFoundError(e)) {
        // Re-crear y reintentar una vez
        state.fileId = await getOrCreateFile(cfg.driveFileName, state.folderId || await getOrCreateFolder(cfg.driveFolderName));
        await uploadContent(state.fileId, JSON.stringify(stateObj));
      } else {
        throw e;
      }
    }
  }

  window.driveApi = {
    isReady: () => !!(state.gapiLoaded && state.clientInitialized && cfg.googleClientId),
    isSignedIn: () => state.signedIn,
    getDebugInfo: () => ({ ready: !!(state.gapiLoaded && state.clientInitialized), signedIn: state.signedIn, lastError: state.lastError }),
    prepare,
    signIn,
    signOut,
    trySilentSignIn,
    loadFromDrive,
    saveToDrive,
  };
})();
