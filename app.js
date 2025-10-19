        // Configuration
        const CONFIG = {
            MAX_MESSAGES: 20,
            API_THROTTLE_MS: 2100, // 2.1 seconds - API caches for 2s, 100ms safety margin
            API_URL: 'https://api.adviceslip.com/advice',
            PARTICLE_INTERVAL: 1000,
            VERBOSE_LOGGING: true,
            STORAGE_KEYS: {
                MESSAGE_QUEUE: 'fortune_queue',
                FORTUNE_HISTORY: 'fortune_history',
                FORTUNE_COUNT: 'fortune_count',
                API_STATE: 'fortune_api_state',
                VERSION: 'fortune_storage_version',
                SHOW_FAVORITES_ONLY: 'show_favorites_only',
                KNOWN_IDS: 'fortune_known_ids'
            },
            STORAGE_VERSION: 1,
            MAX_HISTORY_ITEMS: 20,
            MAX_KNOWN_IDS: 1000,
            AUTO_SAVE_INTERVAL: 30000,
            TIMEOUTS: {
                CLOSE_BUTTON_FOCUS_DELAY: 900,
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
                if (history.length > 10) {
                    const reducedHistory = history.slice(0, 10);
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
                    this.fortuneHistory = savedHistory.slice(0, CONFIG.MAX_HISTORY_ITEMS).map(item => ({
                        ...item,
                        isFavorite: item.isFavorite || false,
                        id: item.id || null
                    }));

                    // Extract IDs from history and add to knownIds
                    this._extractIdsFromItems(this.fortuneHistory);

                    Logger.log(`Loaded ${this.fortuneHistory.length} history items from storage`);
                }

                // Restore fortune count
                this.fortuneCount = savedCount;
                Logger.log(`Loaded fortune count: ${this.fortuneCount}`);
            }

            _trimHistoryToLimit() {
                if (this.fortuneHistory.length > CONFIG.MAX_HISTORY_ITEMS) {
                    this.fortuneHistory = this.fortuneHistory.slice(0, CONFIG.MAX_HISTORY_ITEMS);
                    return true;
                }
                return false;
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
                    cookieContainer: document.getElementById('cookieContainer'),
                    cookie: document.getElementById('cookie'),
                    fortuneSlip: document.getElementById('fortuneSlip'),
                    fortuneText: document.getElementById('fortuneText'),
                    luckyNumbers: document.getElementById('luckyNumbers'),
                    copyBtn: document.getElementById('copyBtn'),
                    closeBtn: document.getElementById('closeBtn'),
                    historyToggle: document.getElementById('historyToggle'),
                    historyPanel: document.getElementById('historyPanel'),
                    historyClose: document.getElementById('historyClose'),
                    historyList: document.getElementById('historyList'),
                    fortuneCounter: document.getElementById('fortuneCounter'),
                    filterToggle: document.getElementById('filterToggle'),
                    historySearch: document.getElementById('historySearch')
                };
            }

            setupEventListeners() {
                this.addAccessibleClickHandler(this.elements.cookieContainer, () => {
                    if (!this.isCracked) {
                        this.onCookieClick();
                    }
                });

                this.addAccessibleClickHandler(
                    this.elements.copyBtn,
                    () => this.copyFortune(),
                    { stopPropagation: true }
                );

                this.addAccessibleClickHandler(
                    this.elements.closeBtn,
                    () => this.resetCookie(),
                    { stopPropagation: true }
                );

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
                    if (e.key === 'Escape') {
                        this.elements.historySearch.value = '';
                        this.searchQuery = '';
                        this.refreshHistory();
                    }
                });

                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        if (this.isHistoryOpen) {
                            this.closeHistory();
                        } else if (this.isCracked) {
                            this.resetCookie();
                        }
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
                if (!query || query.trim() === '') {
                    return text;
                }

                // Escape special regex characters
                const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(${escapedQuery})`, 'gi');

                // Split text and rejoin with highlighted matches
                return text.replace(regex, '<span class="search-highlight">$1</span>');
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
                // Create overlay
                const overlay = this.createElement('div', 'confirmation-overlay', null, {
                    'role': 'dialog',
                    'aria-modal': 'true',
                    'aria-labelledby': 'confirmTitle'
                });

                // Create dialog
                const dialog = this.createElement('div', 'confirmation-dialog');

                // Title
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
                    'Are you sure you want to delete this fortune?'
                );

                const fortunePreview = this.createElement(
                    'p',
                    'confirmation-fortune-preview',
                    `"${messagePreview}"`
                );

                // Buttons container
                const buttonsContainer = this.createElement('div', 'confirmation-buttons');

                // Cancel button
                const cancelBtn = this.createElement('button', 'confirmation-btn confirmation-btn-cancel', 'Cancel', {
                    'aria-label': 'Cancel deletion'
                });

                // Confirm button
                const confirmBtn = this.createElement('button', 'confirmation-btn confirmation-btn-confirm', 'Delete', {
                    'aria-label': 'Confirm deletion'
                });

                // Assemble dialog
                buttonsContainer.appendChild(cancelBtn);
                buttonsContainer.appendChild(confirmBtn);
                dialog.appendChild(title);
                dialog.appendChild(dialogMessage);
                dialog.appendChild(fortunePreview);
                dialog.appendChild(buttonsContainer);
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);

                // Focus confirm button
                setTimeout(() => confirmBtn.focus(), 100);

                // Event handlers
                const closeDialog = () => {
                    overlay.remove();
                };

                const handleConfirm = () => {
                    if (this.deleteHandler) {
                        this.deleteHandler(index);
                    }
                    closeDialog();
                };

                this.addAccessibleClickHandler(cancelBtn, closeDialog, { stopPropagation: true });
                this.addAccessibleClickHandler(confirmBtn, handleConfirm, { stopPropagation: true });
                this.addAccessibleClickHandler(overlay, (e) => {
                    if (e.target === overlay) {
                        closeDialog();
                    }
                }, { preventDefault: false });

                // Escape key to close
                const escapeHandler = (e) => {
                    if (e.key === 'Escape') {
                        closeDialog();
                        document.removeEventListener('keydown', escapeHandler);
                    }
                };
                document.addEventListener('keydown', escapeHandler);
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
                this.elements.cookieContainer.classList.add('cracked');
                this.elements.fortuneText.textContent = message;

                // Generate or use provided lucky numbers
                const numbers = luckyNumbers || generateLuckyNumbers();
                this.elements.luckyNumbers.textContent = numbers.join(', ');

                // Update ARIA attributes for accessibility
                this.updateAriaAttributes(this.elements.cookieContainer, {
                    'aria-pressed': 'true',
                    'aria-label': 'Fortune cookie cracked. Your fortune is being displayed.'
                });
                this.updateAriaAttributes(this.elements.fortuneSlip, {
                    'aria-hidden': 'false'
                });

                // Move focus to close button for keyboard users
                setTimeout(() => {
                    this.elements.closeBtn.focus();
                }, CONFIG.TIMEOUTS.CLOSE_BUTTON_FOCUS_DELAY);
            }

            resetCookie() {
                this.isCracked = false;
                this.elements.cookieContainer.classList.remove('cracked');
                this.elements.cookie.classList.add('visible');

                // Restore ARIA attributes for accessibility
                this.updateAriaAttributes(this.elements.cookieContainer, {
                    'aria-pressed': 'false',
                    'aria-label': 'Fortune cookie. Click or press Enter to reveal your fortune.'
                });
                this.updateAriaAttributes(this.elements.fortuneSlip, {
                    'aria-hidden': 'true'
                });

                // Return focus to cookie container for keyboard users
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

                // Update button state
                const button = this.elements.filterToggle;
                const starIcon = this.createIcon('star', 14, 'vertical-align: -2px; margin-right: 4px;');

                if (this.showFavoritesOnly) {
                    button.classList.add('active');
                    button.setAttribute('aria-pressed', 'true');
                    button.innerHTML = starIcon + 'Show All';
                    button.setAttribute('aria-label', 'Show all fortunes');
                    button.setAttribute('title', 'Show all fortunes');
                } else {
                    button.classList.remove('active');
                    button.setAttribute('aria-pressed', 'false');
                    button.innerHTML = starIcon + 'Favorites Only';
                    button.setAttribute('aria-label', 'Show only favorites');
                    button.setAttribute('title', 'Show only favorites');
                }

                // Refresh history with filter
                this.refreshHistory();

                Logger.log(`Filter toggled. Show favorites only: ${this.showFavoritesOnly}`);
            }

            openHistory() {
                this.isHistoryOpen = true;
                this.elements.historyPanel.classList.add('open');
                this.elements.historyToggle.setAttribute('aria-expanded', 'true');
                this.elements.historyToggle.setAttribute('aria-label', 'Close fortune history');

                // Populate history when opening
                if (this.historyDataProvider) {
                    this.renderHistory(this.historyDataProvider());
                }

                // Focus on search input when opened (for better UX)
                setTimeout(() => {
                    this.elements.historySearch.focus();
                }, 100);
            }

            closeHistory() {
                this.isHistoryOpen = false;
                this.elements.historyPanel.classList.remove('open');
                this.elements.historyToggle.setAttribute('aria-expanded', 'false');
                this.elements.historyToggle.setAttribute('aria-label', 'Open fortune history');

                // Return focus to toggle button
                this.elements.historyToggle.focus();
            }

            setHistoryDataProvider(provider) {
                this.historyDataProvider = provider;
            }

            renderHistory(historyData) {
                const listElement = this.elements.historyList;

                if (!historyData || historyData.length === 0) {
                    listElement.innerHTML = '<p class="history-empty">No fortunes yet. Crack a cookie to begin!</p>';
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
                    listElement.innerHTML = `<p class="history-empty">${emptyMessage}</p>`;
                    return;
                }

                // Clear existing content
                listElement.innerHTML = '';

                // Render each history item (use original index for operations)
                filteredData.forEach((item) => {
                    // Find the original index in the unfiltered data
                    const originalIndex = historyData.indexOf(item);
                    const classes = item.isFavorite ? 'history-item favorited' : 'history-item';
                    const historyItem = this.createElement('div', classes, null, {
                        role: 'listitem'
                    });

                    // Highlight matching text if search is active
                    const fortuneTextContent = this.searchQuery
                        ? this.highlightSearchMatches(item.message, this.searchQuery)
                        : item.message;

                    const fortuneText = this.createElement(
                        'div',
                        'history-fortune-text'
                    );
                    fortuneText.innerHTML = fortuneTextContent;

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
                const historyItems = this.elements.historyList.querySelectorAll('.history-item');
                const itemToDelete = historyItems[index];

                if (itemToDelete) {
                    // Add deleting class for animation
                    itemToDelete.classList.add('deleting');

                    // Wait for animation to complete, then trigger actual deletion
                    setTimeout(() => {
                        if (this.onDeleteComplete) {
                            this.onDeleteComplete(index);
                        }
                    }, 300); // Match animation duration
                }
            }

            setOnDeleteComplete(handler) {
                this.onDeleteComplete = handler;
            }

            setOnToggleFavorite(handler) {
                this.onToggleFavorite = handler;
            }
        }

        class FortuneApp {
            constructor() {
                this.storageService = new StorageService();
                this.storageService.checkVersion();

                this.apiService = new APIService(this.storageService);
                this.messageManager = new MessageManager(this.apiService, this.storageService);
                this.uiController = new UIController();

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
                    this.uiController.showErrorMessage('Failed to toggle favorite. Please try again.');
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
