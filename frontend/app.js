/* ─── Routing ─────────────────────────────────────────────── */
const routes = {
  '/':         renderHome,
  '/auctions': renderAuctions,
  '/artworks': renderArtworks,
  '/artists':  renderArtists,
  '/search':   renderSearch,
};

function route() {
  const hash = window.location.hash || '#/';
  const path = hash.replace(/^#/, '');
  const lotMatch     = path.match(/^\/lot\/(.+)$/);
  const artworkMatch = path.match(/^\/artwork\/(.+)$/);
  if (lotMatch)          renderLotDetail(lotMatch[1]);
  else if (artworkMatch) renderArtworkDetail(artworkMatch[1]);
  else                   (routes[path] || renderHome)();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

/* ─── Root ────────────────────────────────────────────────── */
const root = () => document.getElementById('app-root');
function setRoot(html) { root().innerHTML = html; }
function showLoading() {
  setRoot('<div class="page-loading"><div class="loading-spinner"></div></div>');
}

/* ─── API ─────────────────────────────────────────────────── */
async function apiFetch(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.detail || res.statusText);
  }
  return res.json();
}

/* ─── Formatters ──────────────────────────────────────────── */
function formatKRW(amount) {
  if (!amount) return '—';
  const n = parseInt(amount);
  if (isNaN(n)) return '—';
  if (n >= 100_000_000) {
    const eok = n / 100_000_000;
    const str = Number.isInteger(eok) ? eok : eok.toFixed(1);
    return `${str}억 원`;
  }
  if (n >= 10_000) {
    const man = n / 10_000;
    return `${Number.isInteger(man) ? man : man.toFixed(0)}만 원`;
  }
  return n.toLocaleString('ko-KR') + ' 원';
}

function formatDate(d) {
  if (!d) return '—';
  return d.replace('T', ' ').substring(0, 10);
}

function statusLabel(s) {
  const m = { SCHEDULED:'예정', SETTLED:'낙찰', DRAFT:'초안', LIVE:'진행중', CLOSED:'마감', CANCELLED:'취소', DISPUTED:'분쟁' };
  return m[s] || s || '—';
}

function statusBadge(s) {
  const cls = { SCHEDULED:'scheduled', SETTLED:'settled', DRAFT:'draft', LIVE:'live', CLOSED:'closed', CANCELLED:'cancelled' };
  return `<span class="badge badge-${(cls[s] || 'draft')}">${statusLabel(s)}</span>`;
}

function tempBadge(t) {
  if (!t) return '';
  const m = { warm:'따뜻한 색조', cool:'차가운 색조', neutral:'중성 색조' };
  return `<span class="badge badge-${t}">${m[t] || t}</span>`;
}

function artworkEmoji(movement) {
  const m = {
    '인상주의':'🎨', '한국 추상표현주의':'🟦', '한국 민족 리얼리즘':'🖼️',
    '한국 서정적 구상':'🌸', '후기 인상주의':'🌻',
  };
  return m[movement] || '🖼️';
}

/* ─── Toast ───────────────────────────────────────────────── */
function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ─── Countdown ───────────────────────────────────────────── */
let countdownInterval = null;

function startCountdown(targetDateStr, containerId) {
  if (countdownInterval) clearInterval(countdownInterval);
  const target = new Date(targetDateStr).getTime();

  function tick() {
    const now = Date.now();
    const diff = target - now;
    const el = document.getElementById(containerId);
    if (!el) { clearInterval(countdownInterval); return; }

    if (diff <= 0) {
      el.innerHTML = '<div class="countdown-unit"><div class="countdown-number">—</div><div class="countdown-sep">마감</div></div>';
      clearInterval(countdownInterval);
      return;
    }
    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000)  / 60000);
    const secs  = Math.floor((diff % 60000)    / 1000);

    el.innerHTML = `
      <div class="countdown-unit"><div class="countdown-number">${String(days).padStart(2,'0')}</div><div class="countdown-sep">일</div></div>
      <div class="countdown-unit"><div class="countdown-number">${String(hours).padStart(2,'0')}</div><div class="countdown-sep">시간</div></div>
      <div class="countdown-unit"><div class="countdown-number">${String(mins).padStart(2,'0')}</div><div class="countdown-sep">분</div></div>
      <div class="countdown-unit"><div class="countdown-number">${String(secs).padStart(2,'0')}</div><div class="countdown-sep">초</div></div>`;
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

/* ─── Home ────────────────────────────────────────────────── */
async function renderHome() {
  showLoading();
  try {
    const [stats, lots] = await Promise.all([
      apiFetch('/api/stats'),
      apiFetch('/api/lots'),
    ]);

    const scheduled = lots.filter(l => l.status === 'SCHEDULED');
    const settled   = lots.filter(l => l.status === 'SETTLED').slice(0, 4);
    const featured  = scheduled[0];

    setRoot(`
      <div>
        ${featured ? heroHtml(featured) : ''}

        <div class="stats-bar">
          <div class="stats-inner">
            <div class="stat-item">
              <div class="stat-value">${stats.artworks}</div>
              <div class="stat-label">등록 작품</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${stats.artists}</div>
              <div class="stat-label">작가</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${stats.lots}</div>
              <div class="stat-label">낙찰 경매</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${formatKRW(stats.totalVolume)}</div>
              <div class="stat-label">총 낙찰 금액</div>
            </div>
          </div>
        </div>

        ${scheduled.length > 0 ? `
        <div class="section-wrap">
          <div class="section-header">
            <h2 class="section-title">예정 경매</h2>
            <a href="#/auctions?status=SCHEDULED" class="section-link">모두 보기</a>
          </div>
          <div class="card-grid">
            ${scheduled.map(lotCard).join('')}
          </div>
        </div>` : ''}

        ${settled.length > 0 ? `
        <div class="section-wrap" style="background:var(--white); padding-top:48px; padding-bottom:48px;">
          <div class="container">
            <div class="section-header">
              <h2 class="section-title">최근 낙찰 작품</h2>
              <a href="#/auctions?status=SETTLED" class="section-link">모두 보기</a>
            </div>
            <div class="card-grid">
              ${settled.map(lotCard).join('')}
            </div>
          </div>
        </div>` : ''}
      </div>
    `);

    if (featured) {
      startCountdown(featured.auctionDate, 'hero-countdown');
    }
  } catch (e) {
    setRoot(errorHtml(e.message));
  }
}

function heroHtml(lot) {
  return `
    <div class="hero-section">
      <div class="hero-inner">
        <div>
          <span class="hero-eyebrow">Featured Lot · ${lot.auctionHouse || ''}</span>
          <h1 class="hero-title">${lot.artworkTitle || '—'}</h1>
          <div class="hero-meta">
            <div class="hero-meta-item">
              <strong>${lot.artist || '—'}</strong>
              작가
            </div>
            <div class="hero-meta-item">
              <strong>${lot.auctionDate ? formatDate(lot.auctionDate) : '—'}</strong>
              경매일
            </div>
            <div class="hero-meta-item">
              <strong>Lot ${lot.lotNumber || '—'}</strong>
              로트 번호
            </div>
          </div>
          <div class="hero-estimate">
            <div class="hero-estimate-label">추정가 범위</div>
            <div class="hero-estimate-value">
              ${formatKRW(lot.estimateMin)} — ${formatKRW(lot.estimateMax)}
            </div>
          </div>
          <div class="hero-cta-row">
            <button class="btn-primary" onclick="location.hash='#/lot/${lot.id}'">
              상세보기 및 입찰
            </button>
            <a href="#/artworks" class="btn-outline">작품 둘러보기</a>
          </div>
        </div>
        <div class="hero-countdown-wrap">
          <div class="hero-countdown-label">경매까지 남은 시간</div>
          <div class="countdown-timer" id="hero-countdown">
            <div class="countdown-unit"><div class="countdown-number">—</div><div class="countdown-sep">일</div></div>
            <div class="countdown-unit"><div class="countdown-number">—</div><div class="countdown-sep">시간</div></div>
            <div class="countdown-unit"><div class="countdown-number">—</div><div class="countdown-sep">분</div></div>
            <div class="countdown-unit"><div class="countdown-number">—</div><div class="countdown-sep">초</div></div>
          </div>
        </div>
      </div>
    </div>`;
}

/* ─── Auctions list ───────────────────────────────────────── */
async function renderAuctions(statusFilter) {
  showLoading();
  const qs = statusFilter ? `?status=${statusFilter}` : '';
  try {
    const lots = await apiFetch(`/api/lots${qs}`);

    setRoot(`
      <div class="page-header">
        <div class="page-header-inner">
          <div class="page-header-title">경매 목록</div>
        </div>
      </div>
      <div class="section-wrap">
        <div class="filter-bar">
          <button class="filter-btn ${!statusFilter ? 'active' : ''}" onclick="renderAuctions()">전체</button>
          <button class="filter-btn ${statusFilter === 'SCHEDULED' ? 'active' : ''}" onclick="renderAuctions('SCHEDULED')">예정</button>
          <button class="filter-btn ${statusFilter === 'SETTLED' ? 'active' : ''}" onclick="renderAuctions('SETTLED')">낙찰</button>
        </div>
        ${lots.length === 0 ? emptyHtml('경매 없음', '해당 조건의 경매가 없습니다') : `
        <div class="card-grid card-grid-lg">
          ${lots.map(lotCard).join('')}
        </div>`}
      </div>
    `);
  } catch (e) {
    setRoot(errorHtml(e.message));
  }
}

function lotCard(lot) {
  const priceLabel = lot.status === 'SETTLED' ? '낙찰가' :
                     lot.status === 'SCHEDULED' ? '추정가 하한' : '추정가';
  const priceVal   = lot.status === 'SETTLED' ? lot.hammerPrice :
                     lot.estimateMin;
  const emoji = lot.artworkTitle ? artworkEmoji('') : '🖼️';

  return `
    <div class="lot-card" onclick="location.hash='#/lot/${lot.id}'">
      <div class="lot-card-img">
        <span class="lot-card-placeholder">${emoji}</span>
        <div style="position:absolute;top:12px;right:12px">${statusBadge(lot.status)}</div>
      </div>
      <div class="lot-card-body">
        <div class="lot-card-lot-num">LOT ${lot.lotNumber || lot.id}</div>
        <div class="lot-card-title">${lot.artworkTitle || '—'}</div>
        <div class="lot-card-artist">${lot.artist || '—'}</div>
        <div class="lot-card-footer">
          <div>
            <div class="lot-card-price-label">${priceLabel}</div>
            <div class="lot-card-price">${formatKRW(priceVal)}</div>
          </div>
          <div style="font-size:.78rem;color:var(--mist)">${formatDate(lot.auctionDate)}</div>
        </div>
      </div>
    </div>`;
}

/* ─── Lot detail ──────────────────────────────────────────── */
async function renderLotDetail(lotId) {
  showLoading();
  try {
    const [lot, prov] = await Promise.all([
      apiFetch(`/api/lots/${lotId}`),
      apiFetch(`/api/provenance/${encodeURIComponent(lot_id_to_artwork_id_placeholder(lotId))}`).catch(() => []),
    ]);

    const artworkId = lot.artworkId;
    const provData  = artworkId ? await apiFetch(`/api/provenance/${artworkId}`).catch(() => []) : [];

    const bid = lot.currentBid;
    const isScheduled = lot.status === 'SCHEDULED';

    setRoot(`
      <div class="page-header">
        <div class="page-header-inner">
          <div class="breadcrumb"><a href="#/auctions">경매</a> › Lot ${lot.lotNumber || lotId}</div>
          <div class="page-header-title">${lot.artworkTitle || '—'}</div>
        </div>
      </div>
      <div class="detail-layout">
        <div class="detail-main">
          <div class="detail-artwork-frame">
            ${artworkEmoji(lot.movement)}
          </div>

          <h1 class="detail-title">${lot.artworkTitle || '—'}</h1>
          ${lot.artworkTitleEn ? `<div class="detail-title-en">${lot.artworkTitleEn}</div>` : ''}

          <div class="detail-meta-grid">
            <div class="detail-meta-item">
              <div class="detail-meta-label">작가</div>
              <div class="detail-meta-value">
                ${lot.artist || '—'}
                ${lot.birthYear ? `<span style="font-size:.8rem;color:var(--mist)"> (${lot.birthYear}${lot.deathYear ? '–' + lot.deathYear : '–'})</span>` : ''}
              </div>
            </div>
            <div class="detail-meta-item">
              <div class="detail-meta-label">제작년도</div>
              <div class="detail-meta-value">${lot.year || '—'}</div>
            </div>
            <div class="detail-meta-item">
              <div class="detail-meta-label">재료/기법</div>
              <div class="detail-meta-value">${lot.medium || '—'}</div>
            </div>
            <div class="detail-meta-item">
              <div class="detail-meta-label">크기</div>
              <div class="detail-meta-value">${lot.width && lot.height ? `${lot.width} × ${lot.height} cm` : '—'}</div>
            </div>
            <div class="detail-meta-item">
              <div class="detail-meta-label">사조</div>
              <div class="detail-meta-value">${lot.movement || '—'}</div>
            </div>
            <div class="detail-meta-item">
              <div class="detail-meta-label">시대</div>
              <div class="detail-meta-value">${lot.decade || '—'}</div>
            </div>
            <div class="detail-meta-item">
              <div class="detail-meta-label">색감</div>
              <div class="detail-meta-value">${tempBadge(lot.colorTemp) || '—'}</div>
            </div>
            <div class="detail-meta-item">
              <div class="detail-meta-label">국적</div>
              <div class="detail-meta-value">${lot.nationality || '—'}</div>
            </div>
          </div>

          ${provData.length > 0 ? `
          <div class="provenance-section">
            <div class="provenance-title">소장 이력</div>
            <div class="provenance-timeline">
              ${provData.map(p => `
                <div class="prov-item">
                  <div class="prov-dot"></div>
                  <div class="prov-owner">${p.owner || '—'}</div>
                  ${p.institution ? `<div class="prov-institution">${p.institution}</div>` : ''}
                  <div class="prov-dates">${p.acquisitionDate || ''}${p.transferDate ? ' → ' + p.transferDate : ''}</div>
                  ${p.method ? `<span class="prov-method">${p.method}</span>` : ''}
                </div>`).join('')}
            </div>
          </div>` : ''}
        </div>

        <div class="detail-sidebar">
          <div class="sidebar-card">
            <div class="sidebar-card-header">
              <div class="sidebar-lot-num">LOT ${lot.lotNumber || lotId}</div>
              <div class="sidebar-lot-status">${statusBadge(lot.status)} ${lot.auctionHouse || ''}</div>
            </div>
            <div class="sidebar-card-body">
              <div class="sidebar-estimate-label">추정가</div>
              <div class="sidebar-estimate-range">
                ${formatKRW(lot.estimateMin)} — ${formatKRW(lot.estimateMax)}
              </div>

              ${lot.status === 'SETTLED' ? `
              <div class="sidebar-hammer-label">낙찰가</div>
              <div class="sidebar-hammer">${formatKRW(lot.hammerPrice)}</div>
              ` : ''}

              ${isScheduled ? `
              <div class="sidebar-current-label">현재 최고 입찰가</div>
              <div class="sidebar-current-bid" id="current-bid-display">
                ${bid ? formatKRW(bid.amount) : '입찰 없음'}
              </div>
              ${bid ? `<div class="sidebar-bidder-note">최고 입찰자: ${bid.bidder}</div>` : ''}

              <hr class="sidebar-divider">

              <div class="bid-form" id="bid-form">
                <div>
                  <div class="bid-form-label">입찰자 이름</div>
                  <input type="text" id="bid-bidder" class="bid-form-input" placeholder="이름을 입력하세요">
                </div>
                <div>
                  <div class="bid-form-label">입찰가 (원)</div>
                  <input type="number" id="bid-amount" class="bid-form-input"
                    placeholder="${bid ? (bid.amount + 1000000).toLocaleString() : (parseInt(lot.estimateMin||0)).toLocaleString()}"
                    min="${bid ? bid.amount + 1 : lot.estimateMin}">
                </div>
                <button class="bid-submit-btn" onclick="submitBid('${lotId}')">입찰하기</button>
              </div>

              ${bid && bid.history && bid.history.length > 0 ? `
              <hr class="sidebar-divider">
              <div style="font-size:.78rem;color:var(--mist);margin-bottom:8px;font-weight:500;">입찰 내역</div>
              <div class="bid-history">
                ${[...bid.history].reverse().map(h => `
                  <div class="bid-history-item">
                    <span class="bid-history-bidder">${h.bidder}</span>
                    <span class="bid-history-amount">${formatKRW(h.amount)}</span>
                  </div>`).join('')}
              </div>` : ''}
              ` : ''}

              <hr class="sidebar-divider">
              <div class="kv-list">
                <div class="kv-row"><span class="kv-key">경매사</span><span class="kv-val">${lot.auctionHouse || '—'}</span></div>
                <div class="kv-row"><span class="kv-key">경매일</span><span class="kv-val">${formatDate(lot.auctionDate)}</span></div>
                <div class="kv-row"><span class="kv-key">통화</span><span class="kv-val">${lot.currency || 'KRW'}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    if (isScheduled && lot.auctionDate) {
      startCountdown(lot.auctionDate, 'hero-countdown');
    }
  } catch (e) {
    setRoot(errorHtml(e.message));
  }
}

function lot_id_to_artwork_id_placeholder(lotId) {
  return lotId;
}

async function submitBid(lotId) {
  const bidder = document.getElementById('bid-bidder')?.value?.trim();
  const amount = parseInt(document.getElementById('bid-amount')?.value);
  if (!bidder) { showToast('입찰자 이름을 입력해주세요', 'error'); return; }
  if (!amount || amount <= 0) { showToast('유효한 입찰가를 입력해주세요', 'error'); return; }

  try {
    const btn = document.querySelector('.bid-submit-btn');
    if (btn) btn.disabled = true;

    const result = await apiFetch(`/api/lots/${lotId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidder, amount }),
    });
    showToast(result.message, 'success');
    renderLotDetail(lotId);
  } catch (e) {
    showToast(e.message, 'error');
    const btn = document.querySelector('.bid-submit-btn');
    if (btn) btn.disabled = false;
  }
}

window.submitBid = submitBid;

/* ─── Artworks list ───────────────────────────────────────── */
let artworkFilters = {};

async function renderArtworks(filters) {
  if (filters) artworkFilters = filters;
  showLoading();

  const params = new URLSearchParams();
  if (artworkFilters.movement)    params.set('movement', artworkFilters.movement);
  if (artworkFilters.temperature) params.set('temperature', artworkFilters.temperature);
  if (artworkFilters.decade)      params.set('decade', artworkFilters.decade);

  try {
    const artworks = await apiFetch(`/api/artworks?${params}`);

    const movements = [...new Set(artworks.map(a => a.movement).filter(Boolean))];
    const temps     = [...new Set(artworks.map(a => a.colorTemp).filter(Boolean))];
    const decades   = [...new Set(artworks.map(a => a.decade).filter(Boolean))].sort();

    setRoot(`
      <div class="page-header">
        <div class="page-header-inner">
          <div class="page-header-title">작품 목록</div>
        </div>
      </div>
      <div class="section-wrap">
        <div class="filter-bar">
          <button class="filter-btn ${!artworkFilters.movement ? 'active' : ''}"
            onclick="renderArtworks({})">전체 사조</button>
          ${movements.map(m => `
            <button class="filter-btn ${artworkFilters.movement === m ? 'active' : ''}"
              onclick="renderArtworks({movement:'${m}'})">${m}</button>`).join('')}
        </div>
        <div class="filter-bar" style="margin-top:-16px">
          ${['warm','cool','neutral'].map(t => `
            <button class="filter-btn ${artworkFilters.temperature === t ? 'active' : ''}"
              onclick="renderArtworks({...artworkFilters, temperature: artworkFilters.temperature === '${t}' ? undefined : '${t}'})">
              ${t === 'warm' ? '따뜻한 색조' : t === 'cool' ? '차가운 색조' : '중성 색조'}
            </button>`).join('')}
          ${decades.map(d => `
            <button class="filter-btn ${artworkFilters.decade === d ? 'active' : ''}"
              onclick="renderArtworks({...artworkFilters, decade: artworkFilters.decade === '${d}' ? undefined : '${d}'})">
              ${d}
            </button>`).join('')}
        </div>
        ${artworks.length === 0 ? emptyHtml('작품 없음', '해당 조건의 작품이 없습니다') : `
        <div class="card-grid">
          ${artworks.map(artworkCard).join('')}
        </div>`}
      </div>
    `);
  } catch (e) {
    setRoot(errorHtml(e.message));
  }
}

function artworkCard(a) {
  return `
    <div class="artwork-card" onclick="location.hash='#/artwork/${a.id}'">
      <div class="artwork-card-img">
        <span style="font-size:3rem;opacity:.35">${artworkEmoji(a.movement)}</span>
      </div>
      <div class="artwork-card-body">
        <div class="artwork-card-title">${a.title || '—'}</div>
        <div class="artwork-card-artist">${a.artist || '—'} · ${a.year || '—'}</div>
        <div class="artwork-card-tags">
          ${a.movement ? `<span class="badge badge-gold">${a.movement}</span>` : ''}
          ${tempBadge(a.colorTemp)}
          ${a.decade ? `<span class="badge badge-draft">${a.decade}</span>` : ''}
          ${a.hammerPrice ? `<span class="badge badge-settled">낙찰 ${formatKRW(a.hammerPrice)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

/* ─── Artwork detail ──────────────────────────────────────── */
async function renderArtworkDetail(artworkId) {
  showLoading();
  try {
    const [artwork, prov, lots] = await Promise.all([
      apiFetch(`/api/artworks/${artworkId}`),
      apiFetch(`/api/provenance/${artworkId}`).catch(() => []),
      apiFetch(`/api/artworks/${artworkId}/lots`).catch(() => []),
    ]);

    setRoot(`
      <div class="page-header">
        <div class="page-header-inner">
          <div class="breadcrumb"><a href="#/artworks">작품</a> › ${artwork.title || artworkId}</div>
          <div class="page-header-title">${artwork.title || '—'}</div>
        </div>
      </div>
      <div class="section-wrap">
        <a href="#/artworks" class="back-link">← 작품 목록</a>
        <div style="display:grid;grid-template-columns:1fr 360px;gap:48px;align-items:start">
          <div>
            <div style="background:var(--cream-dark);border-radius:8px;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;font-size:8rem;margin-bottom:32px;border:1px solid var(--border)">
              ${artworkEmoji(artwork.movement)}
            </div>
            <h1 class="detail-title">${artwork.title || '—'}</h1>
            ${artwork.titleEn ? `<div class="detail-title-en">${artwork.titleEn}</div>` : ''}
            <div class="detail-meta-grid" style="margin-top:24px">
              <div class="detail-meta-item"><div class="detail-meta-label">작가</div><div class="detail-meta-value">${artwork.artist || '—'}${artwork.birthYear ? ` (${artwork.birthYear}${artwork.deathYear ? '–'+artwork.deathYear : '–'})` : ''}</div></div>
              <div class="detail-meta-item"><div class="detail-meta-label">제작년도</div><div class="detail-meta-value">${artwork.year || '—'}</div></div>
              <div class="detail-meta-item"><div class="detail-meta-label">재료/기법</div><div class="detail-meta-value">${artwork.medium || '—'}</div></div>
              <div class="detail-meta-item"><div class="detail-meta-label">크기</div><div class="detail-meta-value">${artwork.width && artwork.height ? `${artwork.width} × ${artwork.height} cm` : '—'}</div></div>
              <div class="detail-meta-item"><div class="detail-meta-label">사조</div><div class="detail-meta-value">${artwork.movement || '—'}</div></div>
              <div class="detail-meta-item"><div class="detail-meta-label">시대</div><div class="detail-meta-value">${artwork.decade || '—'} ${artwork.era || ''}</div></div>
              <div class="detail-meta-item"><div class="detail-meta-label">색온도</div><div class="detail-meta-value">${tempBadge(artwork.colorTemp) || '—'}</div></div>
              <div class="detail-meta-item"><div class="detail-meta-label">국적</div><div class="detail-meta-value">${artwork.nationality || '—'}</div></div>
            </div>

            ${prov.length > 0 ? `
            <div class="provenance-section">
              <div class="provenance-title">소장 이력</div>
              <div class="provenance-timeline">
                ${prov.map(p => `
                  <div class="prov-item">
                    <div class="prov-dot"></div>
                    <div class="prov-owner">${p.owner || '—'}</div>
                    ${p.institution ? `<div class="prov-institution">${p.institution}</div>` : ''}
                    <div class="prov-dates">${p.acquisitionDate || ''}${p.transferDate ? ' → ' + p.transferDate : ''}</div>
                    ${p.method ? `<span class="prov-method">${p.method}</span>` : ''}
                  </div>`).join('')}
              </div>
            </div>` : ''}
          </div>

          <div>
            ${lots.length > 0 ? `
            <div class="sidebar-card">
              <div class="sidebar-card-header">
                <div class="sidebar-lot-num">경매 이력</div>
              </div>
              <div class="sidebar-card-body" style="padding:0">
                <table class="lot-history-table">
                  <thead><tr>
                    <th>날짜</th><th>경매사</th><th>상태</th><th>낙찰가</th>
                  </tr></thead>
                  <tbody>
                    ${lots.map(l => `
                      <tr onclick="location.hash='#/lot/${l.id}'" style="cursor:pointer">
                        <td>${formatDate(l.auctionDate)}</td>
                        <td>${l.auctionHouse || '—'}</td>
                        <td>${statusBadge(l.status)}</td>
                        <td style="font-family:'Noto Serif KR',serif;font-weight:600">${formatKRW(l.hammerPrice)}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>` : ''}
          </div>
        </div>
      </div>
    `);
  } catch (e) {
    setRoot(errorHtml(e.message));
  }
}

/* ─── Artists ─────────────────────────────────────────────── */
async function renderArtists() {
  showLoading();
  try {
    const artists = await apiFetch('/api/artists');
    setRoot(`
      <div class="page-header">
        <div class="page-header-inner">
          <div class="page-header-title">작가</div>
        </div>
      </div>
      <div class="section-wrap">
        ${artists.length === 0 ? emptyHtml('작가 없음', '등록된 작가가 없습니다') : `
        <div class="card-grid">
          ${artists.map(artistCard).join('')}
        </div>`}
      </div>
    `);
  } catch (e) {
    setRoot(errorHtml(e.message));
  }
}

function artistCard(a) {
  const initials = (a.name || '?').charAt(0);
  return `
    <div class="artist-card" onclick="location.hash='#/artworks?artist_id=${a.id}'">
      <div class="artist-card-avatar">${initials}</div>
      <div class="artist-card-name">${a.name || '—'}</div>
      ${a.nameEn ? `<div class="artist-card-name-en">${a.nameEn}</div>` : ''}
      <div class="artist-card-meta">
        ${a.birthYear || ''}${a.deathYear ? '–' + a.deathYear : a.birthYear ? '–' : ''} · ${a.nationality || ''}
      </div>
      ${a.movement ? `<div class="artist-card-meta">${a.movement}</div>` : ''}
      <div class="artist-card-count">작품 ${a.artworkCount}점</div>
    </div>`;
}

/* ─── Search ──────────────────────────────────────────────── */
function renderSearch() {
  setRoot(`
    <div class="search-wrap">
      <h1 class="search-title">AI 시맨틱 검색</h1>
      <p class="search-subtitle">자연어로 작품을 검색합니다. 색감, 시대, 작가, 사조, 가격 등을 자유롭게 입력하세요.</p>

      <div class="search-input-row">
        <input type="text" id="search-input" class="search-input"
          placeholder="예: 1970년대 따뜻한 색감의 김환기 작품"
          onkeydown="if(event.key==='Enter') doSearch()">
        <button class="search-btn" onclick="doSearch()">검색</button>
      </div>

      <div class="search-examples">
        ${[
          '1970년대 따뜻한 색감',
          '박수근 리얼리즘',
          '차가운 색조 추상표현주의',
          '10억 이상 낙찰 작품',
          '천경자 서정적 구상',
          '모네 인상주의',
        ].map(ex => `<span class="search-example-chip" onclick="setSearchExample('${ex}')">${ex}</span>`).join('')}
      </div>

      <div id="search-results"></div>
    </div>
  `);
}

window.setSearchExample = function(ex) {
  const inp = document.getElementById('search-input');
  if (inp) { inp.value = ex; doSearch(); }
};

window.doSearch = async function() {
  const q = document.getElementById('search-input')?.value?.trim();
  if (!q) return;

  const resultEl = document.getElementById('search-results');
  if (!resultEl) return;
  resultEl.innerHTML = '<div class="page-loading" style="min-height:200px"><div class="loading-spinner"></div></div>';

  try {
    const data = await apiFetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });

    resultEl.innerHTML = `
      <div class="search-sparql-box">
        <div class="search-sparql-label">생성된 SPARQL 쿼리</div>
        <pre class="search-sparql-code">${escapeHtml(data.sparql)}</pre>
      </div>

      <div class="search-results-header">
        <h3 style="font-family:'Noto Serif KR',serif;font-size:1.1rem">검색 결과</h3>
        <span class="search-results-count">${data.count}건</span>
      </div>

      ${data.count === 0 ? emptyHtml('결과 없음', '다른 검색어로 시도해보세요') : `
      <div class="card-grid">
        ${data.results.map(artworkCard).join('')}
      </div>`}
    `;
  } catch (e) {
    resultEl.innerHTML = errorHtml(e.message);
  }
};

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ─── Utility HTML fragments ──────────────────────────────── */
function emptyHtml(title, desc) {
  return `<div class="empty-state">
    <div class="empty-icon">🖼️</div>
    <div class="empty-title">${title}</div>
    <div class="empty-desc">${desc}</div>
  </div>`;
}

function errorHtml(msg) {
  return `<div class="section-wrap"><div class="error-state">
    오류: ${msg}
    <br><small style="opacity:.7">Fuseki가 실행 중인지 확인하세요 — docker compose up -d</small>
  </div></div>`;
}

/* ─── Modal ───────────────────────────────────────────────── */
window.closeBidModal = function() {
  document.getElementById('bid-modal').classList.add('hidden');
};
document.getElementById('bid-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) window.closeBidModal();
});
