// storage.js - capa de persistencia con fallback a LocalStorage

const LOCAL_KEY = "sorteo_pesos_state_v1";

export const defaultOptions = [
  { key: "chino",    name: "Chinito pochillo",   weight: 20 },
  { key: "pizza",    name: "Italiano prensadito", weight: 20 },
  { key: "hambur",   name: "Vaca comecerdos",     weight: 20 },
  { key: "kebab",    name: "Reina sudadita",      weight: 20 },
  { key: "pollo",    name: "Pollito tiesito",     weight: 20 },
  { key: "especial", name: "ESPECIAL!!!",         weight: 0  }
];

export function getDefaultState() {
  return {
    options: JSON.parse(JSON.stringify(defaultOptions)),
    history: [], // {date, pickedKey}
    lastUpdated: new Date().toISOString()
  };
}

export function loadLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("No se pudo leer LocalStorage:", e);
    return null;
  }
}

export function saveLocalState(state) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...state, lastUpdated: new Date().toISOString() }));
    return true;
  } catch (e) {
    console.warn("No se pudo guardar en LocalStorage:", e);
    return false;
  }
}

// API abstracta que la app usará para cargar/guardar
export async function loadState(preferDrive) {
  if (preferDrive && window.driveApi && window.driveApi.isReady()) {
    try {
      const s = await window.driveApi.loadFromDrive();
      if (s) {
        saveLocalState(s); // cache local
        return s;
      }
    } catch (e) {
      console.warn("Fallo al cargar de Drive, usando local:", e);
    }
  }
  return loadLocalState() || getDefaultState();
}

export async function saveState(state, preferDrive) {
  // Siempre guardamos local
  saveLocalState(state);
  if (preferDrive && window.driveApi && window.driveApi.isReady()) {
    try {
      await window.driveApi.saveToDrive(state);
      return true;
    } catch (e) {
      console.warn("Fallo al guardar en Drive, mantenemos local:", e);
    }
  }
  return false;
}
