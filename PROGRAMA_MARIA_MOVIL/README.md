# Tareas de casa

Aplicación web compartida para gestionar tareas semanales de Maria, Guapito y Sargento.

## 📋 Características

- **Perfiles**: Sargento (administración), Guapito (uso personal) y Maria
- **Calendario Semanal**: Vista organizada por días
- **Asignaciones privadas**: Sargento asigna cada tarea a una o varias personas; Maria y Guapito solo ven las suyas y sus tareas personales
- **Estados independientes**: cada persona marca su propia tarea como realizada y Sargento confirma cada asignación
- **Recompensas**: Hucha y puntos semanales solo para Maria
- **Temas**: Infantil para Maria y serio para Guapito y Sargento
- **Integración con Google Drive**: Almacenamiento de contraseñas y base de datos

## 🚀 Uso Rápido (Modo Local)

1. Inicia el servidor local con `iniciar_servidor.ps1` o `python -m http.server 8080`.
2. Abre `http://localhost:8080`.
3. Selecciona un perfil e introduce su contraseña.

## 🔐 Credenciales

| Perfil | Acceso | Permisos y experiencia |
|---|---|---|
| Sargento | PIN del perfil | Ve todas las tareas, asigna a una o varias personas, revisa y confirma cada asignación y gestiona semanas y bonificaciones. |
| Guapito | PIN del perfil | Ve las tareas asignadas a Guapito y las personales propias; puede marcarlas como realizadas, pero no confirmarlas. |
| Maria | PIN del perfil | Ve las tareas asignadas a Maria y las personales propias; puede marcarlas como realizadas, pero no confirmar tareas de Sargento. Conserva los puntos y la hucha. |

Los tres perfiles pueden crear tareas personales, visibles solo para su creador y para Sargento. Las tareas de Sargento antiguas que no tengan destinatarios se consideran asignadas a Maria.

Los verificadores PBKDF2 se guardan en `profile-passwords.js`, excluido de Git junto con la configuración privada de Drive. Copia `profile-passwords.EXAMPLE.js` y añade los verificadores antes de usar la app. Como la app es estática y pública, estos permisos son controles de interfaz: no protegen realmente los datos y los perfiles pueden forzarse.

## 📊 Sistema de Puntos

- **10€** divididos entre las tareas asignadas a Maria por Sargento
- Cada asignación completada por Maria suma su proporción de euros
- **+2€ bonus** si Maria completa todas sus tareas asignadas por Sargento
- Máximo alcanzable: **12€**

## 🌐 Configuración de Google Drive

### Paso 1: Crear Proyecto en Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un nuevo proyecto: "Maripuri Tasks App"
3. Habilita Google Drive API:
   - APIs & Services > Enable APIs and Services
   - Busca "Google Drive API" y habilítala

### Paso 2: Configurar OAuth 2.0

1. Ve a APIs & Services > Credentials
2. Clic en "Create Credentials" > "OAuth client ID"
3. Tipo de aplicación: "Web application"
4. Orígenes autorizados:
   - `http://localhost:8080` (para desarrollo local)
   - Tu dominio de producción (si lo despliegas)
5. URIs de redirección autorizados:
   - `http://localhost:8080` (para desarrollo)
   - Tu dominio/callback (producción)
6. Descarga el archivo `client_secrets.json`

### Paso 3: Configurar Credenciales

1. Copia el contenido del archivo descargado
2. Crea un archivo `config.js` en la carpeta del proyecto:

```javascript
const GOOGLE_CONFIG = {
    CLIENT_ID: 'TU_CLIENT_ID.apps.googleusercontent.com',
    API_KEY: 'TU_API_KEY',
    DISCOVERY_DOCS: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
    SCOPES: 'https://www.googleapis.com/auth/drive.file'
};
```

3. Añade esta línea en `index.html` antes de `app.js`:
```html
<script src="config.js"></script>
```

### Paso 4: Estructura de Archivos en Drive

En la carpeta de Drive configurada de forma privada para esta instalación:

Archivos que se crearán automáticamente:
- `maria_password.txt` - Archivo heredado; el login actual usa las contraseñas definidas en `CONFIG.PROFILE_PASSWORDS`
- `tasks_database.json` - Base de datos de tareas

### Paso 5: Implementar Funciones de Drive

Reemplaza las funciones en `app.js` marcadas con `// TODO` por las implementaciones reales:

```javascript
async function loadPasswordFromDrive() {
    try {
        const response = await gapi.client.drive.files.list({
            q: `name='maria_password.txt' and '${CONFIG.DRIVE_FOLDER_ID}' in parents`,
            fields: 'files(id, name)'
        });
        
        if (response.result.files.length > 0) {
            const fileId = response.result.files[0].id;
            const content = await gapi.client.drive.files.get({
                fileId: fileId,
                alt: 'media'
            });
            return content.body;
        }
        return 'Maria'; // Valor heredado de ejemplo
    } catch (error) {
        console.error('Error al cargar contraseña:', error);
        return 'Maria';
    }
}

async function saveDatabaseToDrive() {
    const content = JSON.stringify(tasksDatabase, null, 2);
    const metadata = {
        name: CONFIG.DATABASE_FILE_NAME,
        mimeType: 'application/json',
        parents: [CONFIG.DRIVE_FOLDER_ID]
    };
    
    try {
        // Buscar si ya existe
        const response = await gapi.client.drive.files.list({
            q: `name='${CONFIG.DATABASE_FILE_NAME}' and '${CONFIG.DRIVE_FOLDER_ID}' in parents`,
            fields: 'files(id)'
        });
        
        if (response.result.files.length > 0) {
            // Actualizar existente
            await gapi.client.drive.files.update({
                fileId: response.result.files[0].id,
                uploadType: 'media',
                resource: content
            });
        } else {
            // Crear nuevo
            await gapi.client.drive.files.create({
                resource: metadata,
                media: {
                    mimeType: 'application/json',
                    body: content
                }
            });
        }
    } catch (error) {
        console.error('Error al guardar en Drive:', error);
    }
}
```

## 🖥️ Servidor Local para Desarrollo

Para evitar problemas de CORS, usa un servidor local:

### Opción 1: Python
```powershell
python -m http.server 8080
```

### Opción 2: Node.js (http-server)
```powershell
npx http-server -p 8080
```

### Opción 3: PHP
```powershell
php -S localhost:8080
```

Luego abre: `http://localhost:8080`

## 📱 Despliegue para Móvil

### Opción 1: GitHub Pages (Recomendado)
1. Crea un repositorio en GitHub
2. Sube los archivos
3. Ve a Settings > Pages
4. Selecciona la rama `main` y carpeta `/root`
5. Accede desde tu iPhone a la URL generada

### Opción 2: Netlify/Vercel
1. Conecta tu repositorio
2. Despliega automáticamente
3. Configura dominio personalizado (opcional)

### Opción 3: Servidor Personal
- Necesitas un servidor con certificado SSL (HTTPS)
- Google OAuth requiere HTTPS en producción

## 🎨 Personalización

### Cambiar Colores
Edita `styles.css`, variables principales:
- Rosa principal: `#d946ef`
- Morado: `#8b5cf6`
- Verde completado: `#10b981`
- Amarillo realizado: `#fbbf24`
- Naranja pendiente: `#fb923c`

### Cambiar contraseña
Los verificadores de PIN están en `CONFIG.PROFILE_PASSWORDS` dentro de `app.js`; para cambiar un PIN, genera un nuevo salt y verificador PBKDF2.

### Ajustar Puntos y Bonificaciones
En `app.js`, modifica:
```javascript
const CONFIG = {
    POINTS_PER_EURO: 10, // Cambiar máximo de euros
    BONUS_EUROS: 2 // Cambiar bonificación
};
```

## 🐛 Solución de Problemas

### La aplicación no carga
- Verifica que todos los archivos estén en la misma carpeta
- Usa un servidor local (no abras directamente el HTML)
- Revisa la consola del navegador (F12)

### No se guardan los datos
- **Modo local**: Los datos se guardan en localStorage del navegador
- **Con Drive**: Verifica que OAuth esté configurado correctamente

### No funciona en móvil
- Asegúrate de usar HTTPS en producción
- Verifica que la URL esté en los "Orígenes autorizados" de Google Cloud

### Problemas de autenticación
- Verifica que el perfil seleccionado y la contraseña coincidan:
  - Comprueba que has seleccionado el perfil correcto y escrito su PIN

## 📝 Notas Importantes

- **Por ahora la app funciona en modo LOCAL** usando localStorage
- Los datos se almacenan en el navegador
- Para sincronización real con Drive, necesitas completar la configuración OAuth
- La app estática valida las contraseñas en el navegador; no se debe usar como autenticación de datos sensibles.
- Cada semana tiene su propia base de datos independiente

## 🔄 Próximos Pasos

1. ✅ Configurar OAuth de Google Drive
2. ✅ Implementar funciones de lectura/escritura reales
3. ✅ Desplegar en servidor HTTPS
4. ✅ Probar desde iPhone
5. ⏳ Opcional: Añadir notificaciones push
6. ⏳ Opcional: Modo offline con Service Workers

## 👥 Contacto

Los datos de contacto y enlaces privados de Drive no se incluyen en el repositorio.
