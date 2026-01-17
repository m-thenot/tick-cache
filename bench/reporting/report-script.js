// This script is injected into the HTML report
// benchmarkData is provided by the template

const plotlyLayout = {
    paper_bgcolor: '#1a1a2e',
    plot_bgcolor: '#0f0f23',
    font: { color: '#cccccc' },
    xaxis: { gridcolor: '#333', zerolinecolor: '#555' },
    yaxis: { gridcolor: '#333', zerolinecolor: '#555' },
};

const colors = {
    'ttl-wheel': '#00cc00',
    'ttl-wheel-autopurge': '#66ff66',
    'lru-cache': '#ff6b35',
    'lru-cache-autopurge': '#ff9966',
    'ttlcache': '#9b59b6',
    'map': '#4ecdc4'
};

// Render summary cards
function renderSummary() {
    const suite = benchmarkData[0];
    const results = suite.results;

    let summaryHTML = '<div class="summary">';

    results.forEach(r => {
        const isWinner = r.implementation === suite.winner;
        const total = r.latencies['total'];

        const compositeScore = (total.p50 * 0.3 + total.p99 * 0.7) / 1000;

        summaryHTML += `
            <div class="summary-card ${isWinner ? 'winner-card' : ''}">
                <h3>${r.implementation} ${isWinner ? '👑' : ''}</h3>
                <div class="value">${(r.opsPerSec / 1000).toFixed(0)}k ops/s</div>
                <div class="label">Duration: ${r.durationMs.toLocaleString()} ms</div>
                <div class="label highlight">Score: ${compositeScore.toFixed(2)} μs ${isWinner ? '✨' : ''}</div>
                <div class="label">p50: ${(total.p50 / 1000).toFixed(2)} μs</div>
                <div class="label">p99: ${(total.p99 / 1000).toFixed(2)} μs</div>
                <div class="label">p999: ${(total.p999 / 1000).toFixed(2)} μs</div>
                <div class="label" style="margin-top:10px">Hit Rate: ${(r.hitRate * 100).toFixed(1)}%</div>
                <div class="label">Expired TTL: ${r.evictions.ttlEvictions.toLocaleString()}</div>
                <div class="label">LRU Evicted: ${r.evictions.lruEvictions.toLocaleString()}</div>
                <div class="label">Set Evicted: ${r.evictions.setEvictions.toLocaleString()}</div>
                <div class="label">Manual Evicted: ${r.evictions.manualEvictions.toLocaleString()}</div>
                <div class="label">Total Evicted: ${r.evictions.totalEvictions.toLocaleString()}</div>
            </div>
        `;
    });

    summaryHTML += '</div>';
    document.getElementById('summary').innerHTML = summaryHTML;
}

// Render all plots
function renderPlots() {
    const suite = benchmarkData[0];
    const results = suite.results;
    const plotsContainer = document.getElementById('plots');

    renderLatencyOverTime(results, plotsContainer);
    renderMemoryUsage(results, plotsContainer);
    renderBoxPlot(results, plotsContainer);
    renderPercentileComparison(results, plotsContainer);
    renderCDF(results, plotsContainer);
    renderThroughput(results, plotsContainer);
}

// 1. Latency Over Time
function renderLatencyOverTime(results, container) {
    const div = document.createElement('div');
    div.className = 'plot-container';
    div.innerHTML = '<h2>Latency Over Time (Watch for Spikes)</h2><div id="latency-time" class="plot"></div>';
    container.appendChild(div);

    const traces = [];
    results.forEach(r => {
        const getHitSamples = r.samples
            .filter(s => s.operation === 'get-hit')
            .sort((a, b) => a.timestamp - b.timestamp);

        if (getHitSamples.length > 0) {
            // Bin samples into time windows
            const binSize = 1; // ms
            const bins = {};
            getHitSamples.forEach(s => {
                const bin = Math.floor(s.timestamp / binSize) * binSize;
                if (!bins[bin]) bins[bin] = [];
                bins[bin].push(s.nanos / 1000);
            });

            const x = [];
            const y = [];
            const binKeys = Object.keys(bins).sort((a, b) => Number(a) - Number(b));

            binKeys.forEach((bin, idx) => {
                const samples = bins[bin];

                // Skip last bin if it has fewer than 5 samples (incomplete bin artifact)
                if (idx === binKeys.length - 1 && samples.length < 5) {
                    return;
                }

                x.push(Number(bin));
                const sorted = samples.sort((a, b) => a - b);
                const p95idx = Math.floor(sorted.length * 0.95);

                y.push(sorted[p95idx]);
            });

            traces.push({
                type: 'scatter',
                mode: 'lines+markers',
                x: x,
                y: y,
                name: r.implementation,
                line: { color: colors[r.implementation], width: 2 },
                marker: { size: 4 }
            });
        }
    });

    Plotly.newPlot('latency-time', traces, {
        ...plotlyLayout,
        title: 'get(hit) p95 Latency Over Time (1ms bins)',
        xaxis: { title: 'Time (ms)' },
        yaxis: { title: 'Latency (μs)' },
        height: 600
    }, { responsive: true });
}

// Memory Usage Over Time
function renderMemoryUsage(results, container) {
    const div = document.createElement('div');
    div.className = 'plot-container';
    div.innerHTML = '<h2>Memory Usage Over Time</h2><div id="memory-usage" class="plot"></div>';
    container.appendChild(div);

    const traces = [];

    results.forEach(r => {
        if (!r.memorySamples || r.memorySamples.length === 0) return;

        const timestamps = r.memorySamples.map(s => s.timestamp);
        const heapUsedMB = r.memorySamples.map(s => s.heapUsed / 1024 / 1024);
        const heapTotalMB = r.memorySamples.map(s => s.heapTotal / 1024 / 1024);

        // Heap Used
        traces.push({
            x: timestamps,
            y: heapUsedMB,
            name: `${r.implementation} (used)`,
            mode: 'lines',
            line: { color: colors[r.implementation], width: 2 },
            legendgroup: r.implementation,
        });

        // Heap Total (dotted line)
        traces.push({
            x: timestamps,
            y: heapTotalMB,
            name: `${r.implementation} (total)`,
            mode: 'lines',
            line: { color: colors[r.implementation], width: 1, dash: 'dot' },
            legendgroup: r.implementation,
            showlegend: false,
        });
    });

    Plotly.newPlot('memory-usage', traces, {
        ...plotlyLayout,
        title: 'Heap Memory Usage',
        xaxis: { title: 'Time (ms)' },
        yaxis: { title: 'Memory (MB)' },
        height: 500
    }, { responsive: true });
}

// 2. Box Plot (using pre-calculated percentiles)
function renderBoxPlot(results, container) {
    const div = document.createElement("div");
    div.className = "plot-container";
    div.innerHTML =
        '<h2>Latency Distribution (Box Plot)</h2><div id="boxplot" class="plot"></div>';
    container.appendChild(div);

    const opTypes = ["get-hit", "get-miss", "set"];

    // ns -> µs + clamp for log axis safety
    const toUs = (ns) => Math.max(ns / 1000, 1e-6);

    const traces = [];

    // One trace per implementation; each trace contains 3 boxes (one per opType)
    results.forEach((r) => {
        const impl = r.implementation;

        const q1 = [];
        const med = [];
        const q3 = [];
        const lower = [];
        const upper = [];
        const x = [];

        opTypes.forEach((op) => {
            const s = r.latencies?.[op];
            if (!s || s.count <= 0) return;

            const lo = s.p05;
            const hi = s.p95;

            x.push(op);
            q1.push(toUs(s.p25));
            med.push(toUs(s.p50));
            q3.push(toUs(s.p75));
            lower.push(toUs(lo));
            upper.push(toUs(hi));
        });

        if (x.length === 0) return;

        traces.push({
            type: "box",
            name: impl,                 // legend item = implementation
            x,                          // categories = opType
            q1,
            median: med,
            q3,
            lowerfence: lower,
            upperfence: upper,
            boxpoints: false,
            marker: { color: colors[impl] },
            line: { color: colors[impl] },
            offsetgroup: impl,          // important for grouping side-by-side
            legendgroup: impl,
        });
    });

    Plotly.newPlot(
        "boxplot",
        traces,
        {
            ...plotlyLayout,
            title: "Latency Distribution (Grouped Box Plot)",
            boxmode: "group", // key: groups boxes by x category
            yaxis: { title: "Latency (μs)", type: "log" },
            xaxis: { title: "Operation type", categoryorder: "array", categoryarray: opTypes },
            height: 600,
        },
        { responsive: true }
    );

}


// 3. Percentile Comparison
function renderPercentileComparison(results, container) {
    const div = document.createElement('div');
    div.className = 'plot-container';
    div.innerHTML = '<h2>Percentile Comparison (get-hit)</h2><div id="percentiles" class="plot"></div>';
    container.appendChild(div);

    const traces = [];
    const percentiles = ['p50', 'p90', 'p95', 'p99', 'p999'];

    results.forEach(r => {
        const getHit = r.latencies['get-hit'];
        const values = percentiles.map(p => getHit[p] / 1000);

        traces.push({
            type: 'bar',
            name: r.implementation,
            x: percentiles,
            y: values,
            marker: { color: colors[r.implementation] },
            text: values.map(v => v.toFixed(2) + ' μs'),
            textposition: 'outside',
        });
    });

    Plotly.newPlot('percentiles', traces, {
        ...plotlyLayout,
        title: 'Tail Latency (p99/p999 Critical)',
        xaxis: { title: 'Percentile' },
        yaxis: { title: 'Latency (μs)', type: 'log' },
        barmode: 'group',
        height: 500
    }, { responsive: true });
}

// 4. CDF
function renderCDF(results, container) {
    const div = document.createElement('div');
    div.className = 'plot-container';
    div.innerHTML = '<h2>CDF: get(hit) Latency</h2><div id="cdf" class="plot"></div>';
    container.appendChild(div);

    const toUs = (ns) => Math.max(ns / 1000, 1e-6);

    const traces = [];
    results.forEach(r => {
        const samples = r.samples
            .filter(s => s.operation === 'get-hit')
            .map(s => toUs(s.nanos))
            .sort((a, b) => a - b);

        const n = samples.length;
        if (!n) return;

        const cdf = samples.map((_, i) => (i + 1) / n);

        traces.push({
            type: 'scatter',
            mode: 'lines',
            x: samples,
            y: cdf,
            name: r.implementation,
            line: { color: colors[r.implementation], width: 3, shape: 'hv' }
        });
    });

    Plotly.newPlot('cdf', traces, {
        ...plotlyLayout,
        title: 'Cumulative Distribution: get(hit) Latency',
        xaxis: { title: 'Latency (μs)', type: 'log' },
        yaxis: { title: 'Cumulative Probability', range: [0, 1] },
        height: 500
    }, { responsive: true });
}


// 5. Throughput
function renderThroughput(results, container) {
    const div = document.createElement('div');
    div.className = 'plot-container';
    div.innerHTML = '<h2>Throughput</h2><div id="throughput" class="plot"></div>';
    container.appendChild(div);

    const trace = {
        type: 'bar',
        x: results.map(r => r.implementation),
        y: results.map(r => r.opsPerSec),
        marker: { color: results.map(r => colors[r.implementation]) },
        text: results.map(r => (r.opsPerSec / 1000).toFixed(1) + 'k ops/s'),
        textposition: 'outside',
    };

    Plotly.newPlot('throughput', [trace], {
        ...plotlyLayout,
        title: 'Operations per Second',
        xaxis: { title: 'Implementation' },
        yaxis: { title: 'ops/sec' },
        height: 400
    }, { responsive: true });
}

// Initialize report
renderSummary();
renderPlots();
