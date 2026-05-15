# Sorteación gordura extrema (web)

App web estática para elegir “qué toca” los viernes con ponderaciones dinámicas y dos modos:
- Ejecutar sorteo (aleatorio ponderado)
- Sorteo Sanchesco (elección manual y edición de pesos)

Reglas implementadas:
- Pesos iniciales: todas las opciones 20, Especial 0.
- Si sale una opción NO especial:
  - Esa opción pierde 4 puntos.
  - Esos 4 puntos se reparten entre todos los demás NO especiales (+1 a cada uno).
  - Especial gana +3.
- Si sale Especial: Especial vuelve a 0.

Persistencia:
- Por defecto usa LocalStorage del navegador.
- Opcional: Google Drive (archivo JSON con histórico de pesos por si cambias de dispositivo).

## Estructura

- `index.html`: Estructura de la UI.
- `styles.css`: Estilos.
- `config.js`: Configuración (versión, nombre de archivo, Client ID de Google opcional).
- `drive.js`: Integración opcional con Google Drive (OAuth + Drive API v3, gapi + GIS).
- `storage.js`: Capa de persistencia (LocalStorage + fallback + default state).
- `app.js` (ESM): Lógica de la app, render, eventos y reglas.

## Uso local

Opción rápida (puede funcionar directamente abriendo `index.html` en el navegador, pero los módulos ESM a veces requieren servidor local):

1) Con Python (ya lo tienes en tu entorno):

```powershell
# En la carpeta PROGRAMA_WEB_ISMAEL
python -m http.server 5500
```

2) Abre en el navegador:
```
http://localhost:5500/
```

- Si no activas Drive, no necesitas configurar nada. Los datos se guardan en LocalStorage.
- Si activas el switch “Usar Google Drive” sin Client ID configurado, se quedará en LocalStorage.

## Despliegue en GitHub Pages

1) Sube la carpeta `PROGRAMA_WEB_ISMAEL` a un repositorio (por ejemplo, raíz del repo o rama `gh-pages`).
2) Activa GitHub Pages (Settings > Pages) apuntando a la rama y carpeta adecuadas.
3) La URL será algo como `https://tu-usuario.github.io/tu-repo/PROGRAMA_WEB_ISMAEL/`.

Nota: Si usas Google Drive, tendrás que añadir este dominio como JavaScript Authorized Origin en tu Client ID.

## Configurar Google Drive (opcional)

1) Crea un proyecto en Google Cloud Console y habilita “Google Drive API”.
2) Crea credenciales OAuth Client ID (tipo “Web Application”).
3) No guardes el Client Secret en este repositorio. Esta app no lo necesita porque usa autenticación desde navegador con GIS y solo consume el Client ID.
4) En “Authorized JavaScript origins” añade solo los orígenes exactos desde los que servirás la web:
  - Local: `http://localhost:5500`
  - GitHub Pages: `https://swimpiii.github.io`
5) Copia el Client ID en `config.js`:

```js
window.SORTEO_CONFIG = {
  version: "v0.1.0",
  driveFileName: "sorteo_pesos.json",
  driveFolderName: "SorteacionGordura",
  googleClientId: "TU_CLIENT_ID.apps.googleusercontent.com",
  googleScopes: "https://www.googleapis.com/auth/drive.file"
};
```

6) Recarga la página, activa “Usar Google Drive” y pulsa “Conectar”.

El archivo `sorteo_pesos.json` se guardará en una carpeta llamada `SorteacionGordura` en tu Drive.

## Notas

- Si modificas manualmente los pesos desde el editor y guardas, esos valores se usan para el siguiente sorteo.
- El histórico (`history`) guarda fecha y clave elegida. Puedes extenderlo para mostrarlo en UI.
- La lógica evita pesos negativos por sanidad.
- Si algún día queréis “congelar” especial (que no suba +3), habría que ajustar la regla.

## Privacidad

- En modo LocalStorage, todo se queda en tu navegador.
- En modo Drive, la app solicita el scope mínimo `drive.file` (solo archivos creados por la app).
- El `googleClientId` puede estar en un repo público; el `Client Secret` no.
- Si alguna vez subiste un `Client Secret`, rótalo o elimina ese cliente OAuth en Google Cloud y crea otro nuevo.

¡A disfrutar del viernes! 🍕🌯🍗