        // Configuration
        const CONFIG = {
            MAX_MESSAGES: 20,
            API_THROTTLE_MS: 2100, // 2.1 seconds - API caches for 2s, 100ms safety margin
            API_URL: 'https://api.adviceslip.com/advice',
            PARTICLE_INTERVAL: 1000,
            // Enable with ?debug in the URL
            VERBOSE_LOGGING: new URLSearchParams(window.location.search).has('debug'),
            STORAGE_KEYS: {
                MESSAGE_QUEUE: 'fortune_queue',
                FORTUNE_HISTORY: 'fortune_history',
                FORTUNE_COUNT: 'fortune_count',
                API_STATE: 'fortune_api_state',
                VERSION: 'fortune_storage_version',
                SHOW_FAVORITES_ONLY: 'show_favorites_only',
                KNOWN_IDS: 'fortune_known_ids',
                SOUND_ENABLED: 'fortune_sound_enabled'
            },
            STORAGE_VERSION: 1,
            MAX_HISTORY_ITEMS: 20,
            MAX_KNOWN_IDS: 1000,
            AUTO_SAVE_INTERVAL: 30000,
            TIMEOUTS: {
                RECRACK_DELAY: 450, // lets the old slip fold away before the next cookie cracks
                REFILL_SCHEDULE_DELAY: 100,
                INITIAL_ANIMATION_DURATION: 1500,
                PARTICLE_CLEANUP: 5000
            },
            STATUS_STYLES: {
                success: {
                    backgroundColor: '#ffd700',
                    boxShadow: '0 0 8px rgba(255, 215, 0, 0.8)',
                    title: 'API Status: Online - Last call successful',
                    ariaLabel: 'API Status: Online - Last call successful'
                },
                failure: {
                    backgroundColor: '#ff6b6b',
                    boxShadow: '0 0 8px rgba(255, 107, 107, 0.8)',
                    title: 'API Status: Connection issues - Using cached messages',
                    ariaLabel: 'API Status: Connection issues - Using cached messages'
                },
                offline: {
                    backgroundColor: '#666',
                    boxShadow: '0 0 8px rgba(102, 102, 102, 0.6)',
                    title: 'API Status: Offline - Using cached messages',
                    ariaLabel: 'API Status: Offline - Using cached messages'
                }
            },
            EFFECTS: {
                CRACK_DELAY: 450, // as the cookie's shake animation ends
                VIBRATION_PATTERN: [25, 30, 40]
            },
            API_SETTINGS: {
                INITIAL_BACKOFF_DELAY: 1000,
                MAX_BACKOFF_DELAY: 30000,
                INITIAL_CONSECUTIVE_FAILURES: 0
            }
        };

        const WISDOM_MESSAGES = [
            "The best time to plant a tree was 20 years ago. The second best time is now.",
            "Your future is created by what you do today, not tomorrow.",
            "The journey of a thousand miles begins with one step.",
            "What lies behind us and what lies before us are tiny matters compared to what lies within us.",
            "Success is not final, failure is not fatal: it is the courage to continue that counts.",
            "The only way to do great work is to love what you do.",
            "Life is what happens to you while you're busy making other plans.",
            "Innovation distinguishes between a leader and a follower.",
            "The only impossible journey is the one you never begin.",
            "Happiness is not something ready-made. It comes from your own actions."
        ];

        const EMPTY_QUEUE_MESSAGES = [
            "The fortune spirits are taking a coffee break!",
            "Oops! The crystal ball is buffering...",
            "The wise owl flew away with all the advice!",
            "Fortune machine says: 'Please insert more wisdom'",
            "The magic 8-ball rolled under the couch!",
            "All fortunes have been adopted by loving families",
            "The fortune fairy is stuck in traffic!",
            "Wisdom reserves are running low - miners are on strike!",
            "The prophecy department is closed for lunch",
            "Error 404: Fortune not found (but you're awesome anyway!)"
        ];

        class Logger {
            static log(message, ...args) {
                if (CONFIG.VERBOSE_LOGGING) {
                    console.log(message, ...args);
                }
            }

            static warn(message, ...args) {
                if (CONFIG.VERBOSE_LOGGING) {
                    console.warn(message, ...args);
                }
            }

            static error(message, ...args) {
                console.error(message, ...args);
            }
        }

        // Utility function to generate random lucky numbers
        function generateLuckyNumbers(count = 6, max = 99) {
            const numbers = new Set();
            while (numbers.size < count) {
                numbers.add(Math.floor(Math.random() * max) + 1);
            }
            return Array.from(numbers).sort((a, b) => a - b);
        }

        // Keep every favorite plus the newest `limit` non-favorites, preserving order
        function trimHistory(history, limit) {
            let nonFavorites = 0;
            return history.filter(item => item.isFavorite || ++nonFavorites <= limit);
        }

        // StorageService - Handles all localStorage operations with error handling
        class StorageService {
            constructor() {
                this.available = this.checkAvailability();
                if (!this.available) {
                    Logger.warn('localStorage is not available. App will work without persistence.');
                }
            }

            checkAvailability() {
                try {
                    const test = '__storage_test__';
                    localStorage.setItem(test, test);
                    localStorage.removeItem(test);
                    return true;
                } catch (e) {
                    return false;
                }
            }

            get(key, defaultValue = null) {
                if (!this.available) return defaultValue;

                try {
                    const item = localStorage.getItem(key);
                    if (item === null) return defaultValue;
                    return JSON.parse(item);
                } catch (e) {
                    Logger.error(`Failed to get item from storage: ${key}`, e);
                    return defaultValue;
                }
            }

            set(key, value) {
                if (!this.available) return false;

                try {
                    localStorage.setItem(key, JSON.stringify(value));
                    return true;
                } catch (e) {
                    if (e.name === 'QuotaExceededError') {
                        Logger.error('Storage quota exceeded. Attempting to clear old data...');
                        this.clearOldHistory();
                        try {
                            localStorage.setItem(key, JSON.stringify(value));
                            return true;
                        } catch (retryError) {
                            Logger.error('Failed to save after clearing old data', retryError);
                        }
                    } else {
                        Logger.error(`Failed to set item in storage: ${key}`, e);
                    }
                    return false;
                }
            }

            clearOldHistory() {
                const history = this.get(CONFIG.STORAGE_KEYS.FORTUNE_HISTORY, []);
                const reducedHistory = trimHistory(history, 10);
                if (reducedHistory.length < history.length) {
                    this.set(CONFIG.STORAGE_KEYS.FORTUNE_HISTORY, reducedHistory);
                    Logger.log('Cleared old history items to free up space');
                }
            }

            checkVersion() {
                const storedVersion = this.get(CONFIG.STORAGE_KEYS.VERSION, 0);
                if (storedVersion < CONFIG.STORAGE_VERSION) {
                    Logger.log(`Migrating storage from v${storedVersion} to v${CONFIG.STORAGE_VERSION}`);
                    this.set(CONFIG.STORAGE_KEYS.VERSION, CONFIG.STORAGE_VERSION);
                }
            }
        }

        class APIService {
            constructor(storageService) {
                this.storageService = storageService;
                this.lastApiCall = Date.now() - CONFIG.API_THROTTLE_MS;
                this.consecutiveFailures = CONFIG.API_SETTINGS.INITIAL_CONSECUTIVE_FAILURES;
                this.backoffDelay = CONFIG.API_SETTINGS.INITIAL_BACKOFF_DELAY;
                this.maxBackoffDelay = CONFIG.API_SETTINGS.MAX_BACKOFF_DELAY;
                this.onStatusChange = null;
                this.dataChanged = false;
                this.loadFromStorage();
            }

            loadFromStorage() {
                const savedState = this.storageService.get(CONFIG.STORAGE_KEYS.API_STATE, null);

                if (savedState) {
                    this.lastApiCall = savedState.lastApiCall || this.lastApiCall;
                    this.consecutiveFailures = savedState.consecutiveFailures || CONFIG.API_SETTINGS.INITIAL_CONSECUTIVE_FAILURES;
                    this.backoffDelay = savedState.backoffDelay || CONFIG.API_SETTINGS.INITIAL_BACKOFF_DELAY;
                    Logger.log('Loaded API state from storage', savedState);
                }
            }

            saveToStorage() {
                const state = {
                    lastApiCall: this.lastApiCall,
                    consecutiveFailures: this.consecutiveFailures,
                    backoffDelay: this.backoffDelay
                };
                this.storageService.set(CONFIG.STORAGE_KEYS.API_STATE, state);
                this.dataChanged = false;
            }

            async fetchAdvice() {
                try {
                    const response = await fetch(CONFIG.API_URL);
                    if (response.ok) {
                        const data = await response.json();
                        this.onSuccess();
                        return {
                            id: data.slip.id,
                            message: data.slip.advice
                        };
                    }
                    throw new Error(`HTTP ${response.status}`);
                } catch (error) {
                    this.onFailure();
                    Logger.warn('API call failed:', error.message);
                    return null;
                }
            }

            onSuccess() {
                this.consecutiveFailures = CONFIG.API_SETTINGS.INITIAL_CONSECUTIVE_FAILURES;
                this.backoffDelay = CONFIG.API_SETTINGS.INITIAL_BACKOFF_DELAY;
                this.dataChanged = true;
                this.saveToStorage();
                if (this.onStatusChange) {
                    this.onStatusChange('success');
                }
            }

            onFailure() {
                this.consecutiveFailures++;
                this.backoffDelay = Math.min(
                    this.backoffDelay * 2,
                    this.maxBackoffDelay
                );
                this.dataChanged = true;
                this.saveToStorage();
                if (this.onStatusChange) {
                    this.onStatusChange('failure');
                }
            }

            canMakeApiCall() {
                const now = Date.now();
                const throttleDelay = this.consecutiveFailures > 0 
                    ? this.backoffDelay 
                    : CONFIG.API_THROTTLE_MS;
                
                return now - this.lastApiCall >= throttleDelay;
            }

            updateLastApiCall() {
                this.lastApiCall = Date.now();
                this.dataChanged = true;
                this.saveToStorage();
            }

            getBackoffDelay() {
                return this.backoffDelay;
            }

            hasChanges() {
                return this.dataChanged;
            }
        }

        class MessageManager {
            constructor(apiService, storageService) {
                this.apiService = apiService;
                this.storageService = storageService;
                this.messages = [];
                this.fortuneHistory = [];
                this.fortuneCount = 0;
                this.knownIds = new Set();
                this.isFilling = false;
                this.dataChanged = false;
                this.loadFromStorage();
            }

            _extractIdsFromItems(items) {
                items.forEach(item => {
                    if (item.id != null) {
                        this.knownIds.add(item.id);
                    }
                });
            }

            loadFromStorage() {
                const savedQueue = this.storageService.get(CONFIG.STORAGE_KEYS.MESSAGE_QUEUE, []);
                const savedHistory = this.storageService.get(CONFIG.STORAGE_KEYS.FORTUNE_HISTORY, []);
                const savedCount = this.storageService.get(CONFIG.STORAGE_KEYS.FORTUNE_COUNT, 0);
                const savedKnownIds = this.storageService.get(CONFIG.STORAGE_KEYS.KNOWN_IDS, []);

                // Load known IDs
                if (Array.isArray(savedKnownIds)) {
                    this.knownIds = new Set(savedKnownIds);
                    Logger.log(`Loaded ${this.knownIds.size} known IDs from storage`);
                }

                // Initialize queue with hardcoded messages (they have id: null)
                const hardcodedMessages = WISDOM_MESSAGES.map(msg => ({ id: null, message: msg }));
                this.messages = [...hardcodedMessages];

                // Migrate and merge saved queue
                if (savedQueue.length > 0) {
                    const migratedQueue = savedQueue.map(item => {
                        // Handle old format (string) vs new format (object)
                        if (typeof item === 'string') {
                            return { id: null, message: item };
                        }
                        return item;
                    });

                    // Extract IDs from queue and add to knownIds
                    this._extractIdsFromItems(migratedQueue);

                    // Remove hardcoded messages already in saved queue
                    const savedMessages = new Set(migratedQueue.map(item => item.message));
                    const uniqueHardcoded = hardcodedMessages.filter(item => !savedMessages.has(item.message));

                    this.messages = [...migratedQueue, ...uniqueHardcoded];
                    Logger.log(`Loaded ${migratedQueue.length} messages from storage`);
                }

                // Restore fortune history
                if (Array.isArray(savedHistory)) {
                    this.fortuneHistory = savedHistory.map(item => ({
                        ...item,
                        isFavorite: item.isFavorite || false,
                        id: item.id || null
                    }));
                    this._trimHistoryToLimit();

                    // Extract IDs from history and add to knownIds
                    this._extractIdsFromItems(this.fortuneHistory);

                    Logger.log(`Loaded ${this.fortuneHistory.length} history items from storage`);
                }

                // Restore fortune count
                this.fortuneCount = savedCount;
                Logger.log(`Loaded fortune count: ${this.fortuneCount}`);
            }

            _trimHistoryToLimit() {
                const trimmed = trimHistory(this.fortuneHistory, CONFIG.MAX_HISTORY_ITEMS);
                const changed = trimmed.length !== this.fortuneHistory.length;
                this.fortuneHistory = trimmed;
                return changed;
            }

            saveToStorage() {
                this.storageService.set(CONFIG.STORAGE_KEYS.MESSAGE_QUEUE, this.messages);
                this.storageService.set(CONFIG.STORAGE_KEYS.FORTUNE_HISTORY, this.fortuneHistory);
                this.storageService.set(CONFIG.STORAGE_KEYS.FORTUNE_COUNT, this.fortuneCount);

                // Save known IDs as array, limiting size and trimming Set if needed
                if (this.knownIds.size <= CONFIG.MAX_KNOWN_IDS) {
                    this.storageService.set(CONFIG.STORAGE_KEYS.KNOWN_IDS, Array.from(this.knownIds));
                } else {
                    const limitedKnownIds = Array.from(this.knownIds).slice(-CONFIG.MAX_KNOWN_IDS);
                    this.storageService.set(CONFIG.STORAGE_KEYS.KNOWN_IDS, limitedKnownIds);
                    this.knownIds = new Set(limitedKnownIds);
                }

                this.dataChanged = false;
            }

            addToHistory(message, luckyNumbers = null, id = null) {
                const numbers = luckyNumbers || generateLuckyNumbers();
                this.fortuneHistory.unshift({
                    message: message,
                    timestamp: Date.now(),
                    isFavorite: false,
                    luckyNumbers: numbers,
                    id: id
                });

                this._trimHistoryToLimit();

                // Increment fortune counter
                this.fortuneCount++;

                this.dataChanged = true;
                this.saveToStorage();
            }

            getFortuneCount() {
                return this.fortuneCount;
            }

            deleteHistoryItem(index) {
                if (index >= 0 && index < this.fortuneHistory.length) {
                    this.fortuneHistory.splice(index, 1);

                    // Decrement fortune counter
                    if (this.fortuneCount > 0) {
                        this.fortuneCount--;
                    }

                    this.dataChanged = true;
                    this.saveToStorage();
                    Logger.log(`Deleted history item at index ${index}. New count: ${this.fortuneCount}`);
                    return true;
                }
                return false;
            }

            toggleFavorite(index) {
                if (index >= 0 && index < this.fortuneHistory.length) {
                    const item = this.fortuneHistory[index];
                    item.isFavorite = !item.isFavorite;

                    this.dataChanged = true;
                    this.saveToStorage();
                    Logger.log(`Toggled favorite for item at index ${index}. isFavorite: ${item.isFavorite}`);
                    return item.isFavorite;
                }
                return false;
            }

            async addMessage() {
                if (!this.apiService.canMakeApiCall()) {
                    return false;
                }

                this.apiService.updateLastApiCall();
                const result = await this.apiService.fetchAdvice();

                if (!result) {
                    Logger.log('addMessage: API fetch failed, skipping this attempt');
                    return false;
                }

                const { id, message } = result;

                // Check if we already know this ID
                if (id && this.knownIds.has(id)) {
                    Logger.log(`Skipping duplicate API message (ID: ${id}). Queue: ${this.messages.length}/${CONFIG.MAX_MESSAGES}`);
                    return false;
                }

                // Add to known IDs and queue
                if (id) {
                    this.knownIds.add(id);
                }

                this.messages.unshift({ id, message });
                Logger.log(`Added API message (ID: ${id}). Queue: ${this.messages.length}/${CONFIG.MAX_MESSAGES}`);
                this.dataChanged = true;
                this.saveToStorage();
                return true;
            }

            getNextMessage() {
                const messageObj = this.messages.shift();

                let message, messageId;
                if (messageObj) {
                    message = messageObj.message;
                    messageId = messageObj.id;
                    const isHardcodedMessage = messageId === null;
                    const messageType = isHardcodedMessage ? "hardcoded" : "API";
                    Logger.log(`Serving ${messageType} message (ID: ${messageId}): "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
                    this.dataChanged = true;
                } else {
                    const randomIndex = Math.floor(Math.random() * EMPTY_QUEUE_MESSAGES.length);
                    message = EMPTY_QUEUE_MESSAGES[randomIndex];
                    messageId = null;
                    Logger.log(`Serving fallback message: "${message}"`);
                }

                this.saveToStorage();
                this.fillQueue();
                return { id: messageId, message };
            }

            async fillQueue() {
                if (this.isFilling) {
                    Logger.log('Queue fill already in progress, skipping');
                    return;
                }

                this.isFilling = true;
                Logger.log(`Starting queue fill. Current: ${this.messages.length}/${CONFIG.MAX_MESSAGES}`);

                try {
                    let attempts = 0;
                    let added = 0;
                    const maxAttempts = CONFIG.MAX_MESSAGES * 3;
                    const logInterval = 5;

                    while (this.messages.length < CONFIG.MAX_MESSAGES && attempts < maxAttempts) {
                        attempts++;
                        const startTime = Date.now();

                        try {
                            const success = await this.addMessage();
                            if (success) added++;
                        } catch (error) {
                            Logger.error('Error adding message to queue:', error);
                        }

                        // Log progress periodically
                        if (attempts % logInterval === 0) {
                            Logger.log(`Queue fill progress: ${attempts}/${maxAttempts} attempts, ${added} added, ${this.messages.length}/${CONFIG.MAX_MESSAGES} in queue`);
                        }

                        // Wait 2+ seconds AFTER response received to avoid API cache
                        if (this.messages.length < CONFIG.MAX_MESSAGES) {
                            const elapsed = Date.now() - startTime;
                            const remainingWait = Math.max(0, CONFIG.API_THROTTLE_MS - elapsed);
                            await new Promise(resolve => setTimeout(resolve, remainingWait));
                        }
                    }

                    if (attempts >= maxAttempts) {
                        Logger.warn(`Queue fill stopped after ${maxAttempts} attempts. Added ${added} messages. Possible duplicate saturation.`);
                    }

                    Logger.log(`Queue fill complete. Added ${added} new messages. Final: ${this.messages.length}/${CONFIG.MAX_MESSAGES}`);
                } finally {
                    this.isFilling = false;
                }
            }

            getMessageCount() {
                return this.messages.length;
            }

            hasChanges() {
                return this.dataChanged;
            }
        }

        class UIController {
            constructor() {
                this.elements = this.initializeElements();
                this.isCracked = false;
                this.particleInterval = null;
                this.isHistoryOpen = false;
                this.showFavoritesOnly = false;
                this.searchQuery = '';
                this.setupEventListeners();
                this.initializeParticles();
                this.createStatusIndicator();
                this.setupVisibilityListener();
            }

            initializeElements() {
                return {
                    cookieStage: document.getElementById('cookieStage'),
                    cookieContainer: document.getElementById('cookieContainer'),
                    fortuneAnnouncer: document.getElementById('fortuneAnnouncer'),
                    cookie: document.getElementById('cookie'),
                    fortuneSlip: document.getElementById('fortuneSlip'),
                    fortuneText: document.getElementById('fortuneText'),
                    luckyNumbers: document.getElementById('luckyNumbers'),
                    copyBtn: document.getElementById('copyBtn'),
                    cookieHint: document.getElementById('cookieHint'),
                    crackAnotherBtn: document.getElementById('crackAnotherBtn'),
                    historyToggle: document.getElementById('historyToggle'),
                    historyPanel: document.getElementById('historyPanel'),
                    historyClose: document.getElementById('historyClose'),
                    historyList: document.getElementById('historyList'),
                    historyEmpty: document.getElementById('historyEmpty'),
                    fortuneCounter: document.getElementById('fortuneCounter'),
                    filterToggle: document.getElementById('filterToggle'),
                    historySearch: document.getElementById('historySearch')
                };
            }

            setupEventListeners() {
                // A native <button>: click already covers mouse, touch, Enter and Space
                this.elements.cookieContainer.addEventListener('click', () => {
                    if (!this.isCracked) {
                        this.onCookieClick();
                    }
                });

                this.addAccessibleClickHandler(
                    this.elements.copyBtn,
                    () => this.copyFortune(),
                    { stopPropagation: true }
                );

                this.elements.crackAnotherBtn.addEventListener('click', () => this.crackAnother());

                this.addAccessibleClickHandler(
                    this.elements.historyToggle,
                    () => this.toggleHistory()
                );

                this.addAccessibleClickHandler(
                    this.elements.historyClose,
                    () => this.closeHistory()
                );

                this.addAccessibleClickHandler(
                    this.elements.filterToggle,
                    () => this.toggleFavoritesFilter()
                );

                this.elements.historySearch.addEventListener('input', (e) => {
                    this.searchQuery = e.target.value;
                    this.refreshHistory();
                });

                this.elements.historySearch.addEventListener('keydown', (e) => {
                    // First Escape clears the search; Escape on an empty box closes the panel.
                    // preventDefault stops the dialog's built-in Escape-to-close for this press.
                    if (e.key === 'Escape' && this.elements.historySearch.value !== '') {
                        e.preventDefault();
                        this.elements.historySearch.value = '';
                        this.searchQuery = '';
                        this.refreshHistory();
                    }
                });

                const panel = this.elements.historyPanel;

                // The dialog closes itself on Escape; keep our state and focus in step however it closes
                panel.addEventListener('close', () => this.onHistoryClosed());

                // A click on the dimmed backdrop targets the dialog element itself
                panel.addEventListener('click', (e) => {
                    if (e.target === panel) {
                        this.closeHistory();
                    }
                });

                document.addEventListener('keydown', (e) => {
                    // Open dialogs handle their own Escape
                    if (e.key === 'Escape' && this.isCracked && !document.querySelector('dialog[open]')) {
                        this.resetCookie();
                    }
                });
            }

            addAccessibleClickHandler(element, callback, options = {}) {
                const { stopPropagation = false, preventDefault = true } = options;

                element.addEventListener('click', (e) => {
                    if (stopPropagation) e.stopPropagation();
                    callback(e);
                });

                element.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        if (preventDefault) e.preventDefault();
                        if (stopPropagation) e.stopPropagation();
                        callback(e);
                    }
                });
            }

            createElement(tag, className, textContent = null, attributes = {}) {
                const element = document.createElement(tag);
                if (className) element.className = className;
                if (textContent) element.textContent = textContent;

                Object.entries(attributes).forEach(([key, value]) => {
                    element.setAttribute(key, value);
                });

                return element;
            }

            createIcon(iconName, size = 20, inlineStyle = '') {
                const icons = {
                    'menu': '<svg xmlns="http://www.w3.org/2000/svg" width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>',
                    'x': '<svg xmlns="http://www.w3.org/2000/svg" width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
                    'copy': '<svg xmlns="http://www.w3.org/2000/svg" width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
                    'check': '<svg xmlns="http://www.w3.org/2000/svg" width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
                    'trash': '<svg xmlns="http://www.w3.org/2000/svg" width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
                    'star': '<svg xmlns="http://www.w3.org/2000/svg" width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
                    'star-filled': '<svg xmlns="http://www.w3.org/2000/svg" width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
                };

                const iconSvg = icons[iconName];
                if (!iconSvg) {
                    Logger.error(`Icon "${iconName}" not found`);
                    return '';
                }

                let result = iconSvg.replace(/SIZE/g, size);
                if (inlineStyle) {
                    result = result.replace('<svg', `<svg style="${inlineStyle}"`);
                }
                return result;
            }

            highlightSearchMatches(text, query) {
                const fragment = document.createDocumentFragment();
                if (!query || query.trim() === '') {
                    fragment.appendChild(document.createTextNode(text));
                    return fragment;
                }

                // Escape special regex characters
                const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(${escapedQuery})`, 'gi');

                // With a capturing group, split() puts the matches at odd indexes
                text.split(regex).forEach((part, i) => {
                    if (!part) return;
                    if (i % 2 === 1) {
                        fragment.appendChild(this.createElement('span', 'search-highlight', part));
                    } else {
                        fragment.appendChild(document.createTextNode(part));
                    }
                });
                return fragment;
            }

            updateAriaAttributes(element, attributes) {
                Object.entries(attributes).forEach(([key, value]) => {
                    element.setAttribute(key, value);
                });
            }

            createHistoryCopyButton(message) {
                const copyBtn = this.createElement('button', 'history-btn history-copy-btn', null, {
                    'aria-label': 'Copy fortune to clipboard',
                    'title': 'Copy fortune to clipboard'
                });
                copyBtn.innerHTML = this.createIcon('copy', 16);

                this.addAccessibleClickHandler(copyBtn, async () => {
                    const success = await this.copyToClipboard(message);
                    if (success) {
                        this.showCopyFeedback(copyBtn);
                    }
                });

                return copyBtn;
            }

            createHistoryDeleteButton(index, message) {
                const deleteBtn = this.createElement('button', 'history-btn history-delete-btn', null, {
                    'aria-label': 'Delete this fortune from history',
                    'title': 'Delete this fortune from history'
                });
                deleteBtn.innerHTML = this.createIcon('trash', 16);

                this.addAccessibleClickHandler(deleteBtn, () => {
                    this.showDeleteConfirmation(index, message);
                });

                return deleteBtn;
            }

            createHistoryFavoriteButton(index, isFavorite) {
                const iconName = isFavorite ? 'star-filled' : 'star';
                const classes = isFavorite ? 'history-btn history-favorite-btn favorited' : 'history-btn history-favorite-btn';
                const label = isFavorite ? 'Remove from favorites' : 'Add to favorites';

                const favoriteBtn = this.createElement('button', classes, null, {
                    'aria-label': label,
                    'aria-pressed': isFavorite.toString(),
                    'title': label
                });
                favoriteBtn.innerHTML = this.createIcon(iconName, 16);

                this.addAccessibleClickHandler(favoriteBtn, () => {
                    if (this.onToggleFavorite) {
                        this.onToggleFavorite(index);
                    }
                });

                return favoriteBtn;
            }

            showDeleteConfirmation(index, message) {
                // A native modal <dialog>: it stacks above the history dialog, makes everything
                // behind it inert, closes on Escape and returns focus to the trigger when closed
                const dialog = this.createElement('dialog', 'confirmation-dialog', null, {
                    'role': 'alertdialog',
                    'aria-labelledby': 'confirmTitle',
                    'aria-describedby': 'confirmMessage'
                });

                const title = this.createElement('h3', 'confirmation-title', 'Delete Fortune?', {
                    'id': 'confirmTitle'
                });

                // Message preview
                const messagePreview = message.length > 60
                    ? message.substring(0, 60) + '...'
                    : message;

                const dialogMessage = this.createElement(
                    'p',
                    'confirmation-message',
                    'Are you sure you want to delete this fortune?',
                    { 'id': 'confirmMessage' }
                );

                const fortunePreview = this.createElement(
                    'p',
                    'confirmation-fortune-preview',
                    `"${messagePreview}"`
                );

                const buttonsContainer = this.createElement('div', 'confirmation-buttons');

                // Cancel comes first and gets initial focus: the safe choice for a destructive action
                const cancelBtn = this.createElement('button', 'confirmation-btn confirmation-btn-cancel', 'Cancel', {
                    'type': 'button',
                    'autofocus': ''
                });

                const confirmBtn = this.createElement('button', 'confirmation-btn confirmation-btn-confirm', 'Delete', {
                    'type': 'button'
                });

                buttonsContainer.appendChild(cancelBtn);
                buttonsContainer.appendChild(confirmBtn);
                dialog.appendChild(title);
                dialog.appendChild(dialogMessage);
                dialog.appendChild(fortunePreview);
                dialog.appendChild(buttonsContainer);
                document.body.appendChild(dialog);

                let confirmed = false;

                dialog.addEventListener('close', () => {
                    dialog.remove();
                    if (confirmed) {
                        // The trigger button goes away with its card, so focus the search box instead
                        this.elements.historySearch.focus();
                        if (this.deleteHandler) {
                            this.deleteHandler(index);
                        }
                    }
                });

                cancelBtn.addEventListener('click', () => dialog.close());
                confirmBtn.addEventListener('click', () => {
                    confirmed = true;
                    dialog.close();
                });
                dialog.addEventListener('click', (e) => {
                    if (e.target === dialog) {
                        dialog.close();
                    }
                });

                dialog.showModal();
            }

            setDeleteHandler(handler) {
                this.deleteHandler = handler;
            }

            onCookieClick() {
                if (this.cookieClickHandler) {
                    this.cookieClickHandler();
                }
            }

            setCookieClickHandler(handler) {
                this.cookieClickHandler = handler;
            }

            showFortune(message, luckyNumbers = null) {
                this.isCracked = true;
                this.elements.cookieStage.classList.add('cracked');
                this.elements.fortuneText.textContent = message;

                // Generate or use provided lucky numbers
                const numbers = luckyNumbers || generateLuckyNumbers();
                this.elements.luckyNumbers.textContent = numbers.join(', ');

                // The faded-out cookie stays in place for the animation but leaves the
                // keyboard and accessibility tree; the slip enters them
                this.elements.cookieContainer.inert = true;
                this.elements.fortuneSlip.inert = false;

                this.elements.fortuneAnnouncer.textContent = `Your fortune: ${message} Lucky numbers: ${numbers.join(', ')}.`;

                // Swap the hint for the next action, and move focus there: the cookie button
                // just became inert, so focus would otherwise fall back to the page
                this.elements.cookieHint.hidden = true;
                this.elements.crackAnotherBtn.hidden = false;
                this.elements.crackAnotherBtn.focus();
            }

            // Fold the current slip away and crack a fresh cookie in one step
            crackAnother() {
                if (!this.isCracked || this.recrackTimer) return;

                this.elements.cookieStage.classList.remove('cracked');
                this.elements.fortuneSlip.inert = true;

                this.recrackTimer = setTimeout(() => {
                    this.recrackTimer = null;
                    this.onCookieClick();
                }, CONFIG.TIMEOUTS.RECRACK_DELAY);
            }

            resetCookie() {
                this.isCracked = false;
                clearTimeout(this.recrackTimer);
                this.recrackTimer = null;
                this.elements.cookieStage.classList.remove('cracked');
                this.elements.cookie.classList.add('visible');

                this.elements.fortuneSlip.inert = true;
                this.elements.cookieContainer.inert = false;
                this.elements.fortuneAnnouncer.textContent = '';
                this.elements.crackAnotherBtn.hidden = true;
                this.elements.cookieHint.hidden = false;

                // Return focus to the cookie for keyboard users
                this.elements.cookieContainer.focus();
            }

            async copyFortune() {
                const fortuneText = this.elements.fortuneText.textContent;
                const success = await this.copyToClipboard(fortuneText);

                if (success) {
                    this.showCopyFeedback(this.elements.copyBtn);
                }
            }

            async copyToClipboard(text) {
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(text);
                        Logger.log('Copied to clipboard using Clipboard API:', text);
                        return true;
                    } else {
                        return this.fallbackCopyToClipboard(text);
                    }
                } catch (error) {
                    Logger.warn('Clipboard API failed, using fallback:', error);
                    return this.fallbackCopyToClipboard(text);
                }
            }

            fallbackCopyToClipboard(text) {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.setAttribute('aria-hidden', 'true');

                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                try {
                    const successful = document.execCommand('copy');
                    document.body.removeChild(textArea);

                    if (successful) {
                        Logger.log('Copied to clipboard using fallback:', text);
                        return true;
                    }
                    Logger.error('Fallback copy failed');
                    return false;
                } catch (error) {
                    document.body.removeChild(textArea);
                    Logger.error('Fallback copy error:', error);
                    return false;
                }
            }

            showCopyFeedback(button) {
                const originalContent = button.innerHTML;
                const originalLabel = button.getAttribute('aria-label');
                const originalTitle = button.getAttribute('title');

                button.classList.add('copied');
                button.innerHTML = this.createIcon('check', 16);
                button.setAttribute('aria-label', 'Copied to clipboard!');
                button.setAttribute('title', 'Copied to clipboard!');

                setTimeout(() => {
                    button.classList.remove('copied');
                    button.innerHTML = originalContent;
                    button.setAttribute('aria-label', originalLabel);
                    button.setAttribute('title', originalTitle);
                }, 2000);
            }

            createParticle() {
                const particle = document.createElement('div');
                const isGolden = Math.random() > 0.7;

                Object.assign(particle.style, {
                    position: 'fixed',
                    width: isGolden ? '6px' : '4px',
                    height: isGolden ? '6px' : '4px',
                    background: isGolden ? '#ffd700' : 'rgba(255, 215, 0, 0.6)',
                    borderRadius: '50%',
                    pointerEvents: 'none',
                    left: Math.random() * window.innerWidth + 'px',
                    top: '-10px',
                    boxShadow: isGolden ? '0 0 8px rgba(255, 215, 0, 0.8)' : 'none',
                    animation: `fall ${3 + Math.random() * 2}s linear forwards`
                });

                // Mark decorative particles as hidden from screen readers
                particle.setAttribute('aria-hidden', 'true');

                document.body.appendChild(particle);

                setTimeout(() => {
                    particle.remove();
                }, CONFIG.TIMEOUTS.PARTICLE_CLEANUP);
            }

            initializeParticles() {
                this.startParticles();
            }

            startParticles() {
                if (this.particleInterval) return;
                this.particleInterval = setInterval(() => this.createParticle(), CONFIG.PARTICLE_INTERVAL);
            }

            stopParticles() {
                if (this.particleInterval) {
                    clearInterval(this.particleInterval);
                    this.particleInterval = null;
                }
            }

            setupVisibilityListener() {
                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        this.stopParticles();
                        Logger.log('Page hidden - particles paused');
                    } else {
                        this.startParticles();
                        Logger.log('Page visible - particles resumed');
                    }
                });
            }

            createStatusIndicator() {
                const indicator = document.createElement('div');
                indicator.id = 'status-indicator';
                indicator.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background-color: #ffd700;
                    box-shadow: 0 0 8px rgba(255, 215, 0, 0.8);
                    transition: all 0.3s ease;
                    z-index: 998;
                `;
                indicator.title = 'API Status: Online';
                indicator.setAttribute('role', 'status');
                indicator.setAttribute('aria-live', 'polite');
                indicator.setAttribute('aria-label', 'API Status: Online');
                document.body.appendChild(indicator);
                this.statusIndicator = indicator;
            }

            updateStatus(status) {
                if (!this.statusIndicator) return;

                const style = CONFIG.STATUS_STYLES[status];
                if (style) {
                    this.statusIndicator.style.backgroundColor = style.backgroundColor;
                    this.statusIndicator.style.boxShadow = style.boxShadow;
                    this.statusIndicator.title = style.title;
                    this.statusIndicator.setAttribute('aria-label', style.ariaLabel);
                }
            }

            toggleHistory() {
                if (this.isHistoryOpen) {
                    this.closeHistory();
                } else {
                    this.openHistory();
                }
            }

            toggleFavoritesFilter() {
                this.showFavoritesOnly = !this.showFavoritesOnly;

                // A toggle button keeps its label; aria-pressed carries the on/off state
                const button = this.elements.filterToggle;
                button.classList.toggle('active', this.showFavoritesOnly);
                button.setAttribute('aria-pressed', String(this.showFavoritesOnly));

                // Refresh history with filter
                this.refreshHistory();

                Logger.log(`Filter toggled. Show favorites only: ${this.showFavoritesOnly}`);
            }

            openHistory() {
                this.isHistoryOpen = true;

                // Populate history before showing it
                if (this.historyDataProvider) {
                    this.renderHistory(this.historyDataProvider());
                }

                // Modal: dims and disables the page behind it until closed
                this.elements.historyPanel.showModal();
                this.elements.historyToggle.setAttribute('aria-expanded', 'true');

                // Start in the search box with a mouse or trackpad. On touch screens that would
                // pop up the keyboard, so leave the dialog's default focus (the close button).
                if (window.matchMedia('(pointer: fine)').matches) {
                    this.elements.historySearch.focus();
                }
            }

            closeHistory() {
                this.elements.historyPanel.close();
            }

            // Runs however the dialog closes: close button, Escape or backdrop click
            onHistoryClosed() {
                this.isHistoryOpen = false;
                this.elements.historyToggle.setAttribute('aria-expanded', 'false');
                this.elements.historyToggle.focus();
            }

            setHistoryDataProvider(provider) {
                this.historyDataProvider = provider;
            }

            renderHistory(historyData) {
                const listElement = this.elements.historyList;
                const emptyElement = this.elements.historyEmpty;

                const showEmpty = (text) => {
                    listElement.replaceChildren();
                    listElement.hidden = true;
                    emptyElement.textContent = text;
                    emptyElement.hidden = false;
                };

                if (!historyData || historyData.length === 0) {
                    showEmpty('No fortunes yet. Crack a cookie to begin!');
                    return;
                }

                // Apply both filters in a single pass
                const filteredData = historyData.filter(item => {
                    // Apply favorites filter
                    if (this.showFavoritesOnly && !item.isFavorite) {
                        return false;
                    }

                    // Apply search filter
                    if (this.searchQuery && this.searchQuery.trim() !== '') {
                        const query = this.searchQuery.toLowerCase();
                        const messageMatch = item.message.toLowerCase().includes(query);
                        const numbersMatch = (item.luckyNumbers || []).some(num => num.toString().includes(query));
                        return messageMatch || numbersMatch;
                    }

                    return true;
                });

                // Show empty state if no items match filters
                if (filteredData.length === 0) {
                    let emptyMessage = '';
                    if (this.searchQuery && this.searchQuery.trim() !== '') {
                        emptyMessage = 'No matches found. Try different keywords.';
                    } else if (this.showFavoritesOnly) {
                        emptyMessage = 'No favorites yet. Click the star icon to add favorites!';
                    } else {
                        emptyMessage = 'No fortunes yet. Crack a cookie to begin!';
                    }
                    showEmpty(emptyMessage);
                    return;
                }

                emptyElement.hidden = true;
                listElement.hidden = false;
                listElement.replaceChildren();

                // Render each history item (use original index for operations)
                filteredData.forEach((item) => {
                    // Find the original index in the unfiltered data
                    const originalIndex = historyData.indexOf(item);
                    const classes = item.isFavorite ? 'history-item favorited' : 'history-item';
                    const historyItem = this.createElement('li', classes, null, {
                        'data-index': originalIndex
                    });

                    // Highlight matching text if search is active (built as DOM nodes, never as HTML)
                    const fortuneText = this.createElement(
                        'div',
                        'history-fortune-text'
                    );
                    fortuneText.appendChild(this.highlightSearchMatches(item.message, this.searchQuery));

                    const luckyNumbersText = this.createElement(
                        'div',
                        'history-lucky-numbers',
                        `Lucky Numbers: ${(item.luckyNumbers || []).join(', ')}`
                    );

                    // Create footer with timestamp and buttons
                    const footer = this.createElement('div', 'history-item-footer');

                    const timestamp = this.createElement(
                        'div',
                        'history-timestamp',
                        this.formatTimestamp(item.timestamp)
                    );

                    const actions = this.createElement('div', 'history-item-actions');
                    const favoriteBtn = this.createHistoryFavoriteButton(originalIndex, item.isFavorite || false);
                    const copyBtn = this.createHistoryCopyButton(item.message);
                    const deleteBtn = this.createHistoryDeleteButton(originalIndex, item.message);

                    actions.appendChild(favoriteBtn);
                    actions.appendChild(copyBtn);
                    actions.appendChild(deleteBtn);

                    footer.appendChild(timestamp);
                    footer.appendChild(actions);

                    historyItem.appendChild(fortuneText);
                    historyItem.appendChild(luckyNumbersText);
                    historyItem.appendChild(footer);
                    listElement.appendChild(historyItem);
                });

                Logger.log(`Rendered ${filteredData.length} of ${historyData.length} history items (favorites filter: ${this.showFavoritesOnly})`);
            }

            formatTimestamp(timestamp) {
                const date = new Date(timestamp);
                const now = new Date();
                const diffMs = now - date;
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                const diffDays = Math.floor(diffMs / 86400000);

                if (diffMins < 1) return 'Just now';
                if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
                if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

                return date.toLocaleDateString();
            }

            refreshHistory() {
                if (this.isHistoryOpen && this.historyDataProvider) {
                    this.renderHistory(this.historyDataProvider());
                }
            }

            updateFortuneCounter(count) {
                if (!this.elements.fortuneCounter) return;

                this.elements.fortuneCounter.textContent = `(${count} collected)`;

                // Animate the bump
                this.elements.fortuneCounter.classList.add('counter-bump');
                setTimeout(() => {
                    this.elements.fortuneCounter.classList.remove('counter-bump');
                }, 300);
            }

            deleteHistoryItemWithAnimation(index) {
                // index refers to the unfiltered history, so look the card up by its data-index
                // rather than by its position in the (possibly filtered) list
                const itemToDelete = this.elements.historyList.querySelector(`.history-item[data-index="${index}"]`);

                const completeDeletion = () => {
                    if (this.onDeleteComplete) {
                        this.onDeleteComplete(index);
                    }
                };

                if (itemToDelete) {
                    // Add deleting class for animation
                    itemToDelete.classList.add('deleting');

                    // Wait for animation to complete, then trigger actual deletion
                    setTimeout(completeDeletion, 300); // Match animation duration
                } else {
                    completeDeletion();
                }
            }

            setOnDeleteComplete(handler) {
                this.onDeleteComplete = handler;
            }

            setOnToggleFavorite(handler) {
                this.onToggleFavorite = handler;
            }
        }

        // Crumbs, crunch and buzz when a cookie cracks. Sound and vibration are off until the
        // visitor turns them on; crumbs follow the reduced-motion setting.
        class EffectsController {
            constructor(storageService, toggleButton, crumbsCanvas) {
                this.storageService = storageService;
                this.toggleButton = toggleButton;
                // Draw on our own decorative canvas (hidden from assistive technology) rather
                // than one the library adds. The library is loaded separately; the site works without it.
                this.throwConfetti = typeof window.confetti === 'function'
                    ? window.confetti.create(crumbsCanvas, { resize: true, disableForReducedMotion: true })
                    : null;
                this.audioContext = null;
                this.soundEnabled = this.storageService.get(CONFIG.STORAGE_KEYS.SOUND_ENABLED, false) === true;
                this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

                this.renderToggle();
                this.toggleButton.addEventListener('click', () => this.toggleSound());
            }

            toggleSound() {
                this.soundEnabled = !this.soundEnabled;
                this.storageService.set(CONFIG.STORAGE_KEYS.SOUND_ENABLED, this.soundEnabled);
                this.renderToggle();
                // A short crunch as a preview, which also unlocks audio inside this click
                if (this.soundEnabled) {
                    this.playCrunch();
                }
            }

            renderToggle() {
                this.toggleButton.setAttribute('aria-pressed', String(this.soundEnabled));
                this.toggleButton.classList.toggle('active', this.soundEnabled);
                this.toggleButton.title = this.soundEnabled ? 'Sound effects: on' : 'Sound effects: off';
            }

            // Called when a cookie is cracked; the crack lands as the shake animation ends
            crack(cookieElement) {
                const delay = this.reducedMotion.matches ? 0 : CONFIG.EFFECTS.CRACK_DELAY;
                const rect = cookieElement.getBoundingClientRect();

                setTimeout(() => {
                    this.throwCrumbs(rect);
                    if (this.soundEnabled) {
                        this.playCrunch();
                        if (typeof navigator.vibrate === 'function') {
                            navigator.vibrate(CONFIG.EFFECTS.VIBRATION_PATTERN);
                        }
                    }
                }, delay);
            }

            throwCrumbs(rect) {
                if (!this.throwConfetti) return;
                this.throwConfetti({
                    particleCount: 36,
                    spread: 80,
                    startVelocity: 22,
                    gravity: 1.1,
                    decay: 0.9,
                    ticks: 140,
                    scalar: 0.9,
                    shapes: ['circle', 'square'],
                    colors: ['#e8b04a', '#d4943a', '#f5d38a', '#b8742a', '#fff3c4'],
                    origin: {
                        x: (rect.left + rect.width / 2) / window.innerWidth,
                        y: (rect.top + rect.height / 2) / window.innerHeight
                    },
                });
            }

            // A synthesised crunch: three short bursts of filtered noise, each fading out
            playCrunch() {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) return;

                try {
                    if (!this.audioContext) {
                        this.audioContext = new AudioContextClass();
                    }
                    const ctx = this.audioContext;
                    if (ctx.state === 'suspended') {
                        ctx.resume();
                    }

                    const now = ctx.currentTime;
                    [0, 0.05, 0.11].forEach((offset, i) => {
                        const duration = 0.07;
                        const length = Math.floor(ctx.sampleRate * duration);
                        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
                        const data = buffer.getChannelData(0);
                        for (let j = 0; j < length; j++) {
                            data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 3);
                        }

                        const source = ctx.createBufferSource();
                        source.buffer = buffer;
                        const filter = ctx.createBiquadFilter();
                        filter.type = 'bandpass';
                        filter.frequency.value = 1600 + i * 700 + Math.random() * 400;
                        filter.Q.value = 1.2;
                        const gain = ctx.createGain();
                        gain.gain.value = 0.45 - i * 0.1;

                        source.connect(filter);
                        filter.connect(gain);
                        gain.connect(ctx.destination);
                        source.start(now + offset);
                    });
                } catch (error) {
                    Logger.warn('Could not play sound:', error.message);
                }
            }
        }

        class FortuneApp {
            constructor() {
                this.storageService = new StorageService();
                this.storageService.checkVersion();

                this.apiService = new APIService(this.storageService);
                this.messageManager = new MessageManager(this.apiService, this.storageService);
                this.uiController = new UIController();
                this.effects = new EffectsController(
                    this.storageService,
                    document.getElementById('soundToggle'),
                    document.getElementById('crumbsCanvas')
                );

                this.setupIntegration();
                this.setupAutoSave();
            }

            setupIntegration() {
                this.uiController.setCookieClickHandler(() => {
                    this.handleCookieClick();
                });

                this.apiService.onStatusChange = (status) => {
                    this.uiController.updateStatus(status);
                };

                // Provide history data to UI controller
                this.uiController.setHistoryDataProvider(() => {
                    return this.messageManager.fortuneHistory;
                });

                // Set up delete handler
                this.uiController.setDeleteHandler((index) => {
                    this.uiController.deleteHistoryItemWithAnimation(index);
                });

                this.uiController.setOnDeleteComplete((index) => {
                    this.handleDeleteHistoryItem(index);
                });

                this.uiController.setOnToggleFavorite((index) => {
                    this.handleToggleFavorite(index);
                });

                window.addEventListener('online', () => {
                    this.uiController.updateStatus('success');
                });

                window.addEventListener('offline', () => {
                    this.uiController.updateStatus('offline');
                });
            }

            setupAutoSave() {
                // Periodic backup every 30 seconds, only if data has changed
                setInterval(() => {
                    if (this.messageManager.hasChanges() || this.apiService.hasChanges()) {
                        this.messageManager.saveToStorage();
                        this.apiService.saveToStorage();
                        Logger.log('Auto-save completed');
                    }
                }, CONFIG.AUTO_SAVE_INTERVAL);
            }

            handleCookieClick() {
                try {
                    const result = this.messageManager.getNextMessage();
                    const { id, message } = result;
                    const luckyNumbers = generateLuckyNumbers();
                    this.messageManager.addToHistory(message, luckyNumbers, id);
                    this.uiController.showFortune(message, luckyNumbers);
                    this.effects.crack(this.uiController.elements.cookieContainer);

                    // Update fortune counter
                    const count = this.messageManager.getFortuneCount();
                    this.uiController.updateFortuneCounter(count);

                    // Refresh history panel if it's open
                    this.uiController.refreshHistory();
                } catch (error) {
                    Logger.error('Failed to get fortune: ' + error.message);
                }
            }

            handleToggleFavorite(index) {
                try {
                    const isFavorite = this.messageManager.toggleFavorite(index);

                    // Refresh history panel to reflect changes
                    this.uiController.refreshHistory();

                    Logger.log(`Toggled favorite at index ${index}. Now ${isFavorite ? 'favorited' : 'unfavorited'}`);
                } catch (error) {
                    Logger.error('Error toggling favorite:', error);
                }
            }

            handleDeleteHistoryItem(index) {
                try {
                    const success = this.messageManager.deleteHistoryItem(index);
                    if (success) {
                        // Update counter display
                        const count = this.messageManager.getFortuneCount();
                        this.uiController.updateFortuneCounter(count);

                        // Refresh history panel to reflect changes
                        this.uiController.refreshHistory();

                        Logger.log(`Successfully deleted history item at index ${index}`);
                    } else {
                        Logger.error(`Failed to delete history item at index ${index}`);
                    }
                } catch (error) {
                    Logger.error('Failed to delete history item: ' + error.message);
                }
            }

            async initialize() {
                try {
                    // Initialize counter display with current count
                    const count = this.messageManager.getFortuneCount();
                    this.uiController.updateFortuneCounter(count);

                    await this.messageManager.fillQueue();
                } catch (error) {
                    Logger.error('Queue fill failed: ' + error.message);
                }
            }
        }

        let fortuneApp;

        window.addEventListener('load', async () => {
            try {
                const cookie = document.getElementById('cookie');
                if (cookie) {
                    // Add initial-load class for the first animation only
                    cookie.classList.add('initial-load');

                    // After initial animation completes, remove the class and add visible class
                    setTimeout(() => {
                        cookie.classList.remove('initial-load');
                        cookie.classList.add('visible');
                    }, CONFIG.TIMEOUTS.INITIAL_ANIMATION_DURATION);
                }

                fortuneApp = new FortuneApp();
                await fortuneApp.initialize();
            } catch (error) {
                Logger.error('Failed to start Fortune Cookie app:', error);
            }
        });
