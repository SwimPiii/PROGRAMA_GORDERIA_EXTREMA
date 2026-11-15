// ==================== CONFIGURACIÓN ====================
const CONFIG = {
    PASSWORD_FILE_NAME: 'maria_password.txt',
    DATABASE_FILE_NAME: 'tasks_database.json',
    PIGGY_BANK_FILE_NAME: 'piggy_bank.json',
    POINTS_PER_EURO: 10, // 10€ máximo
    BONUS_EUROS: 2 // Bonificación por semana completa
};

// Tareas por defecto para rellenar semana automáticamente
const DEFAULT_TASKS = {
    daily: [ // Lunes a Domingo
        { title: 'Poner y quitar la mesa (comida)', description: '' },
        { title: 'Poner y quitar la mesa (cena)', description: '' },
        { title: 'Hacer tu cama', description: '' }
    ],
    weekdays: [ // Lunes a Viernes
        { title: 'Hacer deberes y/o estudiar', description: '' }
    ],
    saturday: [ // Solo Sábado
        { title: 'Limpiar habitación', description: '' }
    ]
};

// ==================== VARIABLES GLOBALES ====================
let currentUser = null; // 'sargento', 'guapito' o 'maria'
let currentWeekStart = null; // Fecha de inicio de la semana actual
let tasksDatabase = {}; // Base de datos de tareas por semana
let piggyBank = 0; // Dinero acumulado en la hucha
let gapi = null;
let gapiInited = false;
let mariaPassword = ''; // Contraseña de Maria desde Drive

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
});

function initializeApp() {
    // Cargar Google API
    loadGoogleAPI();
    
    // Establecer semana actual
    currentWeekStart = getWeekStart(new Date());
    
    // Inicializar base de datos local
    loadLocalDatabase();
    
    // Cargar hucha
    loadPiggyBank();
}

function isAdministrator() {
    return currentUser === 'sargento';
}

function isAdminTask(creator) {
    return creator === 'sargento' || creator === 'super_usuario';
}

function getTaskAssignees(task) {
    const validProfiles = ['maria', 'guapito', 'sargento'];
    if (Array.isArray(task.assignees)) {
        return [...new Set(task.assignees.filter(profile => validProfiles.includes(profile)))];
    }
    if (isAdminTask(task.creator)) return ['maria'];
    return validProfiles.includes(task.creator) ? [task.creator] : [];
}

function getTaskStatus(task, profile) {
    const status = task.assigneeStatuses && task.assigneeStatuses[profile];
    return ['pending', 'done', 'completed'].includes(status)
        ? status
        : (['pending', 'done', 'completed'].includes(task.status) ? task.status : 'pending');
}

function getVisibleTasks(tasks, profile = currentUser) {
    if (profile === 'sargento') return tasks;
    return tasks.filter(task => getTaskAssignees(task).includes(profile));
}

function canChangeTaskStatus(task, profile = currentUser, actor = currentUser) {
    if (!getTaskAssignees(task).includes(profile)) return false;
    if (actor === 'sargento') return true;
    if (profile !== actor) return false;
    if (isAdminTask(task.creator)) return getTaskStatus(task, profile) !== 'completed';
    return task.creator === profile;
}

function getNextTaskStatus(task, profile, actor = currentUser) {
    if (!canChangeTaskStatus(task, profile, actor)) return null;

    const status = getTaskStatus(task, profile);
    if (actor === 'sargento') {
        return status === 'pending' ? 'done' : status === 'done' ? 'completed' : 'pending';
    }
    if (isAdminTask(task.creator)) {
        return status === 'pending' ? 'done' : 'pending';
    }
    return status === 'completed' ? 'pending' : 'completed';
}

function setTaskStatus(task, profile, status) {
    const assignees = getTaskAssignees(task);
    task.assignees = assignees;
    if (!task.assigneeStatuses || typeof task.assigneeStatuses !== 'object') {
        task.assigneeStatuses = {};
    }
    assignees.forEach(assignee => {
        if (!['pending', 'done', 'completed'].includes(task.assigneeStatuses[assignee])) {
            task.assigneeStatuses[assignee] = ['pending', 'done', 'completed'].includes(task.status)
                ? task.status
                : 'pending';
        }
    });
    task.assigneeStatuses[profile] = status;

    const statuses = assignees.map(assignee => task.assigneeStatuses[assignee]);
    task.status = statuses.length > 0 && statuses.every(value => value === 'completed')
        ? 'completed'
        : statuses.includes('done') ? 'done' : 'pending';
}

function isMariaRewardTask(task) {
    return isAdminTask(task.creator) && getTaskAssignees(task).includes('maria');
}

function getProfileLabel(profile) {
    if (profile === 'sargento' || profile === 'super_usuario') return 'Sargento';
    if (profile === 'guapito') return 'Guapito';
    return 'Maria';
}

function updateProfileTheme(profile) {
    const serious = profile !== 'maria';
    document.body.classList.toggle('theme-serious', serious);
    document.body.classList.toggle('profile-guapito', profile === 'guapito');
    const title = document.getElementById('loginTitle');
    if (title) {
        title.textContent = profile === 'maria' ? '🌺 Tareas de Maria 🌺' : `Tareas · ${getProfileLabel(profile)}`;
    }
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = serious ? '#1f2937' : '#3b82f6';
}

async function verifyProfilePassword(profile, password) {
    const verifier = window.PROFILE_PASSWORDS && window.PROFILE_PASSWORDS[profile];
    if (!verifier) {
        throw new Error('Falta configurar la contraseña privada de este perfil en profile-passwords.js.');
    }
    if (!window.crypto?.subtle) {
        throw new Error('Este navegador no permite verificar la clave. Usa una versión reciente.');
    }

    const key = await window.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const result = await window.crypto.subtle.deriveBits({
        name: 'PBKDF2',
        salt: Uint8Array.from(verifier.salt.match(/.{2}/g), byte => parseInt(byte, 16)),
        iterations: 200000,
        hash: 'SHA-256'
    }, key, 256);
    const actualHash = Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
    let difference = 0;
    for (let index = 0; index < verifier.hash.length; index++) {
        difference |= verifier.hash.charCodeAt(index) ^ actualHash.charCodeAt(index);
    }
    return difference === 0;
}

function setupEventListeners() {
    // Login
    document.getElementById('loginButton').addEventListener('click', handleLogin);
    document.getElementById('passwordInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') handleLogin();
    });
    
    document.getElementById('profileSelect').addEventListener('change', function() {
        updateProfileTheme(this.value);
    });
    
    // Logout
    document.getElementById('logoutButton').addEventListener('click', handleLogout);
    // (Eliminados botones de conectar Drive; conexión ahora es automática)
    
    // Navegación de semanas
    document.getElementById('prevWeek').addEventListener('click', () => navigateWeek(-1));
    document.getElementById('nextWeek').addEventListener('click', () => navigateWeek(1));
    
    // Botones de administración
    document.getElementById('addBonusBtn').addEventListener('click', addBonus);
    document.getElementById('removeBonusBtn').addEventListener('click', removeBonus);
    document.getElementById('clearWeekBtn').addEventListener('click', clearWeek);
    document.getElementById('fillWeekBtn').addEventListener('click', fillWeekAutomatically);
    document.getElementById('editPiggyBank').addEventListener('click', editPiggyBankAmount);
    
    // Modal
    document.querySelector('.close').addEventListener('click', closeModal);
    document.getElementById('cancelTaskBtn').addEventListener('click', closeModal);
    document.getElementById('taskForm').addEventListener('submit', handleTaskSubmit);

    // Próximas tareas
    const upcomingBtn = document.getElementById('upcomingBtn');
    const upcomingModal = document.getElementById('upcomingModal');
    const closeUpcoming = document.getElementById('closeUpcoming');
    if (upcomingBtn && upcomingModal && closeUpcoming) {
        upcomingBtn.addEventListener('click', showUpcomingTasks);
        closeUpcoming.addEventListener('click', () => upcomingModal.style.display = 'none');
    }
}

// ==================== GOOGLE DRIVE API ====================
async function handleDriveConnect() {
    const btn = document.getElementById('driveConnectBtn');
    
    if (typeof driveSignIn !== 'function') {
        alert('Google Drive no está disponible. Verifica la configuración.');
        return;
    }
    
    try {
        btn.textContent = '☁️ Conectando...';
        btn.disabled = true;
        
        await driveSignIn();
        
        btn.textContent = '✅ Conectado a Drive';
        btn.style.background = '#10b981';
        
        alert('¡Conectado a Google Drive! Tus datos se sincronizarán automáticamente.');
    } catch (error) {
        console.error('Error conectando con Drive:', error);
        btn.textContent = '☁️ Conectar Google Drive';
        btn.disabled = false;
        alert('No se pudo conectar con Google Drive: ' + error.message);
    }
}

function loadGoogleAPI() {
    // Drive se prepara automáticamente en segundo plano
    // Solo cargamos password local por ahora
    loadPasswordFromLocalStorage();
    
    // Verificar si ya hay sesión activa (para reconexión automática)
    setTimeout(() => {
        if (typeof driveState !== 'undefined' && driveState.signedIn) {
            console.log('Sesión de Drive activa');
            const btn = document.getElementById('driveConnectBtn');
            if (btn) {
                btn.textContent = '✅ Conectado a Drive';
                btn.style.background = '#10b981';
            }
        }
    }, 2000);
}

function loadPasswordFromLocalStorage() {
    // Temporalmente usar localStorage hasta configurar Drive
    const stored = localStorage.getItem('mariaPassword');
    mariaPassword = stored || 'maria'; // Password por defecto
    
    if (!stored) {
        localStorage.setItem('mariaPassword', mariaPassword);
    }
}

async function loadPasswordFromDrive() {
    // Ya no se usa, la carga se hace desde drive-config.js
    return mariaPassword;
}

async function savePasswordToDrive(password) {
    if (typeof savePasswordToDriveReal === 'function') {
        await savePasswordToDriveReal(password);
    } else {
        localStorage.setItem('mariaPassword', password);
        mariaPassword = password;
    }
}

async function loadDatabaseFromDrive() {
    // Ya no se usa, la carga se hace desde drive-config.js
}

async function saveDatabaseToDrive() {
    if (typeof saveDatabaseToDriveReal === 'function') {
        await saveDatabaseToDriveReal();
    } else {
        localStorage.setItem('tasksDatabase', JSON.stringify(tasksDatabase));
    }
}

function loadLocalDatabase() {
    const stored = localStorage.getItem('tasksDatabase');
    if (stored) {
        tasksDatabase = JSON.parse(stored);
    }
}

function saveLocalDatabase() {
    localStorage.setItem('tasksDatabase', JSON.stringify(tasksDatabase));
    // Guardar también en Drive si está conectado
    if (typeof saveDatabaseToDriveReal === 'function') {
        saveDatabaseToDriveReal().catch(err => console.error('Error guardando en Drive:', err));
    }
}

// ==================== AUTENTICACIÓN ====================
async function handleLogin() {
    const passwordInput = document.getElementById('passwordInput');
    const password = passwordInput.value.trim();
    const errorMsg = document.getElementById('loginError');
    
    errorMsg.textContent = '';
    
    if (!password) {
        errorMsg.textContent = 'Por favor, introduce una contraseña';
        return;
    }
    
    const selectedProfile = document.getElementById('profileSelect').value;
    let isValid;
    try {
        isValid = await verifyProfilePassword(selectedProfile, password);
    } catch (error) {
        console.error('No se pudo verificar la clave del perfil:', error);
        errorMsg.textContent = error.message;
        return;
    }
    if (isValid) currentUser = selectedProfile;
    
    if (isValid) {
        updateProfileTheme(currentUser);
        // Gesto de usuario: intentar conectar Drive automáticamente aquí
        try {
            if (typeof driveSignIn === 'function') {
                await driveSignIn();
            }
        } catch (e) {
            console.log('Drive no se pudo conectar automáticamente en login:', e);
        }

        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.add('active');
        
        // Actualizar UI
        updateWelcomeMessage();
        
        // Cargar datos (primero de localStorage, luego intentar Drive)
        loadLocalDatabase();
        renderCalendar();
        
        // Si aún no está conectado, intentarlo en segundo plano
        setTimeout(async () => {
            try {
                if (typeof driveSignIn === 'function') {
                    const isDriveConnected = typeof driveState !== 'undefined' && driveState.signedIn;
                    if (!isDriveConnected) {
                        await driveSignIn();
                        renderCalendar();
                    }
                }
            } catch (error) {
                console.log('Drive no disponible, continuando con localStorage:', error);
            }
        }, 500);
        
        // Mostrar controles de admin si es super usuario
        document.getElementById('adminControls').style.display = isAdministrator() ? 'flex' : 'none';
    } else {
        errorMsg.textContent = '❌ Contraseña incorrecta';
        passwordInput.value = '';
    }
}

async function handleLogout() {
    // Guardar datos en Drive antes de cerrar sesión
    try {
        if (typeof saveDatabaseToDriveReal === 'function' && driveState.signedIn) {
            await saveDatabaseToDriveReal();
            if (typeof savePiggyBankToDrive === 'function') {
                await savePiggyBankToDrive();
            }
            console.log('Datos guardados en Drive al cerrar sesión');
        }
    } catch (error) {
        console.error('Error guardando en Drive al cerrar sesión:', error);
    }
    
    currentUser = null;
    updateProfileTheme(document.getElementById('profileSelect').value);
    document.getElementById('mainScreen').classList.remove('active');
    document.getElementById('loginScreen').classList.add('active');
    document.getElementById('passwordInput').value = '';
    document.getElementById('adminControls').style.display = 'none';
}

function updateWelcomeMessage() {
    const welcomeMsg = document.getElementById('welcomeMessage');
    const giveMoneyBtn = document.getElementById('giveMoney');
    const editPiggyBtn = document.getElementById('editPiggyBank');
    
    document.getElementById('mainScreen').classList.toggle('profile-guapito', currentUser === 'guapito');
    document.getElementById('mainScreen').classList.toggle('theme-serious', currentUser !== 'maria');
    if (isAdministrator()) {
        welcomeMsg.textContent = 'Sargento · Gestión de tareas';
        if (giveMoneyBtn) {
            giveMoneyBtn.style.display = 'block';
        }
        if (editPiggyBtn) {
            editPiggyBtn.style.display = 'block';
        }
    } else {
        welcomeMsg.textContent = currentUser === 'guapito' ? 'Guapito · Tareas' : 'Bienvenida, Maria! 🌺';
        if (giveMoneyBtn) {
            giveMoneyBtn.style.display = 'none';
        }
        if (editPiggyBtn) {
            editPiggyBtn.style.display = 'none';
        }
    }
}

// ==================== GESTIÓN DE FECHAS ====================
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Lunes como primer día
    return new Date(d.setDate(diff));
}

function getWeekKey(weekStart) {
    return weekStart.toISOString().split('T')[0];
}

function formatDate(date) {
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 
                    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${date.getDate()} ${months[date.getMonth()]}`;
}

function getDayName(dayIndex) {
    const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    return days[dayIndex];
}

function navigateWeek(direction) {
    currentWeekStart.setDate(currentWeekStart.getDate() + (direction * 7));
    renderCalendar();
}

// ==================== RENDERIZADO ====================
function renderCalendar() {
    updateWeekDisplay();
    updateProgressBar();
    
    const calendar = document.getElementById('calendar');
    calendar.innerHTML = '';
    
    const weekKey = getWeekKey(currentWeekStart);
    const weekData = tasksDatabase[weekKey] || { tasks: [], bonus: 0 };
    
    // Crear columnas para cada día
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(currentWeekStart);
        dayDate.setDate(currentWeekStart.getDate() + i);
        
        const dayColumn = document.createElement('div');
        dayColumn.className = 'day-column';
        
        // Header del día
        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        
        const dayInfo = document.createElement('div');
        const dayName = document.createElement('div');
        dayName.className = 'day-name';
        dayName.textContent = getDayName(i);
        
        const dateDisplay = document.createElement('div');
        dateDisplay.className = 'day-date';
        dateDisplay.textContent = formatDate(dayDate);
        
        dayInfo.appendChild(dayName);
        dayInfo.appendChild(dateDisplay);
        
        // Botón añadir tarea
        const addBtn = document.createElement('button');
        addBtn.className = 'add-task-btn';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', () => openTaskModal(i));
        
        dayHeader.appendChild(dayInfo);
        dayHeader.appendChild(addBtn);
        
        // Lista de tareas
        const taskList = document.createElement('div');
        taskList.className = 'task-list';
        taskList.id = `taskList-${i}`;
        
        // Filtrar tareas del día
        const dayTasks = getVisibleTasks(weekData.tasks, currentUser).filter(task => task.day === i);
        dayTasks.forEach(task => {
            const taskElement = createTaskElement(task, weekKey);
            taskList.appendChild(taskElement);
        });
        
        dayColumn.appendChild(dayHeader);
        dayColumn.appendChild(taskList);
        calendar.appendChild(dayColumn);
    }
}

function createTaskElement(task, weekKey) {
    const taskItem = document.createElement('div');
    taskItem.className = 'task-item';
    
    const assignees = getTaskAssignees(task);
    const statusControls = document.createElement('div');
    statusControls.className = 'task-status-controls';
    const visibleAssignees = isAdministrator() ? assignees : [currentUser];
    visibleAssignees.forEach(profile => {
        const status = getTaskStatus(task, profile);
        const statusRow = document.createElement('div');
        statusRow.className = 'task-status-row';

        if (isAdministrator()) {
            const assigneeLabel = document.createElement('span');
            assigneeLabel.className = 'task-status-label';
            assigneeLabel.textContent = getProfileLabel(profile);
            statusRow.appendChild(assigneeLabel);
        }

        const statusButton = document.createElement('button');
        statusButton.type = 'button';
        statusButton.className = `task-status ${status}`;
        statusButton.textContent = status === 'pending' ? '○' : status === 'done' ? '◐' : '●';
        statusButton.setAttribute('aria-label', `${getProfileLabel(profile)}: ${status}`);
        statusButton.disabled = !canChangeTaskStatus(task, profile);
        statusButton.addEventListener('click', (e) => {
            e.stopPropagation();
            changeTaskStatus(task, weekKey, profile);
        });
        statusRow.appendChild(statusButton);
        statusControls.appendChild(statusRow);
    });
    
    // Contenido de la tarea
    const taskContent = document.createElement('div');
    taskContent.className = 'task-content';
    
    const taskTitle = document.createElement('div');
    taskTitle.className = 'task-title';
    taskTitle.textContent = task.title;
    
    taskContent.appendChild(taskTitle);
    
    if (task.description) {
        const taskDesc = document.createElement('div');
        taskDesc.className = 'task-description';
        taskDesc.textContent = task.description;
        taskContent.appendChild(taskDesc);
    }
    
    const taskCreator = document.createElement('div');
    taskCreator.className = 'task-creator';
    const assigneeNames = assignees.map(getProfileLabel).join(', ');
    taskCreator.textContent = isAdminTask(task.creator)
        ? `Para: ${assigneeNames} · Creada por ${getProfileLabel(task.creator)}`
        : `Personal · Creada por ${getProfileLabel(task.creator)}`;
    taskContent.appendChild(taskCreator);
    
    // Acciones
    const taskActions = document.createElement('div');
    taskActions.className = 'task-actions';
    
    const canDelete = isAdministrator() || (task.creator === currentUser && !isAdminTask(task.creator));
    
    if (canDelete) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete';
        deleteBtn.textContent = '🗑️';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTask(task, weekKey);
        });
        taskActions.appendChild(deleteBtn);
    }
    
    taskItem.appendChild(statusControls);
    taskItem.appendChild(taskContent);
    taskItem.appendChild(taskActions);
    
    return taskItem;
}

function updateWeekDisplay() {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(currentWeekStart.getDate() + 6);
    
    const weekDisplay = document.getElementById('weekDisplay');
    weekDisplay.textContent = `Semana del ${formatDate(currentWeekStart)} - ${formatDate(weekEnd)} ${currentWeekStart.getFullYear()}`;
}

function updateProgressBar() {
    const weekKey = getWeekKey(currentWeekStart);
    const weekData = tasksDatabase[weekKey] || { tasks: [], bonus: 0 };
    
    const superUserTasks = weekData.tasks.filter(isMariaRewardTask);
    const completedTasks = superUserTasks.filter(t => getTaskStatus(t, 'maria') === 'completed');
    
    let totalEuros = 0;
    
    if (superUserTasks.length > 0) {
        const eurosPerTask = CONFIG.POINTS_PER_EURO / superUserTasks.length;
        totalEuros = completedTasks.length * eurosPerTask;
    }
    
    // Añadir bonificación
    totalEuros += weekData.bonus || 0;
    
    // Calcular el máximo dinámico (10€ base + bonificación otorgada)
    const maxEuros = CONFIG.POINTS_PER_EURO + (weekData.bonus || 0);
    
    const percentage = (totalEuros / maxEuros) * 100;
    
    document.getElementById('progressFill').style.width = `${percentage}%`;
    document.getElementById('pointsDisplay').textContent = 
        `${totalEuros.toFixed(2)}€ / ${maxEuros.toFixed(2)}€`;
    
    // Actualizar mensaje de bonus
    const allCompleted = superUserTasks.length > 0 &&
                        superUserTasks.every(t => getTaskStatus(t, 'maria') === 'completed');
    
    const bonusText = document.getElementById('bonusText');
    if (allCompleted && weekData.bonus === 0 && isAdministrator()) {
        bonusText.textContent = '🎉 ¡Todas las tareas completadas! Puedes otorgar bonificación';
        bonusText.style.color = '#10b981';
    } else if (allCompleted && weekData.bonus > 0) {
        bonusText.textContent = `✨ ¡Bonificación de ${weekData.bonus}€ otorgada!`;
        bonusText.style.color = '#10b981';
    } else {
        bonusText.textContent = '🌺 Completa todas las tareas y obtendrás euritos extras!';
        bonusText.style.color = '#0ea5e9';
    }
}

// ==================== GESTIÓN DE TAREAS ====================
let currentEditingTask = null;
let currentEditingDay = null;

function openTaskModal(dayIndex) {
    currentEditingDay = dayIndex;
    currentEditingTask = null;
    
    document.getElementById('modalTitle').textContent = 'Nueva Tarea';
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDescription').value = '';
    document.getElementById('taskDay').value = dayIndex;
    document.querySelectorAll('input[name="taskAssignee"]').forEach(input => {
        input.checked = input.value === 'sargento';
    });
    document.getElementById('assigneesField').style.display = isAdministrator() ? 'block' : 'none';
    
    // Mostrar/ocultar descripción según usuario
    const descriptionField = document.getElementById('taskDescription');
    const descriptionContainer = descriptionField.parentElement;
    
    if (isAdministrator()) {
        descriptionField.style.display = 'none';
        descriptionField.required = false;
    } else {
        descriptionField.style.display = 'block';
        descriptionField.required = false;
    }
    
    document.getElementById('taskModal').style.display = 'block';
}

function closeModal() {
    document.getElementById('taskModal').style.display = 'none';
    currentEditingTask = null;
    currentEditingDay = null;
}

function handleTaskSubmit(e) {
    e.preventDefault();
    
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const day = parseInt(document.getElementById('taskDay').value);
    
    if (!title) return;
    
    const assignees = isAdministrator()
        ? Array.from(document.querySelectorAll('input[name="taskAssignee"]:checked'), input => input.value)
        : [currentUser];
    if (assignees.length === 0) {
        alert('Selecciona al menos una persona para la tarea.');
        return;
    }

    const weekKey = getWeekKey(currentWeekStart);
    
    if (!tasksDatabase[weekKey]) {
        tasksDatabase[weekKey] = { tasks: [], bonus: 0 };
    }
    
    const newTask = {
        id: Date.now(),
        title,
        description,
        day,
        status: 'pending',
        creator: currentUser,
        assignees,
        assigneeStatuses: Object.fromEntries(assignees.map(profile => [profile, 'pending'])),
        createdAt: new Date().toISOString()
    };
    
    tasksDatabase[weekKey].tasks.push(newTask);
    saveLocalDatabase();
    
    closeModal();
    renderCalendar();
}

function changeTaskStatus(task, weekKey, profile = currentUser) {
    const weekData = tasksDatabase[weekKey];
    if (!weekData || !canChangeTaskStatus(task, profile)) return;
    const taskIndex = weekData.tasks.findIndex(t => t.id === task.id);
    
    if (taskIndex === -1) return;
    
    const currentTask = weekData.tasks[taskIndex];
    const previousStatus = getTaskStatus(currentTask, profile);
    const nextStatus = getNextTaskStatus(currentTask, profile);
    if (!nextStatus) return;
    setTaskStatus(currentTask, profile, nextStatus);

    if (isMariaRewardTask(currentTask) && profile === 'maria' && nextStatus !== previousStatus) {
        const rewardTasks = weekData.tasks.filter(isMariaRewardTask);
        const eurosPerTask = rewardTasks.length > 0 ? CONFIG.POINTS_PER_EURO / rewardTasks.length : 0;
        if (nextStatus === 'completed') addMoneyToPiggyBank(eurosPerTask);
        if (previousStatus === 'completed') addMoneyToPiggyBank(-eurosPerTask);
    }
    
    saveLocalDatabase();
    renderCalendar();
}

function deleteTask(task, weekKey) {
    if (!isAdministrator() && (task.creator !== currentUser || isAdminTask(task.creator))) return;
    if (!confirm('¿Seguro que quieres eliminar esta tarea?')) return;
    
    const weekData = tasksDatabase[weekKey];
    weekData.tasks = weekData.tasks.filter(t => t.id !== task.id);
    
    saveLocalDatabase();
    renderCalendar();
}

// ==================== BONIFICACIONES ====================
function addBonus() {
    if (!isAdministrator()) return;
    const weekKey = getWeekKey(currentWeekStart);
    const weekData = tasksDatabase[weekKey] || { tasks: [], bonus: 0 };
    
    const superUserTasks = weekData.tasks.filter(isMariaRewardTask);
    const allCompleted = superUserTasks.length > 0 &&
                        superUserTasks.every(t => getTaskStatus(t, 'maria') === 'completed');
    
    if (!allCompleted) {
        alert('⚠️ No se puede otorgar bonificación. Aún hay tareas pendientes o sin completar.');
        return;
    }
    
    // Solicitar el monto de la bonificación
    const bonusAmountStr = prompt('¿Cuántos euros de bonificación quieres añadir?', '2');
    
    if (bonusAmountStr === null) {
        // Usuario canceló el prompt
        return;
    }
    
    const bonusAmount = parseFloat(bonusAmountStr);
    
    if (isNaN(bonusAmount) || bonusAmount <= 0) {
        alert('Por favor, introduce un número válido mayor que 0');
        return;
    }
    
    weekData.bonus = (weekData.bonus || 0) + bonusAmount;
    tasksDatabase[weekKey] = weekData;
    
    // Añadir bonus a la hucha
    addMoneyToPiggyBank(bonusAmount);
    
    saveLocalDatabase();
    renderCalendar();
    
    alert(`✅ ¡Bonificación de ${bonusAmount.toFixed(2)}€ otorgada y añadida a la hucha!`);
}

function removeBonus() {
    if (!isAdministrator()) return;
    if (!confirm('¿Seguro que quieres quitar la bonificación de esta semana?')) return;
    
    const weekKey = getWeekKey(currentWeekStart);
    const weekData = tasksDatabase[weekKey] || { tasks: [], bonus: 0 };
    
    const previousBonus = weekData.bonus;
    weekData.bonus = 0;
    tasksDatabase[weekKey] = weekData;
    
    // Restar bonus de la hucha
    if (previousBonus > 0) {
        addMoneyToPiggyBank(-previousBonus);
    }
    
    saveLocalDatabase();
    renderCalendar();
    
    alert('✅ Bonificación eliminada y restada de la hucha');
}

function clearWeek() {
    if (!isAdministrator()) return;
    if (!confirm('¿SEGURO que quieres eliminar TODAS las tareas de esta semana? Esta acción no se puede deshacer.')) return;
    
    const weekKey = getWeekKey(currentWeekStart);
    delete tasksDatabase[weekKey];
    
    saveLocalDatabase();
    renderCalendar();
    
    alert('✅ Semana limpiada');
}

// ==================== CERRAR MODAL AL HACER CLICK FUERA ====================
window.onclick = function(event) {
    const modal = document.getElementById('taskModal');
    if (event.target === modal) {
        closeModal();
    }
};

// ==================== SISTEMA DE HUCHA ====================
function loadPiggyBank() {
    const stored = localStorage.getItem('piggyBank');
    if (stored) {
        piggyBank = parseFloat(stored);
    } else {
        piggyBank = 0;
    }
    updatePiggyBankDisplay();
}

function savePiggyBank() {
    localStorage.setItem('piggyBank', piggyBank.toString());
    // Guardar también en Drive si está disponible
    if (typeof savePiggyBankToDrive === 'function') {
        piggyBankBalance = piggyBank; // Sincronizar variable global
        savePiggyBankToDrive();
    }
    updatePiggyBankDisplay();
}

function updatePiggyBankDisplay() {
    const display = document.getElementById('piggyBankAmount');
    if (display) {
        display.textContent = `${piggyBank.toFixed(2)}€`;
    }
}

function addMoneyToPiggyBank(amount) {
    piggyBank += amount;
    savePiggyBank();
}

function giveMoneyFromPiggyBank() {
    if (!isAdministrator()) return;
    
    const amount = prompt(`💰 La hucha tiene ${piggyBank.toFixed(2)}€\n\n¿Cuánto dinero quieres dar a Maria?\n(Se restará de la hucha)`);
    
    if (amount === null) return; // Cancelado
    
    const euros = parseFloat(amount);
    
    if (isNaN(euros) || euros <= 0) {
        alert('⚠️ Por favor, introduce una cantidad válida mayor que 0');
        return;
    }
    
    if (euros > piggyBank) {
        alert(`⚠️ No hay suficiente dinero en la hucha.\nDisponible: ${piggyBank.toFixed(2)}€`);
        return;
    }
    
    if (confirm(`¿Seguro que quieres dar ${euros.toFixed(2)}€ a Maria?\n\nSe restará de la hucha.`)) {
        piggyBank -= euros;
        savePiggyBank();
        alert(`✅ Has dado ${euros.toFixed(2)}€ a Maria\n\n💰 Queda en la hucha: ${piggyBank.toFixed(2)}€`);
    }
}

function editPiggyBankAmount() {
    if (!isAdministrator()) return;
    
    const newAmount = prompt(`✏️ Editar cantidad de la hucha\n\nActual: ${piggyBank.toFixed(2)}€\n\n¿Cuánto dinero quieres que tenga la hucha?`);
    
    if (newAmount === null) return; // Cancelado
    
    const euros = parseFloat(newAmount);
    
    if (isNaN(euros) || euros < 0) {
        alert('⚠️ Por favor, introduce una cantidad válida (0 o mayor)');
        return;
    }
    
    if (confirm(`¿Seguro que quieres cambiar la hucha de ${piggyBank.toFixed(2)}€ a ${euros.toFixed(2)}€?`)) {
        piggyBank = euros;
        savePiggyBank();
        alert(`✅ Hucha actualizada: ${piggyBank.toFixed(2)}€`);
    }
}

// ==================== RELLENAR SEMANA AUTOMÁTICAMENTE ====================
function fillWeekAutomatically() {
    if (!isAdministrator()) return;
    
    if (!confirm('¿Quieres rellenar la semana con las tareas por defecto?\n\n⚠️ NO se borrarán las tareas existentes, solo se añadirán las que falten.')) {
        return;
    }
    
    const weekKey = getWeekKey(currentWeekStart);
    
    if (!tasksDatabase[weekKey]) {
        tasksDatabase[weekKey] = { tasks: [], bonus: 0 };
    }
    
    let addedCount = 0;
    
    // Función auxiliar para verificar si una tarea ya existe
    function taskExists(day, title) {
        return tasksDatabase[weekKey].tasks.some(task => 
            task.day === day && task.title === title
        );
    }
    
    // Añadir tareas diarias (Lunes a Domingo)
    for (let day = 0; day < 7; day++) {
        DEFAULT_TASKS.daily.forEach(task => {
            if (!taskExists(day, task.title)) {
                tasksDatabase[weekKey].tasks.push({
                    id: Date.now() + addedCount,
                    title: task.title,
                    description: task.description,
                    day: day,
                    status: 'pending',
                    creator: 'sargento',
                    assignees: ['maria'],
                    assigneeStatuses: { maria: 'pending' },
                    createdAt: new Date().toISOString()
                });
                addedCount++;
            }
        });
    }
    
    // Añadir tareas de lunes a viernes (días 0-4)
    for (let day = 0; day < 5; day++) {
        DEFAULT_TASKS.weekdays.forEach(task => {
            if (!taskExists(day, task.title)) {
                tasksDatabase[weekKey].tasks.push({
                    id: Date.now() + addedCount,
                    title: task.title,
                    description: task.description,
                    day: day,
                    status: 'pending',
                    creator: 'sargento',
                    assignees: ['maria'],
                    assigneeStatuses: { maria: 'pending' },
                    createdAt: new Date().toISOString()
                });
                addedCount++;
            }
        });
    }
    
    // Añadir tarea del sábado (día 5)
    DEFAULT_TASKS.saturday.forEach(task => {
        if (!taskExists(5, task.title)) {
            tasksDatabase[weekKey].tasks.push({
                id: Date.now() + addedCount,
                title: task.title,
                description: task.description,
                day: 5,
                status: 'pending',
                creator: 'sargento',
                assignees: ['maria'],
                assigneeStatuses: { maria: 'pending' },
                createdAt: new Date().toISOString()
            });
            addedCount++;
        }
    });
    
    saveLocalDatabase();
    renderCalendar();
    
    if (addedCount > 0) {
        alert(`✅ Se han añadido ${addedCount} tareas a la semana`);
    } else {
        alert('ℹ️ Todas las tareas por defecto ya estaban en la semana');
    }
}

// ==================== PRÓXIMAS TAREAS ====================
const AUTO_TITLES_EXCLUDE = new Set([
    'Poner y quitar la mesa (comida)',
    'Poner y quitar la mesa (cena)',
    'Limpiar habitación',
    'Hacer deberes y/o estudiar',
    'Hacer tu cama'
]);

function showUpcomingTasks() {
    const upcomingModal = document.getElementById('upcomingModal');
    const upcomingList = document.getElementById('upcomingList');
    if (!upcomingModal || !upcomingList) return;
    const today = new Date();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const items = [];
    
    // Considerar semanas presentes en la base de datos (actual y siguientes si existen)
    const weekKeys = Object.keys(tasksDatabase).sort();
    weekKeys.forEach(weekKey => {
        const weekStartDate = new Date(weekKey);
        const data = tasksDatabase[weekKey];
        if (!data || !data.tasks) return;
        getVisibleTasks(data.tasks, currentUser).forEach(task => {
            if (AUTO_TITLES_EXCLUDE.has(task.title)) return;
            const taskDate = new Date(weekStartDate);
            taskDate.setDate(weekStartDate.getDate() + task.day);
            const diffDays = Math.ceil((taskDate - today) / MS_PER_DAY);
            if (diffDays >= 0) {
                const profiles = isAdministrator() ? getTaskAssignees(task) : [currentUser];
                profiles.forEach(profile => {
                    if (getTaskStatus(task, profile) === 'completed') return;
                    items.push({
                        title: task.title,
                        assignee: profile,
                        dayName: getDayName(task.day),
                        date: taskDate,
                        daysLeft: diffDays
                    });
                });
            }
        });
    });
    
    items.sort((a, b) => a.date - b.date);
    
    upcomingList.innerHTML = '';
    if (items.length === 0) {
        upcomingList.innerHTML = '<p>No hay próximas tareas especiales.</p>';
    } else {
        items.forEach(item => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '8px 0';
            const left = document.createElement('div');
            left.textContent = isAdministrator()
                ? `${item.dayName} - ${item.title} (${getProfileLabel(item.assignee)})`
                : `${item.dayName} - ${item.title}`;
            const right = document.createElement('div');
            right.textContent = `${item.daysLeft} días`;
            right.style.color = '#22c55e';
            right.style.fontWeight = 'bold';
            row.appendChild(left);
            row.appendChild(right);
            upcomingList.appendChild(row);
        });
    }
    upcomingModal.style.display = 'block';
}
