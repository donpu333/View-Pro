/**
 * EconomicCalendar.js — собственный виджет экономического календаря для View Pro
 * ============================================================================
 * Замена виджета tradays.com (MetaQuotes), который:
 *   — не принимает фильтры в коде встройки (настройки сбрасываются каждый раз);
 *   — вообще не содержит Россию (RUB отсутствует в их списке валют).
 *
 * Данные:
 *   1) TradingView (chartevents-reuters.tradingview.com) — открытый API,
 *      без ключа, с CORS (*). США — события высокой важности (NFP, CPI, FOMC,
 *      ISM и т.д.), Россия — макростатистика (CPI, ВВП, розница, PMI...).
 *   2) Встроенный график заседаний ЦБ РФ по ключевой ставке (cbr.ru/DKP/cal_mp) —
 *      TradingView его не отдаёт, поэтому он зашит статическим списком ниже.
 *      ⚠ Один раз в год (в декабре) добавляйте даты следующего года в CBR_MEETINGS.
 *
 * Возможности:
 *   — переключатель периода «День» (только сегодня) / «Неделя» (7 дней вперёд),
 *     выбор сохраняется в localStorage;
 *   — фильтры важности по странам (чипы), сохраняются в localStorage;
 *   — КРУПНЫЙ ШРИФТ; карточка события раскрывается по клику:
 *     описание события на русском (40+ индикаторов), что означает прогноз,
 *     факт/прогноз/предыдущее, единицы измерения, период, источник;
 *   — обратный отсчёт до ближайшего события, подсветка событий ближайшего часа;
 *   — автообновление раз в 15 минут, кэш для мгновенного открытия.
 *
 * Использование:
 *   <script src="./EconomicCalendar.js"></script>
 *   window.EconomicCalendarWidget.load(document.getElementById('economicCalendarWidget'));
 *
 * Опции (необязательно):
 *   {
 *     countries: ['US','RU'],   // страны (в API TradingView: US, RU, EU, GB, CN, JP...)
 *     days: 7,                  // на сколько дней вперёд показывать
 *     refreshMin: 15,           // автообновление данных, минут
 *     demoFallback: false       // true — показывать демо-данные при ошибке сети (только для демо-страницы)
 *   }
 */
(function () {
  'use strict';

  var API_URL = 'https://chartevents-reuters.tradingview.com/events';
  var STORAGE_FILTERS = 'econCalendarFilters.v1';
  var STORAGE_CACHE   = 'econCalendarCache.v1';
  var STORAGE_RANGE   = 'econCalendarRange.v1';

  // =====================================================================
  // Заседания Совета директоров ЦБ РФ по ключевой ставке (13:30 МСК = 10:30 UTC)
  // Источник: https://cbr.ru/DKP/cal_mp/
  // Прошедшие даты можно не удалять — виджет показывает только от сегодня и далее.
  // TODO: в декабре 2026 ЦБ опубликует график на 2027 год — добавьте даты сюда.
  // =====================================================================
  var CBR_MEETINGS = [
    { date: '2026-02-13T10:30:00Z', note: 'Среднесрочный прогноз; пресс-конференция 15:00 МСК' },
    { date: '2026-03-20T10:30:00Z', note: 'Пресс-конференция 15:00 МСК' },
    { date: '2026-04-24T10:30:00Z', note: 'Среднесрочный прогноз; пресс-конференция 15:00 МСК' },
    { date: '2026-06-19T10:30:00Z', note: 'Пресс-конференция 15:00 МСК' },
    { date: '2026-07-24T10:30:00Z', note: 'Среднесрочный прогноз; пресс-конференция 15:00 МСК' },
    { date: '2026-09-11T10:30:00Z', note: 'Пресс-конференция 15:00 МСК' },
    { date: '2026-10-23T10:30:00Z', note: 'Среднесрочный прогноз; пресс-конференция 15:00 МСК' },
    { date: '2026-12-18T10:30:00Z', note: 'Пресс-конференция 15:00 МСК' }
  ];
  var CBR_LINK = 'https://cbr.ru/DKP/cal_mp/';

  var COUNTRY_META = {
    US: { flag: '🇺🇸', name: 'США' },
    RU: { flag: '🇷🇺', name: 'Россия' },
    EU: { flag: '🇪🇺', name: 'Еврозона' },
    GB: { flag: '🇬🇧', name: 'Великобритания' },
    CN: { flag: '🇨🇳', name: 'Китай' },
    JP: { flag: '🇯🇵', name: 'Япония' }
  };

  // Фильтры по умолчанию: США — только высокие; Россия — высокие + средние
  var DEFAULT_FILTERS = { 'US:1': true, 'US:0': false, 'RU:1': true, 'RU:0': true };

  // =====================================================================
  // СЛОВАРЬ ОПИСАНИЙ СОБЫТИЙ НА РУССКОМ
  // m — подстроки для поиска в названии (регистр не важен), c — страна (не обязательно)
  // ru — короткий русский подзаголовок, desc — подробное описание
  // =====================================================================
  var DESC_RULES = [
    // ---------- ЦБ РФ ----------
    { src: 'cbr', ru: 'Ключевая ставка Банка России', desc: 'Решение Совета директоров Банка России по ключевой ставке (пресс-релиз в 13:30 МСК, пресс-конференция Председателя в 15:00 МСК). Главное событие для рубля, ОФЗ и российского рынка акций. Повышение ставки — поддержка рублю и давление на акции; снижение — давление на рубль и поддержка акций. На квартальных заседаниях публикуется среднесрочный прогноз — сигнал о будущей траектории ставки часто двигает рынок сильнее самого решения.' },

    // ---------- США: занятость ----------
    { m: ['non-farm payrolls', 'nonfarm'], ru: 'Занятость вне сельского хозяйства (NFP)', desc: 'Nonfarm Payrolls — изменение числа занятых в США вне сельского хозяйства, главный ежемесячный отчёт по рынку труда (первая пятница месяца, 8:30 по восточному времени США). Один из самых «двигающих» рынок индикаторов: значение заметно выше прогноза укрепляет доллар (ожидания более жёсткой политики ФРС), ниже прогноза — ослабляет. В момент выхода — резкие движения в валютах, индексах и крипторынке. Публикуется вместе с уровнем безработицы и пересмотром прошлых данных.' },
    { m: ['unemployment rate'], c: 'US', ru: 'Уровень безработицы (США)', desc: 'Доля безработных в общей численности рабочей силы США. Публикуется вместе с NFP. Рост безработицы — признак охлаждения рынка труда и аргумент для ФРС снижать ставку (давление на доллар); снижение — наоборот. Сильное движение вызывает, когда значение отличается от прогноза на 0,1 п.п. и больше.' },
    { m: ['initial jobless'], ru: 'Первичные заявки по безработице', desc: 'Еженедельные данные (четверг, 8:30 ET) о числе впервые обратившихся за пособием по безработице. Самый оперативный индикатор состояния рынка труда: рост заявок — ранний сигнал замедления экономики и давления на доллар, снижение — признак устойчивого рынка труда.' },
    { m: ['jolts'], ru: 'Вакансии на рынке труда (JOLTS)', desc: 'Число открытых вакансий в США — индикатор спроса на рабочую силу, который ФРС внимательно отслеживает (соотношение вакансий к числу безработных). Снижение вакансий — признак охлаждения рынка труда, что усиливает ожидания снижения ставки и давит на доллар.' },
    { m: ['adp'], ru: 'Занятость от ADP (превью NFP)', desc: 'Оценка изменения занятости в частном секторе от агентства ADP. Выходит за два дня до официального NFP и служит его «превью» — рынки используют его для корректировки ожиданий перед главным отчётом. Сам по себе двигает рынок умеренно.' },

    // ---------- США: инфляция ----------
    { m: ['core cpi'], ru: 'Базовая потребительская инфляция (Core CPI)', desc: 'Потребительская инфляция без учёта продуктов питания и энергии — «трендовая» составляющая, на которую ФРС смотрит пристальнее всего. Именно Core CPI сильнее всего влияет на ожидания по ставке: значение выше прогноза — доллар растёт, акции и крипторынок под давлением; ниже прогноза — наоборот.' },
    { m: ['cpi'], c: 'US', ru: 'Потребительская инфляция (CPI)', desc: 'Индекс потребительских цен США — главный инфляционный показатель месяца. Публикуется в середине месяца (month-over-month и year-over-year, отдельно базовый индекс). Инфляция выше прогноза усиливает ожидания жёсткой политики ФРС (доллар↑, рисковые активы↓), ниже — поддерживает ралли акций и криптовалют.' },
    { m: ['ppi'], c: 'US', ru: 'Производственная инфляция (PPI)', desc: 'Индекс цен производителей — опережающий индикатор потребительской инфляции: рост издержек производителей со временем перекладывается в цены для потребителей. Рынок реагирует слабее, чем на CPI, но сильное отклонение от прогноза меняет ожидания по ставке ФРС.' },
    { m: ['pce', 'personal consumption expenditures'], ru: 'Инфляция PCE — «любимый» индикатор ФРС', desc: 'Ценовой индекс расходов личного потребления (Core PCE) — тот самый показатель, по которому ФРС таргетирует инфляцию 2% (а не по CPI). Публикуется с лагом около месяца. Отклонение от прогноза напрямую меняет траекторию ожиданий по ставке.' },

    // ---------- США: ФРС ----------
    { m: ['fed interest rate', 'fomc', 'interest rate decision'], c: 'US', ru: 'Решение ФРС по ставке (FOMC)', desc: 'Решение Федерального комитета по открытым рынкам (FOMC) по федеральной ставке — главное событие для всех мировых рынков. Повышение/сигнал «выше и дольше» — доллар↑, акции и крипто↓; снижение/мягкий тон — наоборот. Сопровождается заявлением (statement), а на опорных заседаниях — прогнозами dot plot и пресс-конференцией.' },
    { m: ['press conference', 'powell'], ru: 'Пресс-конференция главы ФРС', desc: 'Пресс-конференция Председателя ФРС через 30 минут после решения по ставке. Часто двигает рынок сильнее самого решения: важны тон и формулировки об инфляции, занятости и готовности менять ставку. Волатильность может разворачиваться по ходу выступления.' },
    { m: ['fed '], ru: 'Выступление представителя ФРС', desc: 'Выступление члена ФРС (голосующего или главы регионального банка). Рынок ищет намёки на будущие решения по ставке — особенно значимы выступления в «период тишины» перед FOMC и на фоне спорных данных.' },

    // ---------- США: деловая активность ----------
    { m: ['ism n-mfg', 'ism non-manufacturing', 'ism services'], ru: 'ISM — сфера услуг США', desc: 'Индекс деловой активности в сфере услуг от ISM. Услуги — около 70% экономики США, поэтому индикатор сильно влияет на ожидания роста и инфляции (компонент цен в отчёте особенно важен для ФРС). Выше 50 — рост сектора, ниже 50 — сокращение.' },
    { m: ['ism manufacturing', 'ism mfg'], ru: 'ISM — производственный сектор США', desc: 'Индекс деловой активности в обрабатывающей промышленности от ISM — один из важнейших опережающих индикаторов экономики США. Выше 50 — расширение производства, ниже 50 — сокращение. Сильное отклонение от прогноза заметно двигает доллар и фондовые индексы.' },
    { m: ['s&p global'], c: 'US', ru: 'PMI от S&P Global (США)', desc: 'Индексы деловой активности (PMI) от S&P Global: Flash — первая предварительная оценка (двигает рынок сильнее), Final — финальное значение (реакция обычно слабая). Выше 50 — рост деловой активности, ниже — сокращение. Выходят по производству, услугам и композитный.' },
    { m: ['philly fed', 'empire state', 'richmond fed', 'dallas fed', 'chicago pmi', 'kansas'], ru: 'Региональный индекс ФРБ', desc: 'Индексы деловой активности от региональных Федеральных резервных банков (Филадельфия, Нью-Йорк, Ричмонд, Даллас, Чикаго) — ранние срезы состояния промышленности. Служат опережающим сигналом перед общенациональным ISM.' },
    { m: ['consumer confidence', 'consumer sentiment', 'michigan'], ru: 'Потребительское доверие', desc: 'Индекс уверенности потребителей (Conference Board или Мичиганский университет). Показывает готовность домохозяйств тратить — основу роста экономики США. В релизе Мичиганского университета рынок отдельно смотрит на инфляционные ожидания.' },

    // ---------- США: рост и прочее ----------
    { m: ['gdp'], c: 'US', ru: 'ВВП США', desc: 'Валовой внутренний продукт США (квартально, в годовом выражении). Первая оценка (Advance) двигает рынок сильнее всего, вторая (Second) и финальная (Final) — это пересмотры, реакция на них обычно сдержанная. Также публикуются компоненты: потребление, дефлятор ВВП (важен для оценки инфляции).' },
    { m: ['retail sales'], c: 'US', ru: 'Розничные продажи (США)', desc: 'Объём розничных продаж — главный индикатор потребительских расходов (около 70% ВВП США). Значение выше прогноза — доллар укрепляется, ниже — ослабевает. Важна и контрольная группа (без авто, бензина и стройматериалов), которая идёт в расчёт ВВП.' },
    { m: ['durable goods'], ru: 'Заказы на товары длительного пользования', desc: 'Объём новых заказов на товары со сроком службы более 3 лет (техника, оборудование, транспорт). Индикатор инвестиционной активности бизнеса; ключевой компонент — заказы без транспорта (менее волатильный).' },
    { m: ['existing home', 'new home', 'pending home', 'building permits', 'housing starts'], ru: 'Рынок недвижимости США', desc: 'Данные по рынку жилья: продажи (вторичные/новые/незавершённые), разрешения на строительство и закладки новых домов. Сектор очень чувствителен к ипотечным ставкам, поэтому служит индикатором эффективности политики ФРС и настроений домохозяйств.' },
    { m: ['trade balance'], c: 'US', ru: 'Торговый баланс (США)', desc: 'Разница между экспортом и импортом США. Дефицит влияет на расчёт ВВП (чистый экспорт). Рынок обычно реагирует умеренно, если отклонение от прогноза не очень большое.' },
    { m: ['industrial production', 'capacity utilization'], ru: 'Промышленное производство (США)', desc: 'Динамика выпуска в промышленности, добывающем секторе и коммунальных услугах + загрузка мощностей. Совпадающий индикатор состояния реальной экономики.' },
    { m: ['crude oil inventories', 'eia'], ru: 'Запасы нефти от EIA', desc: 'Еженедельные данные Минэнерго США о запасах сырой нефти (среда). Влияют на цены нефти, а через них — на инфляционные ожидания и валюты сырьевых стран. Сильное расхождение с прогнозом API накануне усиливает реакцию.' },

    // ---------- Россия ----------
    { m: ['cpi'], c: 'RU', ru: 'Инфляция в России (Росстат)', desc: 'Индекс потребительских цен в России: недельные, месячные (CPI MM) и годовые (CPI YY) данные Росстата. Главный индикатор для решений ЦБ РФ: устойчивое ускорение инфляции — аргумент за повышение ключевой ставки (поддержка рублю, давление на акции), замедление — за снижение.' },
    { m: ['gdp'], c: 'RU', ru: 'ВВП России (помесячная оценка)', desc: 'Помесячная оценка ВВП от Минэкономразвития — оперативный срез экономической активности в России. Влияет на ожидания по политике ЦБ: перегрев экономики усиливает проинфляционные риски.' },
    { m: ['retail sales'], c: 'RU', ru: 'Розничные продажи (Россия)', desc: 'Оборот розничной торговли (Росстат, год к году) — основной индикатор потребительской активности россиян. Устойчивый рост потребления при ограниченном предложении — проинфляционный фактор, который учитывает ЦБ.' },
    { m: ['unemployment'], c: 'RU', ru: 'Безработица (Россия)', desc: 'Уровень безработицы по методологии МОТ (Росстат). В последние годы на исторических минимумах — дефицит кадров разгоняет зарплаты и остаётся одним из ключевых проинфляционных факторов, на которые ссылается ЦБ РФ.' },
    { m: ['industrial output'], ru: 'Промышленное производство (Россия)', desc: 'Индекс промышленного производства (Росстат) — динамика выпуска в добыче и обработке. Показывает, насколько экономика выдерживает жёсткую денежно-кредитную политику.' },
    { m: ['real wages'], ru: 'Реальные зарплаты (Россия)', desc: 'Реальные располагаемые зарплаты (с поправкой на инфляцию). Быстрый рост зарплат поддерживает потребление, но усиливает инфляционное давление — важный аргумент в риторике ЦБ РФ.' },
    { m: ['ppi'], c: 'RU', ru: 'Цены производителей (Россия)', desc: 'Индекс цен производителей промышленных товаров (Росстат). Опережающий индикатор для потребительской инфляции: рост издержек производителей со временем перекладывается в розничные цены.' },
    { m: ['s&p global mfg'], c: 'RU', ru: 'PMI обрабатывающих отраслей РФ', desc: 'Индекс деловой активности (PMI) в обрабатывающей промышленности России от S&P Global. Выше 50 — рост сектора, ниже 50 — сокращение. Один из немногих оперативных рыночных индикаторов состояния российской промышленности.' },
    { m: ['s&p global services'], c: 'RU', ru: 'PMI сферы услуг РФ', desc: 'Индекс деловой активности (PMI) в сфере услуг России от S&P Global. Услуги — крупнейший сектор экономики; значение выше 50 указывает на рост деловой активности.' },
    { m: ['cbank wkly reserves', 'international reserves'], ru: 'Международные резервы ЦБ РФ', desc: 'Еженедельные данные Банка России о международных (золотовалютных) резервах. Рост — укрепление «подушки безопасности» страны; на курс рубля влияют опосредованно, но важны для оценки устойчивости финансовой системы.' },
    { m: ['fx intervention'], ru: 'Валютные интервенции', desc: 'Операции ЦБ РФ и Минфина на валютном рынке в рамках бюджетного правила (покупка/продажа юаней). Влияют на баланс спроса и предложения валюты и, соответственно, на динамику рубля.' },
    { m: ['budget fulfilment'], ru: 'Исполнение бюджета РФ', desc: 'Данные об исполнении федерального бюджета (доходы/расходы). Дефицит бюджета и структура расходов важны для оценки проинфляционного влияния фискальной политики — фактор для решений ЦБ РФ.' },
    { m: ['foreign trade'], c: 'RU', ru: 'Внешняя торговля (Россия)', desc: 'Сальдо и оборот внешней торговли России. Экспортная выручка — ключевой фактор предложения валюты на рынке и поддержки рубля.' },
    { m: ['overall comprehensive risk'], ru: 'Обзор рисков финансовых рынков (ЦБ РФ)', desc: 'Обзор «О чем говорят тренды» / комплексная оценка рисков финансовых рынков от Банка России — аналитический релиз о состоянии рынков и финансовой стабильности.' }
  ];

  function describe(ev) {
    var n = (ev.name || '').toLowerCase();
    for (var i = 0; i < DESC_RULES.length; i++) {
      var r = DESC_RULES[i];
      if (r.src && ev.src === r.src) return r;
      if (!r.m) continue;
      if (r.c && ev.country !== r.c) continue;
      for (var j = 0; j < r.m.length; j++) {
        if (n.indexOf(r.m[j]) !== -1) return r;
      }
    }
    return null;
  }

  var state = {
    container: null,
    opts: null,
    all: [],
    filters: null,
    lastUpdate: null,
    fetching: false,
    error: null,
    demo: false,
    tickTimer: null,
    expanded: {},      // раскрытые карточки: id -> true
    range: 'week',     // 'day' — только сегодня, 'week' — 7 дней вперёд
    _lastScroll: null
  };

  // ============================ UTILS ==================================

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtTime(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtDateHeader(ts) {
    var d = new Date(ts);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var diffDays = Math.round((day - today) / 86400000);
    var label = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
    if (diffDays === 0) return 'Сегодня · ' + label;
    if (diffDays === 1) return 'Завтра · ' + label;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtValue(v, scale) {
    if (v === null || v === undefined || v === '') return '—';
    var s = String(v);
    if (scale && scale.length <= 3 && s.indexOf(scale) === -1) s += scale;
    return s;
  }

  function fmtCountdown(ms) {
    if (ms < 0) ms = 0;
    var min = Math.floor(ms / 60000);
    var h = Math.floor(min / 60);
    var d = Math.floor(h / 24);
    if (d > 0) return d + ' д ' + (h % 24) + ' ч';
    if (h > 0) return h + ' ч ' + (min % 60) + ' мин';
    if (min > 0) return min + ' мин';
    return 'менее минуты';
  }

  function evId(ev) { return ev.country + '|' + ev.ts + '|' + ev.name; }

  function loadFilters() {
    var f = {};
    for (var k in DEFAULT_FILTERS) f[k] = DEFAULT_FILTERS[k];
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_FILTERS) || 'null');
      if (saved && typeof saved === 'object') {
        for (var k2 in saved) f[k2] = !!saved[k2];
      }
    } catch (e) { /* приватный режим / песочница — работаем с дефолтами */ }
    return f;
  }

  function saveFilters() {
    try { localStorage.setItem(STORAGE_FILTERS, JSON.stringify(state.filters)); } catch (e) {}
  }

  function loadRange(defaultRange) {
    try {
      var r = localStorage.getItem(STORAGE_RANGE);
      if (r === 'day' || r === 'week') return r;
    } catch (e) {}
    return (defaultRange === 'day') ? 'day' : 'week';
  }

  function saveRange() {
    try { localStorage.setItem(STORAGE_RANGE, state.range); } catch (e) {}
  }

  function saveCache() {
    try {
      localStorage.setItem(STORAGE_CACHE, JSON.stringify({
        t: state.lastUpdate ? state.lastUpdate.getTime() : 0,
        events: state.all
      }));
    } catch (e) {}
  }

  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(STORAGE_CACHE) || 'null');
      if (c && c.events && c.events.length && c.t) {
        if (Date.now() - c.t < 12 * 3600 * 1000) return c;
      }
    } catch (e) {}
    return null;
  }

  // ============================ DATA ===================================

  function cbrEvents() {
    return CBR_MEETINGS.map(function (m) {
      return {
        ts: new Date(m.date).getTime(),
        country: 'RU',
        importance: 1,
        name: 'ЦБ РФ: решение по ключевой ставке',
        note: m.note || '',
        forecast: null, previous: null, actual: null,
        scale: '', period: '', unit: '% годовых', source: 'Банк России',
        comment: '', link: CBR_LINK, src: 'cbr'
      };
    });
  }

  function mapTvEvent(e) {
    return {
      ts: new Date(e.date).getTime(),
      country: e.country,
      importance: e.importance,
      name: e.indicator || e.title || '',
      note: '',
      forecast: e.forecast, previous: e.previous, actual: e.actual,
      scale: e.scale || '', period: e.period || '',
      unit: e.unit || '', source: e.source || '',
      comment: e.comment || '', link: '', src: 'tv'
    };
  }

  function fetchData(silent) {
    if (state.fetching) return;
    state.fetching = true;
    if (!silent) { state.error = null; render(); }

    var opts = state.opts;
    var now = new Date();
    var from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var to = new Date(from.getTime() + opts.days * 86400000);
    var url = API_URL +
      '?from=' + encodeURIComponent(from.toISOString()) +
      '&to=' + encodeURIComponent(to.toISOString()) +
      '&countries=' + encodeURIComponent(opts.countries.join(',')) +
      '&minImportance=0';

    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var res = (data && data.result) ? data.result : [];
        var events = res.map(mapTvEvent).concat(cbrEvents());
        var todayStart = from.getTime();
        events = events.filter(function (e) { return e.ts >= todayStart - 3600000; });
        events.sort(function (a, b) { return a.ts - b.ts; });
        state.all = events;
        state.lastUpdate = new Date();
        state.error = null;
        state.demo = false;
        state.fetching = false;
        saveCache();
        render();
      })
      .catch(function (err) {
        state.fetching = false;
        if (state.all.length) { render(); return; }
        state.error = err && err.message ? err.message : 'сеть недоступна';
        if (state.opts.demoFallback) {
          state.demo = true;
          state.all = demoEvents();
          state.lastUpdate = new Date();
        }
        render();
      });
  }

  // Демо-данные — только для офлайн-предпросмотра (opts.demoFallback)
  function demoEvents() {
    var t = Date.now();
    var day = 86400000;
    return [
      { ts: t - 3600000 * 5, country: 'US', importance: 1, name: 'Non-Farm Payrolls', note: '', forecast: 180, previous: 162, actual: 177, scale: 'K', period: 'Sep. 2026', unit: 'Number of jobs', source: 'BLS', comment: 'Number of jobs added or lost in all non-farm businesses. Published monthly.', link: '', src: 'demo' },
      { ts: t - 3600000 * 2, country: 'US', importance: 1, name: 'ISM Manufacturing PMI', note: '', forecast: 55.1, previous: 54.6, actual: null, scale: '', period: 'Sep. 2026', unit: 'Index (diffusion)', source: 'ISM', comment: '', link: '', src: 'demo' },
      { ts: t + 3600000,     country: 'RU', importance: 1, name: 'ЦБ РФ: решение по ключевой ставке', note: 'Пресс-конференция 15:00 МСК', forecast: null, previous: null, actual: null, scale: '', period: '', unit: '% годовых', source: 'Банк России', comment: '', link: CBR_LINK, src: 'cbr' },
      { ts: t + day,         country: 'US', importance: 1, name: 'CPI YY, NSA', note: '', forecast: 3.2, previous: 3.4, actual: null, scale: '', period: 'Sep. 2026', unit: 'Index', source: 'BLS', comment: '', link: '', src: 'demo' },
      { ts: t + day + 3600000 * 2, country: 'RU', importance: 0, name: 'CPI YY', note: '', forecast: 8.1, previous: 8.3, actual: null, scale: '', period: 'Sep. 2026', unit: 'Index', source: 'Rosstat', comment: '', link: '', src: 'demo' },
      { ts: t + day * 2,     country: 'US', importance: 1, name: 'Fed Interest Rate Decision', note: '', forecast: 4.25, previous: 4.25, actual: null, scale: '', period: '', unit: 'Rate', source: 'Federal Reserve', comment: '', link: '', src: 'demo' },
      { ts: t + day * 3,     country: 'RU', importance: 0, name: 'GDP YY Monthly', note: '', forecast: null, previous: 1.1, actual: null, scale: '', period: '', unit: '', source: 'MinEcon', comment: '', link: '', src: 'demo' }
    ];
  }

  // ============================ FILTER =================================

  function passFilter(ev) {
    var key = ev.country + ':' + (ev.importance === 1 ? '1' : '0');
    if (key in state.filters) return state.filters[key];
    return ev.importance === 1;
  }

  function visibleEvents() {
    var evs = state.all.filter(passFilter);
    if (state.range === 'day') {
      var today = dayKey(Date.now());
      evs = evs.filter(function (e) { return dayKey(e.ts) === today; });
    }
    return evs;
  }

  // ============================ STYLES =================================

  function injectStyles() {
    if (document.getElementById('ecw-styles')) return;
    var css = '' +
      '.ecw-root{display:flex;flex-direction:column;height:100%;width:100%;background:#1E1E1E;color:#E0E0E0;font-family:Inter,system-ui,Arial,sans-serif;font-size:14px;box-sizing:border-box;}' +
      '.ecw-root *{box-sizing:border-box;}' +
      '.ecw-rangebar{display:flex;align-items:center;gap:8px;padding:9px 12px 0;background:#232323;}' +
      '.ecw-rlabel{color:#848e9c;font-size:12.5px;}' +
      '.ecw-seg{display:inline-flex;border:1px solid #404040;border-radius:8px;overflow:hidden;}' +
      '.ecw-rbtn{background:#1E1E1E;border:none;color:#848e9c;font-size:13px;padding:5px 16px;cursor:pointer;font-family:inherit;transition:all .15s;}' +
      '.ecw-rbtn:hover{color:#fff;}' +
      '.ecw-rbtn + .ecw-rbtn{border-left:1px solid #404040;}' +
      '.ecw-rbtn.on{background:#4A90E2;color:#fff;font-weight:600;}' +
      '.ecw-toolbar{display:flex;flex-wrap:wrap;gap:5px;padding:8px 12px;border-bottom:1px solid #2D2D2D;background:#232323;}' +
      '.ecw-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:14px;border:1px solid #404040;background:#1E1E1E;color:#848e9c;cursor:pointer;font-size:13px;user-select:none;transition:all .15s;}' +
      '.ecw-chip:hover{border-color:#5b9bd5;}' +
      '.ecw-chip.on{color:#fff;border-color:#4A90E2;background:rgba(74,144,226,.18);}' +
      '.ecw-chip .dot{width:8px;height:8px;border-radius:50%;display:inline-block;}' +
      '.ecw-dot-high{background:#f23645;}' +
      '.ecw-dot-med{background:#FF9800;}' +
      '.ecw-statusbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 12px;border-bottom:1px solid #2D2D2D;color:#848e9c;font-size:12.5px;background:#202020;}' +
      '.ecw-countdown{color:#5b9bd5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.ecw-countdown b{color:#E0E0E0;font-weight:600;}' +
      '.ecw-refresh{background:none;border:1px solid #404040;color:#B0B0B0;border-radius:4px;cursor:pointer;font-size:12.5px;padding:3px 10px;flex-shrink:0;}' +
      '.ecw-refresh:hover{border-color:#5b9bd5;color:#fff;}' +
      '.ecw-list{flex:1;overflow-y:auto;padding:4px 0 10px;}' +
      '.ecw-dayhdr{position:sticky;top:0;z-index:2;background:#262626;color:#B0B0B0;font-size:13px;font-weight:600;padding:6px 12px;border-top:1px solid #333;border-bottom:1px solid #333;letter-spacing:.3px;}' +
      '.ecw-event{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;}' +
      '.ecw-event:hover{background:rgba(255,255,255,.03);}' +
      '.ecw-event.past{opacity:.45;}' +
      '.ecw-event.soon{background:rgba(242,54,69,.08);box-shadow:inset 3px 0 0 #f23645;animation:ecw-pulse 2s ease-in-out infinite;}' +
      '@keyframes ecw-pulse{0%,100%{background:rgba(242,54,69,.08);}50%{background:rgba(242,54,69,.18);}}' +
      '.ecw-row{display:flex;gap:9px;align-items:flex-start;}' +
      '.ecw-time{font-family:"JetBrains Mono",monospace;font-size:14px;font-weight:500;color:#E0E0E0;min-width:46px;padding-top:1px;}' +
      '.ecw-event.past .ecw-time{color:#848e9c;}' +
      '.ecw-when{color:#f23645;font-size:11px;font-weight:600;margin-top:2px;}' +
      '.ecw-flag{font-size:17px;line-height:19px;min-width:20px;text-align:center;}' +
      '.ecw-body{flex:1;min-width:0;}' +
      '.ecw-name{color:#F0F0F0;font-size:14.5px;font-weight:600;line-height:1.3;word-break:break-word;}' +
      '.ecw-name a{color:#5b9bd5;text-decoration:none;}' +
      '.ecw-name a:hover{text-decoration:underline;}' +
      '.ecw-imp{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;}' +
      '.ecw-ru{color:#9aa0a6;font-size:12.5px;margin-top:2px;line-height:1.3;}' +
      '.ecw-note{color:#848e9c;font-size:12.5px;margin-top:2px;}' +
      '.ecw-vals{display:flex;gap:12px;margin-top:4px;color:#848e9c;font-size:12.5px;flex-wrap:wrap;align-items:center;}' +
      '.ecw-vals .v{white-space:nowrap;}' +
      '.ecw-vals .lbl{color:#5f636d;}' +
      '.ecw-vals .fcst{color:#5b9bd5;font-weight:600;}' +
      '.ecw-vals .prev{color:#B0B0B0;}' +
      '.ecw-vals .actual{color:#fff;font-weight:700;}' +
      '.ecw-chevron{color:#5f636d;font-size:12px;align-self:center;flex-shrink:0;transition:transform .15s;}' +
      '.ecw-event.open .ecw-chevron{transform:rotate(90deg);color:#5b9bd5;}' +
      /* ---- раскрытая карточка ---- */
      '.ecw-details{margin:9px 0 2px 67px;padding:10px 12px;background:#252525;border:1px solid #333;border-radius:6px;cursor:default;}' +
      '.ecw-dsec{margin-bottom:9px;}' +
      '.ecw-dsec:last-child{margin-bottom:0;}' +
      '.ecw-dtitle{color:#5f636d;font-size:11px;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;font-weight:600;}' +
      '.ecw-desc{color:#D6D6D6;font-size:13px;line-height:1.6;}' +
      '.ecw-vtable{display:flex;gap:18px;}' +
      '.ecw-vcell{text-align:center;flex:1;background:#1E1E1E;border-radius:6px;padding:7px 4px;}' +
      '.ecw-vcell .num{font-size:16px;font-weight:700;font-family:"JetBrains Mono",monospace;}' +
      '.ecw-vcell .cap{color:#5f636d;font-size:11px;margin-top:2px;}' +
      '.ecw-vcell.c-act .num{color:#fff;}' +
      '.ecw-vcell.c-fcst .num{color:#5b9bd5;}' +
      '.ecw-vcell.c-prev .num{color:#B0B0B0;}' +
      '.ecw-meta{color:#848e9c;font-size:12px;line-height:1.7;}' +
      '.ecw-meta b{color:#B0B0B0;font-weight:600;}' +
      '.ecw-comment{color:#848e9c;font-size:12px;line-height:1.55;font-style:italic;border-left:2px solid #404040;padding-left:8px;}' +
      '.ecw-link{display:inline-block;margin-top:6px;color:#5b9bd5;font-size:12.5px;text-decoration:none;}' +
      '.ecw-link:hover{text-decoration:underline;}' +
      '.ecw-empty{padding:34px 16px;text-align:center;color:#848e9c;font-size:13.5px;line-height:1.6;}' +
      '.ecw-demo-banner{background:#7a5b00;color:#ffe082;text-align:center;padding:5px 8px;font-size:12.5px;font-weight:600;}' +
      '.ecw-error{background:#5b1f1f;color:#ffab91;text-align:center;padding:5px 8px;font-size:12.5px;}' +
      '.ecw-footer{padding:5px 12px;border-top:1px solid #2D2D2D;color:#5f636d;font-size:11.5px;display:flex;justify-content:space-between;background:#202020;}' +
      '.ecw-hint{color:#5f636d;font-size:11px;padding:0 12px 6px;}';
    var st = document.createElement('style');
    st.id = 'ecw-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ============================ RENDER =================================

  function renderChips() {
    var html = '';
    state.opts.countries.forEach(function (c) {
      var meta = COUNTRY_META[c] || { flag: '', name: c };
      html += '<span class="ecw-chip' + (state.filters[c + ':1'] ? ' on' : '') + '" data-key="' + c + ':1" title="' + esc(meta.name) + ' — только высокая важность">' +
        meta.flag + ' <span class="dot ecw-dot-high"></span>Высокие</span>';
      html += '<span class="ecw-chip' + (state.filters[c + ':0'] ? ' on' : '') + '" data-key="' + c + ':0" title="' + esc(meta.name) + ' — средняя важность">' +
        meta.flag + ' <span class="dot ecw-dot-med"></span>Средние</span>';
    });
    return html;
  }

  function nextEventHtml(list, now) {
    var next = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].ts > now) { next = list[i]; break; }
    }
    if (!next) return '<span>Ближайших событий нет</span>';
    var meta = COUNTRY_META[next.country] || { flag: '' };
    return '<span>Ближайшее: <b>через ' + fmtCountdown(next.ts - now) + '</b> — ' +
      meta.flag + ' ' + esc(next.name) + ' (' + fmtTime(next.ts) + ')</span>';
  }

  function renderDetails(ev, info) {
    var meta = COUNTRY_META[ev.country] || { flag: '', name: ev.country };
    var html = '<div class="ecw-details">';

    // описание события
    html += '<div class="ecw-dsec"><div class="ecw-dtitle">Что за событие</div>';
    if (info && info.desc) {
      html += '<div class="ecw-desc">' + esc(info.desc) + '</div>';
    } else if (ev.comment) {
      html += '<div class="ecw-desc">' + esc(ev.comment) + '</div>';
    } else {
      html += '<div class="ecw-desc">Описание для этого события пока не добавлено. Ниже — данные источника.</div>';
    }
    html += '</div>';

    // значения
    html += '<div class="ecw-dsec"><div class="ecw-dtitle">Значения</div>' +
      '<div class="ecw-vtable">' +
        '<div class="ecw-vcell c-act"><div class="num">' + esc(fmtValue(ev.actual, ev.scale)) + '</div><div class="cap">Факт</div></div>' +
        '<div class="ecw-vcell c-fcst"><div class="num">' + esc(fmtValue(ev.forecast, ev.scale)) + '</div><div class="cap">Прогноз</div></div>' +
        '<div class="ecw-vcell c-prev"><div class="num">' + esc(fmtValue(ev.previous, ev.scale)) + '</div><div class="cap">Пред.</div></div>' +
      '</div>' +
      '<div class="ecw-desc" style="margin-top:6px;font-size:12px;color:#848e9c;">Прогноз — консенсус-ожидание аналитиков. Основное движение цены вызывает отклонение факта от прогноза: факт сильнее прогноза → как правило, укрепление валюты страны и давление на рисковые активы; факт слабее — наоборот.</div>' +
      '</div>';

    // мета
    var metaParts = [];
    if (ev.period) metaParts.push('<b>Период:</b> ' + esc(ev.period));
    if (ev.unit) metaParts.push('<b>Ед. измерения:</b> ' + esc(ev.unit));
    if (ev.source) metaParts.push('<b>Источник:</b> ' + esc(ev.source));
    metaParts.push('<b>Важность:</b> ' + (ev.importance === 1 ? '🔴 высокая' : '🟠 средняя'));
    html += '<div class="ecw-dsec"><div class="ecw-dtitle">Справка</div><div class="ecw-meta">' + metaParts.join('<br>') + '</div></div>';

    // оригинальное описание источника (на английском)
    if (ev.comment && info && info.desc) {
      html += '<div class="ecw-dsec"><div class="ecw-dtitle">Описание источника (EN)</div><div class="ecw-comment">' + esc(ev.comment) + '</div></div>';
    }

    if (ev.link) {
      html += '<a class="ecw-link" href="' + esc(ev.link) + '" target="_blank" rel="noopener">Открыть источник ↗</a>';
    }
    html += '</div>';
    return html;
  }

  function renderList(list) {
    var now = Date.now();
    var html = '';
    var lastDay = '';
    list.forEach(function (ev) {
      var dk = dayKey(ev.ts);
      if (dk !== lastDay) {
        lastDay = dk;
        html += '<div class="ecw-dayhdr">' + esc(fmtDateHeader(ev.ts)) + '</div>';
      }
      var meta = COUNTRY_META[ev.country] || { flag: '', name: ev.country };
      var info = describe(ev);
      var past = ev.ts < now;
      var soon = !past && (ev.ts - now) <= 3600000;
      var open = !!state.expanded[evId(ev)];
      var cls = 'ecw-event' + (past ? ' past' : '') + (soon ? ' soon' : '') + (open ? ' open' : '');
      var impDot = ev.importance === 1 ? 'ecw-dot-high' : 'ecw-dot-med';
      var nameHtml = ev.link
        ? '<a href="' + esc(ev.link) + '" target="_blank" rel="noopener">' + esc(ev.name) + '</a>'
        : esc(ev.name);
      var vals =
        '<span class="v"><span class="lbl">Факт</span> <span class="' + (ev.actual !== null && ev.actual !== undefined ? 'actual' : '') + '">' + esc(fmtValue(ev.actual, ev.scale)) + '</span></span>' +
        '<span class="v"><span class="lbl">Прогноз</span> <span class="fcst">' + esc(fmtValue(ev.forecast, ev.scale)) + '</span></span>' +
        '<span class="v"><span class="lbl">Пред</span> <span class="prev">' + esc(fmtValue(ev.previous, ev.scale)) + '</span></span>';
      var timeLabel = fmtTime(ev.ts) + (soon ? '<div class="ecw-when">через ' + fmtCountdown(ev.ts - now) + '</div>' : '');

      html += '<div class="' + cls + '" data-ts="' + ev.ts + '" data-id="' + esc(evId(ev)) + '">' +
        '<div class="ecw-row">' +
          '<div class="ecw-time">' + timeLabel + '</div>' +
          '<div class="ecw-flag" title="' + esc(meta.name) + '">' + meta.flag + '</div>' +
          '<div class="ecw-body">' +
            '<div class="ecw-name"><span class="ecw-imp ' + impDot + '" title="' + (ev.importance === 1 ? 'Высокая важность' : 'Средняя важность') + '"></span>' + nameHtml + '</div>' +
            (info && info.ru ? '<div class="ecw-ru">' + esc(info.ru) + '</div>' : '') +
            (ev.note ? '<div class="ecw-note">' + esc(ev.note) + '</div>' : '') +
            '<div class="ecw-vals">' + vals + '</div>' +
          '</div>' +
          '<div class="ecw-chevron">▶</div>' +
        '</div>' +
        (open ? renderDetails(ev, info) : '') +
      '</div>';
    });
    if (!list.length) {
      html = state.range === 'day'
        ? '<div class="ecw-empty">На сегодня событий нет.<br>Переключитесь на «Неделя», чтобы увидеть ближайшие события.</div>'
        : '<div class="ecw-empty">Нет событий по выбранным фильтрам.<br>Попробуйте включить «Средние» для США или проверить диапазон дат.</div>';
    }
    return html;
  }

  function render() {
    var c = state.container;
    if (!c) return;
    var list = visibleEvents();
    var now = Date.now();

    var statusRight = state.lastUpdate
      ? '⟳ ' + fmtTime(state.lastUpdate.getTime())
      : (state.fetching ? '⟳ загрузка…' : '⟳');

    var html = '' +
      '<div class="ecw-root">' +
        (state.demo ? '<div class="ecw-demo-banner">⚠ ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ — нет доступа к API</div>' : '') +
        (state.error && !state.demo ? '<div class="ecw-error">Ошибка загрузки: ' + esc(state.error) + ' — показан кэш (если есть)</div>' : '') +
        '<div class="ecw-rangebar">' +
          '<span class="ecw-rlabel">Период:</span>' +
          '<div class="ecw-seg">' +
            '<button class="ecw-rbtn' + (state.range === 'day' ? ' on' : '') + '" data-range="day" title="Только сегодняшние события">День</button>' +
            '<button class="ecw-rbtn' + (state.range === 'week' ? ' on' : '') + '" data-range="week" title="События на 7 дней вперёд">Неделя</button>' +
          '</div>' +
        '</div>' +
        '<div class="ecw-toolbar">' + renderChips() + '</div>' +
        '<div class="ecw-statusbar">' +
          '<span class="ecw-countdown" id="ecwCountdown">' + nextEventHtml(list, now) + '</span>' +
          '<button class="ecw-refresh" id="ecwRefresh" title="Обновить сейчас">' + statusRight + '</button>' +
        '</div>' +
        '<div class="ecw-list" id="ecwList">' + renderList(list) + '</div>' +
        '<div class="ecw-hint">Нажмите на событие — подробное описание и прогноз</div>' +
        '<div class="ecw-footer"><span>Данные: TradingView + ЦБ РФ</span><span id="ecwFooterUpd">обновлено ' + (state.lastUpdate ? fmtTime(state.lastUpdate.getTime()) : '—') + '</span></div>' +
      '</div>';

    c.innerHTML = html;

    // переключатель периода День/Неделя
    c.querySelectorAll('.ecw-rbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = b.getAttribute('data-range');
        if (state.range !== r) {
          state.range = r;
          saveRange();
          render();
        }
      });
    });

    // чипы фильтров
    c.querySelectorAll('.ecw-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var key = chip.getAttribute('data-key');
        state.filters[key] = !state.filters[key];
        saveFilters();
        render();
      });
    });

    // раскрытие карточек (делегирование)
    var listEl = c.querySelector('#ecwList');
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('.ecw-event') : null;
        if (!row) return;
        if (e.target.closest('a')) return; // клики по ссылкам не перехватываем
        var id = row.getAttribute('data-id');
        if (state.expanded[id]) delete state.expanded[id];
        else state.expanded[id] = true;
        render();
      });
      if (state._lastScroll != null) listEl.scrollTop = state._lastScroll;
      listEl.addEventListener('scroll', function () { state._lastScroll = listEl.scrollTop; });
    }

    var rb = c.querySelector('#ecwRefresh');
    if (rb) rb.addEventListener('click', function () { fetchData(false); });
  }

  // Лёгкий тик: countdown + автообновление + классы soon/past (без полного рендера)
  function tick() {
    if (!state.container || !state.container.offsetParent) return;
    var now = Date.now();

    if (state.opts.refreshMin && !state.fetching) {
      var age = state.lastUpdate ? (now - state.lastUpdate.getTime()) : Infinity;
      if (age > state.opts.refreshMin * 60000) { fetchData(true); return; }
    }

    var cd = state.container.querySelector('#ecwCountdown');
    if (cd) cd.innerHTML = nextEventHtml(visibleEvents(), now);

    state.container.querySelectorAll('.ecw-event').forEach(function (el) {
      var ts = parseInt(el.getAttribute('data-ts') || '0', 10);
      if (!ts) return;
      el.classList.toggle('past', ts < now);
      el.classList.toggle('soon', ts >= now && ts - now <= 3600000);
    });
  }

  // ============================ PUBLIC API =============================

  function load(container, options) {
    if (!container) { console.warn('EconomicCalendar: container not found'); return; }
    injectStyles();

    state.container = container;
    state.opts = Object.assign({
      countries: ['US', 'RU'],
      days: 7,
      refreshMin: 15,
      defaultRange: 'week',   // 'day' | 'week' — если пользователь ещё не выбирал
      demoFallback: false
    }, options || {});
    state.filters = loadFilters();
    state.range = loadRange(state.opts.defaultRange);

    var cache = loadCache();
    if (cache) {
      state.all = cache.events;
      state.lastUpdate = new Date(cache.t);
    }
    render();
    fetchData(!!cache);

    if (!state.tickTimer) state.tickTimer = setInterval(tick, 30000);
  }

  function destroy() {
    if (state.tickTimer) { clearInterval(state.tickTimer); state.tickTimer = null; }
    if (state.container) state.container.innerHTML = '';
    state.container = null;
  }

  window.EconomicCalendarWidget = {
    load: load,
    destroy: destroy,
    refresh: function () { fetchData(false); },
    setRange: function (r) {
      if (r === 'day' || r === 'week') { state.range = r; saveRange(); render(); }
    },
    // можно редактировать график ЦБ и словарь описаний из кода:
    CBR_MEETINGS: CBR_MEETINGS,
    DESC_RULES: DESC_RULES
  };

  console.log('✅ EconomicCalendar.js v3 загружен (период День/Неделя + крупный шрифт + описания)');
})();
