document.addEventListener('DOMContentLoaded', function() {
    if (!window.__ANALYTICS_DATA__ || typeof Chart === 'undefined') return;

    const data = window.__ANALYTICS_DATA__;
    const chartInstances = [];

    renderCharts();
    bindTableInteractions();
    window.addEventListener('themechange', renderCharts);

    function getThemeColors() {
        const rootStyles = getComputedStyle(document.documentElement);
        return {
            text: rootStyles.getPropertyValue('--app-text').trim() || '#10233f',
            muted: rootStyles.getPropertyValue('--app-text-muted').trim() || '#64748b',
            border: rootStyles.getPropertyValue('--app-border').trim() || 'rgba(148,163,184,0.24)',
            surface: rootStyles.getPropertyValue('--app-surface').trim() || '#ffffff',
            accent: rootStyles.getPropertyValue('--app-accent').trim() || '#0f766e',
            accentSoft: rootStyles.getPropertyValue('--app-accent-soft').trim() || 'rgba(15,118,110,0.12)',
            success: document.documentElement.dataset.theme === 'dark' ? '#4ade80' : '#16a34a',
            warning: document.documentElement.dataset.theme === 'dark' ? '#fbbf24' : '#f59e0b',
            danger: document.documentElement.dataset.theme === 'dark' ? '#f87171' : '#ef4444',
            info: document.documentElement.dataset.theme === 'dark' ? '#67e8f9' : '#38bdf8'
        };
    }

    function clearCharts() {
        while (chartInstances.length) {
            const instance = chartInstances.pop();
            if (instance && typeof instance.destroy === 'function') {
                instance.destroy();
            }
        }
    }

    function markChartReady(canvas) {
        const container = canvas && canvas.closest('.chart-card');
        if (container) {
            container.classList.add('is-chart-ready');
        }
    }

    function showEmptyChart(canvas, message) {
        const container = canvas && canvas.parentElement;
        if (!container) return;
        markChartReady(canvas);
        if (container.querySelector('.chart-empty-state')) return;

        const empty = document.createElement('div');
        empty.className = 'chart-empty-state text-muted d-flex align-items-center justify-content-center h-100';
        empty.textContent = message;
        container.appendChild(empty);
        canvas.hidden = true;
    }

    function resetEmptyState(canvas) {
        const container = canvas && canvas.parentElement;
        if (!container) return;
        const empty = container.querySelector('.chart-empty-state');
        if (empty) empty.remove();
        canvas.hidden = false;
    }

    function buildBaseOptions(colors) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: colors.muted,
                        usePointStyle: true,
                        boxWidth: 10
                    }
                },
                tooltip: {
                    backgroundColor: colors.surface,
                    titleColor: colors.text,
                    bodyColor: colors.muted,
                    borderColor: colors.border,
                    borderWidth: 1
                }
            }
        };
    }

    function renderCharts() {
        const colors = getThemeColors();
        clearCharts();
        document.querySelectorAll('.chart-card').forEach(function(card) {
            card.classList.remove('is-chart-ready');
        });

        renderProgressChart(colors);
        renderActivityChart(colors);
        renderFunnelChart(colors);
    }

    function renderProgressChart(colors) {
        const canvas = document.getElementById('progressDistChart');
        if (!canvas) return;

        const values = Array.isArray(data.charts && data.charts.progressBuckets) ? data.charts.progressBuckets : [];
        if (!values.some(function(value) { return Number(value) > 0; })) {
            showEmptyChart(canvas, 'No progress data yet.');
            return;
        }

        resetEmptyState(canvas);
        const chart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: ['0-10%', '11-25%', '26-50%', '51-75%', '76-100%'],
                datasets: [{
                    data: values,
                    backgroundColor: [colors.danger, colors.warning, colors.info, colors.accent, colors.success],
                    borderWidth: 0,
                    hoverOffset: 6
                }]
            },
            options: {
                ...buildBaseOptions(colors),
                cutout: '72%'
            }
        });
        chartInstances.push(chart);
        markChartReady(canvas);
    }

    function renderActivityChart(colors) {
        const canvas = document.getElementById('activityTrendChart');
        if (!canvas) return;

        const points = Array.isArray(data.charts && data.charts.activityData) ? data.charts.activityData : [];
        if (!points.length) {
            showEmptyChart(canvas, 'No learner activity data yet.');
            return;
        }

        resetEmptyState(canvas);
        const chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: points.map(function(point) { return point.x; }),
                datasets: [{
                    label: 'Active users',
                    data: points.map(function(point) { return point.y; }),
                    borderColor: colors.accent,
                    backgroundColor: colors.accentSoft,
                    borderWidth: 2.5,
                    tension: 0.38,
                    fill: true,
                    pointBackgroundColor: colors.accent,
                    pointRadius: 3,
                    pointHoverRadius: 5
                }]
            },
            options: {
                ...buildBaseOptions(colors),
                plugins: {
                    ...buildBaseOptions(colors).plugins,
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: colors.muted },
                        grid: { color: colors.border }
                    },
                    x: {
                        ticks: { color: colors.muted },
                        grid: { display: false }
                    }
                }
            }
        });
        chartInstances.push(chart);
        markChartReady(canvas);
    }

    function renderFunnelChart(colors) {
        const canvas = document.getElementById('funnelChart');
        if (!canvas) return;

        const steps = Array.isArray(data.charts && data.charts.funnel) ? data.charts.funnel : [];
        if (!steps.length) {
            showEmptyChart(canvas, 'No funnel data yet.');
            return;
        }

        resetEmptyState(canvas);
        const chart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: steps.map(function(step) { return step.stage; }),
                datasets: [{
                    label: 'Users',
                    data: steps.map(function(step) { return step.count; }),
                    backgroundColor: [colors.accent, colors.info, colors.warning, colors.success],
                    borderRadius: 10,
                    borderSkipped: false
                }]
            },
            options: {
                ...buildBaseOptions(colors),
                indexAxis: 'y',
                plugins: {
                    ...buildBaseOptions(colors).plugins,
                    legend: { display: false }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { color: colors.muted },
                        grid: { color: colors.border }
                    },
                    y: {
                        ticks: { color: colors.muted },
                        grid: { display: false }
                    }
                }
            }
        });
        chartInstances.push(chart);
        markChartReady(canvas);
    }

    function bindTableInteractions() {
        const searchInput = document.getElementById('tableSearch');
        const tableBody = document.getElementById('learnersTableBody');
        if (!searchInput || !tableBody) return;

        const rows = Array.from(tableBody.querySelectorAll('tr'));
        searchInput.addEventListener('input', function(event) {
            const term = String(event.target.value || '').toLowerCase();
            rows.forEach(function(row) {
                row.style.display = row.innerText.toLowerCase().includes(term) ? '' : 'none';
            });
        });

        const headers = document.querySelectorAll('.learners-table th[data-sort]');
        let currentSort = { col: null, asc: true };

        headers.forEach(function(header) {
            header.addEventListener('click', function() {
                const sortKey = header.getAttribute('data-sort');
                const isNumeric = sortKey === 'progress' || sortKey === 'score' || sortKey === 'rating';

                if (currentSort.col === sortKey) {
                    currentSort.asc = !currentSort.asc;
                } else {
                    currentSort.col = sortKey;
                    currentSort.asc = true;
                }

                headers.forEach(function(item) {
                    item.textContent = item.textContent.replace(' ↑', '').replace(' ↓', '');
                });
                header.textContent += currentSort.asc ? ' ↑' : ' ↓';

                const sorted = rows.sort(function(a, b) {
                    const aVal = a.getAttribute('data-' + sortKey) || '';
                    const bVal = b.getAttribute('data-' + sortKey) || '';
                    if (isNumeric) {
                        return currentSort.asc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
                    }
                    return currentSort.asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                });

                tableBody.innerHTML = '';
                sorted.forEach(function(row) {
                    tableBody.appendChild(row);
                });
            });
        });
    }

});
