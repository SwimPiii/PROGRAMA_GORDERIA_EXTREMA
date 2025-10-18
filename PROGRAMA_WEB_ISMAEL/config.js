// Configuración de la app. Puedes editar estos valores.
window.SORTEO_CONFIG = {
  version: "v0.1.0",
  // Nombre del archivo donde se guardarán los pesos en Drive (si se activa)
  driveFileName: "sorteo_pesos.json",
  // Carpeta (por nombre) dentro de Mi unidad. Si no existe, se creará.
  driveFolderName: "SorteacionGordura",
  // Client ID de OAuth 2.0 para la app web (si quieres Drive). Crea uno en Google Cloud Console.
  // Si lo dejas vacío, la app no intentará conectar a Drive a menos que pegues aquí tu Client ID.
  googleClientId: "",
  // Scopes necesarios para Drive
  googleScopes: "https://www.googleapis.com/auth/drive.file"
};
