#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchmarkSuiteResult } from "../types";

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate HTML report with Plotly visualizations
 */
export function generateHTMLReport(
    suiteResults: BenchmarkSuiteResult[],
    outputPath: string
): void {
    const html = generateHTML(suiteResults);
    fs.writeFileSync(outputPath, html, "utf-8");
}

/**
 * Load the report JavaScript from external file
 */
function loadReportScript(): string {
    const scriptPath = path.join(__dirname, "report-script.js");
    return fs.readFileSync(scriptPath, "utf-8");
}

/**
 * Load the report CSS from external file
 */
function loadReportStyles(): string {
    const stylesPath = path.join(__dirname, "report-styles.css");
    return fs.readFileSync(stylesPath, "utf-8");
}

/**
 * Generate complete HTML with embedded Plotly visualizations
 * Focused on latency analysis for expiration stress test
 */
function generateHTML(suiteResults: BenchmarkSuiteResult[]): string {
    const styles = loadReportStyles();
    const script = loadReportScript();

    // Inject the benchmark data as a separate variable
    const dataScript = `const benchmarkData = ${JSON.stringify(suiteResults, null, 2)};`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TtlWheelCache - Expiration Stress Test</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js" charset="utf-8"></script>
    <style>${styles}</style>
</head>
<body>
    <div class="container">
        <h1>🔥 Expiration Stress Test</h1>
        <p style="margin-bottom: 30px; color: #999;">High churn with short TTLs (50-500ms) - Timer Wheel Performance</p>

        <div id="summary"></div>
        <div id="plots"></div>
    </div>

    <script>
${dataScript}
${script}
    </script>
</body>
</html>`;
}

/**
 * CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Usage: tsx bench/report-generator.ts <input.json> <output.html>");
        process.exit(1);
    }

    const [inputPath, outputPath] = args;
    const data = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
    generateHTMLReport(data, outputPath);
    console.log(`✓ HTML report generated: ${outputPath}`);
    console.log(`\nOpen ${outputPath} in your browser to view the report!`);
}
