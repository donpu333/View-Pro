// Глобальное хранилище всех индикаторов
window.IndicatorRegistry = new Map();

// Перевод категорий для UI меню
const CATEGORY_LABELS = {
    trend: 'Трендовые',
    oscillator: 'Осцилляторы',
    histogram: 'Гистограммные',
    volatility: 'Волатильность',
    info: 'Инфо'
};

// Новая универсальная Фабрика (больше не требует обновления!)
window.IndicatorFactory = {
    createIndicator(type, manager) {
        const IndicatorClass = window.IndicatorRegistry.get(type);
        if (!IndicatorClass) {
            console.warn('⚠️ Индикатор не найден:', type);
            return null;
        }
        try {
            return new IndicatorClass(manager);
        } catch (error) {
            console.error(`❌ Ошибка создания ${type}:`, error);
            return null;
        }
    },

    // Генерирует список для меню добавления на лету
    getIndicatorsList() {
        const list = [];
        window.IndicatorRegistry.forEach((Class, id) => {
            list.push({
                id: id,
                name: Class.meta?.name || id,
                category: CATEGORY_LABELS[Class.meta?.category] || 'Другое',
                color: Class.meta?.color || '#FFF',
                panel: Class.meta?.panel || 'main'
            });
        });
        return list;
    }
};
