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
 *     [EC-IMP] три уровня — 🔴 высокие / 🟠 средние / ⚪ низкие. Важность
 *     источника (Reuters importance 0|1|2) НЕ принимается на веру: для США и
 *     России она размечена непредсказуемо (FOMC и NFP идут как 2, а GDP
 *     Advance, Core PCE, Consumer Confidence и почти вся статистика Росстата —
 *     как 0), поэтому сверху накладывается курируемый список значимых релизов
 *     (IMP_HIGH / IMP_MED / IMP_LOW). Из-за прежней двухуровневой схемы
 *     («высокая» = importance === 1) заседание ФРС и NFP попадали в «средние»
 *     и при выключенном чипе не показывались вовсе — исправлено.
 *     По умолчанию показываются ТОЛЬКО события высокой важности (как в обычном
 *     календаре «красные» события); средние и низкие включаются чипами;
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
  // [EC-IMP] v1 → v2: сменилась ШКАЛА важности (2 уровня → 3), поэтому и кэш,
  // и сохранённые фильтры версионируем заново. Старые ключи больше не читаются
  // (в econCalendarFilters.v1 лежал дефолт 'US:0'=false, из-за которого FOMC и
  // NFP были скрыты; переносить его в новую схему означало бы сохранить баг).
  var STORAGE_FILTERS    = 'econCalendarFilters.v2';
  var STORAGE_FILTERS_V1 = 'econCalendarFilters.v1';   // только для справки/отладки
  var STORAGE_CACHE      = 'econCalendarCache.v2';
  var STORAGE_CACHE_V1   = 'econCalendarCache.v1';     // только для справки/отладки
  var STORAGE_RANGE   = 'econCalendarRange.v1';
  var STORAGE_BLS_BUDGET = 'econCalendarBlsBudget.v1';

  // =====================================================================
  // [EC-FAST] БЫСТРЫЙ КАНАЛ — зачем он нужен
  // ---------------------------------------------------------------------
  // Основной источник (chartevents-reuters.tradingview.com) отдаёт поле actual
  // с задержкой в ЧАСЫ. Измерено 2026-10-15 по 158 событиям за 12 дней
  // (US/RU/EU/GB/JP/CN, minImportance=0):
  //
  //     возраст события      событий   с фактом
  //       0–1  ч                 10        0     (0%)
  //       1–4  ч                 12        0     (0%)
  //      10–12  ч                 8        8     (100%)
  //     24–25  ч                37       35     (95%)
  //   importance=1: минимальный возраст события С фактом — 27.7 ч
  //
  // То есть поллинг хоть каждые 10 секунд бесполезен: числа в источнике ещё нет.
  // Поэтому для индикаторов, у которых есть открытый официальный API, факт
  // берётся НАПРЯМУЮ оттуда. BLS (api.bls.gov) отдаёт данные в течение
  // ~30–60 минут после релиза, работает без ключа и шлёт Access-Control-Allow-Origin: *.
  //
  // Верификация (13 месяцев истории, сравнение с actual из TradingView,
  // релиз месяца M относится к данным месяца M-1):
  //     CPI YY, NSA       8/8 совпадений до 0.1 п.п.
  //     CPI MM, SA        8/8
  //     Core CPI YY, NSA  8/8
  //     Core CPI MM, SA   8/8   → итого 32/32
  //
  // ЧЕГО ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО:
  //   • NFP — BLS отдаёт ПЕРЕСМОТРЕННЫЕ значения (релиз 02.10.2026 = 29K,
  //     сейчас в API 46K), цифра перестанет совпадать с той, на которую
  //     реагировал рынок. Совпадений 0/8.
  //   • PPI — «PPI exFood/Energy MM» не равен ни WPUFD4, ни WPUFD49104
  //     (совпадений 4/6). Лучше «—», чем неверное число.
  //   • JOLTS — совпадает только после пересчёта единиц (7079 тыс = 7.079 млн),
  //     но тоже пересматривается.
  //   • Unemployment Rate / Initial Jobless Claims — серий CPS и DOL ETA в
  //     бесплатном v1-доступе нет (LNS04000000 → "Series does not exist").
  // =====================================================================
  // ---------------------------------------------------------------------
  // [EC-FH] Finnhub — единственный проверенный источник, который отдаёт actual
  // ПО ВСЕМ событиям (Retail Sales, Initial Jobless Claims, NFP, RU, EU...)
  // в течение минут, а не часов, и при этом шлёт Access-Control-Allow-Origin: *.
  // Бесплатный ключ: https://finnhub.io/register (нужна только почта),
  // лимит бесплатного тарифа — 60 запросов/минуту, этого хватает с запасом.
  //
  // Проверено 2026-10-15, что БЕСКЛЮЧЕВЫХ источников с полем actual не существует:
  //   • TradingView/Reuters (основной) — actual через 4–10 ч;
  //   • ForexFactory nfs.faireconomy.media — поля actual НЕТ ВООБЩЕ
  //     (title,country,date,impact,forecast,previous) и нет CORS;
  //   • Myfxbook на том же хосте — 404;
  //   • BLS api.bls.gov — без ключа, но только CPI-семейство (см. FAST_RULES);
  //   • Eurostat — без ключа и с CORS, но только статистика ЕС;
  //   • FRED fredgraph.csv, cbr.ru, Philadelphia Fed — НЕ отдают CORS-заголовок;
  //   • Census (Retail Sales) и EIA (нефть/газ) — CORS есть, но нужен бесплатный ключ;
  //   • TradingEconomics guest-доступ закрыт (HTTP 410).
  // Поэтому: без ключа — CPI/Core CPI за ~30–60 мин, остальное по мере публикации
  // TradingView (4–10 ч); с ключом Finnhub — всё за минуты.
  // ---------------------------------------------------------------------
  var FINNHUB_URL = 'https://finnhub.io/api/v1/calendar/economic';
  var STORAGE_FH_KEY = 'econCalendarFinnhubKey.v1';
  var FH_CACHE_MS = 45000;        // кэш ответа Finnhub
  var FH_MATCH_MIN_SCORE = 0.6;   // порог сходства названия
  var FH_MATCH_MAX_DT = 3 * 3600000;  // окно совпадения по времени

  var BLS_URL = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
  var FAST_RULES = [
    { series: 'CUUR0000SA0',    calc: 'yoy', dp: 1, any: ['cpi yy'], none: ['core'] },
    { series: 'CUSR0000SA0',    calc: 'mom', dp: 1, any: ['cpi mm'], none: ['core'] },
    { series: 'CUUR0000SA0L1E', calc: 'yoy', dp: 1, any: ['core cpi yy'] },
    { series: 'CUSR0000SA0L1E', calc: 'mom', dp: 1, any: ['core cpi mm'] }
  ];
  var FAST_WINDOW_MS   = 6 * 3600000;   // сколько часов после релиза ждём факт
  var FAST_POLL_MS     = 60000;         // как часто дёргаем быстрый канал
  var FAST_CACHE_MS    = 10 * 60000;    // кэш серии BLS (значение внутри дня не меняется)
  var FAST_DAILY_LIMIT = 40;            // жёсткий дневной бюджет запросов к BLS (лимит v1 — 50/IP)
  var HOT_POLL_MS      = 60000;         // основной фид в «горячем» окне после релиза
  var FETCH_WATCHDOG_MS = 20000;        // защита от залипшего state.fetching

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

  // =====================================================================
  // [EC-OVERLAY] СОБЫТИЯ, КОТОРЫХ НЕТ В ФИДЕ TradingView/Reuters
  // ---------------------------------------------------------------------
  // Проверено 2026-10-27 на живом API (US/RU/EU/GB/JP/CN, 45 дней, 456
  // событий): источник НЕ отдаёт
  //   • минутки FOMC (FOMC Minutes) — ни одного события за 45 дней;
  //   • Beige Book — ни одного;
  //   • выступления глав ЦБ — ни одного;
  //   • недельную инфляцию Росстата (главный оперативный индикатор для RUB/ОФЗ);
  //   • по России вообще всего ~10 уникальных индикаторов за полтора месяца.
  // Эти события критичны для торговли, поэтому они зашиты отдельным слоем —
  // по тому же принципу, что и график заседаний ЦБ РФ (CBR_MEETINGS).
  // Даты заседаний ФРС — официальные, с federalreserve.gov/monetarypolicy/
  // fomccalendars.htm; минутки считаем по правилу самого ФРС (через 3 недели
  // после решения), а Beige Book берём ТОЛЬКО из официального графика
  // (publications/beige-book-default.htm): формулой «−14 дней от заседания»
  // он не считается — выпуск 25.11.2026 выходит ПОСЛЕ заседания 27–28.10.
  // Недельная инфляция Росстата — каждая среда 16:00 МСК; такие события
  // помечаются tentative: время типовое, в праздничные недели релиза нет.
  // =====================================================================
  var FED_LINK = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
  var FED_BEIGE_LINK = 'https://www.federalreserve.gov/monetarypolicy/publications/beige-book-default.htm';
  var ROSSTAT_LINK = 'https://rosstat.gov.ru/folder/313/event';

  /** n-й заданный день недели месяца (для расчёта границ DST в США). */
  function nthWeekday(year, month, weekday, n) {
    var first = new Date(Date.UTC(year, month, 1));
    var shift = (weekday - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(year, month, 1 + shift + (n - 1) * 7));
  }

  /** Смещение США Eastern в минутах от UTC для конкретной даты (EST −300 / EDT −240). */
  function usEastOffsetMin(d) {
    var y = d.getUTCFullYear();
    var start = nthWeekday(y, 2, 0, 2);   // 2-е воскресенье марта
    var end = nthWeekday(y, 10, 0, 1);    // 1-е воскресенье ноября
    return (d >= start && d < end) ? -240 : -300;
  }

  /**
   * Дата+время в США Eastern → ISO-строка в UTC.
   * etDate: 'YYYY-MM-DD', etHour: часы по местному времени Вашингтона/Нью-Йорка.
   */
  function etToIso(etDate, etHour) {
    var p = String(etDate).split('-');
    // [EC-OVERLAY] etHour может быть дробным (14.5 = 14:30 — пресс-конференция
    // ФРС начинается через полчаса после заявления). Date.UTC() дробные часы
    // отбрасывает, поэтому минуты считаем отдельно.
    var h = Math.floor(etHour);
    var m = Math.round((etHour - h) * 60);
    var naive = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], h, m, 0));
    var d = new Date(naive.getTime() - usEastOffsetMin(naive) * 60000);
    return d.toISOString().replace('.000', '');
  }

  // Заседания FOMC 2025–2027.
  //   start/end — дни заседания (решение объявляется во второй день, 14:00 ET);
  //   sep       — заседание с Summary of Economic Projections и dot plot
  //               (в эти дни добавляется отдельное событие «пресс-конференция»);
  //   beige     — ДАТА ВЫХОДА Beige Book, привязанная к заседанию.
  // Источник: federalreserve.gov/monetarypolicy/fomccalendars.htm (график
  // заседаний и минутки) и .../publications/beige-book-default.htm (Beige Book).
  // Решение 28.10.2026 дополнительно сверено с живым фидом Reuters — 18:00Z.
  //
  // ⚠ Beige Book НЕЛЬЗЯ считать формулой «−14 дней от заседания»: в 2026 году
  //   официальные даты — 14.01, 04.03, 15.04, 03.06, 15.07, 02.09, 14.10 и
  //   25.11 (ноябрьский выходит ПОСЛЕ заседания 27–28.10, а не до декабрьского).
  // TODO: ФРС публикует график на следующий год в июне, а даты Beige Book —
  //       в декабре; обновляйте FOMC_MEETINGS и BEIGE_BOOK_DATES.
  var FOMC_MEETINGS = [
    { start: '2025-01-28', end: '2025-01-29' },
    { start: '2025-03-18', end: '2025-03-19', sep: true },
    { start: '2025-05-06', end: '2025-05-07' },
    { start: '2025-06-17', end: '2025-06-18', sep: true },
    { start: '2025-07-29', end: '2025-07-30' },
    { start: '2025-09-16', end: '2025-09-17', sep: true },
    { start: '2025-10-28', end: '2025-10-29' },
    { start: '2025-12-09', end: '2025-12-10', sep: true },
    { start: '2026-01-27', end: '2026-01-28', beige: '2026-01-14' },
    { start: '2026-03-17', end: '2026-03-18', sep: true, beige: '2026-03-04' },
    { start: '2026-04-28', end: '2026-04-29', beige: '2026-04-15' },
    { start: '2026-06-16', end: '2026-06-17', sep: true, beige: '2026-06-03' },
    { start: '2026-07-28', end: '2026-07-29', beige: '2026-07-15' },
    { start: '2026-09-15', end: '2026-09-16', sep: true, beige: '2026-09-02' },
    { start: '2026-10-27', end: '2026-10-28', beige: '2026-10-14' },
    { start: '2026-12-08', end: '2026-12-09', sep: true, beige: '2026-11-25' },
    { start: '2027-01-26', end: '2027-01-27' },
    { start: '2027-03-16', end: '2027-03-17', sep: true },
    { start: '2027-05-04', end: '2027-05-05' },
    { start: '2027-06-15', end: '2027-06-16', sep: true },
    { start: '2027-07-27', end: '2027-07-28' },
    { start: '2027-09-14', end: '2027-09-15', sep: true },
    { start: '2027-10-26', end: '2027-10-27' },
    { start: '2027-12-14', end: '2027-12-15', sep: true }
  ];

  /** Прибавить/вычесть дни к 'YYYY-MM-DD', вернуть 'YYYY-MM-DD'. */
  function shiftDateStr(dateStr, days) {
    var p = String(dateStr).split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() + days);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function fomcEvents() {
    var out = [];
    FOMC_MEETINGS.forEach(function (m) {
      var sepNote = m.sep ? '; публикуются экономические прогнозы (SEP) и dot plot' : '';
      // 1) Решение по ставке + заявление (14:00 по времени США Eastern)
      out.push({
        date: etToIso(m.end, 14), country: 'US', name: 'FOMC: решение по ставке (заявление)',
        note: 'Заявление в 14:00 ET' + (m.sep ? ', пресс-конференция главы ФРС в 14:30 ET' + sepNote : ''),
        unit: '% годовых', source: 'Federal Reserve', link: FED_LINK, src: 'fomc'
      });
      // 2) Пресс-конференция главы ФРС — начинается через 30 минут после
      //    заявления. На опорных заседаниях (sep) к ней добавляются прогнозы
      //    SEP и dot plot, поэтому это отдельное, более сильное событие.
      out.push({
        date: etToIso(m.end, 14.5), country: 'US',
        name: m.sep ? 'ФРС: пресс-конференция и прогнозы (SEP)' : 'ФРС: пресс-конференция',
        note: 'Начало в 14:30 ET, через 30 минут после заявления' + sepNote,
        unit: '', source: 'Federal Reserve', link: FED_LINK, src: 'fomc'
      });
      // 3) Beige Book — только по ОФИЦИАЛЬНОЙ дате ФРС (14:00 ET).
      //    Формулой «−14 дней от заседания» его считать нельзя: в 2026-м
      //    ноябрьский выпуск (25.11) выходит после заседания 27–28.10.
      if (m.beige) {
        out.push({
          date: etToIso(m.beige, 14), country: 'US', name: 'ФРС: Beige Book («Бежевая книга»)',
          note: 'Обзор состояния экономики по 12 округам; выходит 8 раз в год, обычно за 2 недели до заседания ФРС. Дата — по официальному графику ФРС.',
          unit: '', source: 'Federal Reserve', link: FED_BEIGE_LINK, src: 'fomc'
        });
      }
      // 4) Минутки — через 3 недели после решения (правило ФРС, среда 14:00 ET)
      out.push({
        date: etToIso(shiftDateStr(m.end, 21), 14), country: 'US', name: 'FOMC Minutes (протокол заседания)',
        note: 'Протокол заседания от ' + m.end + '; выходит через 3 недели после решения. Дату ФРС иногда сдвигает на день из-за праздников.',
        unit: '', source: 'Federal Reserve', link: FED_LINK, src: 'fomc', tentative: true
      });
    });
    return out;
  }

  /**
   * Недельная оценка инфляции Росстата: каждая среда, 16:00 МСК (13:00 UTC).
   * Релиза нет в первую неделю января и в длинные новогодние каникулы —
   * эти даты пропускаем. Событие помечается tentative (время типовое).
   */
  function rosstatWeeklyCpiEvents(fromTs, toTs) {
    var out = [];
    var d = new Date(fromTs);
    d.setUTCHours(13, 0, 0, 0);
    while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);   // ближайшая среда
    var end = new Date(toTs);
    while (d <= end) {
      var jan1to8 = d.getUTCMonth() === 0 && d.getUTCDate() <= 8;
      if (!jan1to8) {
        out.push({
          date: d.toISOString().replace('.000', ''), country: 'RU',
          name: 'Россия: недельная инфляция (Росстат)',
          note: 'Оценка ИПЦ за неделю с предыдущего вторника. Время типовое — 16:00 МСК; ' +
                'в праздничные недели релиз может не выходить.',
          unit: '% к предыдущей неделе', source: 'Росстат', link: ROSSTAT_LINK,
          src: 'rosstat', tentative: true
        });
      }
      d = new Date(d.getTime() + 7 * 86400000);
    }
    return out;
  }

  /**
   * [EC-OVERLAY] Склеивает события из фида и из курируемого слоя и убирает
   * дубли: если источник уже отдал событие на то же время (±15 мин), оставляем
   * ЕГО — там есть прогноз/предыдущее значение, которых нет в нашем слое.
   */
  function mergeOverlay(feedEvents, overlayEvents) {
    var kept = [];
    var takenBySrc = {};   // страна|бакет15мин -> true
    feedEvents.forEach(function (e) {
      kept.push(e);
      if (!e || !e.ts) return;
      takenBySrc[e.country + '|' + Math.round(e.ts / 900000)] = true;
    });
    overlayEvents.forEach(function (e) {
      if (!e || !e.ts) return;
      var b = Math.round(e.ts / 900000);
      var k1 = e.country + '|' + b, k2 = e.country + '|' + (b - 1), k3 = e.country + '|' + (b + 1);
      if (takenBySrc[k1] || takenBySrc[k2] || takenBySrc[k3]) return;   // уже есть из источника
      takenBySrc[k1] = true;
      kept.push(e);
    });
    return kept;
  }

  var COUNTRY_META = {
    US: { flag: '🇺🇸', name: 'США' },
    RU: { flag: '🇷🇺', name: 'Россия' },
    EU: { flag: '🇪🇺', name: 'Еврозона' },
    GB: { flag: '🇬🇧', name: 'Великобритания' },
    CN: { flag: '🇨🇳', name: 'Китай' },
    JP: { flag: '🇯🇵', name: 'Япония' }
  };

  // =====================================================================
  // [EC-IMP] ВАЖНОСТЬ СОБЫТИЙ — почему её нельзя брать из API как есть
  // ---------------------------------------------------------------------
  // ОШИБКА, ИЗ-ЗА КОТОРОЙ ПРОПАДАЛИ ГЛАВНЫЕ СОБЫТИЯ:
  // Reuters/TradingView отдаёт importance = 0 | 1 | 2, где 2 — САМОЕ важное
  // (FOMC, NFP). Код же считал «высокой» только importance === 1, а всё
  // остальное сваливал в «средние» через `importance === 1 ? 1 : 0`.
  // В результате:
  //   • FOMC Decision Fed Funds Tgt Rate (importance=2) → «средние» →
  //     для США чип «Средние» по умолчанию ВЫКЛЮЧЕН → заседание ФРС не
  //     показывалось вообще;
  //   • Non-Farm Payrolls (importance=2) → то же самое;
  //   • API в принципе размечает важность непредсказуемо: GDP Advance,
  //     Core PCE, Consumer Confidence, Durable Goods, Chicago PMI, U Mich,
  //     Average Earnings, Housing Starts приходят с importance=0, а у
  //     России importance=0 почти ВСЁ (CPI, розница, безработица, ВВП).
  //     За 45 дней по US/RU/EU/GB/JP/CN из 456 событий «высоких» было 4.
  //
  // ЧТО СДЕЛАНО:
  //   1) importance API нормализуется в 3 уровня: 2 = высокая, 1 = средняя,
  //      0 = низкая (больше ничего не теряется при приведении);
  //   2) сверху накладывается КУРИРУЕМЫЙ СПИСОК IMP_RULES: известные
  //      рыночно-значимые релизы принудительно поднимаются до высокой/средней
  //      важности независимо от того, что прислал API;
  //   3) мусор (аукционы Treasuries, MBA-ставки, буровые, экспортные продажи
  //      свинины, недельные резервы ЦБ) принудительно опускается в «низкую»,
  //      чтобы не тонуть в 60 строках технического шума;
  //   4) интерфейс НЕ менялся: два чипа на страну, 🔴 Высокие / 🟠 Средние.
  //      Ключ «Высокие» теперь управляет уровнем 2, «Средние» — уровнем 1;
  //      уровень 0 (технический шум) не показывается ни при каких настройках.
  //      По умолчанию включены только «Высокие».
  //
  // Проверено 2026-10-27 на живом API (US/RU, 7 и 45 дней):
  //   было видно: 2 события из 76 (неделя US+RU)
  //   стало видно: FOMC 28.10, Initial Jobless Clm, GDP Advance, Core PCE,
  //                Consumer Confidence, Durable Goods, Case-Shiller, EIA,
  //                RU: розница/зарплаты/безработица/ВВП + ставка ЦБ РФ
  // =====================================================================
  var IMP_TIERS = {
    2: { key: '2', label: 'Высокие', short: 'высокая', dot: 'ecw-dot-high', emoji: '🔴', title: 'Высокая важность — двигает рынок' },
    1: { key: '1', label: 'Средние', short: 'средняя', dot: 'ecw-dot-med',  emoji: '🟠', title: 'Средняя важность — заметная реакция' },
    0: { key: '0', label: 'Низкие',  short: 'низкая',  dot: 'ecw-dot-low',  emoji: '⚪', title: 'Низкая важность — технический фон/шум' }
  };

  // ---------------------------------------------------------------------
  // 🔴 ВЫСОКАЯ важность — ТОЛЬКО ЭТО показывается по умолчанию.
  //
  // Режим «только высокие» обязывает держать список коротким и честным:
  // сюда входят релизы, на которые рынок реально реагирует (ставка и ФРС,
  // занятость, инфляция, ВВП, розница, деловая активность). Всё остальное —
  // жильё, запасы нефти, вторичные компоненты, региональные индексы —
  // осознанно отправлено в «средние» и включается чипом.
  // Список курируется вручную, потому что оценка Reuters ненадёжна (см. [EC-IMP]).
  // Подстроки в нижнем регистре, сравнение по name.toLowerCase().
  // ---------------------------------------------------------------------
  var IMP_HIGH = [
    // ---------- США: ФРС ----------
    { c: 'US', m: ['fomc', 'fed funds', 'interest rate decision', 'fed interest rate',
                   'int on excess reserves', 'press conference', 'powell', 'fed chair',
                   'federal reserve', 'fomc minutes', 'monetary policy report',
                   'beige book', 'beige', 'treasury refunding', 'quarterly refunding'] },
    // ---------- США: занятость ----------
    { c: 'US', m: ['non-farm payrolls', 'nonfarm payrolls', 'payrolls', 'unemployment rate',
                   // в фиде заявки называются «Initial Jobless Clm *» — матчим и сокращение
                   'initial jobless', 'jobless clm', 'jobless claims', 'initial claims',
                   'employment cost', 'average earnings', 'average hourly earnings',
                   'nonfarm productivity', 'unit labor costs', 'jolts',
                   'adp national employment', 'challenger job'] },
    // ---------- США: инфляция ----------
    { c: 'US', m: ['cpi', 'ppi', 'pce', 'personal consumption expenditures',
                   'import prices', 'export prices', 'employment wages'] },
    // ---------- США: рост, потребитель, деловая активность ----------
    { c: 'US', m: ['gdp', 'retail sales', 'consumer confidence', 'u mich',
                   'ism manufacturing', 'ism mfg', 'ism n-mfg', 'ism services',
                   'ism non-manufacturing', 's&p global comp pmi', 's&p global mfg pmi',
                   's&p global svcs pmi', 's&p global services pmi', 'personal income',
                   'personal spending', 'industrial production'] },

    // ---------- Россия ----------
    { c: 'RU', m: ['cpi', 'инфляци', 'gdp', 'ввп', 'retail sales', 'розничн', 'unemployment',
                   'безработиц', 'industrial output', 'industrial production', 'промышленн',
                   'trade balance', 'внешняя торговл', 'foreign trade', 'budget', 'бюджет',
                   'key rate', 'ключевой ставк', 'cbr', 'цб рф', 'fx intervention', 'интервенц',
                   'pmi', 's&p global', 'consumer confidence', 'потребительск',
                   'comprehensive risk', 'о чем говорят тренды', 'monetary policy',
                   'денежно-кредитн', 'gross domestic product'] },

    // ---------- Еврозона / Великобритания / Япония / Китай (если включены) ----------
    { c: 'EU', m: ['ecb', 'deposit facility', 'refinancing rate', 'marginal lending', 'lagarde',
                   'cpi', 'hicp', 'gdp', 'unemployment', 'ifo', 'zew', 'sentix',
                   'pmi flash', 'pmi prelim'] },
    { c: 'GB', m: ['boe', 'bank of england', 'rate decision', 'monetary policy', 'bailey',
                   'cpi', 'gdp', 'unemployment', 'claimant count', 'retail sales',
                   'pmi flash', 'pmi prelim', 'average earnings'] },
    { c: 'JP', m: ['boj', 'bank of japan', 'rate decision', 'outlook report', 'ueda',
                   'cpi', 'gdp', 'tankan', 'trade balance', 'pmi flash', 'pmi prelim',
                   'wage growth', 'household spending', 'machine orders', 'core orders'] },
    { c: 'CN', m: ['lpr', 'mlf', 'pboc', 'cpi', 'ppi', 'gdp', 'pmi', 'trade balance', 'exports',
                   'imports', 'industrial production', 'retail sales', 'fixed asset',
                   'foreign reserves', 'new yuan loans', 'social financing', 'caixin'] }
  ];

  // ---------------------------------------------------------------------
  // 🟠 СРЕДНЯЯ важность: регулярно публикуется, реакция умеренная.
  // По умолчанию ВЫКЛЮЧЕНА — включается чипом «Средние».
  // Сюда осознанно отправлены релизы, которые источник иногда помечает высоко,
  // и второстепенные данные: жильё (включая Building Permits — Reuters отдаёт
  // его с importance=1), Case-Shiller, запасы EIA, региональные индексы ФРБ,
  // финальные значения PMI, компоненты PCE.
  // Правило medHit поднимает уровень до 1, но НЕ опускает то, что источник
  // уже оценил как 2 (Math.max(1, base)).
  // ---------------------------------------------------------------------
  var IMP_MED = [
    { c: 'US', m: ['s&p global', 'pmi', 'ism', 'ism n-mfg bus act', 'pending sales',
                   'pending home', 'exist. home sales', 'existing home', 'new home sales',
                   'michigan', 'consumer sentiment',
                   'eia', 'crude', 'nat gas', 'natural gas',
                   'export sales', 'job openings', 'workweek', 'real weekly earnings',
                   'retail ex', 'construction spending', 'auto sales', 'car sales',
                   'truck sales', 'business inventories', 'treasury international capital',
                   'tic', 'continuing claims', 'jobless',
                   'budget balance', 'federal budget', 'cpi index', 'cpi mm nsa',
                   'cpi wage earner', 'durable goods', 'factory orders',
                   'building permits', 'build permits', 'housing starts', 'house starts',
                   'case-shiller', 'caseshiller', 'leading index', 'leap',
                   'wholesale inventories', 'retail inventories', 'consumer credit',
                   'capacity utilization', 'trade balance', 'international trade',
                   'goods trade balance', 'philly fed', 'empire state', 'richmond fed',
                   'dallas fed', 'chicago pmi', 'kansas city fed', 'tiaa',
                   'labor force partic'] },
    { c: 'RU', m: ['reserves', 'резерв', 'money supply', 'денежная масса', 'gold', 'золото',
                   'deposits', 'депозит', 'loans', 'кредит', 'inflation expectation',
                   'инфляционные ожидани', 'pmi', 's&p global', 'trade', 'торговл',
                   'consumer', 'потребительск', 'cpi', 'real wages', 'зарплат', 'ppi',
                   'цен производителей'] },
    { c: 'EU', m: ['pmi', 'ppi', 'retail sales', 'industrial production', 'construction', 'm3',
                   'trade balance', 'wage', 'loan', 'economic sentiment', 'business climate',
                   'consumer confidence', 'current account'] },
    { c: 'GB', m: ['pmi', 'ppi', 'industrial production', 'construction', 'm4', 'trade balance',
                   'wage', 'mortgage', 'house price', 'consumer credit', 'gfk', 'cbi',
                   'public sector'] },
    { c: 'JP', m: ['pmi', 'industrial production', 'retail sales', 'current account',
                   'labor cash', 'tertiary industry', 'coincident index', 'leading index',
                   'consumer confidence'] },
    { c: 'CN', m: ['house price', 'property', 'industrial profits', 'm2', 'loan', 'urban survey',
                   'foreign investment', 'budget'] }
  ];

  // ---------------------------------------------------------------------
  // ⚪ НИЗКАЯ важность: технический шум. Именно он раньше забивал список
  // (60+ строк аукционов Treasuries за неделю). Проверяется ПЕРЕД повышением.
  // ---------------------------------------------------------------------
  var IMP_LOW = [
    { m: ['auc -', 'auc-', 'bill auc', 'note auc', 'bond auc', 'tips auc', 'frn', 'bid-to-cover',
          'bid to cover', 'total accepted', 'high yield', 'tail ratio'] },
    { m: ['mba 5-yr', 'mba 15-yr', 'mba ', 'pork export', 'bean oil', 'poultry output',
          'wsd-', 'ethanol', 'weekly ner pulse', 'adp weekly'] },
    // [EC-IMP] еженедельные резервы ЦБ РФ выходят каждый четверг и рынок не
    // двигают; без этого правила они поднимались до «средних» по слову reserves.
    { m: ['cbank wkly reserves', 'weekly reserves', 'недельные резервы', 'международные резервы'] }
  ];

  /** Первая подходящая подстрока из списка правил (правила вида {c, m}). */
  function impMatch(rules, name, country) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.c && r.c !== country) continue;
      for (var j = 0; j < r.m.length; j++) {
        if (name.indexOf(r.m[j]) !== -1) return r.m[j];
      }
    }
    return null;
  }

  /**
   * [EC-IMP] Нормализация важности одного события.
   * @param  {number} apiImp  importance из API (0|1|2, изредка больше)
   * @param  {string} name    название индикатора
   * @param  {string} country код страны (US/RU/...)
   * @param  {string} src     'tv' | 'cbr' | 'demo'
   * @return {{imp:number, raw:number, boosted:boolean, why:string}}
   */
  function normalizeImportance(apiImp, name, country, src) {
    var raw = Number(apiImp);
    if (!isFinite(raw)) raw = 0;
    // [EC-IMP] защита от «шкалы в другую сторону»: больше 2 не бывает ни у кого,
    // а вот 2 у Reuters — это максимум. Всё, что выше, просто прижимаем к 2.
    var base = raw > 2 ? 2 : (raw < 0 ? 0 : raw);
    var n = String(name || '').toLowerCase();

    if (src === 'cbr') return { imp: 2, raw: raw, boosted: false, why: 'заседание ЦБ РФ — встроенный источник' };

    var lowHit = impMatch(IMP_LOW, n, country);
    if (lowHit) return { imp: 0, raw: raw, boosted: base > 0, why: 'технический релиз («' + lowHit + '»)' };

    var highHit = impMatch(IMP_HIGH, n, country);
    if (highHit) return { imp: 2, raw: raw, boosted: base < 2, why: 'значимый релиз («' + highHit + '»)' };

    var medHit = impMatch(IMP_MED, n, country);
    if (medHit) return { imp: Math.max(1, base), raw: raw, boosted: base < 1, why: 'регулярный индикатор («' + medHit + '»)' };

    return { imp: base, raw: raw, boosted: false, why: 'по оценке источника' };
  }

  /** Применил ли куратор важный релиз, который API недооценил. */
  function isBoosted(ev) { return !!(ev && ev.impBoosted); }

  // Фильтры по умолчанию: [EC-IMP] показываем ТОЛЬКО ВЫСОКУЮ важность —
  // как в привычном календаре, где «красные» события и есть весь календарь.
  // Средние и низкие доступны чипами, но по умолчанию выключены, чтобы список
  // не раздувался до 40 строк в неделю.
  //
  // ⚠ Важно: это безопасно только потому, что сама разметка важности
  // исправлена. Раньше «высокими» считались события с importance === 1, а FOMC
  // и NFP приходили с importance === 2 и пропадали. Теперь высокая важность
  // назначается курируемым списком IMP_HIGH, поэтому режим «только высокие»
  // действительно показывает все значимые релизы.
  var DEFAULT_FILTERS = {
    'US:2': true,  'US:1': false, 'US:0': false,
    'RU:2': true,  'RU:1': false, 'RU:0': false,
    'EU:2': true,  'EU:1': false, 'EU:0': false,
    'GB:2': true,  'GB:1': false, 'GB:0': false,
    'JP:2': true,  'JP:1': false, 'JP:0': false,
    'CN:2': true,  'CN:1': false, 'CN:0': false
  };

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
    { m: ['фрс: пресс-конференция'], c: 'US', ru: 'Пресс-конференция главы ФРС', desc: 'Пресс-конференция председателя ФРС — начинается через 30 минут после публикации заявления, в 14:30 по времени США Eastern. Часто двигает рынок сильнее самого решения: важны тон и формулировки об инфляции, занятости и готовности менять ставку. Волатильность может разворачиваться по ходу выступления, особенно на вопросах о сроках следующего шага.' },
    { m: ['fed '], ru: 'Выступление представителя ФРС', desc: 'Выступление члена ФРС (голосующего или главы регионального банка). Рынок ищет намёки на будущие решения по ставке — особенно значимы выступления в «период тишины» перед FOMC и на фоне спорных данных.' },
    // [EC-OVERLAY] этих событий нет в фиде Reuters — добавлены курируемым слоем
    { m: ['fomc minutes', 'fomc: протокол', 'протокол заседания'], c: 'US', ru: 'Протокол заседания FOMC (минутки)', desc: 'Протокол прошедшего заседания ФРС — выходит через три недели после решения, в 14:00 по времени США Eastern. Это самый детальный источник о том, как комитет обсуждал инфляцию, занятость и траекторию ставки: рынок ищет расхождения между членами FOMC и намёки на следующий шаг. Если тон протокола жёстче, чем звучало на пресс-конференции, доллар укрепляется, акции и крипто под давлением; мягче — наоборот. Волатильность обычно ниже, чем в день решения, но на спорных заседаниях минутки двигают рынок заметно.' },
    { m: ['beige book', 'бежевая книга'], c: 'US', ru: 'Beige Book («Бежевая книга») ФРС', desc: 'Сводный обзор состояния экономики США по 12 федеральным округам — выходит за две недели до каждого заседания FOMC, в 14:00 ET. Составляется на основе опросов бизнеса, банков и экспертов, поэтому даёт «живую» картину: занятость, цены, потребительские расходы, промышленность, недвижимость. Формально это не статистика, но формулировки об инфляционном давлении и замедлении найма напрямую влияют на ожидания по ставке.' },
    { m: ['fomc: решение', 'fomc: решение по ставке'], c: 'US', ru: 'Решение ФРС по ставке (заявление FOMC)', desc: 'Заявление Федерального комитета по открытым рынкам — публикуется в 14:00 по времени США Eastern в последний день заседания. Главное событие для всех мировых рынков: меняется федеральная ставка, а формулировки об инфляции и занятости задают траекторию ожиданий. На опорных заседаниях (март, июнь, сентябрь, декабрь) одновременно выходят экономические прогнозы SEP с dot plot, а в 14:30 ET начинается пресс-конференция председателя — она часто разворачивает движение, начатое заявлением.' },
    { m: ['фрс: пресс-конференция и прогнозы', 'прогнозы (sep)'], c: 'US', ru: 'Пресс-конференция ФРС и прогнозы SEP', desc: 'Пресс-конференция председателя ФРС через 30 минут после заявления плюс обновлённые экономические прогнозы (Summary of Economic Projections) с точечным графиком ожиданий по ставке (dot plot). Рынок сравнивает dot plot с текущими ценами фьючерсов на ставку: сдвиг медианы даже на один шаг меняет доходности, доллар и рисковые активы. Ответы на вопросы о сроках снижения/повышения ставки двигают рынок сильнее самого решения.' },
    { m: ['недельная инфляция'], c: 'RU', ru: 'Недельная инфляция в России (Росстат)', desc: 'Еженедельная оценка индекса потребительских цен Росстата — выходит по средам в 16:00 МСК и охватывает период с предыдущего вторника. Самый оперативный индикатор инфляции в России: именно на недельные цифры смотрит Банк России при решении по ключевой ставке, и именно они задают динамику рубля и ОФЗ между месячными релизами. Ускорение недельного роста цен (особенно выше 0,15–0,20% в неделю) усиливает ожидания жёсткой политики ЦБ — поддержка рублю и давление на акции и длинные ОФЗ; замедление — наоборот. В первую неделю января и в длинные праздники релиз не выходит.' },

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
    _lastScroll: null,
    // [EC-FAST] факты из быстрого канала: evId -> { value, src, at }
    // Хранятся ОТДЕЛЬНО от state.all, потому что fetchData() каждый раз
    // пересоздаёт массив событий, и проставленный actual в нём бы терялся.
    fastFacts: {},
    _blsCache: {},        // seriesId -> { t, map, latestYm }
    _blsInFlight: {},     // seriesId -> Promise
    _lastFastRun: 0,
    _lastDataTick: 0,
    // [EC-FH] Finnhub
    finnhubKey: null,
    _fhCache: null,
    _fhCacheAt: 0,
    _fhLastRun: 0,
    _fhLastError: null,
    _fhLastApplied: 0,
    _fhRows: 0,
    _fetchStartedAt: 0,
    _refetchQueued: false,
    _visible: true
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

  /** [EC-FAST] время с секундами — чтобы было видно, что обновление живое. */
  function fmtClock(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
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

  // ====================== [EC-FAST] БЫСТРЫЙ КАНАЛ ======================

  /** Короткая подпись источников быстрых фактов для футера. */
  function fastSrcLabel() {
    var seen = {};
    for (var k in state.fastFacts) { if (state.fastFacts[k] && state.fastFacts[k].src) seen[state.fastFacts[k].src] = 1; }
    var names = Object.keys(seen);
    return names.length ? names.join('+') : 'BLS';
  }

  /** Факт, который нужно показать: сначала источник, потом быстрый канал. */
  function effectiveActual(ev) {
    if (ev.actual !== null && ev.actual !== undefined) return ev.actual;
    var ff = state.fastFacts[evId(ev)];
    return ff ? ff.value : null;
  }

  /** Есть ли для события быстрый источник (BLS). */
  function matchFastRule(name) {
    var n = String(name || '').toLowerCase();
    for (var i = 0; i < FAST_RULES.length; i++) {
      var r = FAST_RULES[i];
      var hit = false;
      for (var j = 0; j < r.any.length; j++) { if (n.indexOf(r.any[j]) !== -1) { hit = true; break; } }
      if (!hit) continue;
      var blocked = false;
      if (r.none) { for (var k = 0; k < r.none.length; k++) { if (n.indexOf(r.none[k]) !== -1) { blocked = true; break; } } }
      if (!blocked) return r;
    }
    return null;
  }

  function ymKey(y, m) { return y + '-' + (m < 10 ? '0' + m : '' + m); }

  function shiftYm(ym, delta) {
    var p = ym.split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10) + delta;
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    return ymKey(y, m);
  }

  /** Релиз месяца M публикует данные месяца M-1 (проверено на 32 релизах CPI). */
  function refYmOf(ts) {
    var d = new Date(ts);
    return shiftYm(ymKey(d.getFullYear(), d.getMonth() + 1), -1);
  }

  function calcFromSeries(map, calc, ym, dp) {
    var a = map.get(ym);
    if (a === undefined || a === null) return null;
    var b = map.get(shiftYm(ym, calc === 'yoy' ? -12 : -1));
    if (b === undefined || b === null || !b) return null;
    var v = (a / b - 1) * 100;
    var f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }

  function blsBudgetLeft() {
    var today = new Date();
    var key = ymKey(today.getFullYear(), today.getMonth() + 1) + '-' + today.getDate();
    try {
      var b = JSON.parse(localStorage.getItem(STORAGE_BLS_BUDGET) || 'null');
      if (b && b.date === key) return Math.max(0, FAST_DAILY_LIMIT - (b.used || 0));
    } catch (e) {}
    return FAST_DAILY_LIMIT;
  }

  function blsBudgetSpend(n) {
    var today = new Date();
    var key = ymKey(today.getFullYear(), today.getMonth() + 1) + '-' + today.getDate();
    try {
      var b = JSON.parse(localStorage.getItem(STORAGE_BLS_BUDGET) || 'null');
      var used = (b && b.date === key) ? (b.used || 0) : 0;
      localStorage.setItem(STORAGE_BLS_BUDGET, JSON.stringify({ date: key, used: used + n }));
    } catch (e) {}
  }

  /**
   * Запрос одной серии BLS. Только GET: POST с Content-Type: application/json
   * требует preflight, а OPTIONS на api.bls.gov отвечает 405 БЕЗ CORS-заголовков —
   * браузер такой запрос заблокирует. GET + Accept: application/json является
   * «простым» запросом и проходит (Access-Control-Allow-Origin: *).
   */
  function blsSeries(seriesId) {
    var now = Date.now();
    var cached = state._blsCache[seriesId];
    if (cached && now - cached.t < FAST_CACHE_MS) return Promise.resolve(cached);
    if (state._blsInFlight[seriesId]) return state._blsInFlight[seriesId];
    if (blsBudgetLeft() <= 0) return Promise.resolve(cached || null);

    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
    var p = fetch(BLS_URL + encodeURIComponent(seriesId), {
      headers: { 'Accept': 'application/json' },
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        blsBudgetSpend(1);
        var rows = (((d.Results || {}).series || [])[0] || {}).data || [];
        var map = new Map();
        var latestYm = null;
        rows.forEach(function (x) {
          if (!/^M(0[1-9]|1[0-2])$/.test(x.period)) return;   // только регулярные месяцы
          var ym = x.year + '-' + x.period.slice(1);
          var v = parseFloat(x.value);
          if (!isFinite(v)) return;
          map.set(ym, v);
          if (!latestYm || ym > latestYm) latestYm = ym;
        });
        var entry = { t: Date.now(), map: map, latestYm: latestYm };
        if (map.size) state._blsCache[seriesId] = entry;
        return map.size ? entry : null;
      })
      .catch(function (e) {
        try { console.warn('[EC-FAST] BLS ' + seriesId + ': ' + ((e && e.message) || e)); } catch (x) {}
        return cached || null;
      })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        delete state._blsInFlight[seriesId];
        return res;
      });
    state._blsInFlight[seriesId] = p;
    return p;
  }

  /**
   * Пробует проставить факт из быстрого канала всем событиям, которые вышли
   * не позже FAST_WINDOW_MS назад и до сих пор без actual.
   * Значение принимается, только если BLS уже опубликовал НУЖНЫЙ месяц
   * (latestYm === refYm) — иначе можно показать чужой период.
   */
  function runFastLane() {
    var now = Date.now();
    if (now - state._lastFastRun < FAST_POLL_MS) return Promise.resolve(0);
    state._lastFastRun = now;

    var tasks = [];
    (state.all || []).forEach(function (ev) {
      if (!ev || !ev.ts) return;
      if (ev.actual !== null && ev.actual !== undefined) return;
      if (state.fastFacts[evId(ev)]) return;
      if (!(ev.ts <= now && ev.ts > now - FAST_WINDOW_MS)) return;
      var rule = matchFastRule(ev.name);
      if (!rule) return;
      tasks.push({ ev: ev, rule: rule, refYm: refYmOf(ev.ts) });
    });
    if (!tasks.length) return Promise.resolve(0);

    var wanted = {};
    tasks.forEach(function (t) { wanted[t.rule.series] = true; });
    var ids = Object.keys(wanted);
    if (blsBudgetLeft() <= 0) return Promise.resolve(0);

    return Promise.all(ids.map(blsSeries)).then(function () {
      var applied = 0;
      tasks.forEach(function (t) {
        var entry = state._blsCache[t.rule.series];
        if (!entry || !entry.map) return;
        // месяц ещё не опубликован — ждём следующего круга
        if (entry.latestYm !== t.refYm) return;
        var v = calcFromSeries(entry.map, t.rule.calc, t.refYm, t.rule.dp);
        if (v === null || !isFinite(v)) return;
        state.fastFacts[evId(t.ev)] = { value: v, src: 'BLS', at: Date.now(), period: t.refYm };
        applied++;
      });
      if (applied) {
        console.log('[EC-FAST] факт получен из BLS для ' + applied + ' событ(ия/ий)');
        saveCache();
        render();
      }
      return applied;
    }).catch(function (e) {
      try { console.warn('[EC-FAST] ' + ((e && e.message) || e)); } catch (x) {}
      return 0;
    });
  }

  // ======================= [EC-FH] КАНАЛ FINNHUB =======================

  function getFinnhubKey() {
    if (state.finnhubKey) return state.finnhubKey;
    try { state.finnhubKey = localStorage.getItem(STORAGE_FH_KEY) || ''; } catch (e) { state.finnhubKey = ''; }
    return state.finnhubKey;
  }

  function setFinnhubKey(key) {
    state.finnhubKey = String(key || '').trim();
    try {
      if (state.finnhubKey) localStorage.setItem(STORAGE_FH_KEY, state.finnhubKey);
      else localStorage.removeItem(STORAGE_FH_KEY);
    } catch (e) {}
    state._fhCache = null; state._fhCacheAt = 0; state._fhLastRun = 0; state._fhLastError = null;
    // [EC-FH] возвращаем промис: setFinnhubKey('xxx').then(n => ...) — сколько
    // фактов проставилось. Без ключа просто перерисовываем виджет.
    if (state.finnhubKey) return runFinnhubLane();
    render();
    return Promise.resolve(0);
  }

  function ymd(d) {
    return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) +
           '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  /** Finnhub отдаёт либо ISO-строку, либо epoch-секунды. */
  function fhTime(v) {
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
    var t = Date.parse(v);
    if (!isNaN(t)) return t;
    var n = parseFloat(v);
    return isFinite(n) ? (n < 1e11 ? n * 1000 : n) : NaN;
  }

  var FH_COUNTRY_ALIASES = {
    'united states': 'US', 'usa': 'US', 'us': 'US', 'russia': 'RU', 'ru': 'RU',
    'euro area': 'EU', 'eurozone': 'EU', 'eu': 'EU', 'united kingdom': 'GB', 'uk': 'GB', 'gb': 'GB',
    'china': 'CN', 'cn': 'CN', 'japan': 'JP', 'jp': 'JP', 'germany': 'DE', 'de': 'DE'
  };

  function fhCountry(v) {
    var s = String(v || '').trim().toLowerCase();
    if (FH_COUNTRY_ALIASES[s]) return FH_COUNTRY_ALIASES[s];
    return s.length >= 2 ? s.slice(0, 2).toUpperCase() : '';
  }

  function fhNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.,\-+]/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  var FH_STOPWORDS = { the: 1, of: 1, for: 1, in: 1, a: 1, an: 1, and: 1, sa: 1, nsa: 1, mom: 1, yoy: 1, mm: 1, yy: 1, qoq: 1, ms: 1 };

  function fhTokens(name) {
    return String(name || '').toLowerCase()
      .replace(/[^a-z0-9а-яё ]+/gi, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').filter(function (w) { return w.length >= 2 && !FH_STOPWORDS[w]; });
  }

  /** «clm» ~ «claims», «jobless» = «jobless»: совпадение по префиксу от 3 символов. */
  function fhTokEq(a, b) {
    if (a === b) return true;
    if (a.length < 3 || b.length < 3) return false;
    return a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  function fhNameScore(a, b) {
    var ta = fhTokens(a), tb = fhTokens(b);
    if (!ta.length || !tb.length) return 0;
    var hit = 0;
    ta.forEach(function (w) {
      for (var i = 0; i < tb.length; i++) { if (fhTokEq(w, tb[i])) { hit++; break; } }
    });
    return hit / Math.max(ta.length, tb.length);
  }

  function fetchFinnhub() {
    var now = Date.now();
    if (state._fhCache && now - state._fhCacheAt < FH_CACHE_MS) return Promise.resolve(state._fhCache);
    var key = getFinnhubKey();
    if (!key) return Promise.resolve(null);

    var url = FINNHUB_URL + '?from=' + ymd(new Date(now - 86400000)) +
              '&to=' + ymd(new Date(now + 86400000)) + '&token=' + encodeURIComponent(key);
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
    return fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('ключ отклонён (HTTP ' + r.status + ')');
        if (r.status === 429) throw new Error('лимит запросов Finnhub (HTTP 429)');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var rows = Array.isArray(data) ? data
          : (data && (data.result || data.data || data.events || data.calendar)) || [];
        if (!Array.isArray(rows)) rows = [];
        state._fhCache = rows;
        state._fhCacheAt = Date.now();
        state._fhRows = rows.length;
        state._fhLastError = rows.length ? null : 'пустой ответ: ' + JSON.stringify(data).slice(0, 200);
        if (!rows.length) {
          try { console.warn('[EC-FH] Finnhub вернул пусто. Ключ вставлен? Ответ: ' + state._fhLastError); } catch (e) {}
        }
        return rows;
      })
      .catch(function (e) {
        state._fhLastError = (e && e.message) || String(e);
        try { console.warn('[EC-FH] Finnhub: ' + state._fhLastError); } catch (x) {}
        return state._fhCache;
      })
      .then(function (res) { if (timer) clearTimeout(timer); return res; });
  }

  /**
   * Ищет в ответе Finnhub строку, соответствующую событию: та же страна,
   * время в пределах FH_MATCH_MAX_DT, похожее название. Спорные совпадения
   * отбрасываются — неверная цифра хуже прочерка.
   */
  function fhFindFor(ev, rows) {
    var best = null, bestScore = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r) continue;
      var actual = fhNum(r.actual !== undefined ? r.actual : (r.value !== undefined ? r.value : r.a));
      if (actual === null) continue;
      var t = fhTime(r.time || r.date || r.timestamp);
      if (!isFinite(t) || Math.abs(t - ev.ts) > FH_MATCH_MAX_DT) continue;
      var c = fhCountry(r.country || r.region || r.c);
      if (c && ev.country && c !== ev.country) continue;
      var name = r.event || r.name || r.indicator || r.title || '';
      var sc = fhNameScore(ev.name, name);
      if (sc < FH_MATCH_MIN_SCORE) continue;
      if (sc > bestScore) { bestScore = sc; best = { row: r, score: sc, value: actual, name: name }; }
    }
    return best;
  }

  function runFinnhubLane() {
    var key = getFinnhubKey();
    if (!key) return Promise.resolve(0);
    var now = Date.now();
    if (now - state._fhLastRun < FAST_POLL_MS) return Promise.resolve(0);
    state._fhLastRun = now;

    var targets = [];
    (state.all || []).forEach(function (ev) {
      if (!ev || !ev.ts) return;
      if (effectiveActual(ev) !== null) return;
      if (!(ev.ts <= now && ev.ts > now - FAST_WINDOW_MS)) return;
      targets.push(ev);
    });
    if (!targets.length) return Promise.resolve(0);

    return fetchFinnhub().then(function (rows) {
      if (!rows || !rows.length) return 0;
      var applied = 0;
      targets.forEach(function (ev) {
        var m = fhFindFor(ev, rows);
        if (!m) return;
        state.fastFacts[evId(ev)] = {
          value: m.value, src: 'Finnhub', at: Date.now(),
          period: String(m.row.time || m.row.date || '').slice(0, 10),
          score: Math.round(m.score * 100) / 100, matched: m.name
        };
        applied++;
      });
      state._fhLastApplied = applied;
      if (applied) {
        console.log('[EC-FH] факт получен из Finnhub для ' + applied + ' событ(ия/ий)');
        saveCache();
        render();
      }
      return applied;
    }).catch(function (e) {
      try { console.warn('[EC-FH] ' + ((e && e.message) || e)); } catch (x) {}
      return 0;
    });
  }

  /**
   * [EC-FH] Самодиагностика канала: что реально вернул Finnhub и сколько
   * событий совпало. Запуск из консоли:
   *   EconomicCalendarWidget.testFastSource()            // с сохранённым ключом
   *   EconomicCalendarWidget.testFastSource('ВАШ_КЛЮЧ')  // проверить новый ключ
   */
  function testFastSource(key) {
    if (key) setFinnhubKey(key);
    state._fhCache = null; state._fhCacheAt = 0; state._fhLastRun = 0;
    return fetchFinnhub().then(function (rows) {
      var out = {
        ключЗадан: !!getFinnhubKey(),
        строкВОтвете: rows ? rows.length : 0,
        ошибка: state._fhLastError,
        поляПервойСтроки: rows && rows[0] ? Object.keys(rows[0]) : [],
        пример: rows && rows[0] ? JSON.stringify(rows[0]).slice(0, 300) : null,
        совпалоСобытий: 0,
        детали: []
      };
      var now = Date.now();
      (state.all || []).forEach(function (ev) {
        if (!ev.ts || ev.ts > now || ev.ts < now - FAST_WINDOW_MS) return;
        if (!rows) return;
        var m = fhFindFor(ev, rows);
        if (m) {
          out.совпалоСобытий++;
          out.детали.push({ событие: ev.name, факт: m.value, источникНазвание: m.name, сходство: Math.round(m.score * 100) / 100 });
        } else {
          out.детали.push({ событие: ev.name, факт: null, примечание: 'в ответе Finnhub не найдено' });
        }
      });
      try { console.log('[EC-FH] самодиагностика', out); } catch (e) {}
      return out;
    });
  }

  /** Есть ли «горячее» событие: вышло недавно, факта ещё нет. */
  function hotEventAge(now) {
    var best = -1;
    (state.all || []).forEach(function (ev) {
      if (!ev || !ev.ts) return;
      if (effectiveActual(ev) !== null) return;
      var age = now - ev.ts;
      if (age >= 0 && age < FAST_WINDOW_MS && (best < 0 || age < best)) best = age;
    });
    return best;
  }

  /**
   * [EC-IMP] Чтение фильтров важности + миграция со старой двухуровневой схемы.
   *
   * Раньше ключи были 'US:1' («высокие» = importance API === 1) и 'US:0'
   * («всё остальное»), а настройки лежали в 'econCalendarFilters.v1'. После
   * перехода на 3 уровня переносить их «в лоб» нельзя: у подавляющего
   * большинства там лежит дефолт {'US:1':true,'US:0':false}, и слепая
   * миграция сохранила бы ровно тот баг, который мы чиним (FOMC/NFP скрыты).
   * Поэтому:
   *   • фильтры живёт в отдельном ключе ...Filters.v2, старый не читаем;
   *   • если v2 есть — используем его (пользователь уже выбирал 3 уровня);
   *   • если v2 нет — стартуем с НОВЫХ дефолтов (высокие+средние включены),
   *     ничего не переносим: старые значения описывали другую шкалу.
   */
  function loadFilters() {
    var f = {};
    for (var k in DEFAULT_FILTERS) f[k] = DEFAULT_FILTERS[k];
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_FILTERS) || 'null');
      if (saved && typeof saved === 'object') {
        var known = 0;
        for (var k2 in saved) {
          if (k2 in DEFAULT_FILTERS) { f[k2] = !!saved[k2]; known++; }
        }
        // защита от частично «старого» объекта (например, после ручного правки)
        if (!known) { for (var d in DEFAULT_FILTERS) f[d] = DEFAULT_FILTERS[d]; }
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
      // [EC-FAST] быстрые факты переживают перезагрузку страницы, но не вечно:
      // через 3 дня они уже не нужны (основной фид к тому времени догонит).
      var facts = {};
      var cutoff = Date.now() - 3 * 86400000;
      for (var k in state.fastFacts) {
        if (state.fastFacts[k] && state.fastFacts[k].at > cutoff) facts[k] = state.fastFacts[k];
      }
      localStorage.setItem(STORAGE_CACHE, JSON.stringify({
        v: 2,   // [EC-IMP] схема: importance = 0|1|2 + srcImp/impWhy
        t: state.lastUpdate ? state.lastUpdate.getTime() : 0,
        events: state.all,
        fastFacts: facts
      }));
    } catch (e) {}
  }

  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(STORAGE_CACHE) || 'null');
      if (c && c.events && c.events.length && c.t) {
        // [EC-IMP] кэш версии v1 содержит importance по СТАРОЙ двухуровневой
        // шкале — показывать его нельзя, иначе FOMC/NFP снова пропадут до
        // первого успешного запроса. Отсекаем и чистим.
        if (c.v !== 2) {
          try { localStorage.removeItem(STORAGE_CACHE); localStorage.removeItem(STORAGE_CACHE_V1); } catch (e) {}
          return null;
        }
        if (Date.now() - c.t < 12 * 3600 * 1000) return c;
      }
    } catch (e) {}
    return null;
  }

  // ============================ DATA ===================================

  function cbrEvents() {
    return CBR_MEETINGS.map(function (m) {
      var ni = normalizeImportance(2, 'ЦБ РФ: решение по ключевой ставке', 'RU', 'cbr');
      return {
        ts: new Date(m.date).getTime(),
        country: 'RU',
        // [EC-IMP] заседание ЦБ РФ — всегда максимальная важность
        importance: ni.imp,
        srcImp: 2,
        impBoosted: false,
        impWhy: ni.why,
        name: 'ЦБ РФ: решение по ключевой ставке',
        note: m.note || '',
        forecast: null, previous: null, actual: null,
        scale: '', period: '', unit: '% годовых', source: 'Банк России',
        comment: '', link: CBR_LINK, src: 'cbr'
      };
    });
  }

  /**
   * [EC-OVERLAY] Событие из курируемого слоя (ФРС/Росстат) — в общий формат.
   * Такие события всегда имеют максимальную важность: в слой попадают только
   * те релизы, которых нет в фиде и которые рынок реально торгует.
   */
  function mapOverlayEvent(o) {
    return {
      ts: new Date(o.date).getTime(),
      country: o.country,
      importance: 2,
      srcImp: 2,
      impBoosted: false,
      impWhy: 'курируемый слой: ' + (o.src === 'rosstat' ? 'Росстат' : 'ФРС'),
      name: o.name,
      note: o.note || '',
      forecast: null, previous: null, actual: null,
      scale: '', period: '', unit: o.unit || '', source: o.source || '',
      comment: '', link: o.link || '', src: o.src,
      tentative: !!o.tentative
    };
  }

  function mapTvEvent(e) {
    // [EC-IMP] importance из API (0|1|2, где 2 — максимум) нормализуем и
    // при необходимости поднимаем курируемым списком IMP_RULES.
    var name = e.indicator || e.title || '';
    var ni = normalizeImportance(e.importance, name, e.country, 'tv');
    return {
      ts: new Date(e.date).getTime(),
      country: e.country,
      importance: ni.imp,
      srcImp: ni.raw,
      impBoosted: ni.boosted,
      impWhy: ni.why,
      name: name,
      note: '',
      forecast: e.forecast, previous: e.previous, actual: e.actual,
      scale: e.scale || '', period: e.period || '',
      unit: e.unit || '', source: e.source || '',
      comment: e.comment || '', link: '', src: 'tv'
    };
  }

  function fetchData(silent) {
    // [EC-POLL] Раньше запрос, пришедший во время другого запроса, ПРОСТО
    // ВЫБРАСЫВАЛСЯ (return). Если state.fetching ещё и залипал (исключение до
    // fetch, зависший промис), автообновление останавливалось навсегда.
    if (state.fetching) { state._refetchQueued = true; return; }
    state.fetching = true;
    state._fetchStartedAt = Date.now();
    if (!silent) { state.error = null; render(); }

    var opts = state.opts;
    if (!opts) { state.fetching = false; return; }
    var now = new Date();
    var from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var to = new Date(from.getTime() + opts.days * 86400000);
    var url = API_URL +
      '?from=' + encodeURIComponent(from.toISOString()) +
      '&to=' + encodeURIComponent(to.toISOString()) +
      '&countries=' + encodeURIComponent(opts.countries.join(',')) +
      '&minImportance=0';

    // [VP-NET] календарь грузится со стороннего API: без таймаута зависший
    // запрос вечно висел в пуле соединений и никак не проявлялся в консоли.
    (function () {
      var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      return fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
        .finally(function () { if (timer) clearTimeout(timer); });
    })()
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var res = (data && data.result) ? data.result : [];
        var todayStart = from.getTime();
        var feedEvents = res.map(mapTvEvent);
        // [EC-OVERLAY] поверх фида добавляем то, чего в нём нет:
        // заседания/минутки/Beige Book ФРС, ставка ЦБ РФ, недельная инфляция Росстата.
        var overlay = cbrEvents();
        if (opts.countries.indexOf('US') !== -1) overlay = overlay.concat(fomcEvents().map(mapOverlayEvent));
        if (opts.countries.indexOf('RU') !== -1) {
          overlay = overlay.concat(rosstatWeeklyCpiEvents(todayStart - 86400000, to.getTime()).map(mapOverlayEvent));
        }
        var events = mergeOverlay(feedEvents, overlay)
          .filter(function (e) { return e.ts >= todayStart - 3600000 && e.ts <= to.getTime() + 3600000; });
        events.sort(function (a, b) { return a.ts - b.ts; });
        state.all = events;
        state.lastUpdate = new Date();
        state.error = null;
        state.demo = false;
        state.fetching = false;
        saveCache();
        render();
        // [EC-FAST] после основного фида сразу пробуем быстрые каналы и
        // повторяем запрос, если он запрашивался, пока мы были заняты.
        runFinnhubLane();
        runFastLane();
        if (state._refetchQueued) {
          state._refetchQueued = false;
          setTimeout(function () { fetchData(true); }, 1500);
        }
      })
      .catch(function (err) {
        state.fetching = false;
        if (state.all.length) {
          // [VP-EC] данные есть, но обновление не удалось — сказать об этом явно
          try { console.warn('[VP-EC] обновление календаря не удалось (' + (err && err.message) + '), показаны прежние данные'); } catch (e) {}
          render(); return;
        }
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
  // [EC-IMP] важность здесь уже по новой шкале: 2 — высокая, 1 — средняя, 0 — низкая
  function demoEvents() {
    var t = Date.now();
    var day = 86400000;
    return [
      { ts: t - 3600000 * 5, country: 'US', importance: 2, srcImp: 2, impBoosted: false, impWhy: 'демо', name: 'Non-Farm Payrolls', note: '', forecast: 180, previous: 162, actual: 177, scale: 'K', period: 'Sep. 2026', unit: 'Number of jobs', source: 'BLS', comment: 'Number of jobs added or lost in all non-farm businesses. Published monthly.', link: '', src: 'demo' },
      { ts: t - 3600000 * 2, country: 'US', importance: 2, srcImp: 1, impBoosted: true, impWhy: 'демо', name: 'ISM Manufacturing PMI', note: '', forecast: 55.1, previous: 54.6, actual: null, scale: '', period: 'Sep. 2026', unit: 'Index (diffusion)', source: 'ISM', comment: '', link: '', src: 'demo' },
      { ts: t + 3600000,     country: 'RU', importance: 2, srcImp: 2, impBoosted: false, impWhy: 'заседание ЦБ РФ', name: 'ЦБ РФ: решение по ключевой ставке', note: 'Пресс-конференция 15:00 МСК', forecast: null, previous: null, actual: null, scale: '', period: '', unit: '% годовых', source: 'Банк России', comment: '', link: CBR_LINK, src: 'cbr' },
      { ts: t + day,         country: 'US', importance: 2, srcImp: 1, impBoosted: true, impWhy: 'демо', name: 'CPI YY, NSA', note: '', forecast: 3.2, previous: 3.4, actual: null, scale: '', period: 'Sep. 2026', unit: 'Index', source: 'BLS', comment: '', link: '', src: 'demo' },
      { ts: t + day,         country: 'US', importance: 2, srcImp: 0, impBoosted: true, impWhy: 'демо', name: 'GDP Advance', note: '', forecast: 2.1, previous: 3.8, actual: null, scale: '%', period: 'Q3 2026', unit: 'Annualized %', source: 'BEA', comment: '', link: '', src: 'demo' },
      { ts: t + day + 3600000 * 2, country: 'RU', importance: 2, srcImp: 0, impBoosted: true, impWhy: 'демо', name: 'CPI YY', note: '', forecast: 8.1, previous: 8.3, actual: null, scale: '', period: 'Sep. 2026', unit: 'Index', source: 'Rosstat', comment: '', link: '', src: 'demo' },
      { ts: t + day * 2,     country: 'US', importance: 2, srcImp: 2, impBoosted: false, impWhy: 'демо', name: 'Fed Interest Rate Decision', note: '', forecast: 4.25, previous: 4.25, actual: null, scale: '', period: '', unit: 'Rate', source: 'Federal Reserve', comment: '', link: '', src: 'demo' },
      { ts: t + day * 2 + 3600000, country: 'US', importance: 0, srcImp: 0, impBoosted: false, impWhy: 'демо', name: '3M Bill Auc - TA*', note: '', forecast: null, previous: null, actual: null, scale: '', period: '', unit: '', source: 'US Treasury', comment: '', link: '', src: 'demo' },
      { ts: t + day * 3,     country: 'RU', importance: 2, srcImp: 0, impBoosted: true, impWhy: 'демо', name: 'GDP YY Monthly', note: '', forecast: null, previous: 1.1, actual: null, scale: '', period: '', unit: '', source: 'MinEcon', comment: '', link: '', src: 'demo' }
    ];
  }

  // ============================ FILTER =================================

  function passFilter(ev) {
    // [EC-IMP] Кнопок две — «Высокие» (importance 2) и «Средние» (importance 1).
    // Технический шум (importance 0: аукционы Treasuries, MBA-ставки, буровые,
    // недельные резервы ЦБ) не показывается ни при каких настройках.
    var imp = tierOf(ev);
    if (imp === 0) return false;
    var key = ev.country + ':' + imp;
    // [EC-FH] защита: если фильтры ещё не загружены (виджет не инициализирован),
    // оператор `in` на null бросал исключение и ронял весь render().
    if (state.filters && key in state.filters) return state.filters[key];
    return imp === 2;   // фильтры ещё не загружены — показываем только высокие
  }

  /** Сколько событий каждого уровня сейчас в загруженном наборе (для чипов). */
  function tierCounts() {
    var counts = {};
    (state.all || []).forEach(function (ev) {
      var imp = (ev.importance === 2 || ev.importance === 1) ? ev.importance : 0;
      var key = ev.country + ':' + imp;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  /** Сколько событий показывается прямо сейчас (для статуса/отладки). */
  function visibleCount() { return (visibleEvents() || []).length; }

  function visibleEvents() {
    var evs = (state.all || []).filter(passFilter);
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
      '.ecw-vals .waiting{color:#8a8f98;font-style:italic;}' +
      '.ecw-bolt{color:#ffca28;margin-right:2px;font-style:normal;}' +
      '.ecw-fasttoggle{cursor:pointer;border-bottom:1px dotted #5f636d;margin:0 6px;}' +
      '.ecw-fasttoggle:hover{color:#ffca28;border-bottom-color:#ffca28;}' +
      '.ecw-fasttoggle.on{color:#7bd88f;border-bottom-color:#7bd88f;}' +
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
    // [EC-FH] защита от неинициализированного state (см. passFilter)
    if (!state.opts || !state.opts.countries) return html;
    var f = state.filters || {};
    // Два чипа — как в оригинале. Отдельной кнопки для «низкой» важности нет:
    // технический шум (аукционы Treasuries, MBA-ставки, буровые, недельные
    // резервы ЦБ) не показывается ни при каких настройках.
    state.opts.countries.forEach(function (c) {
      var meta = COUNTRY_META[c] || { flag: '', name: c };
      html += '<span class="ecw-chip' + (f[c + ':2'] ? ' on' : '') + '" data-key="' + c + ':2" title="' + esc(meta.name) + ' — только высокая важность">' +
        meta.flag + ' <span class="dot ecw-dot-high"></span>Высокие</span>';
      html += '<span class="ecw-chip' + (f[c + ':1'] ? ' on' : '') + '" data-key="' + c + ':1" title="' + esc(meta.name) + ' — средняя важность">' +
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

  /** [EC-IMP] уровень важности события (2/1/0) — защищённый от мусора в данных. */
  function tierOf(ev) {
    var i = ev && ev.importance;
    return (i === 2 || i === 1) ? i : 0;
  }

  /** [EC-IMP] описание уровня важности для title/справки. */
  function tierTitle(ev) {
    var t = IMP_TIERS[tierOf(ev)];
    var s = t.emoji + ' ' + t.title.charAt(0).toUpperCase() + t.title.slice(1);
    if (ev && ev.srcImp !== undefined && ev.srcImp !== null && Number(ev.srcImp) !== tierOf(ev)) {
      s += ' (оценка источника Reuters: ' + ev.srcImp + ' из 2 — пересчитана)';
    }
    if (ev && ev.impWhy) s += ': ' + ev.impWhy;
    return s;
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
    var dAct = effectiveActual(ev);
    var dFf = state.fastFacts[evId(ev)];
    html += '<div class="ecw-dsec"><div class="ecw-dtitle">Значения</div>' +
      '<div class="ecw-vtable">' +
        '<div class="ecw-vcell c-act"><div class="num">' + (dFf ? '⚡ ' : '') + esc(fmtValue(dAct, ev.scale)) + '</div><div class="cap">Факт' +
          (dFf ? ' · ' + esc(dFf.src) : '') + '</div></div>' +
        '<div class="ecw-vcell c-fcst"><div class="num">' + esc(fmtValue(ev.forecast, ev.scale)) + '</div><div class="cap">Прогноз</div></div>' +
        '<div class="ecw-vcell c-prev"><div class="num">' + esc(fmtValue(ev.previous, ev.scale)) + '</div><div class="cap">Пред.</div></div>' +
      '</div>' +
      '<div class="ecw-desc" style="margin-top:6px;font-size:12px;color:#848e9c;">Прогноз — консенсус-ожидание аналитиков. Основное движение цены вызывает отклонение факта от прогноза: факт сильнее прогноза → как правило, укрепление валюты страны и давление на рисковые активы; факт слабее — наоборот.</div>' +
      '</div>';

    // мета
    var metaParts = [];
    // [EC-FAST] честно пишем, откуда число и почему его может не быть
    if (dFf) {
      metaParts.push('<b>Факт получен:</b> ' + esc(dFf.src) + ' (быстрый канал), ' +
                     new Date(dFf.at).toLocaleTimeString('ru-RU') + ', период ' + esc(dFf.period));
    } else if (dAct === null || dAct === undefined) {
      metaParts.push('<b>Факта пока нет:</b> основной источник (TradingView/Reuters) публикует его ' +
                     'с задержкой 4–10 часов после релиза' +
                     (matchFastRule(ev.name) ? '; быстрый канал BLS опрашивается каждую минуту' : ''));
    }
    if (ev.period) metaParts.push('<b>Период:</b> ' + esc(ev.period));
    if (ev.unit) metaParts.push('<b>Ед. измерения:</b> ' + esc(ev.unit));
    if (ev.source) metaParts.push('<b>Источник:</b> ' + esc(ev.source));
    metaParts.push('<b>Важность:</b> ' + (tierOf(ev) === 2 ? '🔴 высокая' : '🟠 средняя'));
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
      var impDot = tierOf(ev) === 2 ? 'ecw-dot-high' : 'ecw-dot-med';
      var impTitle = tierOf(ev) === 2 ? 'Высокая важность' : 'Средняя важность';
      var nameHtml = ev.link
        ? '<a href="' + esc(ev.link) + '" target="_blank" rel="noopener">' + esc(ev.name) + '</a>'
        : esc(ev.name);
      // [EC-FAST] «Факт» берётся из основного фида ИЛИ из быстрого канала (BLS).
      // Если событие уже прошло, а числа нет ни там ни там — показываем «ожид.»
      // с внятной подсказкой вместо голого прочерка: раньше пользователь не мог
      // отличить «ещё не опубликовано» от «виджет сломался».
      var act = effectiveActual(ev);
      var ff = state.fastFacts[evId(ev)];
      var actText = (act === null || act === undefined) ? (past ? 'ожид.' : '—') : fmtValue(act, ev.scale);
      var actTitle = '';
      if (ff) {
        actTitle = 'Факт из быстрого канала: ' + ff.src + ' (период ' + ff.period +
                   '), получен в ' + fmtTime(ff.at) + '. Основной источник публикует это значение позже.';
      } else if (act === null || act === undefined) {
        actTitle = past
          ? 'Источник (TradingView/Reuters) публикует факт с задержкой до 4–10 часов.' +
            (matchFastRule(ev.name) ? ' Быстрый канал BLS уже опрашивается.' : ' Быстрого официального источника для этого индикатора нет.')
          : 'Ещё не опубликовано';
      }
      var vals =
        '<span class="v" title="' + esc(actTitle) + '"><span class="lbl">Факт</span> <span class="' +
          (act !== null && act !== undefined ? 'actual' : (past ? 'waiting' : '')) + '">' +
          (ff ? '<span class="ecw-bolt" title="факт из быстрого канала">⚡</span>' : '') +
          esc(actText) + '</span></span>' +
        '<span class="v"><span class="lbl">Прогноз</span> <span class="fcst">' + esc(fmtValue(ev.forecast, ev.scale)) + '</span></span>' +
        '<span class="v"><span class="lbl">Пред</span> <span class="prev">' + esc(fmtValue(ev.previous, ev.scale)) + '</span></span>';
      var timeLabel = fmtTime(ev.ts) + (soon ? '<div class="ecw-when">через ' + fmtCountdown(ev.ts - now) + '</div>' : '');

      html += '<div class="' + cls + '" data-ts="' + ev.ts + '" data-id="' + esc(evId(ev)) + '">' +
        '<div class="ecw-row">' +
          '<div class="ecw-time">' + timeLabel + '</div>' +
          '<div class="ecw-flag" title="' + esc(meta.name) + '">' + meta.flag + '</div>' +
          '<div class="ecw-body">' +
            '<div class="ecw-name"><span class="ecw-imp ' + impDot + '" title="' + impTitle + '"></span>' + nameHtml + '</div>' +
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
        '<div class="ecw-footer"><span title="Основной источник публикует факт с задержкой 4–10 ч. Быстрые каналы: BLS (CPI/Core CPI, без ключа) и Finnhub (все события, нужен бесплатный ключ)">Данные: TradingView + ЦБ РФ' +
          (Object.keys(state.fastFacts).length ? ' + <span title="есть факты из быстрого канала">⚡' + fastSrcLabel() + '</span>' : '') + '</span>' +
          '<span id="ecwFastToggle" class="ecw-fasttoggle' + (getFinnhubKey() ? ' on' : '') + '" title="' +
            (getFinnhubKey()
              ? 'Быстрый канал Finnhub включён — нажмите, чтобы убрать ключ'
              : 'Быстрый канал ВЫКЛЮЧЕН: без ключа факт по CPI приходит за ~30–60 мин, по остальным событиям — через 4–10 ч. Нажмите, чтобы вставить бесплатный ключ Finnhub') + '">' +
            '⚡ ' + (getFinnhubKey() ? 'быстрый канал вкл' : 'быстрый канал выкл') + '</span>' +
          '<span id="ecwFooterUpd" title="Бюджет запросов к BLS на сегодня: ' + blsBudgetLeft() + '/' + FAST_DAILY_LIMIT + '">обновлено ' + (state.lastUpdate ? fmtClock(state.lastUpdate.getTime()) : '—') + '</span></div>' +
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

    // [EC-FH] вкл/выкл быстрого канала Finnhub
    var ft = c.querySelector('#ecwFastToggle');
    if (ft) ft.addEventListener('click', function () {
      var cur = getFinnhubKey();
      var msg = cur
        ? 'Ключ Finnhub уже сохранён.\nОставьте поле пустым и нажмите ОК, чтобы отключить быстрый канал.'
        : 'Быстрый канал Finnhub: факт по ВСЕМ событиям за минуты вместо 4–10 часов.\n\n' +
          '1) откройте https://finnhub.io/register (нужна только почта, бесплатно)\n' +
          '2) скопируйте API key из личного кабинета\n' +
          '3) вставьте его сюда\n\n' +
          'Ключ хранится только в localStorage этого браузера и уходит лишь на finnhub.io.';
      var v;
      try { v = window.prompt(msg, cur || ''); } catch (e) { v = null; }
      if (v === null) return;
      setFinnhubKey(v);
      render();
      try {
        console.log(v.trim() ? '[EC-FH] ключ сохранён, проверяю канал…' : '[EC-FH] быстрый канал отключён');
      } catch (e) {}
      if (v.trim()) { testFastSource(); }
    });
  }

  // =====================================================================
  // [EC-POLL] Тик разделён на ДВЕ независимые части.
  //
  // БЫЛО: один tick(), который ПЕРВОЙ ЖЕ СТРОКОЙ возвращался, если контейнер
  // не отрисован (!getClientRects().length). Календарь живёт в плавающем окне
  // (index.html: #floatingCalendar, display:none по умолчанию, кнопки «─» и «✕»),
  // то есть почти всегда скрыт. Получалось:
  //   • окно закрыто/свёрнуто -> tick() делает НОЛЬ -> автообновления нет вообще;
  //   • load() вызывается один раз (флаг calendarLoaded) -> повторное открытие
  //     окна данные НЕ перезапрашивает.
  // Итог: пользователь открывает календарь через несколько часов и видит
  // «Факт: —» — данные просто никто не обновлял.
  //
  // СТАЛО: dataTick() (запросы) работает ВСЕГДА, uiTick() (обратный отсчёт и
  // классы) — только когда окно видимо.
  // =====================================================================

  function isVisible() {
    return !!(state.container && state.container.isConnected &&
              state.container.getClientRects().length && state._visible !== false);
  }

  function dataTick() {
    if (!state.opts) return;
    var now = Date.now();

    // сторож: если fetch завис, не даём флагу заблокировать обновления навсегда
    if (state.fetching && state._fetchStartedAt && now - state._fetchStartedAt > FETCH_WATCHDOG_MS) {
      try { console.warn('[EC-POLL] fetch завис > ' + (FETCH_WATCHDOG_MS / 1000) + 'с — сбрасываю флаг'); } catch (e) {}
      state.fetching = false;
    }

    // 1) быстрые каналы — до основного фида, они дают факт на часы раньше.
    //    Finnhub (если задан ключ) покрывает все события, BLS — CPI-семейство.
    runFinnhubLane();
    runFastLane();

    // 2) основной фид: адаптивный интервал
    if (state.fetching) return;
    var age = state.lastUpdate ? (now - state.lastUpdate.getTime()) : Infinity;
    var hot = hotEventAge(now);
    var interval = (state.opts.refreshMin || 5) * 60000;
    if (hot >= 0) {
      // первые 30 минут после релиза — каждую минуту, дальше до 6 ч — раз в 5 минут
      interval = (hot < 30 * 60000) ? HOT_POLL_MS : Math.min(interval, 5 * 60000);
    }
    if (age > interval) fetchData(true);
  }

  function uiTick() {
    if (!isVisible()) return;
    var now = Date.now();
    var cd = state.container.querySelector('#ecwCountdown');
    if (cd) cd.innerHTML = nextEventHtml(visibleEvents(), now);

    state.container.querySelectorAll('.ecw-event').forEach(function (el) {
      var ts = parseInt(el.getAttribute('data-ts') || '0', 10);
      if (!ts) return;
      el.classList.toggle('past', ts < now);
      el.classList.toggle('soon', ts >= now && ts - now <= 3600000);
    });
  }

  function tick() {
    dataTick();
    uiTick();
  }

  /** [EC-POLL] Возврат на вкладку/открытие окна — обновляемся сразу, не дожидаясь тика. */
  function onVisibleAgain() {
    if (!state.opts) return;
    state._lastFastRun = 0;                 // снять троттлинг быстрых каналов
    state._fhLastRun = 0;
    var age = state.lastUpdate ? (Date.now() - state.lastUpdate.getTime()) : Infinity;
    if (age > 60000 && !state.fetching) fetchData(true);
    else runFastLane();
    uiTick();
  }

  // ============================ PUBLIC API =============================

  function load(container, options) {
    if (!container) { console.warn('EconomicCalendar: container not found'); return; }
    injectStyles();

    state.container = container;
    state.opts = Object.assign({
      countries: ['US', 'RU'],
      days: 7,
      refreshMin: 5,   // [VP-EC] было 15: факт приезжал слишком поздно
      defaultRange: 'week',   // 'day' | 'week' — если пользователь ещё не выбирал
      demoFallback: false
    }, options || {});
    state.filters = loadFilters();
    state.range = loadRange(state.opts.defaultRange);
    state.finnhubKey = null;
    getFinnhubKey();   // [EC-FH] прочитать сохранённый ключ

    var cache = loadCache();
    if (cache) {
      state.all = cache.events;
      state.lastUpdate = new Date(cache.t);
      if (cache.fastFacts) state.fastFacts = cache.fastFacts;   // [EC-FAST]
    }
    render();
    fetchData(!!cache);

    // [EC-POLL] тик — 30 с, но данные обновляются по адаптивному расписанию
    // внутри dataTick(); UI-часть при скрытом окне просто пропускается.
    if (!state.tickTimer) state.tickTimer = setInterval(tick, 30000);

    // [EC-POLL] возврат на вкладку — сразу добираем данные
    if (!state._visHandler) {
      state._visHandler = function () { if (!document.hidden) onVisibleAgain(); };
      document.addEventListener('visibilitychange', state._visHandler);
      window.addEventListener('focus', state._visHandler);
    }
  }

  function destroy() {
    if (state.tickTimer) { clearInterval(state.tickTimer); state.tickTimer = null; }
    if (state._visHandler) {
      document.removeEventListener('visibilitychange', state._visHandler);
      window.removeEventListener('focus', state._visHandler);
      state._visHandler = null;
    }
    if (state.container) state.container.innerHTML = '';
    state.container = null;
  }

  window.EconomicCalendarWidget = {
    load: load,
    destroy: destroy,
    refresh: function () { fetchData(false); },
    /**
     * [EC-POLL] Окно календаря открыли/развернули. load() вызывается один раз
     * за сессию (флаг calendarLoaded в index.html), поэтому без этого хука
     * повторное открытие показывало бы часы́ устаревших данных.
     */
    onShow: function () { state._visible = true; onVisibleAgain(); },
    /** Окно свернули/закрыли: данные продолжают обновляться, UI-тик засыпает. */
    onHide: function () { state._visible = false; },
    /** Принудительный прогон быстрых каналов (отладка). */
    pollFast: function () {
      state._lastFastRun = 0; state._fhLastRun = 0; state._fhCache = null;
      return Promise.all([runFinnhubLane(), runFastLane()]);
    },
    /** [EC-FH] ключ Finnhub: setFinnhubKey('xxx') / getFinnhubKey(). */
    setFinnhubKey: setFinnhubKey,
    getFinnhubKey: getFinnhubKey,
    /** [EC-FH] проверка канала: что вернул источник и сколько событий совпало. */
    testFastSource: testFastSource,
    /** Диагностика из консоли. */
    diag: function () {
      var now = Date.now();
      return {
        событий: (state.all || []).length,
        показано: visibleCount(),
        фильтры: JSON.parse(JSON.stringify(state.filters || {})),
        // [EC-IMP] сколько событий каждого уровня и сколько поднято куратором
        важность: (function () {
          var out = { высокая: 0, средняя: 0, низкая: 0, поднятоСписком: 0 };
          (state.all || []).forEach(function (e) {
            var t = tierOf(e);
            if (t === 2) out.высокая++; else if (t === 1) out.средняя++; else out.низкая++;
            if (isBoosted(e)) out.поднятоСписком++;
          });
          return out;
        })(),
        последнееОбновление: state.lastUpdate ? new Date(state.lastUpdate).toLocaleTimeString('ru-RU') : null,
        возрастДанныхСек: state.lastUpdate ? Math.round((now - state.lastUpdate.getTime()) / 1000) : null,
        fetching: state.fetching,
        видим: isVisible(),
        быстроеОбновлениеСек: state.opts ? Math.round((now - state._lastFastRun) / 1000) : null,
        фактовИзБыстрыхКаналов: Object.keys(state.fastFacts).length,
        finnhub: {
          ключЗадан: !!getFinnhubKey(),
          строкВКэше: state._fhRows,
          последняяОшибка: state._fhLastError,
          проставленоФактов: state._fhLastApplied,
          последнийЗапросСекНазад: state._fhLastRun ? Math.round((Date.now() - state._fhLastRun) / 1000) : null
        },
        бюджетBLSсегодня: blsBudgetLeft() + '/' + FAST_DAILY_LIMIT,
        горячееСобытие: (function () { var h = hotEventAge(now); return h < 0 ? null : Math.round(h / 60000) + ' мин назад, факта нет'; })(),
        ждутФакта: (state.all || []).filter(function (e) {
          return e.ts <= now && e.ts > now - FAST_WINDOW_MS && effectiveActual(e) === null;
        }).map(function (e) { return e.name + ' (' + fmtTime(e.ts) + (matchFastRule(e.name) ? ', ⚡BLS' : ', только основной фид') + ')'; })
      };
    },
    setRange: function (r) {
      if (r === 'day' || r === 'week') { state.range = r; saveRange(); render(); }
    },
    // [EC-FAST] отладка/тесты: доступ к внутренностям виджета.
    // Пример в консоли: EconomicCalendarWidget._debug.state.fastFacts
    _debug: {
      state: state,
      FAST_RULES: FAST_RULES,
      matchFastRule: matchFastRule,
      refYmOf: refYmOf,
      shiftYm: shiftYm,
      calcFromSeries: calcFromSeries,
      effectiveActual: effectiveActual,
      runFastLane: runFastLane,
      blsSeries: blsSeries,
      blsBudgetLeft: blsBudgetLeft,
      runFinnhubLane: runFinnhubLane,
      fetchFinnhub: fetchFinnhub,
      fhFindFor: fhFindFor,
      fhNameScore: fhNameScore,
      getFinnhubKey: getFinnhubKey,
      dataTick: dataTick,
      hotEventAge: hotEventAge,
      // [EC-IMP] отладка важности: как классифицируется конкретное событие
      normalizeImportance: normalizeImportance,
      IMP_TIERS: IMP_TIERS,
      IMP_HIGH: IMP_HIGH,
      IMP_MED: IMP_MED,
      IMP_LOW: IMP_LOW,
      tierOf: tierOf,
      tierCounts: tierCounts,
      isBoosted: isBoosted,
      loadFilters: loadFilters,
      // [EC-OVERLAY]
      etToIso: etToIso,
      usEastOffsetMin: usEastOffsetMin,
      shiftDateStr: shiftDateStr,
      fomcEvents: fomcEvents,
      rosstatWeeklyCpiEvents: rosstatWeeklyCpiEvents,
      mapOverlayEvent: mapOverlayEvent,
      mergeOverlay: mergeOverlay,
      render: render,
      renderList: renderList,
      renderDetails: renderDetails,
      visibleEvents: visibleEvents,
      passFilter: passFilter
    },
    // можно редактировать графики и словарь описаний из кода:
    CBR_MEETINGS: CBR_MEETINGS,
    FOMC_MEETINGS: FOMC_MEETINGS,
    DESC_RULES: DESC_RULES
  };

  console.log('✅ EconomicCalendar.js v4 загружен (3 уровня важности [EC-IMP] + период День/Неделя + описания)');
})();
