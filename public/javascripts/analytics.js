document.addEventListener('DOMContentLoaded', () => {
    // Check if analytics data is exposed globally
    if (!window.__ANALYTICS_DATA__) return;

    const data = window.__ANALYTICS_DATA__;
    
    // Theme colors matching CSS
    const colors = {
        primary: '#4f46e5',
        secondary: '#0ea5e9',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        gray: '#e2e8f0',
        chartBg: 'rgba(79, 70, 229, 0.1)',
        chartBorder: 'rgba(79, 70, 229, 1)'
    };

    // 1. Progress Distribution Chart (Doughnut)
    const ctxProgress = document.getElementById('progressDistChart');
    if (ctxProgress) {
        new Chart(ctxProgress, {
            type: 'doughnut',
            data: {
                labels: ['0-10%', '11-25%', '26-50%', '51-75%', '76-100%'],
                datasets: [{
                    data: data.charts.progressBuckets,
                    backgroundColor: [
                        colors.danger,
                        colors.warning,
                        colors.secondary,
                        colors.primary,
                        colors.success
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                },
                cutout: '70%'
            }
        });
    }

    // 2. Activity Trend (Line Chart)
    const ctxTrend = document.getElementById('activityTrendChart');
    if (ctxTrend) {
        const labels = data.charts.activityData.map(d => d.x);
        const values = data.charts.activityData.map(d => d.y);
        
        new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Active Users',
                    data: values,
                    borderColor: colors.primary,
                    backgroundColor: colors.chartBg,
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: colors.primary,
                    pointRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: colors.gray } },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    // 3. Funnel Chart (Bar Chart styled as funnel)
    const ctxFunnel = document.getElementById('funnelChart');
    if (ctxFunnel) {
        const labels = data.charts.funnel.map(f => f.stage);
        const values = data.charts.funnel.map(f => f.count);

        new Chart(ctxFunnel, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Users',
                    data: values,
                    backgroundColor: colors.secondary,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, grid: { display: false } },
                    y: { grid: { display: false } }
                }
            }
        });
    }

    // --- Table Filtering and Sorting ---
    const searchInput = document.getElementById('tableSearch');
    const tableBody = document.getElementById('learnersTableBody');
    if (searchInput && tableBody) {
        const rows = Array.from(tableBody.querySelectorAll('tr'));
        
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            rows.forEach(row => {
                const text = row.innerText.toLowerCase();
                row.style.display = text.includes(term) ? '' : 'none';
            });
        });

        // Basic Sorting feature
        const headers = document.querySelectorAll('.learners-table th[data-sort]');
        let currentSort = { col: null, asc: true };

        headers.forEach(header => {
            header.addEventListener('click', () => {
                const sortKey = header.getAttribute('data-sort');
                const isNumeric = sortKey === 'progress' || sortKey === 'score' || sortKey === 'rating';
                
                if (currentSort.col === sortKey) {
                    currentSort.asc = !currentSort.asc;
                } else {
                    currentSort.col = sortKey;
                    currentSort.asc = true;
                }

                headers.forEach(h => h.innerHTML = h.innerHTML.replace(' ↑', '').replace(' ↓', ''));
                header.innerHTML += currentSort.asc ? ' ↑' : ' ↓';

                const sortedRows = rows.sort((a, b) => {
                    const aVal = a.getAttribute(`data-${sortKey}`) || '';
                    const bVal = b.getAttribute(`data-${sortKey}`) || '';
                    
                    if (isNumeric) {
                        return currentSort.asc ? (Number(aVal) - Number(bVal)) : (Number(bVal) - Number(aVal));
                    } else {
                        return currentSort.asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                    }
                });

                tableBody.innerHTML = '';
                sortedRows.forEach(r => tableBody.appendChild(r));
            });
        });
    }
});
