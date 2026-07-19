/**
 * Надежный и безопасный класс-обертка для работы с IndexedDB.
 * Включает защиту от зависаний, потерь данных и блокировок браузера.
 */
class IndexedDBStorage {
    /**
     * @param {string} dbName - Имя базы данных
     * @param {number} [version=2] - Версия схемы базы данных
     */
    constructor(dbName, version = 2) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
        this.initPromise = null;
        console.log('📦 IndexedDBStorage constructor:', dbName, 'v' + version);
    }

    /**
     * Инициализирует соединение с базой данных.
     * @returns {Promise<IDBDatabase>}
     */
    async init() {
        if (this.db) return this.db;
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            // ЗАЩИТА 1: Предотвращаем ReferenceError в строгих iframe или SSR
            if (typeof indexedDB === 'undefined') {
                return reject(new Error('IndexedDB is not supported in this environment'));
            }

            console.log('📦 Opening database...');
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = (event) => {
                console.error('📦 Database error:', event.target.error);
                this.initPromise = null; // Сброс для возможности повторной попытки
                reject(event.target.error);
            };

            request.onblocked = (event) => {
                console.warn('📦 Database blocked - close other tabs with this app');
                // ЗАЩИТА 2: Reject обязателен! Иначе await init() зависнет навсегда (pending).
                // Это корректно активирует глобальный .catch() и Proxy-fallback.
                reject(new Error('Database blocked by another connection'));
            };

            request.onsuccess = (event) => {
                console.log('📦 Database opened successfully');
                this.db = event.target.result;

                this.db.onclose = () => {
                    console.warn('📦 Database connection closed unexpectedly');
                    this.db = null;
                    this.initPromise = null;
                };

                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                console.log(`📦 Database upgrade needed from v${event.oldVersion} to v${event.version}`);
                const db = event.target.result;
                const transaction = event.target.transaction;

                // Версия 1: Создание всех хранилищ с нуля
                if (event.oldVersion < 1) {
                    if (!db.objectStoreNames.contains('symbolCaches')) {
                        const symbolStore = db.createObjectStore('symbolCaches', { keyPath: 'exchange' });
                        symbolStore.createIndex('timestamp', 'timestamp');
                    }
                    if (!db.objectStoreNames.contains('drawings')) {
                        const drawingsStore = db.createObjectStore('drawings', { keyPath: 'id' });
                        drawingsStore.createIndex('type', 'type');
                        drawingsStore.createIndex('symbolKey', 'symbolKey');
                        drawingsStore.createIndex('timestamp', 'timestamp');
                    }
                    if (!db.objectStoreNames.contains('candles')) {
                        const candlesStore = db.createObjectStore('candles', { keyPath: 'key' });
                        candlesStore.createIndex('symbol', 'symbol');
                        candlesStore.createIndex('interval', 'interval');
                        candlesStore.createIndex('exchange', 'exchange');
                        candlesStore.createIndex('marketType', 'marketType');
                        candlesStore.createIndex('lastUpdate', 'lastUpdate');
                    }
                    if (!db.objectStoreNames.contains('settings')) {
                        db.createObjectStore('settings', { keyPath: 'key' });
                    }
                }

                // Версия 2: Миграция - добавляем индекс symbolKey, если его нет
                if (event.oldVersion < 2 && db.objectStoreNames.contains('drawings')) {
                    const drawingsStore = transaction.objectStore('drawings');
                    if (!drawingsStore.indexNames.contains('symbolKey')) {
                        console.log('📦 Adding symbolKey index to existing drawings store');
                        drawingsStore.createIndex('symbolKey', 'symbolKey');
                    }
                }
            };
        });

        return this.initPromise;
    }

    /**
     * Закрывает соединение с базой данных.
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.initPromise = null;
            console.log('📦 Database connection closed');
        }
    }

    /**
     * Удаляет запись по ключу.
     * @param {string} storeName - Имя хранилища
     * @param {string|number} key - Ключ записи
     * @returns {Promise<void>}
     */
    async delete(storeName, key) {
        await this.init();
        if (!this.db.objectStoreNames.contains(storeName)) throw new Error(`Store '${storeName}' not found`);

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const request = transaction.objectStore(storeName).delete(key);

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
                transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            } catch (error) {
                console.error(`📦 Error in delete (${storeName}):`, error);
                reject(error);
            }
        });
    }

    /**
     * Сохраняет или обновляет запись.
     * @param {string} storeName - Имя хранилища
     * @param {any} data - Данные для сохранения (должны содержать keyPath)
     * @returns {Promise<any>} - Возвращает ключ сохраненной записи
     */
    async put(storeName, data) {
        await this.init();
        if (!this.db.objectStoreNames.contains(storeName)) throw new Error(`Store '${storeName}' not found`);

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const request = transaction.objectStore(storeName).put(data);

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            } catch (error) {
                console.error(`📦 Error in put (${storeName}):`, error);
                reject(error);
            }
        });
    }

    /**
     * Получает одну запись по ключу.
     * @param {string} storeName - Имя хранилища
     * @param {string|number} key - Ключ записи
     * @returns {Promise<any>}
     */
    async get(storeName, key) {
        await this.init();
        if (!this.db.objectStoreNames.contains(storeName)) throw new Error(`Store '${storeName}' not found`);

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const request = transaction.objectStore(storeName).get(key);

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            } catch (error) {
                console.error(`📦 Error in get (${storeName}):`, error);
                reject(error);
            }
        });
    }

    /**
     * Получает все записи из хранилища.
     * @param {string} storeName - Имя хранилища
     * @returns {Promise<Array<any>>}
     */
    async getAll(storeName) {
        await this.init();
        if (!this.db.objectStoreNames.contains(storeName)) throw new Error(`Store '${storeName}' not found`);

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const request = transaction.objectStore(storeName).getAll();

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            } catch (error) {
                console.error(`📦 Error in getAll (${storeName}):`, error);
                reject(error);
            }
        });
    }

    /**
     * Получает записи по значению индекса.
     * @param {string} storeName - Имя хранилища
     * @param {string} indexName - Имя индекса
     * @param {any} value - Искомое значение (ОБЯЗАТЕЛЬНО)
     * @returns {Promise<Array<any>>}
     */
    async getByIndex(storeName, indexName, value) {
        await this.init();
        if (!this.db.objectStoreNames.contains(storeName)) throw new Error(`Store '${storeName}' not found`);

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);

                if (!store.indexNames.contains(indexName)) {
                    console.warn(`📦 Index '${indexName}' not found in '${storeName}'`);
                    return resolve([]);
                }

                // ЗАЩИТА 3: Предотвращаем случайную выгрузку всей таблицы в память (Out-of-Memory)
                if (value === undefined) {
                    return reject(new Error('Value is required for getByIndex to prevent loading the entire store'));
                }

                const request = store.index(indexName).getAll(value);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            } catch (error) {
                console.error(`📦 Error in getByIndex (${storeName}):`, error);
                reject(error);
            }
        });
    }

    /**
     * Очищает все записи в хранилище.
     * @param {string} storeName - Имя хранилища
     * @returns {Promise<void>}
     */
    async clear(storeName) {
        await this.init();
        if (!this.db.objectStoreNames.contains(storeName)) throw new Error(`Store '${storeName}' not found`);

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const request = transaction.objectStore(storeName).clear();

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
                transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            } catch (error) {
                console.error(`📦 Error in clear (${storeName}):`, error);
                reject(error);
            }
        });
    }

    /**
     * Возвращает количество записей в хранилище.
     * @param {string} storeName - Имя хранилища
     * @returns {Promise<number>}
     */
    async count(storeName) {
        await this.init();
        if (!this.db.objectStoreNames.contains(storeName)) throw new Error(`Store '${storeName}' not found`);

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const request = transaction.objectStore(storeName).count();

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            } catch (error) {
                console.error(`📦 Error in count (${storeName}):`, error);
                reject(error);
            }
        });
    }

    /**
     * Массовое сохранение записей с гарантией сохранения порядка результатов.
     * @param {string} storeName - Имя хранилища
     * @param {Array<any>} items - Массив данных для сохранения
     * @returns {Promise<Array<any>>} - Массив ключей в том же порядке, что и items
     */
    async putMany(storeName, items) {
        await this.init();
        if (!Array.isArray(items) || items.length === 0) return [];
        if (!this.db.objectStoreNames.contains(storeName)) throw new Error(`Store '${storeName}' not found`);

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                
                // ЗАЩИТА 4: Гарантируем сохранение исходного порядка элементов
                const results = new Array(items.length);

                items.forEach((item, index) => {
                    const request = store.put(item);
                    request.onsuccess = () => {
                        results[index] = request.result;
                    };
                    // Отдельный onerror не нужен: ошибка автоматически прервет транзакцию
                });

                // Нативные события транзакции надежнее ручных счетчиков
                transaction.oncomplete = () => resolve(results);
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
            } catch (error) {
                console.error(`📦 Error in putMany (${storeName}):`, error);
                reject(error);
            }
        });
    }

    /**
     * Полное удаление базы данных.
     * @returns {Promise<void>}
     */
    async deleteDatabase() {
        this.close();
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this.dbName);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            // ЗАЩИТА 5: Предотвращаем вечное зависание Promise при блокировке удаления
            request.onblocked = () => reject(new Error('Database delete blocked by another connection'));
        });
    }
}

// ============================================================
// Глобальная инициализация (Безопасная для SSR/Node.js)
// ============================================================
if (typeof window !== 'undefined') {
    window.IndexedDBStorage = IndexedDBStorage;
    
    window.db = new IndexedDBStorage('TradingViewPro', 3);
    window.dbReady = false;

    window.db.init()
        .then(() => {
            window.dbReady = true;
            console.log('✅ IndexedDB ready to use');
        })
        .catch(err => {
            window.dbReady = false;
            console.error('❌ IndexedDB init failed:', err);

            // Умная заглушка (Proxy) – все операции будут безопасно игнорироваться
            window.db = new Proxy({}, {
                get: (target, prop) => {
                    if (['get', 'put', 'delete', 'getAll', 'getByIndex', 'clear', 'count', 'putMany', 'init', 'close'].includes(prop)) {
                        return (...args) => {
                            console.warn(`📦 IndexedDB DISABLED. Call to db.${prop}(${args[0] || ''}) was ignored.`);
                            if (prop === 'getAll' || prop === 'getByIndex' || prop === 'putMany') {
                                return Promise.resolve([]);
                            }
                            if (prop === 'count') {
                                return Promise.resolve(0);
                            }
                            return Promise.resolve(undefined);
                        };
                    }
                    return undefined;
                }
            });

            setTimeout(() => {
                alert('Ваш браузер заблокировал доступ к локальной базе данных.\nСохранение рисунков и кэш свечей будут недоступны в этой сессии.\nРазрешите использование Cookies/Storage в настройках браузера.');
            }, 1000);
        });
}
