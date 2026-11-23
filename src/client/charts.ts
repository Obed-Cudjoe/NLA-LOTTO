/** Chart.js wrappers. Degrades silently when the CDN is unavailable. */
import { CHANCE_ONE, CHANCE_THREE, CHANCE_TWO, type BacktestResult } from '../mathEngine';

declare global {
  interface Window {
    Chart?: any;
  }
}

const instances = new Map<string, any>();

const GOLD = '#fcd116';
const GREEN = '#10b981';
const RED = '#ce1126';
const SLATE = 'rgba(148,163,184,0.75)';
const GRID = 'rgba(255,255,255,0.06)';

function destroy(id: string): void {
  const existing = instances.get(id);
  if (existing) {
    try {
      existing.destroy();
    } catch {
      /* ignore */
    }
    instances.delete(id);
  }
}

function canvas(id: string): { ctx: CanvasRenderingContext2D; el: HTMLCanvasElement } | null {
  const el = document.getElementById(id) as HTMLCanvasElement | null;
  if (!el) return null;
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  return { ctx, el };
}

function baseOptions(legend = true): Record<string, unknown> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: legend,
        labels: { color: SLATE as unknown as string, boxWidth: 10, boxHeight: 10, font: { size: 10 } },
      },
      tooltip: {
        backgroundColor: 'rgba(11,16,32,0.95)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        padding: 8,
      },
    },
    scales: {
      x: {
        ticks: { color: 'rgba(148,163,184,0.7)', font: { size: 9 }, maxTicksLimit: 8 },
        grid: { color: GRID },
      },
      y: {
        beginAtZero: true,
        ticks: { color: 'rgba(148,163,184,0.7)', font: { size: 9 } },
        grid: { color: GRID },
      },
    },
  };
}

export function renderBacktestCharts(bt: BacktestResult): void {
  const Chart = typeof window !== 'undefined' ? window.Chart : undefined;
  if (!Chart) return;

  const runs = bt.runs;
  if (!runs.length) return;

  /* ---- cumulative hits vs chance ---- */
  const target = canvas('chart-cumulative');
  if (target) {
    destroy('chart-cumulative');
    let e1 = 0;
    let e2 = 0;
    const labels: string[] = [];
    const series1: number[] = [];
    const series2: number[] = [];
    const chance1: number[] = [];
    const chance2: number[] = [];

    runs.forEach((r, i) => {
      if (r.hit1) e1++;
      if (r.hit2) e2++;
      labels.push(r.draw_date.slice(5));
      series1.push(e1);
      series2.push(e2);
      chance1.push(+((i + 1) * CHANCE_ONE * 10).toFixed(2)); // scaled x10 so it is visible
      chance2.push(+((i + 1) * CHANCE_TWO * 100).toFixed(2)); // scaled x100
    });

    const chart = new Chart(target.ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '1-Number hits (cumulative)',
            data: series1,
            borderColor: GOLD,
            backgroundColor: 'rgba(252,209,22,0.12)',
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: 'Chance, 1-Number (×10)',
            data: chance1,
            borderColor: 'rgba(148,163,184,0.8)',
            borderDash: [4, 4],
            pointRadius: 0,
            borderWidth: 1.5,
            fill: false,
          },
          {
            label: '2-Sure hits (cumulative)',
            data: series2,
            borderColor: GREEN,
            pointRadius: 0,
            borderWidth: 1.5,
            tension: 0.25,
          },
          {
            label: 'Chance, 2-Sure (×100)',
            data: chance2,
            borderColor: 'rgba(148,163,184,0.45)',
            borderDash: [2, 5],
            pointRadius: 0,
            borderWidth: 1.5,
            fill: false,
          },
        ],
      },
      options: baseOptions(),
    });
    instances.set('chart-cumulative', chart);
  }

  /* ---- observed vs random for each metric ---- */
  const dist = canvas('chart-distribution');
  if (dist) {
    destroy('chart-distribution');
    const s = bt.summary;
    const chart = new Chart(dist.ctx, {
      type: 'bar',
      data: {
        labels: ['1-Number', '2-Sure', '3-Direct'],
        datasets: [
          {
            label: 'Engine hits',
            data: [s.oneNumber.hits, s.twoSure.hits, s.threeDirect.hits],
            backgroundColor: GOLD,
            borderRadius: 3,
          },
          {
            label: 'Random mean',
            data: [
              s.randomBaseline.meanOneNumberHits,
              s.randomBaseline.simulations ? s.twoSure.expectedHits : 0,
              s.randomBaseline.meanTrioHits,
            ],
            backgroundColor: 'rgba(148,163,184,0.45)',
            borderRadius: 3,
          },
        ],
      },
      options: {
        ...baseOptions(),
        indexAxis: 'y' as const,
      },
    });
    instances.set('chart-distribution', chart);
  }

  void RED;
  void CHANCE_THREE;
}

export function destroyAllCharts(): void {
  for (const id of [...instances.keys()]) destroy(id);
}
