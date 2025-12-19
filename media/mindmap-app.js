/**
 * TypeMap Mindmap Application
 * Canvas-based high-performance visualization for codebase mindmaps
 */

// VS Code API
const vscode = acquireVsCodeApi();

// State
let currentData = null;
let currentLayout = 'radial';
let svg, g, zoom;

// Dynamic dimensions
function getWidth() { return window.innerWidth; }
function getHeight() { return window.innerHeight; }
function getRadius() { return Math.min(getWidth(), getHeight()) / 2 - 100; }

// Color scale for node types
const typeColors = {
  root: '#6c71c4',
  folder: '#b58900',
  file: '#268bd2',
  class: '#2aa198',
  interface: '#859900',
  function: '#cb4b16',
  type: '#d33682',
  enum: '#6c71c4',
  variable: '#93a1a1',
  component: '#2aa198',
  hook: '#859900'
};

// Git status colors
const gitColors = {
  modified: '#e2c08d',
  added: '#89d185',
  deleted: '#c74e39',
  untracked: '#73c991',
  staged: '#89d185'
};

// Canvas rendering state
let canvas, ctx;
let currentTransform = { k: 1, x: 0, y: 0 };
let nodes = [], links = [];
let animationId = null;
let currentDrawFn = null;

/**
 * Initialize canvas element with zoom/pan handling
 */
function initCanvas() {
  const width = getWidth();
  const height = getHeight();
  const container = document.getElementById('mindmap');
  container.innerHTML = '';
  
  canvas = document.createElement('canvas');
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.style.cursor = 'grab';
  container.appendChild(canvas);
  
  ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  currentTransform = { k: 1, x: width / 2, y: height / 2 };
  nodes = [];
  links = [];
  
  // Zoom with wheel
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const oldK = currentTransform.k;
    const newK = Math.max(0.1, Math.min(10, oldK * Math.pow(2, -e.deltaY * 0.003)));
    const scaleFactor = newK / oldK;
    
    currentTransform.x = mouseX - (mouseX - currentTransform.x) * scaleFactor;
    currentTransform.y = mouseY - (mouseY - currentTransform.y) * scaleFactor;
    currentTransform.k = newK;
    
    if (currentDrawFn) currentDrawFn();
  }, { passive: false });
  
  // Pan with drag
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    if (dragging) {
      currentTransform.x += e.clientX - lastX;
      currentTransform.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (currentDrawFn) currentDrawFn();
    } else {
      // Check hover with generous hit area
      const wx = (mx - currentTransform.x) / currentTransform.k;
      const wy = (my - currentTransform.y) / currentTransform.k;
      const hitRadius = Math.max(12, 8 / currentTransform.k);
      let hovered = null;
      for (const n of nodes) {
        const dx = n.x - wx, dy = n.y - wy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < hitRadius) { hovered = n; break; }
      }
      canvas.style.cursor = hovered ? 'pointer' : 'grab';
      if (hovered) showTooltip(e, { data: hovered.data });
      else hideTooltip();
    }
  });
  canvas.addEventListener('mouseup', () => { dragging = false; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('mouseleave', () => { dragging = false; canvas.style.cursor = 'grab'; hideTooltip(); });
  
  // Click handling - navigate to source file
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - currentTransform.x) / currentTransform.k;
    const wy = (my - currentTransform.y) / currentTransform.k;
    
    // Find clicked node with generous hit area
    const hitRadius = Math.max(12, 8 / currentTransform.k);
    for (const n of nodes) {
      const dx = n.x - wx, dy = n.y - wy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < hitRadius) {
        // Flash effect for visual feedback
        const origColor = n.color;
        n.color = '#ffffff';
        drawCanvas();
        setTimeout(() => {
          n.color = origColor;
          drawCanvas();
        }, 100);
        
        handleNodeClick(e, { data: n.data });
        break;
      }
    }
  });
  
  // Zoom buttons
  zoom = {
    scaleBy: function(sel, k) {
      const w = getWidth(), h = getHeight();
      const oldK = currentTransform.k;
      const newK = Math.max(0.1, Math.min(10, oldK * k));
      const scaleFactor = newK / oldK;
      currentTransform.x = w/2 - (w/2 - currentTransform.x) * scaleFactor;
      currentTransform.y = h/2 - (h/2 - currentTransform.y) * scaleFactor;
      currentTransform.k = newK;
      drawCanvas();
    },
    transform: function(sel, t) {
      currentTransform = { k: t.k || 1, x: t.x || getWidth()/2, y: t.y || getHeight()/2 };
      drawCanvas();
    }
  };
  
  svg = { _el: canvas, transition: () => svg, call: () => svg };
  g = { _el: null, _groups: [[null]], attr: () => g };
}

/**
 * Draw the canvas content
 */
function drawCanvas() {
  if (!ctx) return;
  const width = getWidth(), height = getHeight();
  const k = currentTransform.k;
  
  // High-quality rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(currentTransform.x, currentTransform.y);
  ctx.scale(k, k);
  
  // Draw links with gradient effect
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  for (const link of links) {
    ctx.beginPath();
    ctx.moveTo(link.sx, link.sy);
    ctx.quadraticCurveTo(link.cx, link.cy, link.tx, link.ty);
    
    // Create gradient for each link
    const gradient = ctx.createLinearGradient(link.sx, link.sy, link.tx, link.ty);
    gradient.addColorStop(0, 'rgba(100, 100, 120, 0.6)');
    gradient.addColorStop(1, 'rgba(80, 80, 100, 0.3)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = Math.max(1, 1.5 / k);
    ctx.stroke();
  }
  
  // Draw nodes with glow effect
  const showLabels = k > 0.25;
  const showAllLabels = k > 0.5;
  const nodeScale = Math.max(1, 1 / Math.sqrt(k));
  
  for (const n of nodes) {
    const radius = n.r * nodeScale;
    
    // Outer glow for parent nodes
    if (n.isParent && k > 0.4) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius + 3/k, 0, Math.PI * 2);
      ctx.fillStyle = n.color.replace(')', ', 0.2)').replace('rgb', 'rgba');
      ctx.fill();
    }
    
    // Main node circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
    
    // Add gradient fill for nicer look
    const grad = ctx.createRadialGradient(n.x - radius/3, n.y - radius/3, 0, n.x, n.y, radius);
    grad.addColorStop(0, lightenColor(n.color, 30));
    grad.addColorStop(1, n.color);
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Border
    ctx.strokeStyle = n.strokeColor || 'rgba(255,255,255,0.3)';
    ctx.lineWidth = n.strokeColor ? 2.5 / k : 1 / k;
    ctx.stroke();
  }
  
  // Draw labels with shadow for readability
  if (showLabels) {
    ctx.textBaseline = 'middle';
    const fontSize = Math.max(10, Math.min(13, 11 / k));
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    
    for (const n of nodes) {
      if (showAllLabels || n.isParent) {
        ctx.textAlign = n.textAlign || 'start';
        
        // Text shadow for better readability
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillText(n.label, n.x + n.labelOffset + 0.5/k, n.y + 0.5/k);
        
        // Main text
        ctx.fillStyle = n.isParent ? '#ffffff' : '#d4d4d4';
        ctx.fillText(n.label, n.x + n.labelOffset, n.y);
      }
    }
  }
  
  ctx.restore();
}

/**
 * Lighten a hex color by a percentage
 */
function lightenColor(color, percent) {
  if (color.startsWith('#')) {
    const num = parseInt(color.slice(1), 16);
    const r = Math.min(255, (num >> 16) + percent);
    const g = Math.min(255, ((num >> 8) & 0x00FF) + percent);
    const b = Math.min(255, (num & 0x0000FF) + percent);
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }
  return color;
}

/**
 * Truncate text with ellipsis
 */
function truncate(str, len) {
  return str.length > len ? str.substring(0, len) + '...' : str;
}

/**
 * Calculate node radius based on size relative to type
 */
function getNodeRadius(d, sizeByType) {
  const radiusRanges = {
    'root': [8, 12],
    'folder': [4, 10],
    'file': [3, 7],
    'class': [3, 6],
    'interface': [3, 6],
    'function': [2, 5],
    'method': [2, 5],
    'variable': [2, 4],
    'type': [2, 5],
    'enum': [2, 5],
    'unknown': [2, 4]
  };
  
  const type = d.data.type || 'unknown';
  const size = d.data.size || 1;
  const typeStats = sizeByType.get(type);
  const range = radiusRanges[type] || radiusRanges['unknown'];
  
  if (!typeStats || typeStats.max === typeStats.min) {
    return range[0];
  }
  
  const sizeRatio = (size - typeStats.min) / (typeStats.max - typeStats.min);
  const radiusRatio = Math.sqrt(sizeRatio);
  
  return range[0] + radiusRatio * (range[1] - range[0]);
}

/**
 * Calculate size statistics by node type
 */
function calculateSizeByType(descendants) {
  const sizeByType = new Map();
  
  for (const d of descendants) {
    const type = d.data.type || 'unknown';
    const size = d.data.size || 1;
    if (!sizeByType.has(type)) {
      sizeByType.set(type, { min: size, max: size });
    } else {
      const entry = sizeByType.get(type);
      entry.min = Math.min(entry.min, size);
      entry.max = Math.max(entry.max, size);
    }
  }
  
  return sizeByType;
}

/**
 * Render radial tree layout
 */
function renderRadialTree(data) {
  initCanvas();
  const radius = getRadius();
  
  const root = d3.hierarchy(data);
  const tree = d3.tree()
    .size([2 * Math.PI, radius])
    .separation((a, b) => (a.parent === b.parent ? 1 : 2) / (a.depth || 1));

  tree(root);

  // Build links array for canvas
  links = root.links().map(link => {
    const sa = link.source.x, sr = link.source.y;
    const ta = link.target.x, tr = link.target.y;
    const c0 = Math.cos(sa - Math.PI/2), s0 = Math.sin(sa - Math.PI/2);
    const c1 = Math.cos(ta - Math.PI/2), s1 = Math.sin(ta - Math.PI/2);
    return {
      sx: sr * c0, sy: sr * s0,
      cx: (sr + tr) / 2 * c0, cy: (sr + tr) / 2 * s0,
      tx: tr * c1, ty: tr * s1
    };
  });

  const descendants = root.descendants();
  const sizeByType = calculateSizeByType(descendants);

  // Build nodes array for canvas
  nodes = descendants.map(d => {
    const angle = d.x - Math.PI / 2;
    const x = d.y * Math.cos(angle);
    const y = d.y * Math.sin(angle);
    const isLeft = d.x >= Math.PI;
    const nodeRadius = getNodeRadius(d, sizeByType);
    
    return {
      x, y,
      r: nodeRadius,
      color: typeColors[d.data.type] || '#999',
      strokeColor: d.data.gitStatus ? gitColors[d.data.gitStatus] : null,
      label: truncate(d.data.name, 20),
      labelOffset: isLeft ? -(nodeRadius + 4) : (nodeRadius + 4),
      textAlign: isLeft ? 'end' : 'start',
      isParent: !!d.children,
      data: d.data
    };
  });

  currentDrawFn = drawCanvas;
  drawCanvas();
  document.getElementById('node-count').textContent = descendants.length;
  document.getElementById('loading').style.display = 'none';
}

/**
 * Render tree layout (dendrogram)
 */
function renderTreeLayout(data) {
  initCanvas();
  
  const width = getWidth();
  const height = getHeight();
  const root = d3.hierarchy(data);
  const nodeCount = root.descendants().length;
  const dynamicHeight = Math.max(height - 100, nodeCount * 18);
  const tree = d3.tree().size([dynamicHeight, width - 250]);
  tree(root);
  
  // Offset for dendrogram
  const offsetX = 100, offsetY = 50;
  currentTransform.x = 0;
  currentTransform.y = 0;

  // Build links array
  links = root.links().map(link => ({
    sx: link.source.y + offsetX,
    sy: link.source.x + offsetY,
    cx: (link.source.y + link.target.y) / 2 + offsetX,
    cy: link.source.x + offsetY,
    tx: link.target.y + offsetX,
    ty: link.target.x + offsetY
  }));

  // Build nodes array
  nodes = root.descendants().map(d => ({
    x: d.y + offsetX,
    y: d.x + offsetY,
    r: d.children ? 4 : 3,
    color: typeColors[d.data.type] || '#999',
    strokeColor: d.data.gitStatus ? gitColors[d.data.gitStatus] : null,
    label: truncate(d.data.name, 30),
    labelOffset: d.children ? -6 : 6,
    textAlign: d.children ? 'end' : 'start',
    isParent: !!d.children,
    data: d.data
  }));

  currentDrawFn = drawCanvas;
  drawCanvas();
  document.getElementById('node-count').textContent = root.descendants().length;
  document.getElementById('loading').style.display = 'none';
}

/**
 * Render force-directed layout
 */
function renderForceLayout(data) {
  initCanvas();
  const width = getWidth();
  const height = getHeight();
  
  const root = d3.hierarchy(data);
  const hierarchyNodes = root.descendants();
  const hierarchyLinks = root.links();
  
  // Initialize positions
  hierarchyNodes.forEach((n, i) => {
    n.x = (Math.random() - 0.5) * 400;
    n.y = (Math.random() - 0.5) * 400;
    n.vx = 0;
    n.vy = 0;
  });

  // Build initial nodes/links for rendering
  function updateNodesAndLinks() {
    nodes = hierarchyNodes.map(d => ({
      x: d.x,
      y: d.y,
      r: d.children ? 8 : 5,
      color: typeColors[d.data.type] || '#999',
      strokeColor: d.data.gitStatus ? gitColors[d.data.gitStatus] : null,
      label: truncate(d.data.name, 15),
      labelOffset: 0,
      textAlign: 'center',
      isParent: !!d.children,
      data: d.data
    }));
    
    links = hierarchyLinks.map(link => ({
      sx: link.source.x, sy: link.source.y,
      cx: (link.source.x + link.target.x) / 2,
      cy: (link.source.y + link.target.y) / 2,
      tx: link.target.x, ty: link.target.y
    }));
  }

  // Force simulation
  let alpha = 1;
  let iterations = 0;
  const maxIterations = 300;
  
  function tick() {
    alpha *= 0.97;
    iterations++;
    
    if (alpha < 0.005 || iterations >= maxIterations) {
      updateNodesAndLinks();
      drawCanvas();
      return;
    }
    
    hierarchyNodes.forEach(a => {
      a.vx -= a.x * 0.02;
      a.vy -= a.y * 0.02;
      
      hierarchyNodes.forEach(b => {
        if (a === b) return;
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 180) {
          const force = -80 / (dist * dist + 1);
          a.vx += dx * force * alpha;
          a.vy += dy * force * alpha;
        }
      });
    });
    
    hierarchyLinks.forEach(link => {
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 50) / dist * 0.15 * alpha;
      link.source.vx += dx * force;
      link.source.vy += dy * force;
      link.target.vx -= dx * force;
      link.target.vy -= dy * force;
    });
    
    hierarchyNodes.forEach(n => {
      n.x += n.vx;
      n.y += n.vy;
      n.vx *= 0.85;
      n.vy *= 0.85;
    });
    
    updateNodesAndLinks();
    drawCanvas();
    requestAnimationFrame(tick);
  }
  
  currentDrawFn = drawCanvas;
  tick();

  document.getElementById('node-count').textContent = hierarchyNodes.length;
  document.getElementById('loading').style.display = 'none';
}

/**
 * Render sunburst diagram
 */
function renderSunburst(data) {
  initCanvas();
  
  const width = getWidth();
  const height = getHeight();
  const radius = Math.min(width, height) / 2 - 20;
  
  // Create hierarchy with size values
  const root = d3.hierarchy(data)
    .sum(d => d.children ? 0 : (d.size || 1))
    .sort((a, b) => b.value - a.value);
  
  // Partition layout for sunburst
  const partitionLayout = d3.partition().size([2 * Math.PI, radius]);
  partitionLayout(root);
  
  // Store arc data for click detection
  const arcs = [];
  
  // Center transform
  currentTransform.x = width / 2;
  currentTransform.y = height / 2;
  currentTransform.k = 1;
  
  // Draw function
  function drawSunburst() {
    if (!ctx) return;
    
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(currentTransform.x, currentTransform.y);
    ctx.scale(currentTransform.k, currentTransform.k);
    
    arcs.length = 0;
    
    root.descendants().forEach(d => {
      if (d.depth === 0) return; // Skip root
      
      const startAngle = d.x0;
      const endAngle = d.x1;
      const innerRadius = d.y0;
      const outerRadius = d.y1;
      
      // Store for click detection
      arcs.push({
        startAngle, endAngle, innerRadius, outerRadius,
        data: d.data,
        depth: d.depth
      });
      
      // Draw arc
      ctx.beginPath();
      ctx.arc(0, 0, outerRadius, startAngle - Math.PI/2, endAngle - Math.PI/2, false);
      ctx.arc(0, 0, innerRadius, endAngle - Math.PI/2, startAngle - Math.PI/2, true);
      ctx.closePath();
      
      // Fill with type color
      const baseColor = typeColors[d.data.type] || '#999';
      const lightness = Math.min(30, d.depth * 8);
      ctx.fillStyle = lightenColor(baseColor, lightness);
      ctx.fill();
      
      // Stroke
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      
      // Git status highlight
      if (d.data.gitStatus && gitColors[d.data.gitStatus]) {
        ctx.strokeStyle = gitColors[d.data.gitStatus];
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
    
    // Draw labels for larger arcs
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    root.descendants().forEach(d => {
      if (d.depth === 0) return;
      
      const angle = (d.x0 + d.x1) / 2;
      const r = (d.y0 + d.y1) / 2;
      const arcLength = (d.x1 - d.x0) * r;
      
      // Only show labels for arcs wide enough
      if (arcLength > 25 && d.y1 - d.y0 > 15) {
        const x = r * Math.cos(angle - Math.PI/2);
        const y = r * Math.sin(angle - Math.PI/2);
        
        ctx.save();
        ctx.translate(x, y);
        
        // Rotate text to follow arc
        let rotation = angle;
        if (angle > Math.PI) {
          rotation += Math.PI;
        }
        ctx.rotate(rotation - Math.PI/2);
        
        const fontSize = Math.min(11, (d.y1 - d.y0) / 2);
        ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        
        // Text shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(truncate(d.data.name, 15), 0.5, 0.5);
        ctx.fillStyle = '#fff';
        ctx.fillText(truncate(d.data.name, 15), 0, 0);
        
        ctx.restore();
      }
    });
    
    ctx.restore();
  }
  
  // Override click handler for sunburst
  const canvasEl = document.getElementById('mindmap').querySelector('canvas');
  canvasEl.onclick = (e) => {
    const rect = canvasEl.getBoundingClientRect();
    const mx = e.clientX - rect.left - currentTransform.x;
    const my = e.clientY - rect.top - currentTransform.y;
    
    // Convert to polar coordinates
    const dist = Math.sqrt(mx*mx + my*my) / currentTransform.k;
    let angle = Math.atan2(my, mx) + Math.PI/2;
    if (angle < 0) angle += 2 * Math.PI;
    
    // Find clicked arc
    for (const arc of arcs) {
      if (dist >= arc.innerRadius && dist <= arc.outerRadius &&
          angle >= arc.startAngle && angle <= arc.endAngle) {
        handleNodeClick(e, { data: arc.data });
        break;
      }
    }
  };
  
  // Override mousemove for sunburst hover
  canvasEl.onmousemove = (e) => {
    const rect = canvasEl.getBoundingClientRect();
    const mx = e.clientX - rect.left - currentTransform.x;
    const my = e.clientY - rect.top - currentTransform.y;
    
    const dist = Math.sqrt(mx*mx + my*my) / currentTransform.k;
    let angle = Math.atan2(my, mx) + Math.PI/2;
    if (angle < 0) angle += 2 * Math.PI;
    
    let hovered = null;
    for (const arc of arcs) {
      if (dist >= arc.innerRadius && dist <= arc.outerRadius &&
          angle >= arc.startAngle && angle <= arc.endAngle) {
        hovered = arc;
        break;
      }
    }
    
    canvasEl.style.cursor = hovered ? 'pointer' : 'default';
    if (hovered) {
      showTooltip(e, { data: { ...hovered.data, size: hovered.data.size } });
    } else {
      hideTooltip();
    }
  };
  
  currentDrawFn = drawSunburst;
  drawSunburst();
  
  // Update zoom handlers for sunburst
  zoom.scaleBy = function(sel, k) {
    currentTransform.k = Math.max(0.3, Math.min(5, currentTransform.k * k));
    drawSunburst();
  };
  zoom.transform = function(sel, t) {
    currentTransform.k = 1;
    currentTransform.x = width / 2;
    currentTransform.y = height / 2;
    drawSunburst();
  };
  
  document.getElementById('node-count').textContent = root.descendants().length;
  document.getElementById('loading').style.display = 'none';
}

/**
 * Handle node click - navigate to source code or reveal folder
 */
function handleNodeClick(event, d) {
  event.stopPropagation();
  if (event.preventDefault) event.preventDefault();
  
  const nodeData = d.data || d;
  
  // Navigate to file if path is available
  if (nodeData.filePath) {
    vscode.postMessage({
      type: 'navigateToFile',
      filePath: nodeData.filePath,
      line: nodeData.line || 1
    });
  } else if (nodeData.type === 'folder' || nodeData.type === 'root') {
    // For folders, reveal in file explorer
    const folderPath = nodeData.id || nodeData.name;
    vscode.postMessage({
      type: 'revealInExplorer',
      folderPath: folderPath
    });
  } else if (nodeData.name) {
    // Fallback: send node clicked message
    vscode.postMessage({
      type: 'nodeClicked',
      node: nodeData
    });
  }
}

/**
 * Show tooltip with metrics
 */
function showTooltip(event, d) {
  const tooltip = document.getElementById('tooltip');
  const data = d.data;
  
  // Build metrics display
  let metricsHtml = '';
  if (data.linesOfCode) metricsHtml += '<span>LOC: ' + data.linesOfCode + '</span>';
  if (data.complexity && data.complexity > 1) metricsHtml += '<span>Cyclomatic: ' + data.complexity + '</span>';
  if (data.cognitiveComplexity) metricsHtml += '<span>Cognitive: ' + data.cognitiveComplexity + '</span>';
  if (data.methodCount) metricsHtml += '<span>Methods: ' + data.methodCount + '</span>';
  if (data.fieldCount) metricsHtml += '<span>Fields: ' + data.fieldCount + '</span>';
  if (data.parameterCount) metricsHtml += '<span>Params: ' + data.parameterCount + '</span>';
  if (data.returnCount > 1) metricsHtml += '<span>Returns: ' + data.returnCount + '</span>';
  if (data.throwCount) metricsHtml += '<span>Throws: ' + data.throwCount + '</span>';
  if (data.maxNestingDepth) metricsHtml += '<span>Max Nesting: ' + data.maxNestingDepth + '</span>';
  if (data.inheritanceDepth) metricsHtml += '<span>Inheritance: ' + data.inheritanceDepth + '</span>';
  if (data.implementsCount) metricsHtml += '<span>Implements: ' + data.implementsCount + '</span>';
  if (data.constructorParamCount) metricsHtml += '<span>Constructor Params: ' + data.constructorParamCount + '</span>';
  if (data.staticMethodCount) metricsHtml += '<span>Static: ' + data.staticMethodCount + '</span>';
  if (data.asyncMethodCount) metricsHtml += '<span>Async: ' + data.asyncMethodCount + '</span>';
  if (data.hasJsDoc) metricsHtml += '<span>📝 Documented</span>';
  if (data.todoCount) metricsHtml += '<span>⚠️ TODOs: ' + data.todoCount + '</span>';
  if (data.anyTypeCount) metricsHtml += '<span>⚠️ any: ' + data.anyTypeCount + '</span>';
  if (data.size) metricsHtml += '<span>Size: ' + data.size + '</span>';
  
  tooltip.innerHTML = `
    <div class="tooltip-title">${data.name}</div>
    <div class="tooltip-type">${data.type}${data.gitStatus ? ' • ' + data.gitStatus : ''}</div>
    ${metricsHtml ? '<div class="tooltip-metrics">' + metricsHtml + '</div>' : ''}
    ${data.filePath ? '<div style="margin-top:4px;font-size:10px;opacity:0.7">' + data.filePath + (data.line ? ':' + data.line : '') + '</div>' : ''}
  `;
  tooltip.style.left = (event.pageX + 10) + 'px';
  tooltip.style.top = (event.pageY + 10) + 'px';
  tooltip.classList.add('visible');
}

/**
 * Hide tooltip
 */
function hideTooltip() {
  document.getElementById('tooltip').classList.remove('visible');
}

/**
 * Render based on current layout
 */
function render() {
  if (!currentData) return;
  
  switch (currentLayout) {
    case 'radial':
      renderRadialTree(currentData);
      break;
    case 'tree':
      renderTreeLayout(currentData);
      break;
    case 'force':
      renderForceLayout(currentData);
      break;
    case 'sunburst':
      renderSunburst(currentData);
      break;
  }
}

/**
 * Update button active states
 */
function updateButtonStates() {
  document.querySelectorAll('#controls button').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById('btn-' + currentLayout).classList.add('active');
}

/**
 * Update statistics display
 */
function updateStatistics(stats) {
  const statsEl = document.getElementById('stats-info');
  if (!statsEl || !stats) return;
  
  let html = '';
  if (stats.totalLinesOfCode) html += 'LOC: ' + stats.totalLinesOfCode.toLocaleString() + ' | ';
  if (stats.totalFiles) html += 'Files: ' + stats.totalFiles + ' | ';
  if (stats.totalClasses) html += 'Classes: ' + stats.totalClasses + ' | ';
  if (stats.totalFunctions) html += 'Functions: ' + stats.totalFunctions + ' | ';
  if (stats.jsDocCoverage !== undefined) html += '📝 JSDoc: ' + stats.jsDocCoverage.toFixed(0) + '% | ';
  if (stats.totalTodoCount > 0) html += '⚠️ TODOs: ' + stats.totalTodoCount + ' | ';
  if (stats.totalAnyTypeCount > 0) html += '⚠️ any: ' + stats.totalAnyTypeCount + ' | ';
  if (stats.totalThrowStatements) html += 'Throws: ' + stats.totalThrowStatements;
  
  statsEl.textContent = html;
}

// Button handlers
document.getElementById('btn-radial').addEventListener('click', () => {
  currentLayout = 'radial';
  updateButtonStates();
  render();
});

document.getElementById('btn-tree').addEventListener('click', () => {
  currentLayout = 'tree';
  updateButtonStates();
  render();
});

document.getElementById('btn-force').addEventListener('click', () => {
  currentLayout = 'force';
  updateButtonStates();
  render();
});

document.getElementById('btn-sunburst').addEventListener('click', () => {
  currentLayout = 'sunburst';
  updateButtonStates();
  render();
});

document.getElementById('btn-zoom-in').addEventListener('click', () => {
  svg.transition().call(zoom.scaleBy, 1.3);
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
  svg.transition().call(zoom.scaleBy, 0.7);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  svg.transition().call(zoom.transform, d3.zoomIdentity.translate(getWidth()/2, getHeight()/2));
});

// Handle messages from extension
window.addEventListener('message', event => {
  const message = event.data;
  switch (message.type) {
    case 'updateGraph':
      currentData = message.data;
      if (message.statistics) {
        updateStatistics(message.statistics);
      }
      render();
      break;
  }
});

// Handle window resize
window.addEventListener('resize', () => {
  render();
});

// Notify extension that webview is ready
vscode.postMessage({ type: 'ready' });
