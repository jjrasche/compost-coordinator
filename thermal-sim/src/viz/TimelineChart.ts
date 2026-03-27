/**
 * Canvas-based timeline chart for compost thermal simulation.
 *
 * Two modes:
 *   - Streaming: snapshots arrive one-by-one during real-time playback (legacy)
 *   - Batch: full year of snapshots loaded at once; scrubber is the primary UX
 *
 * Renders:
 * - Temperature bands (core, avg, surface) as filled area
 * - Thermophilic/mesophilic/frozen zone backgrounds
 * - Vertical bars for material additions (height = volume)
 * - Transfer-out markers
 * - Draggable scrubber line
 */

import type { StepSnapshot } from '../core/engine/tickStep';

/** Recorded event during simulation */
export interface SimEvent {
  timeHours: number;
  type: 'addition' | 'transfer';
  volumeGallons?: number;
}

/** Color palette matching the 3D scene */
const COLORS = {
  bg: '#1a1a2e',
  gridLine: '#2a2a3e',
  gridText: '#666',
  coreTemp: '#ff4422',
  avgTemp: '#ff8c28',
  surfTemp: '#4fb5db',
  coreFill: 'rgba(255, 68, 34, 0.15)',
  surfFill: 'rgba(79, 181, 219, 0.12)',
  thermophilic: 'rgba(100, 180, 100, 0.08)',
  mesophilic: 'rgba(255, 200, 50, 0.06)',
  frozen: 'rgba(60, 100, 200, 0.06)',
  addition: 'rgba(120, 200, 120, 0.6)',
  transfer: 'rgba(200, 100, 100, 0.7)',
  scrubber: '#fff',
  o2Line: '#66bbee',
  moistLine: '#44aa88',
  bioLine: '#66cc44',
  ambientLine: 'rgba(180, 180, 220, 0.4)',
  fanFill: 'rgba(200, 160, 60, 0.15)',
};

const THERMO_MIN = 131;
const THERMO_MAX = 160;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class TimelineChart {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private snapshots: StepSnapshot[] = [];
  private events: SimEvent[] = [];
  private maxHours = 24 * 56; // 8 weeks default view
  private currentTimeHours = 0;
  private containerWidth = 0;
  private simStartDate: Date | null = null;

  /** Callback when user clicks/drags on the chart to seek to a time */
  onSeek: ((timeHours: number) => void) | null = null;

  // Layout
  private margin = { top: 8, right: 12, bottom: 22, left: 42 };
  private tempChartHeight = 0;
  private o2ChartHeight = 0;
  private gap = 4;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.cursor = 'crosshair';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;

    // Click/drag to seek
    let dragging = false;
    const seekFromEvent = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const plotX = mouseX - this.margin.left;
      const plotW = this.containerWidth - this.margin.left - this.margin.right;
      if (plotW <= 0 || plotX < 0 || plotX > plotW) return;
      const timeFrac = plotX / plotW;
      const seekTime = timeFrac * this.maxHours;
      if (this.onSeek) this.onSeek(seekTime);
    };
    this.canvas.addEventListener('mousedown', (e) => { dragging = true; seekFromEvent(e); });
    this.canvas.addEventListener('mousemove', (e) => { if (dragging) seekFromEvent(e); });
    window.addEventListener('mouseup', () => { dragging = false; });

    const resize = () => {
      const rect = container.getBoundingClientRect();
      this.containerWidth = rect.width;
      const dpr = Math.min(window.devicePixelRatio, 2);
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx.scale(dpr, dpr);
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.computeLayout(rect.height);
      this.draw();
    };

    window.addEventListener('resize', resize);
    requestAnimationFrame(resize);
  }

  private computeLayout(totalHeight: number): void {
    const usable = totalHeight - this.margin.top - this.margin.bottom - this.gap;
    this.tempChartHeight = usable * 0.7;
    this.o2ChartHeight = usable * 0.3;
  }

  // --- Data loading ---

  /** Record a single simulation snapshot (streaming mode) */
  recordSnapshot(snap: StepSnapshot): void {
    this.snapshots.push({ ...snap });
    this.currentTimeHours = snap.timeHours;

    // Auto-expand time window if needed
    if (snap.timeHours > this.maxHours * 0.9) {
      this.maxHours = Math.ceil(snap.timeHours / (24 * 7)) * 24 * 7 + 24 * 14;
    }
  }

  /** Load a full batch of snapshots at once (batch mode) */
  loadBatch(snapshots: StepSnapshot[], events: SimEvent[]): void {
    this.snapshots = snapshots;
    this.events = events;
    if (snapshots.length > 0) {
      const lastTime = snapshots[snapshots.length - 1].timeHours;
      this.maxHours = Math.ceil(lastTime / (24 * 7)) * 24 * 7 + 24 * 7;
      this.currentTimeHours = 0;
    }
    this.draw();
  }

  /** Record a material event (streaming mode) */
  recordEvent(ev: SimEvent): void {
    this.events.push(ev);
  }

  /** Set the scrubber position */
  setCurrentTime(timeHours: number): void {
    this.currentTimeHours = timeHours;
  }

  /** Get the snapshot nearest to a given time (for dashboard updates) */
  findNearestSnapshot(timeHours: number): StepSnapshot | null {
    if (this.snapshots.length === 0) return null;
    let nearest = this.snapshots[0];
    let nearestDist = Math.abs(nearest.timeHours - timeHours);
    for (const s of this.snapshots) {
      const dist = Math.abs(s.timeHours - timeHours);
      if (dist < nearestDist) { nearest = s; nearestDist = dist; }
    }
    return nearest;
  }

  /** Set the simulation start date for calendar month labels on x-axis. */
  setStartDate(date: Date | null): void {
    this.simStartDate = date;
  }

  /** Clear all recorded data */
  reset(): void {
    this.snapshots = [];
    this.events = [];
    this.currentTimeHours = 0;
    this.maxHours = 24 * 56;
    this.draw();
  }

  /** Force a redraw */
  draw(): void {
    const w = this.canvas.width / Math.min(window.devicePixelRatio, 2);
    const h = this.canvas.height / Math.min(window.devicePixelRatio, 2);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    if (this.snapshots.length < 2) {
      ctx.fillStyle = '#555';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Change any setting to compute full-year projection', w / 2, h / 2);
      return;
    }

    this.drawTempChart(ctx, w);
    this.drawO2MoistChart(ctx, w);
  }

  // ── Temperature Chart (top panel) ──────────────────────────────

  private drawTempChart(ctx: CanvasRenderingContext2D, chartWidth: number): void {
    const { margin, tempChartHeight: ch, maxHours } = this;
    const plotW = chartWidth - margin.left - margin.right;
    const plotH = ch;
    const ox = margin.left;
    const oy = margin.top;

    // Temperature range for Y axis
    const temps = this.snapshots.flatMap(s => [s.coreTemp, s.surfaceTemp]);
    const tMin = Math.min(20, Math.floor(Math.min(...temps) / 10) * 10);
    const tMax = Math.max(170, Math.ceil(Math.max(...temps) / 10) * 10);

    const xScale = (hours: number) => ox + (hours / maxHours) * plotW;
    const yScale = (temp: number) => oy + plotH - ((temp - tMin) / (tMax - tMin)) * plotH;

    // Zone backgrounds
    ctx.fillStyle = COLORS.frozen;
    ctx.fillRect(ox, yScale(40), plotW, yScale(tMin) - yScale(40));

    ctx.fillStyle = COLORS.mesophilic;
    ctx.fillRect(ox, yScale(THERMO_MIN), plotW, yScale(40) - yScale(THERMO_MIN));

    ctx.fillStyle = COLORS.thermophilic;
    ctx.fillRect(ox, yScale(THERMO_MAX), plotW, yScale(THERMO_MIN) - yScale(THERMO_MAX));

    // Zone labels
    ctx.font = '9px system-ui';
    ctx.fillStyle = '#4a6a4a';
    ctx.textAlign = 'right';
    ctx.fillText('THERMO', ox + plotW - 4, yScale(145));
    ctx.fillStyle = '#6a6a3a';
    ctx.fillText('MESO', ox + plotW - 4, yScale(85));

    // Reference lines at key temperatures
    for (const refT of [32, 100, THERMO_MIN, THERMO_MAX]) {
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(ox, yScale(refT));
      ctx.lineTo(ox + plotW, yScale(refT));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Y axis labels
    ctx.font = '9px system-ui';
    ctx.fillStyle = COLORS.gridText;
    ctx.textAlign = 'right';
    for (let t = tMin; t <= tMax; t += 20) {
      ctx.fillText(t + '°F', ox - 4, yScale(t) + 3);
    }

    // X axis labels — weeks for short sims, months for year sims
    ctx.textAlign = 'center';
    const useMonths = maxHours > 24 * 120; // >4 months: show months
    if (useMonths) {
      this.drawMonthLabels(ctx, xScale, ox, oy, plotW, plotH, maxHours);
    } else {
      for (let week = 0; week <= maxHours / 168; week++) {
        const x = xScale(week * 168);
        if (x > ox + plotW) break;
        ctx.fillStyle = '#333';
        ctx.fillRect(x, oy, 0.5, plotH);
        ctx.fillStyle = COLORS.gridText;
        ctx.fillText('W' + week, x, oy + plotH + 12);
      }
    }

    // Weight area (behind everything, secondary Y axis)
    this.drawWeightArea(ctx, xScale, oy, plotH, plotW, ox);

    // Event bars (behind temp lines)
    this.drawEvents(ctx, xScale, oy, plotH);

    // Ambient temperature line (faint background, shows weather cause/effect)
    if (this.hasWeatherData()) {
      ctx.beginPath();
      ctx.strokeStyle = COLORS.ambientLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (let i = 0; i < this.snapshots.length; i++) {
        const s = this.snapshots[i];
        const x = xScale(s.timeHours);
        const y = yScale(s.ambientTemp);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Temperature filled bands: core-to-surface range
    this.drawFilledBand(ctx, xScale, yScale, 'coreTemp', 'surfaceTemp', COLORS.coreFill);

    // Temperature lines
    this.drawLine(ctx, xScale, yScale, 'coreTemp', COLORS.coreTemp, 1.5);
    this.drawLine(ctx, xScale, yScale, 'avgTemp', COLORS.avgTemp, 1.0);
    this.drawLine(ctx, xScale, yScale, 'surfaceTemp', COLORS.surfTemp, 1.0);

    // Legend
    this.drawLegendItem(ctx, ox + 4, oy + 4, COLORS.coreTemp, 'Core');
    this.drawLegendItem(ctx, ox + 52, oy + 4, COLORS.avgTemp, 'Avg');
    this.drawLegendItem(ctx, ox + 92, oy + 4, COLORS.surfTemp, 'Surf');
    if (this.hasWeatherData()) {
      this.drawLegendItem(ctx, ox + 184, oy + 4, 'rgba(180, 180, 220, 0.7)', 'Ambient');
    }

    // Current time scrubber
    if (this.currentTimeHours >= 0) {
      const sx = xScale(this.currentTimeHours);
      ctx.strokeStyle = COLORS.scrubber;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(sx, oy);
      ctx.lineTo(sx, oy + plotH);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Scrubber handle (triangle at top)
      ctx.fillStyle = COLORS.scrubber;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(sx - 4, oy);
      ctx.lineTo(sx + 4, oy);
      ctx.lineTo(sx, oy + 6);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, plotW, plotH);
  }

  // ── O2 + Moisture Chart (bottom panel) ──────────────────────────

  private drawO2MoistChart(ctx: CanvasRenderingContext2D, chartWidth: number): void {
    const { margin, tempChartHeight, o2ChartHeight: ch, gap, maxHours } = this;
    const plotW = chartWidth - margin.left - margin.right;
    const ox = margin.left;
    const oy = margin.top + tempChartHeight + gap;

    const xScale = (hours: number) => ox + (hours / maxHours) * plotW;
    const yScale = (frac: number) => oy + ch - (frac * ch);

    // Background
    ctx.fillStyle = '#181828';
    ctx.fillRect(ox, oy, plotW, ch);

    // Fan duty cycle filled area (behind everything — shows fan effort)
    if (this.snapshots.length > 1 && this.snapshots[0].dutyCycle !== undefined) {
      ctx.beginPath();
      ctx.moveTo(xScale(this.snapshots[0].timeHours), yScale(0));
      for (let i = 0; i < this.snapshots.length; i++) {
        const s = this.snapshots[i];
        ctx.lineTo(xScale(s.timeHours), yScale(s.dutyCycle));
      }
      ctx.lineTo(xScale(this.snapshots[this.snapshots.length - 1].timeHours), yScale(0));
      ctx.closePath();
      ctx.fillStyle = COLORS.fanFill;
      ctx.fill();
    }

    // 5% O2 reference (below this, activity crashes)
    ctx.strokeStyle = '#442222';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(ox, yScale(0.05 / 0.21));
    ctx.lineTo(ox + plotW, yScale(0.05 / 0.21));
    ctx.stroke();
    ctx.setLineDash([]);

    // Y axis
    ctx.font = '9px system-ui';
    ctx.fillStyle = COLORS.gridText;
    ctx.textAlign = 'right';
    ctx.fillText('21%', ox - 4, yScale(1) + 3);
    ctx.fillText('10%', ox - 4, yScale(0.5) + 3);
    ctx.fillText('0%', ox - 4, yScale(0) + 3);

    // Right Y axis — fan duty cycle
    ctx.textAlign = 'left';
    ctx.fillStyle = '#665520';
    ctx.fillText('Fan', ox + plotW + 3, yScale(0.5) + 3);

    // O2 line (scaled: 0-21% maps to 0-1)
    ctx.beginPath();
    ctx.strokeStyle = COLORS.o2Line;
    ctx.lineWidth = 1;
    for (let i = 0; i < this.snapshots.length; i++) {
      const s = this.snapshots[i];
      const x = xScale(s.timeHours);
      const y = yScale(s.avgOxygen / 0.21);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Moisture line (0-1 FC maps to 0-1)
    ctx.beginPath();
    ctx.strokeStyle = COLORS.moistLine;
    ctx.lineWidth = 1;
    for (let i = 0; i < this.snapshots.length; i++) {
      const s = this.snapshots[i];
      const x = xScale(s.timeHours);
      const y = yScale(s.avgMoisture);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Bio activity line (0-1 maps to 0-1)
    ctx.beginPath();
    ctx.strokeStyle = COLORS.bioLine;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < this.snapshots.length; i++) {
      const s = this.snapshots[i];
      const x = xScale(s.timeHours);
      const y = yScale(s.avgBioActivity);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Scrubber line continues into bottom panel
    if (this.currentTimeHours >= 0) {
      const sx = xScale(this.currentTimeHours);
      ctx.strokeStyle = COLORS.scrubber;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(sx, oy);
      ctx.lineTo(sx, oy + ch);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Legend
    this.drawLegendItem(ctx, ox + 4, oy + 2, COLORS.o2Line, 'O\u2082');
    this.drawLegendItem(ctx, ox + 40, oy + 2, COLORS.moistLine, 'Moist');
    this.drawLegendItem(ctx, ox + 90, oy + 2, COLORS.bioLine, 'Bio %');

    // Border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, plotW, ch);
  }

  /** Detect weather mode by checking if ambient temp varies across snapshots */
  private hasWeatherData(): boolean {
    if (this.snapshots.length < 10) return false;
    const first = this.snapshots[0].ambientTemp;
    return this.snapshots.some(s => Math.abs(s.ambientTemp - first) > 2);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private drawLine(
    ctx: CanvasRenderingContext2D,
    xScale: (h: number) => number,
    yScale: (t: number) => number,
    field: keyof StepSnapshot,
    color: string,
    width: number,
  ): void {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (let i = 0; i < this.snapshots.length; i++) {
      const s = this.snapshots[i];
      const x = xScale(s.timeHours);
      const y = yScale(s[field] as number);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private drawFilledBand(
    ctx: CanvasRenderingContext2D,
    xScale: (h: number) => number,
    yScale: (t: number) => number,
    topField: keyof StepSnapshot,
    bottomField: keyof StepSnapshot,
    fill: string,
  ): void {
    if (this.snapshots.length < 2) return;

    ctx.beginPath();
    ctx.fillStyle = fill;

    // Forward pass (top line)
    for (let i = 0; i < this.snapshots.length; i++) {
      const s = this.snapshots[i];
      const x = xScale(s.timeHours);
      const y = yScale(s[topField] as number);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    // Backward pass (bottom line)
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const s = this.snapshots[i];
      const x = xScale(s.timeHours);
      const y = yScale(s[bottomField] as number);
      ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();
  }

  private drawMonthLabels(
    ctx: CanvasRenderingContext2D,
    xScale: (h: number) => number,
    ox: number, oy: number, plotW: number, plotH: number,
    maxHours: number,
  ): void {
    if (this.simStartDate) {
      // Calendar-aligned month boundaries
      const start = new Date(this.simStartDate);
      const endMs = start.getTime() + maxHours * 3600_000;
      let cursor = new Date(start.getFullYear(), start.getMonth() + 1, 1); // first month boundary

      while (cursor.getTime() <= endMs) {
        const hoursFromStart = (cursor.getTime() - start.getTime()) / 3600_000;
        const x = xScale(hoursFromStart);
        if (x > ox + plotW) break;

        ctx.fillStyle = '#333';
        ctx.fillRect(x, oy, 0.5, plotH);
        ctx.fillStyle = COLORS.gridText;
        ctx.fillText(MONTH_NAMES[cursor.getMonth()], x, oy + plotH + 12);

        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
    } else {
      // Fixed 30-day months (no start date)
      for (let month = 0; month <= maxHours / (24 * 30); month++) {
        const x = xScale(month * 24 * 30);
        if (x > ox + plotW) break;
        ctx.fillStyle = '#333';
        ctx.fillRect(x, oy, 0.5, plotH);
        ctx.fillStyle = COLORS.gridText;
        ctx.fillText('M' + month, x, oy + plotH + 12);
      }
    }
  }

  private drawWeightArea(
    ctx: CanvasRenderingContext2D,
    xScale: (h: number) => number,
    oy: number, plotH: number, plotW: number, ox: number,
  ): void {
    if (this.snapshots.length < 2) return;

    // Find max weight for scaling
    let maxWeight = 100;
    for (const s of this.snapshots) {
      if (s.weightLbs > maxWeight) maxWeight = s.weightLbs;
    }
    maxWeight = Math.ceil(maxWeight / 200) * 200; // round up to nearest 200

    const yScale = (lbs: number) => oy + plotH - (lbs / maxWeight) * plotH * 0.8;

    // Filled area
    ctx.beginPath();
    ctx.fillStyle = 'rgba(180, 160, 120, 0.12)';
    ctx.moveTo(xScale(this.snapshots[0].timeHours), oy + plotH);
    for (const s of this.snapshots) {
      ctx.lineTo(xScale(s.timeHours), yScale(s.weightLbs));
    }
    ctx.lineTo(xScale(this.snapshots[this.snapshots.length - 1].timeHours), oy + plotH);
    ctx.closePath();
    ctx.fill();

    // Weight line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(180, 160, 120, 0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < this.snapshots.length; i++) {
      const s = this.snapshots[i];
      const x = xScale(s.timeHours);
      const y = yScale(s.weightLbs);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Right-side Y axis labels for weight
    ctx.font = '8px system-ui';
    ctx.fillStyle = 'rgba(180, 160, 120, 0.5)';
    ctx.textAlign = 'left';
    for (let w = 0; w <= maxWeight; w += Math.max(200, Math.ceil(maxWeight / 4 / 200) * 200)) {
      const y = yScale(w);
      if (y > oy && y < oy + plotH - 5) {
        ctx.fillText(w + 'lb', ox + plotW + 2, y + 3);
      }
    }

    // Legend
    this.drawLegendItem(ctx, ox + 132, oy + 4, 'rgba(180, 160, 120, 0.7)', 'Weight');
  }

  private drawEvents(
    ctx: CanvasRenderingContext2D,
    xScale: (h: number) => number,
    oy: number,
    plotH: number,
  ): void {
    for (const ev of this.events) {
      const x = xScale(ev.timeHours);
      if (ev.type === 'addition') {
        // Green bar, height proportional to volume (128 gal = full height reference)
        const barH = Math.min(plotH * 0.8, (ev.volumeGallons ?? 128) / 128 * plotH * 0.3);
        ctx.fillStyle = COLORS.addition;
        ctx.fillRect(x - 1.5, oy + plotH - barH, 3, barH);
      } else {
        // Red dashed line for transfer
        ctx.strokeStyle = COLORS.transfer;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.font = '8px system-ui';
        ctx.fillStyle = COLORS.transfer;
        ctx.textAlign = 'center';
        ctx.fillText('XFER', x, oy + 10);
      }
    }
  }

  private drawLegendItem(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    color: string, label: string,
  ): void {
    ctx.fillStyle = color;
    ctx.fillRect(x, y + 2, 10, 3);
    ctx.fillStyle = '#999';
    ctx.font = '8px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 13, y + 7);
  }
}
