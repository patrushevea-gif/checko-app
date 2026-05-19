const API_KEY_STORAGE = 'checkoApiKey';
        const PORTFOLIO_STORAGE = 'checkoCounterpartyPortfolioV2';
        const SETTINGS_STORAGE = 'checkoCounterpartySettingsV2';

        const ENDPOINTS = {
            company: 'https://api.checko.ru/v2/company',
            finances: 'https://api.checko.ru/v2/finances',
            enforcements: 'https://api.checko.ru/v2/enforcements',
            legalCases: 'https://api.checko.ru/v2/legal-cases',
            bankruptcy: 'https://api.checko.ru/v2/bankruptcy-messages'
        };

        let batchIsRunning = false;

        function getApiKey() {
            return (localStorage.getItem(API_KEY_STORAGE) || '').trim();
        }

        function saveApiKey() {
            const key = document.getElementById('apiKey').value.trim();
            if (key) {
                localStorage.setItem(API_KEY_STORAGE, key);
                setStatus('apiStatus', `Ключ сохранен локально: ${maskKey(key)}`, 'success');
            } else {
                localStorage.removeItem(API_KEY_STORAGE);
                setStatus('apiStatus', 'Ключ очищен.', 'warning');
            }
            renderApiStatus();
        }

        function renderApiStatus() {
            const key = getApiKey();
            document.getElementById('apiKey').value = key;
            document.getElementById('apiStatus').textContent = key
                ? `Ключ сохранен только в этом браузере: ${maskKey(key)}`
                : 'Ключ не записывается в код и не отправляется в GitHub.';
        }

        function maskKey(key) {
            return key.length > 8 ? `${key.slice(0, 3)}••••••${key.slice(-3)}` : '••••••';
        }

        function requireApiKey() {
            const key = getApiKey();
            if (!key) throw new Error('Сначала сохраните личный API-ключ Checko');
            return key;
        }

        function buildUrl(endpoint, params = {}) {
            const query = new URLSearchParams({ key: requireApiKey() });
            Object.entries(params).forEach(([name, value]) => {
                if (value !== undefined && value !== null && value !== '') query.set(name, value);
            });
            return `${endpoint}?${query.toString()}`;
        }

        async function checko(endpoint, params = {}, budget = null) {
            if (budget) {
                if (budget.remaining <= 0) throw new Error('Лимит запросов для запуска исчерпан');
                budget.remaining -= 1;
                budget.used += 1;
            }

            const response = await fetch(buildUrl(endpoint, params));
            const text = await response.text();
            let payload;

            try {
                payload = JSON.parse(text);
            } catch (error) {
                throw new Error(`Checko вернул не JSON: ${error.message}`);
            }

            if (!response.ok || payload.meta?.status === 'error') {
                throw new Error(payload.meta?.message || `HTTP ${response.status}`);
            }

            return payload;
        }

        function normalizeInn(value) {
            const inn = String(value || '').replace(/\D/g, '');
            return /^(?:\d{10}|\d{12})$/.test(inn) ? inn : '';
        }

        function extractInns(value) {
            const matches = String(value || '').match(/\d{12}|\d{10}/g) || [];
            return [...new Set(matches.map(normalizeInn).filter(Boolean))];
        }

        function today(date = new Date()) {
            const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
            return local.toISOString().slice(0, 10);
        }

        function fmt(value, suffix = '') {
            if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
            return `${Number(value).toLocaleString('ru-RU')}${suffix}`;
        }

        function signed(value, suffix = '') {
            if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
            const number = Number(value);
            return `${number > 0 ? '+' : ''}${fmt(number, suffix)}`;
        }

        function money(value) {
            return fmt(Math.round(Number(value || 0)), ' ₽');
        }

        function escapeHtml(value) {
            const div = document.createElement('div');
            div.textContent = value == null ? '' : String(value);
            return div.innerHTML;
        }

        function setStatus(id, message, type = '') {
            const node = document.getElementById(id);
            node.textContent = message;
            node.className = `status ${type}`.trim();
        }

        function getSettings() {
            return {
                intervalDays: Math.max(1, Number(document.getElementById('intervalDays').value) || 1),
                requestLimit: Math.min(100, Math.max(1, Number(document.getElementById('requestLimit').value) || 100)),
                dueOnly: document.getElementById('dueOnly').checked,
                useFinances: document.getElementById('useFinances').checked,
                useEnforcements: document.getElementById('useEnforcements').checked,
                useBankruptcy: document.getElementById('useBankruptcy').checked,
                useLegalCases: document.getElementById('useLegalCases').checked
            };
        }

        function saveSettings() {
            localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(getSettings()));
        }

        function loadSettings() {
            try {
                const settings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE) || '{}');
                if (settings.intervalDays) document.getElementById('intervalDays').value = settings.intervalDays;
                if (settings.requestLimit) document.getElementById('requestLimit').value = settings.requestLimit;
                ['dueOnly', 'useFinances', 'useEnforcements', 'useBankruptcy', 'useLegalCases'].forEach(id => {
                    if (typeof settings[id] === 'boolean') document.getElementById(id).checked = settings[id];
                });
            } catch (error) {
                console.warn(error);
            }
        }

        function readPortfolio() {
            try {
                const records = JSON.parse(localStorage.getItem(PORTFOLIO_STORAGE) || '[]');
                return Array.isArray(records) ? records : [];
            } catch (error) {
                console.warn(error);
                return [];
            }
        }

        function savePortfolio(records) {
            localStorage.setItem(PORTFOLIO_STORAGE, JSON.stringify(records));
        }

        function addInns() {
            const input = document.getElementById('innList');
            const inns = extractInns(input.value);
            if (!inns.length) {
                setStatus('portfolioStatus', 'Не нашел корректных ИНН 10 или 12 цифр.', 'warning');
                return;
            }

            const records = readPortfolio();
            const known = new Set(records.map(record => record.inn));
            const now = new Date().toISOString();
            let added = 0;

            inns.forEach(inn => {
                if (known.has(inn)) return;
                records.push({
                    inn,
                    createdAt: now,
                    lastCheckedAt: null,
                    name: '',
                    status: '',
                    risk: { level: 'unknown', score: 0, reasons: [] },
                    metrics: {},
                    deltas: {},
                    history: []
                });
                added += 1;
            });

            savePortfolio(records);
            input.value = '';
            renderPortfolio();
            setStatus('portfolioStatus', `Добавлено: ${added}. Уже были в базе: ${inns.length - added}.`, added ? 'success' : '');
        }

        function isDue(record, intervalDays) {
            if (!record.lastCheckedAt) return true;
            const next = new Date(record.lastCheckedAt);
            next.setDate(next.getDate() + intervalDays);
            return next <= new Date();
        }

        function nextCheck(record, intervalDays) {
            if (!record.lastCheckedAt) return 'сейчас';
            const next = new Date(record.lastCheckedAt);
            next.setDate(next.getDate() + intervalDays);
            return next.toLocaleDateString('ru-RU');
        }

        function sortForCheck(records) {
            return [...records].sort((a, b) => {
                if (!a.lastCheckedAt && b.lastCheckedAt) return -1;
                if (a.lastCheckedAt && !b.lastCheckedAt) return 1;
                if (!a.lastCheckedAt && !b.lastCheckedAt) return (a.createdAt || '').localeCompare(b.createdAt || '');
                return new Date(a.lastCheckedAt) - new Date(b.lastCheckedAt);
            });
        }

        function setProgress(done, total) {
            const wrap = document.getElementById('progress');
            const fill = document.getElementById('progressFill');
            if (!total) {
                wrap.style.display = 'none';
                fill.style.width = '0%';
                return;
            }
            wrap.style.display = 'block';
            fill.style.width = `${Math.round((done / total) * 100)}%`;
        }

        async function runPortfolioBatch() {
            if (batchIsRunning) return;
            saveSettings();

            const settings = getSettings();
            const records = readPortfolio();
            const queue = sortForCheck(records).filter(record => !settings.dueOnly || isDue(record, settings.intervalDays));
            if (!queue.length) {
                setStatus('portfolioStatus', 'Нет контрагентов к проверке по текущему интервалу.', '');
                return;
            }

            batchIsRunning = true;
            const budget = { remaining: settings.requestLimit, used: 0 };
            let checked = 0;
            let failed = 0;

            setProgress(0, queue.length);

            for (const record of queue) {
                if (budget.remaining <= 0) break;
                setStatus('portfolioStatus', `Проверяю ${record.inn}. Осталось запросов: ${budget.remaining}.`);
                try {
                    await updateRecord(record, settings, budget);
                    checked += 1;
                } catch (error) {
                    record.lastError = error.message;
                    failed += 1;
                }
                savePortfolio(records);
                renderPortfolio();
                setProgress(checked + failed, queue.length);
                await new Promise(resolve => setTimeout(resolve, 250));
            }

            batchIsRunning = false;
            setProgress(0, 0);
            setStatus('portfolioStatus', `Готово. Проверено: ${checked}, ошибок: ${failed}, запросов: ${budget.used}.`, failed ? 'warning' : 'success');
        }

        async function checkOne(inn) {
            if (batchIsRunning) return;
            const records = readPortfolio();
            const record = records.find(item => item.inn === inn);
            if (!record) return;

            batchIsRunning = true;
            const budget = { remaining: getSettings().requestLimit, used: 0 };
            setProgress(0, 1);

            try {
                await updateRecord(record, getSettings(), budget);
                savePortfolio(records);
                renderPortfolio();
                setStatus('portfolioStatus', `ИНН ${inn} проверен. Запросов: ${budget.used}.`, 'success');
            } catch (error) {
                record.lastError = error.message;
                savePortfolio(records);
                renderPortfolio();
                setStatus('portfolioStatus', `Ошибка ${inn}: ${error.message}`, 'error');
            } finally {
                batchIsRunning = false;
                setProgress(0, 0);
            }
        }

        async function updateRecord(record, settings, budget) {
            const snapshot = await collectSnapshot(record.inn, settings, budget, record.snapshot || null);
            record.name = snapshot.name;
            record.status = snapshot.status;
            record.ogrn = snapshot.ogrn;
            record.lastCheckedAt = snapshot.checkedAt;
            record.risk = snapshot.risk;
            record.metrics = snapshot.metrics;
            record.deltas = snapshot.deltas;
            record.snapshot = snapshot;
            record.lastError = '';
            record.history = Array.isArray(record.history) ? record.history : [];
            record.history.push(snapshot);
            record.history = record.history.slice(-45);
        }

        async function collectSnapshot(inn, settings, budget, previous) {
            const companyPayload = await checko(ENDPOINTS.company, { inn }, budget);
            const company = companyPayload.data;
            if (!company) throw new Error('Контрагент не найден');

            const ogrn = company.ОГРН || company.ОГРНИП || '';
            const metrics = {
                enforcementDebt: 0,
                enforcementOpenCount: 0,
                bankruptcyMessages: 0,
                legalCasesClaimant: 0,
                legalCasesDefendant: 0,
                latestYear: '',
                revenue: null,
                profit: null,
                revenueYearDelta: null,
                profitYearDelta: null
            };

            if (settings.useFinances && company.ОГРН && budget.remaining > 0) {
                try {
                    const payload = await checko(ENDPOINTS.finances, { ogrn: company.ОГРН }, budget);
                    applyFinances(metrics, payload.data);
                } catch (error) {
                    metrics.financesError = error.message;
                }
            }

            if (settings.useEnforcements && budget.remaining > 0) {
                try {
                    const payload = await checko(ENDPOINTS.enforcements, pageParams(inn, ogrn), budget);
                    applyEnforcements(metrics, recordsFrom(payload));
                } catch (error) {
                    metrics.enforcementsError = error.message;
                }
            }

            if (settings.useBankruptcy && budget.remaining > 0) {
                try {
                    const payload = await checko(ENDPOINTS.bankruptcy, pageParams(inn, ogrn), budget);
                    metrics.bankruptcyMessages = recordsFrom(payload).length;
                } catch (error) {
                    metrics.bankruptcyError = error.message;
                }
            }

            if (settings.useLegalCases && budget.remaining > 0) {
                try {
                    const from = new Date();
                    from.setFullYear(from.getFullYear() - 2);
                    const payload = await checko(ENDPOINTS.legalCases, {
                        inn,
                        date_from: today(from),
                        date_to: today(),
                        limit: 100,
                        page: 1
                    }, budget);
                    applyLegalCases(metrics, recordsFrom(payload), inn);
                } catch (error) {
                    metrics.legalCasesError = error.message;
                }
            }

            const risk = analyze(company, metrics, previous);
            return {
                checkedAt: new Date().toISOString(),
                inn,
                name: company.НаимПолн || company.НаимСокр || company.ФИО || 'Контрагент',
                ogrn,
                status: company.Статус?.Наим || '',
                metrics,
                risk,
                deltas: compare(previous, metrics, risk)
            };
        }

        function pageParams(inn, ogrn) {
            return ogrn ? { ogrn, limit: 100, page: 1 } : { inn, limit: 100, page: 1 };
        }

        function recordsFrom(payload) {
            const data = payload?.data || payload;
            if (!data) return [];
            if (Array.isArray(data)) return data;
            if (Array.isArray(data.Записи)) return data.Записи;
            if (Array.isArray(data.items)) return data.items;
            if (Array.isArray(data.records)) return data.records;
            return [];
        }

        function applyFinances(metrics, finances) {
            if (!finances) return;
            const years = Object.keys(finances)
                .filter(year => /^\d{4}$/.test(year))
                .map(Number)
                .sort((a, b) => a - b);
            if (!years.length) return;

            const latest = String(years[years.length - 1]);
            const prev = years.length > 1 ? String(years[years.length - 2]) : '';
            metrics.latestYear = latest;
            metrics.revenue = numberOrNull(finances[latest]?.['2110']);
            metrics.profit = numberOrNull(finances[latest]?.['2400']);

            if (prev) {
                const prevRevenue = numberOrNull(finances[prev]?.['2110']);
                const prevProfit = numberOrNull(finances[prev]?.['2400']);
                metrics.revenueYearDelta = metrics.revenue !== null && prevRevenue !== null ? metrics.revenue - prevRevenue : null;
                metrics.profitYearDelta = metrics.profit !== null && prevProfit !== null ? metrics.profit - prevProfit : null;
            }
        }

        function applyEnforcements(metrics, records) {
            records.forEach(record => {
                const debt = Number(record.ОстЗадолж || record.СуммаОстатка || record.debt || 0);
                if (debt > 0) {
                    metrics.enforcementOpenCount += 1;
                    metrics.enforcementDebt += debt;
                }
            });
        }

        function applyLegalCases(metrics, records, inn) {
            records.forEach(record => {
                const claimants = Array.isArray(record.Ист) ? record.Ист : [];
                const defendants = Array.isArray(record.Ответ) ? record.Ответ : [];
                if (claimants.some(item => item.ИНН === inn)) metrics.legalCasesClaimant += 1;
                if (defendants.some(item => item.ИНН === inn)) metrics.legalCasesDefendant += 1;
            });
        }

        function numberOrNull(value) {
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        }

        function analyze(company, metrics, previous) {
            const reasons = [];
            let score = 0;
            const status = company.Статус?.Наим || '';

            if (status && status !== 'Действует') {
                score += 60;
                reasons.push(`Статус: ${status}`);
            }

            if (metrics.bankruptcyMessages > 0) {
                score += 60;
                reasons.push(`Сообщения ЕФРСБ: ${metrics.bankruptcyMessages}`);
            }

            if (metrics.enforcementDebt > 0) {
                score += metrics.enforcementDebt >= 500000 ? 35 : 20;
                reasons.push(`Непогашенная задолженность ФССП: ${money(metrics.enforcementDebt)}`);
            }

            if (metrics.enforcementOpenCount >= 5) {
                score += 20;
                reasons.push(`Много открытых ИП: ${metrics.enforcementOpenCount}`);
            }

            if (metrics.legalCasesDefendant > 0) {
                score += metrics.legalCasesDefendant >= 3 ? 20 : 10;
                reasons.push(`Арбитраж ответчиком: ${metrics.legalCasesDefendant}`);
            }

            if (metrics.profit !== null && metrics.profit < 0) {
                score += 15;
                reasons.push(`Убыток за ${metrics.latestYear}: ${money(metrics.profit)}`);
            }

            if (metrics.revenueYearDelta !== null && metrics.revenueYearDelta < 0) {
                score += 10;
                reasons.push('Выручка снизилась к предыдущему году');
            }

            if (previous && metrics.enforcementDebt > (previous.metrics?.enforcementDebt || 0)) {
                score += 15;
                reasons.push('Задолженность ФССП выросла с прошлой проверки');
            }

            if (!reasons.length) reasons.push('Критичных признаков по выбранным источникам нет');

            return {
                score,
                level: score >= 60 ? 'high' : score >= 25 ? 'medium' : 'low',
                reasons
            };
        }

        function compare(previous, metrics, risk) {
            if (!previous) {
                return {
                    riskScore: 0,
                    enforcementDebt: 0,
                    bankruptcyMessages: 0,
                    revenue: 0,
                    profit: 0,
                    riskChanged: false
                };
            }

            return {
                riskScore: risk.score - (previous.risk?.score || 0),
                enforcementDebt: metrics.enforcementDebt - (previous.metrics?.enforcementDebt || 0),
                bankruptcyMessages: metrics.bankruptcyMessages - (previous.metrics?.bankruptcyMessages || 0),
                revenue: comparableDelta(metrics.revenue, previous.metrics?.revenue),
                profit: comparableDelta(metrics.profit, previous.metrics?.profit),
                riskChanged: risk.level !== previous.risk?.level
            };
        }

        function comparableDelta(current, previous) {
            return current !== null && current !== undefined && previous !== null && previous !== undefined
                ? current - previous
                : null;
        }

        function riskLabel(level) {
            if (level === 'high') return 'Высокий';
            if (level === 'medium') return 'Средний';
            if (level === 'low') return 'Низкий';
            return 'Не проверен';
        }

        function renderReasons(reasons) {
            return (reasons || []).slice(0, 4).map(escapeHtml).join('<br>');
        }

        function renderDynamics(record) {
            if (!record.lastCheckedAt) return 'Нет истории';
            const deltas = record.deltas || {};
            const parts = [];
            if (deltas.riskScore) parts.push(`Балл риска: ${signed(deltas.riskScore)}`);
            if (deltas.enforcementDebt) parts.push(`ФССП: ${signed(Math.round(deltas.enforcementDebt), ' ₽')}`);
            if (deltas.bankruptcyMessages) parts.push(`ЕФРСБ: ${signed(deltas.bankruptcyMessages)}`);
            if (deltas.revenue) parts.push(`Выручка: ${signed(deltas.revenue, ' ₽')}`);
            if (deltas.profit) parts.push(`Прибыль: ${signed(deltas.profit, ' ₽')}`);
            if (deltas.riskChanged) parts.push('Уровень риска изменился');
            return parts.length ? parts.map(escapeHtml).join('<br>') : 'Без ухудшения';
        }

        function renderPortfolio() {
            const settings = getSettings();
            const records = sortForCheck(readPortfolio());
            const dueCount = records.filter(record => isDue(record, settings.intervalDays)).length;
            const checkedCount = records.filter(record => record.lastCheckedAt).length;
            const highCount = records.filter(record => record.risk?.level === 'high').length;
            const mediumCount = records.filter(record => record.risk?.level === 'medium').length;

            document.getElementById('portfolioSummary').innerHTML = `
                <div class="metrics">
                    <div class="metric"><div class="label">Всего</div><div class="value">${records.length}</div></div>
                    <div class="metric"><div class="label">Проверено</div><div class="value">${checkedCount}</div></div>
                    <div class="metric"><div class="label">К проверке</div><div class="value">${dueCount}</div></div>
                    <div class="metric"><div class="label">Риски</div><div class="value">${highCount} высоких / ${mediumCount} средних</div></div>
                </div>`;

            if (!records.length) {
                document.getElementById('portfolioTable').innerHTML = '<div class="empty">Список ИНН пока пуст</div>';
                return;
            }

            const rows = records.map(record => {
                const risk = record.risk || { level: 'unknown', score: 0, reasons: [] };
                const metrics = record.metrics || {};
                const checked = record.lastCheckedAt ? new Date(record.lastCheckedAt).toLocaleString('ru-RU') : 'не проверялся';
                const error = record.lastError ? `<div class="status error">${escapeHtml(record.lastError)}</div>` : '';

                return `<tr>
                    <td><strong>${escapeHtml(record.inn)}</strong><br>${escapeHtml(record.name || 'Название появится после проверки')}</td>
                    <td>${escapeHtml(record.status || '—')}</td>
                    <td><span class="badge risk-${risk.level}">${riskLabel(risk.level)}</span><br>Балл: ${risk.score}<br>${renderReasons(risk.reasons)}</td>
                    <td>${money(metrics.enforcementDebt || 0)}<br>${metrics.enforcementOpenCount || 0} открытых</td>
                    <td>${metrics.bankruptcyMessages || 0}</td>
                    <td>${metrics.latestYear || '—'}<br>Выручка: ${fmt(metrics.revenue)}<br>Прибыль: ${fmt(metrics.profit)}</td>
                    <td>${renderDynamics(record)}</td>
                    <td>${checked}<br>Следующая: ${nextCheck(record, settings.intervalDays)}${error}</td>
                    <td><div class="actions">
                        <button type="button" onclick="checkOne('${record.inn}')">Проверить</button>
                        <button type="button" class="secondary" onclick="openQuick('${record.inn}')">Открыть</button>
                        <button type="button" class="danger" onclick="removeInn('${record.inn}')">Удалить</button>
                    </div></td>
                </tr>`;
            }).join('');

            document.getElementById('portfolioTable').innerHTML = `
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Контрагент</th>
                                <th>Статус</th>
                                <th>Риск</th>
                                <th>ФССП</th>
                                <th>ЕФРСБ</th>
                                <th>Финансы</th>
                                <th>Динамика</th>
                                <th>Проверка</th>
                                <th>Действия</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
        }

        function removeInn(inn) {
            const records = readPortfolio().filter(record => record.inn !== inn);
            savePortfolio(records);
            renderPortfolio();
            setStatus('portfolioStatus', `ИНН ${inn} удален.`, 'success');
        }

        function openQuick(inn) {
            document.getElementById('quickInn').value = inn;
            window.scrollTo({ top: 0, behavior: 'smooth' });
            runQuickCheck();
        }

        async function runQuickCheck() {
            const inn = normalizeInn(document.getElementById('quickInn').value);
            if (!inn) {
                setStatus('quickStatus', 'Введите корректный ИНН 10 или 12 цифр.', 'warning');
                return;
            }

            const budget = { remaining: getSettings().requestLimit, used: 0 };
            setStatus('quickStatus', 'Загружаю данные...');

            try {
                const snapshot = await collectSnapshot(inn, getSettings(), budget, null);
                renderQuickResult(snapshot, budget.used);
                setStatus('quickStatus', `Готово. Запросов: ${budget.used}.`, 'success');
            } catch (error) {
                document.getElementById('quickResult').style.display = 'none';
                setStatus('quickStatus', error.message, 'error');
            }
        }

        function renderQuickResult(snapshot, used) {
            const metrics = snapshot.metrics;
            const risk = snapshot.risk;
            document.getElementById('quickResult').style.display = 'block';
            document.getElementById('quickResult').innerHTML = `
                <h2>Результат проверки</h2>
                <div class="result-grid">
                    <div>
                        <div class="metric">
                            <div class="label">Контрагент</div>
                            <div class="value">${escapeHtml(snapshot.name)}</div>
                        </div>
                        <div class="metrics">
                            <div class="metric"><div class="label">ИНН</div><div class="value">${escapeHtml(snapshot.inn)}</div></div>
                            <div class="metric"><div class="label">ОГРН</div><div class="value">${escapeHtml(snapshot.ogrn || '—')}</div></div>
                            <div class="metric"><div class="label">Статус</div><div class="value">${escapeHtml(snapshot.status || '—')}</div></div>
                            <div class="metric"><div class="label">Запросы</div><div class="value">${used}</div></div>
                        </div>
                    </div>
                    <div>
                        <div class="metric">
                            <div class="label">Риск</div>
                            <div class="value"><span class="badge risk-${risk.level}">${riskLabel(risk.level)}</span> ${risk.score}</div>
                            <div class="note">${renderReasons(risk.reasons)}</div>
                        </div>
                        <div class="metrics">
                            <div class="metric"><div class="label">ФССП</div><div class="value">${money(metrics.enforcementDebt)} / ${metrics.enforcementOpenCount}</div></div>
                            <div class="metric"><div class="label">ЕФРСБ</div><div class="value">${metrics.bankruptcyMessages}</div></div>
                            <div class="metric"><div class="label">Выручка</div><div class="value">${fmt(metrics.revenue)}</div></div>
                            <div class="metric"><div class="label">Прибыль</div><div class="value">${fmt(metrics.profit)}</div></div>
                        </div>
                    </div>
                </div>`;
        }

        function exportCsv() {
            const records = readPortfolio();
            if (!records.length) {
                setStatus('portfolioStatus', 'Нечего экспортировать.', 'warning');
                return;
            }

            const headers = [
                'ИНН', 'Название', 'Статус', 'Дата проверки', 'Риск', 'Балл риска', 'Причины',
                'Задолженность ФССП', 'Открытые ИП', 'Сообщения ЕФРСБ', 'Год отчетности',
                'Выручка', 'Прибыль', 'Динамика балла риска', 'Динамика ФССП', 'Динамика ЕФРСБ'
            ];
            const lines = [headers.map(csv).join(';')];

            records.forEach(record => {
                const metrics = record.metrics || {};
                const deltas = record.deltas || {};
                lines.push([
                    record.inn,
                    record.name || '',
                    record.status || '',
                    record.lastCheckedAt || '',
                    riskLabel(record.risk?.level),
                    record.risk?.score || 0,
                    (record.risk?.reasons || []).join(' | '),
                    Math.round(metrics.enforcementDebt || 0),
                    metrics.enforcementOpenCount || 0,
                    metrics.bankruptcyMessages || 0,
                    metrics.latestYear || '',
                    metrics.revenue ?? '',
                    metrics.profit ?? '',
                    deltas.riskScore ?? '',
                    deltas.enforcementDebt ?? '',
                    deltas.bankruptcyMessages ?? ''
                ].map(csv).join(';'));
            });

            download(`checko-counterparties-${today()}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
            setStatus('portfolioStatus', 'CSV сформирован.', 'success');
        }

        function exportJson() {
            const payload = {
                exportedAt: new Date().toISOString(),
                records: readPortfolio()
            };
            download(`checko-counterparties-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
            setStatus('portfolioStatus', 'JSON сформирован.', 'success');
        }

        function importJson(event) {
            const file = event.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = JSON.parse(reader.result);
                    const incoming = Array.isArray(parsed) ? parsed : parsed.records;
                    if (!Array.isArray(incoming)) throw new Error('В файле нет массива records');

                    const byInn = new Map(readPortfolio().map(record => [record.inn, record]));
                    incoming.forEach(record => {
                        const inn = normalizeInn(record.inn);
                        if (inn) byInn.set(inn, { ...record, inn });
                    });

                    savePortfolio([...byInn.values()]);
                    renderPortfolio();
                    setStatus('portfolioStatus', `Импортировано записей: ${incoming.length}.`, 'success');
                } catch (error) {
                    setStatus('portfolioStatus', error.message, 'error');
                } finally {
                    event.target.value = '';
                }
            };
            reader.readAsText(file);
        }

        function clearPortfolio() {
            if (!confirm('Очистить локальную базу контрагентов?')) return;
            localStorage.removeItem(PORTFOLIO_STORAGE);
            renderPortfolio();
            setStatus('portfolioStatus', 'База очищена.', 'success');
        }

        function csv(value) {
            return `"${String(value ?? '').replace(/"/g, '""')}"`;
        }

        function download(filename, text, type) {
            const blob = new Blob([text], { type });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        }

        document.getElementById('quickInn').addEventListener('keydown', event => {
            if (event.key === 'Enter') runQuickCheck();
        });

        ['intervalDays', 'requestLimit', 'dueOnly', 'useFinances', 'useEnforcements', 'useBankruptcy', 'useLegalCases'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                saveSettings();
                renderPortfolio();
            });
        });

        renderApiStatus();
        loadSettings();
        renderPortfolio();
