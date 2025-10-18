PROGRAMA_AJEDREZ — Entrenamiento de medio juego

App web pensada para móvil/PC que:
- Carga una base de partidas en PGN (local).
- Elige una partida al azar y una posición en un rango de jugadas (p. ej. 19-25).
- Muestra el tablero sin revelar la jugada siguiente.
- Analiza con Stockfish hasta 30s y guarda las 3 mejores jugadas.
- Verifica tu jugada: si coincide con alguna de las 3 mejores → “¡Correcto!”, si no → “Incorrecto”.
- Contadores de aciertos/fallos de la sesión.

Uso
1. Exporta tu base “MEDIO JUEGO → Entrenamiento medio juego megadatabase.si4” a PGN desde tu programa (Scid/ChessBase). Los .si4 no pueden leerse en el navegador directamente.
2. Abre `index.html` alojado en GitHub Pages: `/PROGRAMA_GORDERIA_EXTREMA/PROGRAMA_AJEDREZ/`.
3. Carga el archivo PGN (puede ser grande; el parsing es sencillo y funciona con exportaciones estándar).
4. Escribe un rango de jugadas, por ejemplo `19-25`.
5. Pulsa “Cargar al azar”. El motor analizará hasta 30s y listará sus 3 mejores jugadas.
6. Arrastra una pieza. Si coincide con una de las 3, verás “¡Correcto!”.

Notas técnicas
- Tablero: chessboard.js. Reglas: chess.js. Motor: stockfish (WASM/CDN).
- MultiPV=3 para extraer top-3. Cortamos el análisis a los 30s.
- Si el PGN no se parsea: exporta desde tu base con opciones estándar (sin comentarios/variantes si fuera un problema).

Futuras mejoras (opcionales)
- Cargar PGN desde Google Drive (reutilizar `drive.js` y `config.js` del otro proyecto).
- Mostrar eco de la posición (eco code) o metadatos básicos de la partida sin revelar el resto.
- Ajustar fuerza del motor/nivel/tiempo.
