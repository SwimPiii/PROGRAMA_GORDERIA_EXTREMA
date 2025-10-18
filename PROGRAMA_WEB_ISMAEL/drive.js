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
  };

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

  async function signIn() {
    if (!cfg.googleClientId) throw new Error('Client ID no configurado');
    await initClient();
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.googleClientId,
      scope: cfg.googleScopes,
      callback: ''
    });
    const token = await new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => {
        if (resp && resp.access_token) resolve(resp);
        else reject(resp || new Error('No se obtuvo access_token'));
      };
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
    window.gapi.client.setToken({ access_token: token.access_token });
    state.signedIn = true;
    // Buscar o crear carpeta/archivo
    await ensureFolderAndFile();
    return true;
  }

  // Intenta iniciar sesión sin interacción (si ya diste consentimiento antes)
  async function trySilentSignIn() {
    if (!cfg.googleClientId) return false;
    try {
      await initClient();
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cfg.googleClientId,
        scope: cfg.googleScopes,
        callback: ''
      });
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
            resolve(false);
          }
        };
        try {
          tokenClient.requestAccessToken({ prompt: '' }); // 'none'/'': sin UI
        } catch (e) {
          resolve(false);
        }
      });
      return ok;
    } catch {
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
    signIn,
    signOut,
    trySilentSignIn,
    loadFromDrive,
    saveToDrive,
  };
})();
