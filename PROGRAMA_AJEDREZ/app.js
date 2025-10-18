// app.js - Entrenamiento de medio juego (Ajedrez)
// Funciones principales:
// - Cargar PGN local (archivo grande permitido)
// - Elegir una partida y una posición aleatoria dentro del rango de jugadas indicado
// - Mostrar tablero sin revelar jugadas futuras
// - Analizar con Stockfish hasta 30s y mostrar top-3 jugadas
// - Al mover, comparar con top-3 y llevar contadores de aciertos/fallos

let board = null;
let game = new Chess();
let engine = null; // Stockfish
let engineReady = false;
let engineBest = []; // [{uci:'e2e4', san:'e4', score, depth}]
let totalHits = 0;
let totalFails = 0;

const UI = {
  pgnFile: document.getElementById('pgn-file'),
  range: document.getElementById('range'),
  btnRandom: document.getElementById('btn-random'),
  turn: document.getElementById('turn'),
  hits: document.getElementById('hits'),
  fails: document.getElementById('fails'),
  analysisStatus: document.getElementById('analysis-status'),
  bestList: document.getElementById('best-list'),
  engineNote: document.getElementById('engine-note'),
};

// Estado de la base cargada
let gamesIndex = []; // cada item: {offsetStart, offsetEnd} o directamente texto de cada partida
let fullPGNText = '';

// Utilidad: parsear el rango "a-b"
function parseRange(text) {
  const m = (text || '').trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!m) return { from: 1, to: 999 };
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  return { from, to };
}

// PGN splitter simplista: separa por "\n\n" con tags y movetext
function splitPGN(pgnText) {
  // Hay muchas variantes de PGN; esta aproximación funciona bien con PGNs exportados estándar
  // Separa por partidas detectando que empiece por "[" (tags) hasta doble salto que no empieza por "["
  // Alternativamente usar un regex más generoso.
  const parts = pgnText.split(/\n\s*\n(?=\s*\[|\s*[A-Za-z0-9])/g);
  // Filtra entradas muy pequeñas
  return parts.filter(x => x.trim().length > 30);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomChoicePosition(movesArr, fromPly, toPly) {
  // movesArr: array de SAN strings
  // from/to ply basados en jugadas completas: 1 jugada = 2 ply. Pero permitiremos por seguridad.
  if (!movesArr || movesArr.length === 0) return 0;
  // Convertimos rango de jugadas (ej 19-25) a ply aproximados [from*2-2, to*2]
  const minPly = Math.max(0, (fromPly * 2) - 2);
  const maxPly = Math.min(movesArr.length - 1, (toPly * 2));
  if (minPly >= maxPly) return Math.min(movesArr.length - 1, minPly);
  const idx = Math.floor(Math.random() * (maxPly - minPly + 1)) + minPly;
  return Math.max(0, Math.min(movesArr.length - 1, idx));
}

function loadGameUpTo(movesArr, uptoIndex) {
  game.reset();
  for (let i = 0; i <= uptoIndex && i < movesArr.length; i++) {
    const san = movesArr[i];
    const ok = game.move(san, { sloppy: true });
    if (!ok) break;
  }
}

function uciToSAN(uci) {
  try {
    const tmp = new Chess(game.fen());
    const move = tmp.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] });
    return move ? move.san : uci;
  } catch { return uci; }
}

// Inicializar Stockfish (WASM / worker)
function initEngine() {
  if (engine) return;
  engine = STOCKFISH();
  engine.onmessage = (line) => {
    const text = (typeof line === 'string') ? line : line.data;
    if (!text) return;
    if (text.startsWith('Stockfish')) {
      engineReady = true;
    }
    if (text.startsWith('info')) {
      // parse info depth/score/pv
      const bm = parseBestMoveInfo(text);
      if (bm) {
        engineBest = bm.top.slice(0, 3);
        updateBestList();
      }
    }
    if (text.startsWith('bestmove')) {
      // terminado un go; no lo usamos directamente
    }
  };
  // UCI init
  engine.postMessage('uci');
}

function parseBestMoveInfo(infoLine) {
  // Ejemplo: info depth 20 seldepth 32 score cp 34 pv e2e4 e7e5 g1f3 ...
  // Queremos construir una lista con primeros 3 PVs si el motor lo emite (multiPV)
  // Si no, mantenemos el mejor actual.
  // Para simplificar: leer última línea con " pv " y usar primer movimiento del PV.
  if (!/\spv\s/.test(infoLine)) return null;
  // Detectar MultiPV (si está habilitado por defecto en cdn puede no estarlo). Mandaremos setoption.
  const m = infoLine.match(/multipv\s+(\d+)/i);
  const which = m ? parseInt(m[1], 10) : 1;
  const scoreM = infoLine.match(/score\s+(cp|mate)\s+(-?\d+)/);
  const score = scoreM ? `${scoreM[1]} ${scoreM[2]}` : '';
  const depthM = infoLine.match(/\bdepth\s+(\d+)/);
  const depth = depthM ? parseInt(depthM[1], 10) : undefined;
  const pv = infoLine.split(/\spv\s/)[1].trim().split(/\s+/);
  if (!pv || pv.length === 0) return null;
  const first = pv[0];
  const currentTop = [];
  // Guardaremos por índice multipv (1..N)
  currentTop[which - 1] = { uci: first, san: uciToSAN(first), score, depth };
  // Mezclamos con engineBest actual si existe, para mantener los otros slots
  const merged = [];
  for (let i = 0; i < 3; i++) {
    merged[i] = (i === which - 1) ? currentTop[i] : (engineBest[i] || null);
  }
  return { top: merged.filter(Boolean) };
}

function updateBestList() {
  UI.bestList.innerHTML = '';
  engineBest.forEach((m, i) => {
    const li = document.createElement('li');
    li.textContent = `${m.san || m.uci}  ${m.score ? '('+m.score+')' : ''}${m.depth? ' d'+m.depth:''}`;
    UI.bestList.appendChild(li);
  });
}

function updateTurn() {
  UI.turn.textContent = game.turn() === 'w' ? 'Blancas' : 'Negras';
}

function setAnalysisStatus(text) {
  UI.analysisStatus.textContent = text;
}

function startAnalysis(maxMs = 30000) {
  if (!engine) initEngine();
  engineBest = [];
  updateBestList();
  setAnalysisStatus('Analizando…');
  // Preparar posición
  const fen = game.fen();
  engine.postMessage('stop');
  engine.postMessage('ucinewgame');
  engine.postMessage('setoption name MultiPV value 3');
  engine.postMessage(`position fen ${fen}`);
  engine.postMessage('go depth 30'); // arrancar análisis
  // Cortar tras maxMs
  setTimeout(() => {
    engine.postMessage('stop');
    setAnalysisStatus(engineBest.length ? 'Análisis listo' : 'Sin resultado');
  }, maxMs);
}

function onDragStart(source, piece) {
  // Bloquear arrastre si el juego terminó (no debería) o si arrastras pieza del color incorrecto
  if (game.game_over()) return false;
  if (game.turn() === 'w' && piece.search(/^b/) !== -1) return false;
  if (game.turn() === 'b' && piece.search(/^w/) !== -1) return false;
  return true;
}

function onDrop(source, target) {
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';
  // Verificar contra engineBest (por UCI o SAN)
  const uci = source + target + (move.promotion ? move.promotion : '');
  const san = move.san;
  const ok = engineBest.some(m => m.uci === uci || m.san === san);
  if (ok) {
    totalHits += 1;
    UI.hits.textContent = String(totalHits);
    UI.analysisStatus.textContent = '¡Correcto!';
  } else {
    totalFails += 1;
    UI.fails.textContent = String(totalFails);
    UI.analysisStatus.textContent = 'Incorrecto';
  }
  updateTurn();
}

function onSnapEnd() {
  board.position(game.fen());
}

function buildBoard() {
  if (typeof Chessboard !== 'function') {
    alert('No se pudo cargar el tablero (ChessboardJS). Revisa tu conexión.');
    return;
  }
  const cfg = {
    draggable: true,
    position: 'start',
    onDragStart,
    onDrop,
    onSnapEnd,
  };
  board = Chessboard('board', cfg);
}

async function handleRandom() {
  if (!fullPGNText) {
    alert('Carga primero un archivo PGN.');
    return;
  }
  const { from, to } = parseRange(UI.range.value);
  const games = splitPGN(fullPGNText);
  if (!games || games.length === 0) {
    alert('No se detectaron partidas en el PGN.');
    return;
  }
  const chosen = pickRandom(games);
  // Obtener movetext (parte de las jugadas)
  // chess.js puede cargar PGN completo y luego extraer movimientos
  const tmp = new Chess();
  tmp.reset();
  const ok = tmp.load_pgn(chosen, { sloppy: true });
  if (!ok) {
    alert('No se pudo interpretar una partida. Prueba con otro PGN.');
    return;
  }
  // Extraer lista de movimientos SAN
  const history = tmp.history({ verbose: false });
  const upto = randomChoicePosition(history, from, to);
  loadGameUpTo(history, upto);
  board.position(game.fen(), true);
  updateTurn();
  // Lanzar análisis
  startAnalysis(30000);
}

function init() {
  buildBoard();
  updateTurn();
  initEngine();
  UI.hits.textContent = '0';
  UI.fails.textContent = '0';
  UI.analysisStatus.textContent = '-';

  UI.pgnFile.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const text = await file.text();
    fullPGNText = text;
    alert('PGN cargado. Ya puedes pulsar "Cargar al azar".');
  });

  UI.btnRandom.addEventListener('click', handleRandom);
}

document.addEventListener('DOMContentLoaded', init);
