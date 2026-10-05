(() => {
  "use strict";

  const DATASETS = [
    { file: "CMMS_grupo_A.csv", label: "Grupo A" },
    { file: "CMMS_grupo_B.csv", label: "Grupo B" },
    { file: "CMMS_grupo_C.csv", label: "Grupo C" },
    { file: "CMMS_grupo_D.csv", label: "Grupo D" }
  ];
  const NUMERIC_FIELDS = [
    "Downtime_h", "Horas_mano_obra", "Costo_repuestos_CLP",
    "Costo_externo_CLP", "Costo_total_CLP", "Duración_OT_h",
    "Prioridad_SAP", "Tiempo_espera_h", "Tiempo_reparacion_h",
    "Cantidad_repuestos"
  ];
  const DATE_FIELDS = [
    "Fecha_creación", "Fecha_inicio", "Fecha_fin",
    "Fecha_necesidad", "Fecha_planificada"
  ];
  const COLORS = {
    grave: "#d45f64",
    agudo: "#d99732",
    cronico: "#3478c5",
    control: "#16a6a1"
  };
  const state = { rows: [], rawRows: [], sourceRowCount: 0, duplicatesRemoved: 0, headers: [], sourceName: "", page: "overview" };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(String(value).trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseDate(value) {
    if (!value) return null;
    const text = String(value).trim();
    const match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) {
      const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
      const date = new Date(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseCsv(text) {
    const input = text.replace(/^\uFEFF/, "");
    const firstLine = input.split(/\r?\n/, 1)[0] || "";
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const delimiter = semiCount > commaCount ? ";" : ",";
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (quoted) {
        if (char === '"') {
          if (input[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          cell += char;
        }
      } else if (char === '"' && cell.length === 0) {
        quoted = true;
      } else if (char === delimiter) {
        row.push(cell);
        cell = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && input[i + 1] === "\n") i += 1;
        row.push(cell);
        if (row.some((item) => item.trim() !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    if (quoted) throw new Error("El CSV contiene un campo entre comillas que no está cerrado.");
    row.push(cell);
    if (row.some((item) => item.trim() !== "")) rows.push(row);
    if (rows.length < 2) throw new Error("El archivo no contiene filas de datos.");
    const headers = rows[0].map((header) => header.trim().replace(/^'/, ""));
    if (headers.some((header) => !header)) throw new Error("El CSV contiene un nombre de columna vacío.");
    return {
      headers,
      rows: rows.slice(1).map((values) => {
        const record = {};
        headers.forEach((header, index) => {
          record[header] = cleanText(values[index] ?? "");
        });
        return record;
      })
    };
  }

  function cleanText(value) {
    const clean = String(value ?? "").trim().replace(/^'/, "").trim();
    return clean === "" ? null : clean;
  }

  function normalizeRows(parsed) {
    const required = ["OT", "Equipo", "Tipo_mantenimiento", "Downtime_h", "Horas_mano_obra", "Costo_total_CLP"];
    const missing = required.filter((field) => !parsed.headers.includes(field));
    if (missing.length) throw new Error(`Faltan columnas necesarias para el análisis: ${missing.join(", ")}.`);
    const maintenanceMap = {
      correctivo: "Correctivo",
      preventivo: "Preventivo",
      preventiva: "Preventivo",
      predictivo: "Predictivo"
    };
    const stateMap = {
      cerrada: "CERRADA",
      cerrado: "CERRADA",
      abierta: "ABIERTA",
      abierto: "ABIERTA",
      "en ejecucion": "EN EJECUCIÓN",
      "en ejecución": "EN EJECUCIÓN",
      ejecutando: "EN EJECUCIÓN"
    };
    const plannedMap = { si: "Sí", "sí": "Sí", no: "No" };
    const normalizedRows = parsed.rows.map((row) => {
      const normalized = { ...row };
      for (const field of NUMERIC_FIELDS) {
        if (field in normalized) normalized[field] = numberValue(normalized[field]);
      }
      for (const field of DATE_FIELDS) {
        if (field in normalized) normalized[field] = parseDate(normalized[field]);
      }
      const rawType = normalized.Tipo_mantenimiento;
      if (rawType) normalized.Tipo_mantenimiento = maintenanceMap[rawType.toLowerCase()] || rawType;
      const rawState = normalized.Estado;
      if (rawState) normalized.Estado = stateMap[rawState.toLowerCase()] || rawState;
      const rawPlanned = normalized.Planificado;
      if (rawPlanned) normalized.Planificado = plannedMap[rawPlanned.toLowerCase()] || rawPlanned;
      return normalized;
    });
    const seen = new Set();
    return normalizedRows.filter((row) => {
      const signature = JSON.stringify(parsed.headers.map((field) => {
        const value = row[field];
        return value instanceof Date ? value.toISOString() : value;
      }));
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
  }

  function uniqueCount(rows, field) {
    return new Set(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined && value !== "")).size;
  }

  function sum(rows, field) {
    return rows.reduce((total, row) => total + (Number.isFinite(row[field]) ? row[field] : 0), 0);
  }

  function mean(values) {
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function groupBy(rows, keyField, fields) {
    const groups = new Map();
    for (const row of rows) {
      const key = row[keyField];
      if (key === null || key === undefined || key === "") continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.entries()].map(([key, groupRows]) => {
      const result = { key, rows: groupRows };
      for (const [name, operation] of Object.entries(fields)) {
        result[name] = operation(groupRows);
      }
      return result;
    });
  }

  function selectedRows() {
    const type = $("maintenanceFilter").value;
    const criticality = $("criticalityFilter").value;
    const equipment = $("equipmentFilter").value;
    const fromValue = $("dateFrom").value ? new Date(`${$("dateFrom").value}T00:00:00`) : null;
    const toValue = $("dateTo").value ? new Date(`${$("dateTo").value}T23:59:59`) : null;
    return state.rows.filter((row) => {
      if (type && row.Tipo_mantenimiento !== type) return false;
      if (criticality && row.Criticidad !== criticality) return false;
      if (equipment && row.Equipo !== equipment) return false;
      if (fromValue || toValue) {
        const created = row["Fecha_creación"];
        if (!created || (fromValue && created < fromValue) || (toValue && created > toValue)) return false;
      }
      return true;
    });
  }

  function formatNumber(value, digits = 1) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  }

  function formatInteger(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value);
  }

  function formatPercent(value) {
    return value === null || !Number.isFinite(value) ? "—" : `${formatNumber(value, 1)} %`;
  }

  function percent(part, total) {
    return total ? 100 * part / total : 0;
  }

  function summarize(rows) {
    const maintenance = groupBy(rows, "Tipo_mantenimiento", {
      ot: (groupRows) => uniqueCount(groupRows, "OT"),
      hh: (groupRows) => sum(groupRows, "Horas_mano_obra"),
      downtime: (groupRows) => sum(groupRows, "Downtime_h"),
      cost: (groupRows) => sum(groupRows, "Costo_total_CLP")
    });
    maintenance.sort((a, b) => b.ot - a.ot);
    for (const item of maintenance) {
      item.otPct = percent(item.ot, uniqueCount(rows, "OT"));
      item.hhPct = percent(item.hh, sum(rows, "Horas_mano_obra"));
      item.downtimePct = percent(item.downtime, sum(rows, "Downtime_h"));
      item.costPct = percent(item.cost, sum(rows, "Costo_total_CLP"));
    }

    const downtimes = groupBy(rows, "Equipo", { value: (groupRows) => sum(groupRows, "Downtime_h") }).sort((a, b) => b.value - a.value);
    const costs = groupBy(rows, "Equipo", { value: (groupRows) => sum(groupRows, "Costo_total_CLP") }).sort((a, b) => b.value - a.value);
    const byMaintenanceDowntime = [...maintenance].sort((a, b) => b.downtime - a.downtime);
    const byMaintenanceCost = [...maintenance].sort((a, b) => b.cost - a.cost);
    const correctives = rows.filter((row) => String(row.Tipo_mantenimiento || "").trim().toLowerCase() === "correctivo");
    const validRepairs = correctives.filter((row) => {
      const stateValue = String(row.Estado || "").trim().toLowerCase();
      const start = row.Fecha_inicio;
      const end = row.Fecha_fin;
      const duration = start instanceof Date && end instanceof Date ? (end - start) / 3600000 : NaN;
      row.__repairHours = duration;
      return stateValue === "cerrada" && Number.isFinite(duration) && duration > 0;
    });
    const repairHours = validRepairs.map((row) => row.__repairHours);
    const mttrByType = groupBy(validRepairs, "Tipo_equipo", {
      count: (groupRows) => uniqueCount(groupRows, "OT"),
      mttr: (groupRows) => mean(groupRows.map((row) => row.__repairHours)),
      median: (groupRows) => median(groupRows.map((row) => row.__repairHours))
    }).sort((a, b) => b.mttr - a.mttr);
    const paretoBase = groupBy(correctives, "Modo_falla", {
      events: (groupRows) => uniqueCount(groupRows, "OT"),
      downtime: (groupRows) => sum(groupRows, "Downtime_h"),
      cost: (groupRows) => sum(groupRows, "Costo_total_CLP")
    });
    const pareto = (field) => {
      const ordered = [...paretoBase].sort((a, b) => b[field] - a[field]);
      const total = ordered.reduce((acc, item) => acc + item[field], 0);
      let accumulated = 0;
      return ordered.map((item) => {
        accumulated += item[field];
        return { ...item, pct: percent(item[field], total), cumulative: percent(accumulated, total) };
      });
    };
    const jkEquipment = groupBy(validRepairs, "Equipo", {
      equipmentType: (groupRows) => groupRows.find((row) => row.Tipo_equipo)?.Tipo_equipo || "",
      criticality: (groupRows) => groupRows.find((row) => row.Criticidad)?.Criticidad || "",
      failures: (groupRows) => uniqueCount(groupRows, "OT"),
      downtime: (groupRows) => sum(groupRows, "Downtime_h")
    }).map((item) => ({ ...item, mttr: item.failures ? item.downtime / item.failures : 0 }));
    const nLimit = jkEquipment.length ? jkEquipment.reduce((acc, item) => acc + item.failures, 0) / jkEquipment.length : 0;
    const mttrLimit = jkEquipment.reduce((acc, item) => acc + item.downtime, 0) / (jkEquipment.reduce((acc, item) => acc + item.failures, 0) || 1);
    for (const item of jkEquipment) {
      item.frequencyNorm = nLimit ? item.failures / nLimit : 0;
      item.mttrNorm = mttrLimit ? item.mttr / mttrLimit : 0;
      item.risk = item.frequencyNorm * item.mttrNorm;
      item.classification = classify(item.frequencyNorm, item.mttrNorm);
    }
    jkEquipment.sort((a, b) => b.risk - a.risk);

    const validWithMode = validRepairs.filter((row) => row.Modo_falla !== null && row.Modo_falla !== undefined);
    const jkModes = groupBy(validWithMode, "Modo_falla", {
      failures: (groupRows) => uniqueCount(groupRows, "OT"),
      downtime: (groupRows) => sum(groupRows, "Downtime_h")
    }).map((item) => ({ ...item, mttr: item.failures ? item.downtime / item.failures : 0 }));
    const nModeLimit = jkModes.length ? jkModes.reduce((acc, item) => acc + item.failures, 0) / jkModes.length : 0;
    const mttrModeLimit = jkModes.reduce((acc, item) => acc + item.downtime, 0) / (jkModes.reduce((acc, item) => acc + item.failures, 0) || 1);
    for (const item of jkModes) {
      item.frequencyNorm = nModeLimit ? item.failures / nModeLimit : 0;
      item.mttrNorm = mttrModeLimit ? item.mttr / mttrModeLimit : 0;
      item.risk = item.frequencyNorm * item.mttrNorm;
      item.classification = classify(item.frequencyNorm, item.mttrNorm);
    }
    jkModes.sort((a, b) => b.risk - a.risk);

    return {
      rows, maintenance, totalOT: uniqueCount(rows, "OT"),
      totalHH: sum(rows, "Horas_mano_obra"),
      totalDowntime: sum(rows, "Downtime_h"),
      totalCost: sum(rows, "Costo_total_CLP"),
      downtimes, costs, byMaintenanceDowntime, byMaintenanceCost,
      correctives, validRepairs, mttr: mean(repairHours), median: median(repairHours),
      mttrByType, paretoFrequency: pareto("events"),
      paretoDowntime: pareto("downtime"), paretoCost: pareto("cost"),
      jkEquipment, jkModes
    };
  }

  function classify(frequency, mttr) {
    if (frequency < 1 && mttr < 1) return "Bajo control";
    if (frequency < 1 && mttr >= 1) return "Agudo";
    if (frequency >= 1 && mttr < 1) return "Crónico";
    return "Grave";
  }

  function kpi(label, value, note, accent = "var(--blue)") {
    return `<article class="kpi-card" style="--accent:${accent}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-meta">${escapeHtml(note)}</div></article>`;
  }

  function card(title, subtitle, body, wide = false) {
    return `<article class="card${wide ? " wide" : ""}"><div class="card-heading"><div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div></div>${body}</article>`;
  }

  function note(text) {
    return `<div class="chart-note"><strong>Lectura:</strong> ${text}</div>`;
  }

  function barChart(items, valueKey, options = {}) {
    const rows = items.slice(0, options.limit || 10);
    if (!rows.length) return emptyChart();
    const width = 780;
    const labelWidth = options.labelWidth || 175;
    const right = 75;
    const rowHeight = 30;
    const top = 12;
    const height = top + rows.length * rowHeight + 18;
    const chartWidth = width - labelWidth - right;
    const maxValue = Math.max(...rows.map((item) => item[valueKey] || 0), 0.00001);
    const bars = rows.map((item, index) => {
      const y = top + index * rowHeight;
      const barWidth = chartWidth * (item[valueKey] || 0) / maxValue;
      const colorClass = options.colorClass || "";
      return `<g><title>${escapeHtml(item.key)}: ${escapeHtml(options.format ? options.format(item[valueKey]) : formatNumber(item[valueKey]))}</title><text x="${labelWidth - 10}" y="${y + 15}" text-anchor="end">${escapeHtml(shortLabel(item.key, 24))}</text><rect class="bar ${colorClass}" x="${labelWidth}" y="${y + 3}" width="${Math.max(1, barWidth)}" height="17" rx="5"/><text class="value-label" x="${Math.min(labelWidth + barWidth + 8, width - 5)}" y="${y + 16}">${escapeHtml(options.format ? options.format(item[valueKey]) : formatNumber(item[valueKey]))}</text></g>`;
    }).join("");
    const grid = [0, .25, .5, .75, 1].map((ratio) => {
      const x = labelWidth + chartWidth * ratio;
      return `<line class="gridline" x1="${x}" x2="${x}" y1="5" y2="${height - 8}"/>`;
    }).join("");
    return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.aria || "Gráfico de barras")}">${grid}${bars}</svg></div>`;
  }

  function multiBarChart(items, series) {
    if (!items.length) return emptyChart();
    const width = 780;
    const labelWidth = 160;
    const right = 52;
    const groupHeight = Math.max(52, series.length * 16 + 8);
    const top = 12;
    const chartWidth = width - labelWidth - right;
    const height = top + items.length * groupHeight + 18;
    const grid = [0, 25, 50, 75, 100].map((value) => {
      const x = labelWidth + chartWidth * value / 100;
      return `<g><line class="gridline" x1="${x}" x2="${x}" y1="5" y2="${height - 8}"/><text x="${x}" y="${height - 1}" text-anchor="middle">${value}%</text></g>`;
    }).join("");
    const bars = items.map((item, index) => {
      const groupTop = top + index * groupHeight;
      const label = `<text x="${labelWidth - 9}" y="${groupTop + groupHeight / 2 + 4}" text-anchor="end">${escapeHtml(shortLabel(item.key, 22))}</text>`;
      const groupBars = series.map((entry, seriesIndex) => {
        const value = item[entry.key] || 0;
        const y = groupTop + seriesIndex * 16;
        const barLength = chartWidth * Math.max(0, Math.min(100, value)) / 100;
        return `<g><title>${escapeHtml(item.key)} · ${escapeHtml(entry.label)}: ${escapeHtml(formatPercent(value))}</title><rect x="${labelWidth}" y="${y + 2}" width="${Math.max(1, barLength)}" height="10" rx="4" fill="${entry.color}"/><text class="value-label" x="${Math.min(labelWidth + barLength + 5, width - 4)}" y="${y + 11}">${escapeHtml(formatNumber(value, 1))}%</text></g>`;
      }).join("");
      return `<g>${label}${groupBars}</g>`;
    }).join("");
    const legend = series.map((entry, index) => `<g transform="translate(${labelWidth + index * 145},${height - 3})"><rect width="9" height="9" rx="2" fill="${entry.color}"/><text x="14" y="9">${escapeHtml(entry.label)}</text></g>`).join("");
    return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${width} ${height + 18}" role="img" aria-label="Comparación porcentual por tipo de mantenimiento">${grid}${bars}${legend}</svg></div>`;
  }

  function paretoChart(items, valueKey, format) {
    const rows = items.slice(0, 10);
    if (!rows.length) return emptyChart();
    const width = 780;
    const labelWidth = 190;
    const barWidth = 385;
    const pctWidth = 135;
    const rowHeight = 32;
    const top = 15;
    const height = top + rows.length * rowHeight + 15;
    const maxValue = Math.max(...rows.map((item) => item[valueKey] || 0), 0.00001);
    const points = rows.map((item, index) => {
      const y = top + index * rowHeight + 12;
      const x = labelWidth + barWidth + 10 + pctWidth * Math.max(0, Math.min(100, item.cumulative)) / 100;
      return `${x},${y}`;
    }).join(" ");
    const marks = rows.map((item, index) => {
      const y = top + index * rowHeight;
      const amount = barWidth * (item[valueKey] || 0) / maxValue;
      const x = labelWidth + barWidth + 10 + pctWidth * Math.max(0, Math.min(100, item.cumulative)) / 100;
      return `<g><title>${escapeHtml(item.key)}: ${escapeHtml(format(item[valueKey]))}; acumulado ${escapeHtml(formatPercent(item.cumulative))}</title><text x="${labelWidth - 10}" y="${y + 16}" text-anchor="end">${escapeHtml(shortLabel(item.key, 27))}</text><rect class="bar" x="${labelWidth}" y="${y + 3}" width="${Math.max(1, amount)}" height="16" rx="4"/><text class="value-label" x="${Math.min(labelWidth + amount + 6, labelWidth + barWidth)}" y="${y + 15}">${escapeHtml(format(item[valueKey]))}</text><circle class="pareto-point" cx="${x}" cy="${y + 12}" r="4"/><text x="${x + 7}" y="${y + 16}">${escapeHtml(formatPercent(item.cumulative))}</text></g>`;
    }).join("");
    return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Diagrama Pareto con porcentaje acumulado">${marks}<polyline class="pareto-line" points="${points}"/></svg></div>`;
  }

  function jackknifeChart(items, label) {
    if (!items.length) return emptyChart();
    const width = 760;
    const height = 420;
    const left = 58;
    const right = 20;
    const top = 20;
    const bottom = 52;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const maxX = Math.max(2, ...items.map((item) => item.frequencyNorm)) * 1.06;
    const maxY = Math.max(2, ...items.map((item) => item.mttrNorm)) * 1.06;
    const x = (value) => left + (value / maxX) * plotW;
    const y = (value) => top + plotH - (value / maxY) * plotH;
    const midX = x(1);
    const midY = y(1);
    const bg = `<rect class="quadrant alt" x="${left}" y="${top}" width="${Math.max(0, midX - left)}" height="${Math.max(0, midY - top)}"/><rect class="quadrant" x="${midX}" y="${top}" width="${Math.max(0, left + plotW - midX)}" height="${Math.max(0, midY - top)}"/><rect class="quadrant" x="${left}" y="${midY}" width="${Math.max(0, midX - left)}" height="${Math.max(0, top + plotH - midY)}"/><rect class="quadrant alt" x="${midX}" y="${midY}" width="${Math.max(0, left + plotW - midX)}" height="${Math.max(0, top + plotH - midY)}"/>`;
    const lines = `<line class="ref-line" x1="${midX}" x2="${midX}" y1="${top}" y2="${top + plotH}"/><line class="ref-line" x1="${left}" x2="${left + plotW}" y1="${midY}" y2="${midY}"/><line class="axis" x1="${left}" x2="${left + plotW}" y1="${top + plotH}" y2="${top + plotH}"/><line class="axis" x1="${left}" x2="${left}" y1="${top}" y2="${top + plotH}"/><text x="${left + 5}" y="${top + 14}">Agudo</text><text x="${left + plotW - 50}" y="${top + 14}">Grave</text><text x="${left + 5}" y="${top + plotH - 7}">Bajo control</text><text x="${left + plotW - 50}" y="${top + plotH - 7}">Crónico</text><text x="${left + plotW / 2}" y="${height - 10}" text-anchor="middle">Frecuencia normalizada</text><text transform="translate(15 ${top + plotH / 2}) rotate(-90)" text-anchor="middle">MTTR normalizado</text>`;
    const dots = items.map((item) => {
      const color = COLORS[classKey(item.classification)] || COLORS.control;
      return `<circle class="scatter-dot" cx="${x(item.frequencyNorm)}" cy="${y(item.mttrNorm)}" r="${Math.min(9, 4 + Math.sqrt(item.risk || 0))}" fill="${color}"><title>${escapeHtml(item.key)} · ${escapeHtml(item.classification)} · R* ${formatNumber(item.risk, 2)} · ${label}</title></circle>`;
    }).join("");
    return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Diagrama Jack-Knife de ${escapeHtml(label)}">${bg}${lines}${dots}</svg></div>`;
  }

  function classKey(value) {
    return ({ "Grave": "grave", "Agudo": "agudo", "Crónico": "cronico", "Bajo control": "control" })[value] || "control";
  }

  function emptyChart() {
    return '<div class="empty-state">No hay datos suficientes para representar este análisis con los filtros actuales.</div>';
  }

  function shortLabel(value, length) {
    const text = String(value ?? "Sin dato");
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function table(headers, rows, renderCell) {
    if (!rows.length) return '<div class="empty-state">Sin registros para los filtros actuales.</div>';
    const head = headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("");
    const body = rows.map((row, index) => `<tr>${headers.map((header) => `<td class="${header.numeric ? "number-cell" : ""}">${renderCell ? renderCell(row, header.key, index) : escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("");
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function chartCard(title, subtitle, chart, interpretation, wide = false) {
    return card(title, subtitle, `${chart}${interpretation ? note(interpretation) : ""}`, wide);
  }

  function buildMaintenanceTable(summary) {
    const headers = [
      { key: "key", label: "Tipo de mantenimiento" },
      { key: "ot", label: "OT", numeric: true },
      { key: "otPct", label: "% OT", numeric: true },
      { key: "hhPct", label: "% HH", numeric: true },
      { key: "downtimePct", label: "% downtime", numeric: true },
      { key: "costPct", label: "% costo", numeric: true }
    ];
    return table(headers, summary.maintenance, (row, key) => {
      if (key === "ot") return formatInteger(row.ot);
      if (key.endsWith("Pct")) return formatPercent(row[key]);
      return escapeHtml(row.key);
    });
  }

  function renderOverview(summary) {
    if (!summary.rows.length) return emptyChart();
    const topDT = summary.downtimes[0];
    const topMode = summary.paretoDowntime[0];
    const topJK = summary.jkEquipment[0];
    const grid = `<div class="kpi-grid">${kpi("Órdenes únicas", formatInteger(summary.totalOT), `${formatInteger(summary.rows.length)} registros filtrados`, "var(--blue)")}${kpi("Horas de mano de obra", `${formatNumber(summary.totalHH)} h`, "Suma de Horas_mano_obra", "var(--cyan)")}${kpi("Downtime acumulado", `${formatNumber(summary.totalDowntime)} h`, "Pérdida operacional observada", "var(--red)")}${kpi("Costo directo", `${formatNumber(summary.totalCost, 0)} CLP`, "Suma del costo total registrado", "var(--amber)")}${kpi("MTTR correctivo", summary.mttr === null ? "—" : `${formatNumber(summary.mttr)} h`, `${formatInteger(uniqueCount(summary.validRepairs, "OT"))} OT correctivas válidas`, "var(--blue)")}${kpi("Mediana de reparación", summary.median === null ? "—" : `${formatNumber(summary.median)} h`, "Mismas OT válidas del MTTR", "var(--cyan)")}</div>`;
    const callout = `<div class="callout"><strong>Foco operacional.</strong> ${topDT ? `${escapeHtml(topDT.key)} registra el mayor downtime por equipo (${formatNumber(topDT.value)} h).` : "No hay datos de equipo."} ${topMode ? `El modo de falla con más horas acumuladas es ${escapeHtml(topMode.key)} (${formatNumber(topMode.downtime)} h).` : ""} ${topJK ? `Jack-Knife sitúa primero a ${escapeHtml(topJK.key)} (${escapeHtml(topJK.classification)}, R* ${formatNumber(topJK.risk, 2)}).` : ""}</div>`;
    const types = summary.maintenance;
    const distribution = chartCard("Órdenes de trabajo por tipo", "OT únicas por tipo de mantenimiento", barChart(types, "ot", { format: formatInteger }), types[0] ? `La categoría con mayor número de OT es ${escapeHtml(types[0].key)} (${formatInteger(types[0].ot)}; ${formatPercent(types[0].otPct)}).` : "");
    const labor = [...types].sort((a, b) => b.hh - a.hh);
    const laborCard = chartCard("Horas de mano de obra", "Carga de trabajo registrada por estrategia", barChart(labor, "hh", { colorClass: "alt", format: (v) => `${formatNumber(v)} h` }), labor[0] ? `La mayor carga de mano de obra corresponde a ${escapeHtml(labor[0].key)} (${formatNumber(labor[0].hh)} h; ${formatPercent(labor[0].hhPct)}).` : "");
    const compareCard = chartCard(
      "Comparación de OT y horas de mano de obra",
      "Participación relativa por tipo de mantenimiento",
      multiBarChart(types, [
        { key: "otPct", label: "% OT", color: "#3478c5" },
        { key: "hhPct", label: "% HH", color: "#16a6a1" }
      ]),
      labor[0] ? `${escapeHtml(labor[0].key)} representa ${formatPercent(labor[0].otPct)} de las OT y ${formatPercent(labor[0].hhPct)} de las horas-hombre.` : ""
    );
    const impactCard = chartCard(
      "Resumen de impacto por estrategia",
      "Porcentaje del total de OT, HH, downtime y costo",
      multiBarChart(types, [
        { key: "otPct", label: "% OT", color: "#3478c5" },
        { key: "hhPct", label: "% HH", color: "#16a6a1" },
        { key: "downtimePct", label: "% downtime", color: "#d45f64" },
        { key: "costPct", label: "% costo", color: "#d99732" }
      ]),
      summary.byMaintenanceDowntime[0] ? `${escapeHtml(summary.byMaintenanceDowntime[0].key)} concentra el mayor porcentaje de downtime (${formatPercent(summary.byMaintenanceDowntime[0].downtimePct)}).` : ""
    );
    return `${grid}${callout}<div class="content-grid">${distribution}${laborCard}${compareCard}${impactCard}${card("Indicadores por estrategia", "Participación relativa de OT, esfuerzo, downtime y costo", buildMaintenanceTable(summary), true)}</div>`;
  }

  function renderDowntime(summary) {
    const byType = summary.byMaintenanceDowntime;
    const byEquipment = summary.downtimes.slice(0, 10);
    const topType = byType[0];
    const topEq = byEquipment[0];
    const typeNote = topType ? `${escapeHtml(topType.key)} concentra ${formatPercent(topType.downtimePct)} del downtime (${formatNumber(topType.downtime)} h).` : "";
    const equipmentNote = topEq ? `${escapeHtml(topEq.key)} tiene el mayor downtime por activo (${formatNumber(topEq.value)} h; ${formatPercent(percent(topEq.value, summary.totalDowntime))} del total).` : "";
    const typeChart = chartCard("Downtime por tipo de mantenimiento", "Distribución del tiempo fuera de servicio", barChart(byType, "downtime", { colorClass: "warm", format: (v) => `${formatNumber(v)} h` }), typeNote);
    const equipChart = chartCard("Equipos con mayor pérdida operacional", "10 activos con más horas de downtime", barChart(byEquipment, "value", { colorClass: "warm", format: (v) => `${formatNumber(v)} h`, labelWidth: 190 }), equipmentNote, true);
    const ranked = byEquipment.map((row) => ({ key: row.key, value: row.value, pct: percent(row.value, summary.totalDowntime) }));
    const eqTable = table([{ key: "key", label: "Equipo" }, { key: "value", label: "Downtime [h]", numeric: true }, { key: "pct", label: "% downtime total", numeric: true }], ranked, (row, key) => key === "value" ? formatNumber(row.value) : key === "pct" ? formatPercent(row.pct) : escapeHtml(row.key));
    return `<div class="content-grid">${typeChart}${card("Distribución cuantitativa", "Tiempo acumulado por estrategia de mantenimiento", buildDowntimeTypeTable(byType))}${equipChart}${card("Ranking de activos", "Top 10 según horas de indisponibilidad", eqTable)}</div>`;
  }

  function buildDowntimeTypeTable(rows) {
    return table([{ key: "key", label: "Tipo" }, { key: "downtime", label: "Downtime [h]", numeric: true }, { key: "downtimePct", label: "Participación", numeric: true }], rows, (row, key) => key === "downtime" ? formatNumber(row.downtime) : key === "downtimePct" ? formatPercent(row.downtimePct) : escapeHtml(row.key));
  }

  function renderCosts(summary) {
    const byType = summary.byMaintenanceCost;
    const byEquipment = summary.costs.slice(0, 10);
    const typeChart = chartCard("Costo directo por tipo", "Suma de Costo_total_CLP por estrategia", barChart(byType, "cost", { colorClass: "warm", format: (v) => `${formatNumber(v, 0)} CLP`, labelWidth: 190 }), byType[0] ? `${escapeHtml(byType[0].key)} representa ${formatPercent(byType[0].costPct)} del costo total (${formatNumber(byType[0].cost, 0)} CLP).` : "");
    const eqChart = chartCard("Equipos con mayor costo", "10 activos con mayor costo directo acumulado", barChart(byEquipment, "value", { colorClass: "warm", format: (v) => `${formatNumber(v, 0)} CLP`, labelWidth: 190 }), byEquipment[0] ? `${escapeHtml(byEquipment[0].key)} tiene el mayor costo por activo (${formatNumber(byEquipment[0].value, 0)} CLP; ${formatPercent(percent(byEquipment[0].value, summary.totalCost))} del total).` : "", true);
    const tableRows = byEquipment.map((row) => ({ key: row.key, value: row.value, pct: percent(row.value, summary.totalCost) }));
    const costTable = table([{ key: "key", label: "Equipo" }, { key: "value", label: "Costo directo [CLP]", numeric: true }, { key: "pct", label: "% del total", numeric: true }], tableRows, (row, key) => key === "value" ? formatNumber(row.value, 0) : key === "pct" ? formatPercent(row.pct) : escapeHtml(row.key));
    return `<div class="kpi-grid">${kpi("Costo directo total", `${formatNumber(summary.totalCost, 0)} CLP`, "Incluye todos los registros filtrados", "var(--amber)")}${kpi("Tipo con mayor costo", byType[0]?.key || "—", byType[0] ? `${formatPercent(byType[0].costPct)} del gasto` : "Sin datos", "var(--blue)")}${kpi("Equipo con mayor costo", byEquipment[0]?.key || "—", byEquipment[0] ? `${formatNumber(byEquipment[0].value, 0)} CLP` : "Sin datos", "var(--red)")}</div><div class="content-grid">${typeChart}${card("Participación de costos", "Costo total registrado por tipo de mantenimiento", buildCostTypeTable(byType))}${eqChart}${card("Ranking de equipos", "Costo directo acumulado por activo", costTable)}</div>`;
  }

  function buildCostTypeTable(rows) {
    return table([{ key: "key", label: "Tipo" }, { key: "cost", label: "Costo [CLP]", numeric: true }, { key: "costPct", label: "Participación", numeric: true }], rows, (row, key) => key === "cost" ? formatNumber(row.cost, 0) : key === "costPct" ? formatPercent(row.costPct) : escapeHtml(row.key));
  }

  function renderMttr(summary) {
    const typeRows = summary.mttrByType;
    const chart = chartCard("MTTR por tipo de equipo", "Reparaciones correctivas cerradas y con fechas válidas", barChart(typeRows.map((item) => ({ key: item.key, value: item.mttr, count: item.count })), "value", { format: (v) => `${formatNumber(v)} h`, labelWidth: 205 }), typeRows[0] ? `${escapeHtml(typeRows[0].key)} presenta el MTTR medio más alto (${formatNumber(typeRows[0].mttr)} h; ${formatInteger(typeRows[0].count)} OT válidas).` : "");
    const rows = typeRows.map((row) => ({ ...row }));
    const tableHtml = table([{ key: "key", label: "Tipo de equipo" }, { key: "count", label: "Reparaciones", numeric: true }, { key: "mttr", label: "MTTR [h]", numeric: true }, { key: "median", label: "Mediana [h]", numeric: true }], rows, (row, key) => key === "count" ? formatInteger(row.count) : key === "mttr" || key === "median" ? formatNumber(row[key]) : escapeHtml(row.key));
    const global = `<div class="kpi-grid">${kpi("MTTR global correctivo", summary.mttr === null ? "—" : `${formatNumber(summary.mttr)} h`, "Promedio de duraciones válidas", "var(--blue)")}${kpi("Mediana de reparación", summary.median === null ? "—" : `${formatNumber(summary.median)} h`, "Distribución de reparaciones válidas", "var(--cyan)")}${kpi("Reparaciones válidas", formatInteger(uniqueCount(summary.validRepairs, "OT")), `De ${formatInteger(summary.correctives.length)} registros correctivos`, "var(--amber)")}</div>`;
    return `${global}<div class="callout"><strong>Criterio del indicador.</strong> Se incluyen solo registros correctivos con estado “cerrada”, fechas de inicio y fin válidas y duración calculada estrictamente mayor que cero. El MTTR se obtiene de Fecha_fin − Fecha_inicio, igual que en el notebook; no se calcula MTBF ni disponibilidad.</div><div class="content-grid">${chart}${card("Resultados por tipo de equipo", "Media y mediana de reparación con el mismo conjunto válido", tableHtml, true)}</div>`;
  }

  function renderPareto(summary) {
    const frequency = summary.paretoFrequency;
    const downtime = summary.paretoDowntime;
    const cost = summary.paretoCost;
    const frequencyNote = frequency[0] ? `El modo más frecuente es ${escapeHtml(frequency[0].key)} (${formatInteger(frequency[0].events)} OT); los tres primeros reúnen ${formatPercent(frequency.slice(0, 3).reduce((t, item) => t + item.events, 0) / (frequency.reduce((t, item) => t + item.events, 0) || 1) * 100)} de las ocurrencias.` : "";
    const downtimeNote = downtime[0] ? `${escapeHtml(downtime[0].key)} encabeza el downtime por modo (${formatNumber(downtime[0].downtime)} h); los tres primeros acumulan ${formatPercent(downtime.slice(0, 3).reduce((t, item) => t + item.downtime, 0) / (downtime.reduce((t, item) => t + item.downtime, 0) || 1) * 100)} del downtime del Pareto.` : "";
    const costNote = cost[0] ? `${escapeHtml(cost[0].key)} tiene el mayor costo asociado (${formatNumber(cost[0].cost, 0)} CLP); los tres primeros concentran ${formatPercent(cost.slice(0, 3).reduce((t, item) => t + item.cost, 0) / (cost.reduce((t, item) => t + item.cost, 0) || 1) * 100)} del costo del Pareto.` : "";
    const fc = chartCard("Frecuencia de modos de falla", "OT correctivas con modo de falla registrado · acumulado sobre todos los modos", paretoChart(frequency, "events", formatInteger), frequencyNote, true);
    const dt = chartCard("Downtime por modo de falla", "Horas acumuladas · top 10 por downtime", paretoChart(downtime, "downtime", (v) => `${formatNumber(v)} h`), downtimeNote, true);
    const cc = chartCard("Costo directo por modo de falla", "CLP acumulados · top 10 por costo", paretoChart(cost, "cost", (v) => `${formatNumber(v / 1e6, 1)} M`), costNote, true);
    return `<p class="section-intro">Los Pareto agrupan órdenes correctivas por modo de falla. El porcentaje acumulado se calcula sobre la población completa de modos y los gráficos presentan sus diez primeros elementos, conservando el criterio del notebook.</p><div class="content-grid">${fc}${dt}${cc}</div>`;
  }

  function renderJackknife(summary) {
    const equip = summary.jkEquipment;
    const modes = summary.jkModes;
    const topEquip = equip.slice(0, 15);
    const topModes = modes.slice(0, 15);
    const equipCallout = equip[0] ? `El mayor riesgo relativo es ${escapeHtml(equip[0].key)} (${escapeHtml(equip[0].classification)}, R* ${formatNumber(equip[0].risk, 2)}). El ranking de prioridad continúa con ${escapeHtml(equip.slice(1, 3).map((row) => row.key).join(", ") || "sin más activos")}.` : "No hay reparaciones válidas para calcular Jack-Knife por equipo.";
    const modeCallout = modes[0] ? `El modo de falla con mayor riesgo relativo es ${escapeHtml(modes[0].key)} (${escapeHtml(modes[0].classification)}, R* ${formatNumber(modes[0].risk, 2)}).` : "No hay modos de falla válidos suficientes para este análisis.";
    const equipTable = table([
      { key: "key", label: "Equipo" }, { key: "criticality", label: "Criticidad" },
      { key: "failures", label: "OT", numeric: true }, { key: "mttr", label: "MTTR JK [h]", numeric: true },
      { key: "downtime", label: "Downtime [h]", numeric: true }, { key: "risk", label: "R*", numeric: true },
      { key: "classification", label: "Cuadrante" }
    ], topEquip, (row, key, index) => {
      if (key === "key") return `<span class="rank">${index + 1}</span>${escapeHtml(row.key)}`;
      if (key === "failures") return formatInteger(row.failures);
      if (key === "mttr" || key === "downtime") return formatNumber(row[key]);
      if (key === "risk") return formatNumber(row.risk, 2);
      if (key === "classification") return `<span class="tag ${row.classification === "Grave" ? "red" : row.classification === "Agudo" ? "amber" : ""}">${escapeHtml(row.classification)}</span>`;
      return escapeHtml(row[key]);
    });
    const modeTable = table([
      { key: "key", label: "Modo de falla" }, { key: "failures", label: "OT", numeric: true },
      { key: "mttr", label: "Downtime / OT [h]", numeric: true }, { key: "downtime", label: "Downtime [h]", numeric: true },
      { key: "risk", label: "R*", numeric: true }, { key: "classification", label: "Cuadrante" }
    ], topModes, (row, key, index) => {
      if (key === "key") return `<span class="rank">${index + 1}</span>${escapeHtml(row.key)}`;
      if (key === "failures") return formatInteger(row.failures);
      if (key === "mttr" || key === "downtime") return formatNumber(row[key]);
      if (key === "risk") return formatNumber(row.risk, 2);
      if (key === "classification") return `<span class="tag ${row.classification === "Grave" ? "red" : row.classification === "Agudo" ? "amber" : ""}">${escapeHtml(row.classification)}</span>`;
      return escapeHtml(row[key]);
    });
    const equipScatter = chartCard("Jack-Knife de equipos", "Frecuencia normalizada vs. MTTR normalizado · tamaño de punto proporcional al riesgo", jackknifeChart(equip, "equipos"), equipCallout, true);
    const modeScatter = chartCard("Jack-Knife de modos de falla", "Análisis realizado con OT correctivas válidas y modo informado", jackknifeChart(modes, "modos de falla"), modeCallout, true);
    return `<p class="section-intro">Los ejes corresponden a frecuencia y MTTR normalizados frente a los límites medios del propio conjunto filtrado. R* es el producto de ambos factores normalizados. Para equipos, se consideran correctivas cerradas con tiempo de reparación positivo; para modos, además se requiere modo informado.</p><div class="content-grid">${equipScatter}${card("Ranking de activos prioritarios", "Primeros 15 por riesgo relativo Jack-Knife", equipTable, true)}${modeScatter}${card("Ranking de modos de falla", "Primeros 15 por riesgo relativo Jack-Knife", modeTable, true)}</div>`;
  }

  function renderData(summary) {
    const missingByField = state.headers.map((field) => ({
      key: field,
      missing: summary.rows.filter((row) => row[field] === null || row[field] === undefined || row[field] === "").length,
      type: DATE_FIELDS.includes(field) ? "Fecha" : NUMERIC_FIELDS.includes(field) ? "Numérico" : "Texto / categoría"
    })).filter((item) => item.missing > 0).sort((a, b) => b.missing - a.missing);
    const quality = table([{ key: "key", label: "Columna" }, { key: "type", label: "Tipo interpretado" }, { key: "missing", label: "Vacíos", numeric: true }, { key: "pct", label: "% del subconjunto", numeric: true }], missingByField, (row, key) => key === "missing" ? formatInteger(row.missing) : key === "pct" ? formatPercent(percent(row.missing, summary.rows.length)) : escapeHtml(row[key]));
    const info = `<div class="data-summary"><div class="data-stat"><span>Archivo</span><strong>${escapeHtml(state.sourceName)}</strong></div><div class="data-stat"><span>Registros filtrados</span><strong>${formatInteger(summary.rows.length)}</strong></div><div class="data-stat"><span>Duplicados exactos omitidos</span><strong>${formatInteger(state.duplicatesRemoved)}</strong></div><div class="data-stat"><span>OT únicas</span><strong>${formatInteger(summary.totalOT)}</strong></div></div>`;
    return `${info}<div class="callout"><strong>Esquema reconocido.</strong> El análisis usa los campos presentes del CSV; las columnas no requeridas se conservan al exportar. La limpieza elimina apóstrofos iniciales y espacios, interpreta fechas día/mes/año y convierte métricas numéricas con punto o coma decimal.</div>${card("Campos vacíos", "Columnas con datos faltantes en el subconjunto filtrado", quality, true)}`;
  }

  function renderDowntimeTypeTable(rows) {
    return buildDowntimeTypeTable(rows);
  }

  function render() {
    if (!state.rows.length) return;
    const filtered = selectedRows();
    const summary = summarize(filtered);
    $("activeFilterCount").textContent = String([
      $("maintenanceFilter").value, $("criticalityFilter").value,
      $("equipmentFilter").value, $("dateFrom").value, $("dateTo").value
    ].filter(Boolean).length);
    $("pageContent").setAttribute("aria-busy", "false");
    const pageDetails = {
      overview: ["Resumen ejecutivo", "Indicadores principales del dataset seleccionado.", () => renderOverview(summary)],
      downtime: ["Downtime operacional", "Tiempo de indisponibilidad, participación por tipo y activos con mayor impacto.", () => renderDowntime(summary)],
      costs: ["Costos de mantenimiento", "Distribución del costo directo registrado y concentración por activo.", () => renderCosts(summary)],
      mttr: ["MTTR y mantenibilidad", "Duración de reparación calculada sobre las órdenes correctivas válidas.", () => renderMttr(summary)],
      pareto: ["Pareto de modos de falla", "Concentración de frecuencia, downtime y costo en modos de falla.", () => renderPareto(summary)],
      jackknife: ["Priorización Jack-Knife", "Activos y modos de falla ordenados por frecuencia y duración normalizadas.", () => renderJackknife(summary)],
      data: ["Calidad y estructura de datos", "Esquema recibido, registros analizados y valores faltantes.", () => renderData(summary)]
    };
    const details = pageDetails[state.page] || pageDetails.overview;
    $("pageTitle").textContent = details[0];
    $("pageSubtitle").textContent = details[1];
    $("pageContent").innerHTML = filtered.length ? details[2]() : '<div class="empty-state">Los filtros actuales no coinciden con ningún registro.</div>';
    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab.dataset.page === state.page;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-current", active ? "page" : "false");
    });
  }

  function populateFilter(select, values, emptyLabel) {
    const selected = select.value;
    const unique = [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort((a, b) => String(a).localeCompare(String(b), "es"));
    select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>${unique.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (unique.includes(selected)) select.value = selected;
  }

  function setDatasetRows(parsed, name) {
    state.headers = parsed.headers;
    state.rawRows = parsed.rows;
    state.sourceRowCount = parsed.rows.length;
    state.rows = normalizeRows(parsed);
    state.duplicatesRemoved = state.sourceRowCount - state.rows.length;
    state.sourceName = name;
    populateFilter($("maintenanceFilter"), state.rows.map((row) => row.Tipo_mantenimiento), "Todos los tipos");
    populateFilter($("criticalityFilter"), state.rows.map((row) => row.Criticidad), "Todas las criticidades");
    populateFilter($("equipmentFilter"), state.rows.map((row) => row.Equipo), "Todos los equipos");
    $("loadedName").textContent = name;
    $("dataStatus").textContent = `${formatInteger(state.rows.length)} registros · ${state.headers.length} columnas`;
    $("errorBanner").hidden = true;
    render();
  }

  async function loadDataset(file) {
    $("dataStatus").textContent = "Cargando archivo…";
    $("pageContent").setAttribute("aria-busy", "true");
    try {
      const response = await fetch(`data/${encodeURIComponent(file)}`);
      if (!response.ok) throw new Error(`No se pudo cargar el dataset (${response.status}). Comprueba que ${file} esté en la carpeta data/.`);
      const parsed = parseCsv(await response.text());
      setDatasetRows(parsed, file);
    } catch (error) {
      showError(error);
    }
  }

  function showError(error) {
    $("errorBanner").hidden = false;
    $("errorBanner").textContent = error instanceof Error ? error.message : String(error);
    $("dataStatus").textContent = "No se pudo cargar el archivo.";
    $("pageContent").setAttribute("aria-busy", "false");
  }

  function resetFilters() {
    for (const id of ["maintenanceFilter", "criticalityFilter", "equipmentFilter", "dateFrom", "dateTo"]) $(id).value = "";
    render();
  }

  function csvEscape(value) {
    const text = value instanceof Date ? value.toISOString() : value === null || value === undefined ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportSelection() {
    if (!state.rows.length) return;
    const selected = selectedRows();
    const content = [state.headers.map(csvEscape).join(","), ...selected.map((row) => state.headers.map((field) => csvEscape(row[field])).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.sourceName.replace(/\.csv$/i, "")}_seleccion.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    state.page = tab.dataset.page;
    render();
  }));
  for (const id of ["maintenanceFilter", "criticalityFilter", "equipmentFilter", "dateFrom", "dateTo"]) {
    $(id).addEventListener("change", render);
  }
  $("datasetSelect").addEventListener("change", (event) => loadDataset(event.target.value));
  $("fileInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setDatasetRows(parseCsv(await file.text()), file.name);
      $("datasetSelect").value = "";
    } catch (error) {
      showError(error);
    } finally {
      event.target.value = "";
    }
  });
  $("resetFilters").addEventListener("click", resetFilters);
  $("exportCsv").addEventListener("click", exportSelection);
  if (!DATASETS.some((dataset) => dataset.file === $("datasetSelect").value)) $("datasetSelect").value = DATASETS[0].file;
  loadDataset($("datasetSelect").value);
})();
