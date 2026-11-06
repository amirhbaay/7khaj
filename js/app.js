/**
 * Chahar Barg 11 - Clean & Interactive UI Controller
 * Features:
 * - Natural, unhurried game pacing (2-stage visible bot move: card reveal + capture highlight before executing)
 * - Dedicated live strip showing what each opponent/partner played ("حریف‌ها چی بازی کردن")
 * - Direct tap on a hand card OR interactive tap on table cards + hand card
 * - Silent automatic LZ compression in background
 * - Default Light Theme + 1-tap Dark Theme toggle
 * - 2-Player & 4-Player switch + "دست قبلی" modal
 */
(function (global) {
  'use strict';

  let appState = null;
  let appSettings = {
    theme: 'light',
    playerCount: 2,
    targetScore: 62,
    muted: false
  };

  let selectedTableCardIds = new Set();
  let botTimer = null;
  let botStageTimer = null;
  let botPreviewState = null; // { playerIndex, playerName, card, captureIds }
  let deferredInstallPrompt = null;

  function toPersianDigits(val) {
    if (val === null || val === undefined) return '';
    const map = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(val).replace(/\d/g, d => map[Number(d)]);
  }

  function showToast(msg, isSur = false) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast-banner' + (isSur ? ' sur-toast' : '');
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, isSur ? 2800 : 2000);
  }

  function applyTheme(theme) {
    appSettings.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', appSettings.theme);
    const btn = document.getElementById('btnThemeToggle');
    if (btn) {
      btn.textContent = appSettings.theme === 'dark' ? '☀️' : '🌙';
    }
    saveSilently();
  }

  function saveSilently() {
    if (typeof LZStorage === 'undefined') return;
    LZStorage.save(LZStorage.keys.SETTINGS, appSettings);
    if (appState) {
      LZStorage.save(LZStorage.keys.GAME_STATE, appState);
    }
  }

  function createMiniCardChipHtml(card) {
    if (!card) return '';
    const suitMeta = PasurEngine.SUIT_INFO[card.suit];
    return `<span class="mini-card-chip suit-${suitMeta.color}">${card.label}${suitMeta.symbol}</span>`;
  }

  function doesHandCardMatchSelection(handCard) {
    if (selectedTableCardIds.size === 0 || !appState) return false;
    const validOptions = PasurEngine.findAllValidCaptureOptions(handCard, appState.tableCards);
    return validOptions.some(opt =>
      opt.length === selectedTableCardIds.size &&
      opt.every(c => selectedTableCardIds.has(c.id))
    );
  }

  function createCardElement(card, options = {}) {
    const suitMeta = PasurEngine.SUIT_INFO[card.suit];
    const el = document.createElement('div');

    el.className = [
      'playing-card',
      `suit-${suitMeta.color}`,
      options.canCapture ? 'can-capture' : '',
      options.readyMatch ? 'ready-match' : '',
      options.isSelectedOnTable ? 'table-selected' : '',
      options.isBotCapturing ? 'bot-capturing-card' : ''
    ].filter(Boolean).join(' ');

    el.setAttribute('data-card-id', card.id);

    el.innerHTML = `
      <div class="card-corner top">
        <span class="card-rank">${card.label}</span>
        <span class="card-suit-small">${suitMeta.symbol}</span>
      </div>
      <div class="card-center-suit">${suitMeta.symbol}</div>
      <div class="card-corner bottom">
        <span class="card-rank">${card.label}</span>
        <span class="card-suit-small">${suitMeta.symbol}</span>
      </div>
    `;

    if (typeof options.onClick === 'function') {
      if (options.isHandCard) {
        el.addEventListener('mouseenter', () => highlightCapturableOnTable(card));
        el.addEventListener('mouseleave', () => clearHoverHighlights());
      }
      el.addEventListener('click', () => {
        clearHoverHighlights();
        options.onClick(card);
      });
    }

    return el;
  }

  function highlightCapturableOnTable(handCard) {
    clearHoverHighlights();
    if (!appState || selectedTableCardIds.size > 0 || botPreviewState) return;
    const options = PasurEngine.findAllValidCaptureOptions(handCard, appState.tableCards);
    if (options.length === 0) return;

    const targetIds = new Set();
    for (const subset of options) {
      for (const c of subset) targetIds.add(c.id);
    }

    const tableContainer = document.getElementById('tableCardsContainer');
    if (!tableContainer) return;
    tableContainer.querySelectorAll('.playing-card').forEach(el => {
      if (targetIds.has(el.getAttribute('data-card-id'))) {
        el.classList.add('highlight-target');
      }
    });
  }

  function clearHoverHighlights() {
    const tableContainer = document.getElementById('tableCardsContainer');
    if (!tableContainer) return;
    tableContainer.querySelectorAll('.highlight-target').forEach(el => {
      el.classList.remove('highlight-target');
    });
  }

  function toggleTableCardSelection(tableCard) {
    if (!appState || appState.phase !== 'PLAYING' || appState.currentTurnIndex !== 0 || botPreviewState) return;
    SoundFX.playTap();
    if (selectedTableCardIds.has(tableCard.id)) {
      selectedTableCardIds.delete(tableCard.id);
    } else {
      selectedTableCardIds.add(tableCard.id);
    }
    renderGame();
  }

  function renderGame() {
    if (!appState) return;

    // 1. Mode buttons
    const btn2P = document.getElementById('btnMode2P');
    const btn4P = document.getElementById('btnMode4P');
    if (btn2P && btn4P) {
      btn2P.classList.toggle('active', appState.playerCount === 2);
      btn4P.classList.toggle('active', appState.playerCount === 4);
    }

    // 2. Top Scores & Round Chip
    const scoreUsEl = document.getElementById('scoreTeamUs');
    const scoreThemEl = document.getElementById('scoreTeamThem');
    const roundBadge = document.getElementById('roundBadgeText');
    if (scoreUsEl) scoreUsEl.textContent = toPersianDigits(appState.scores.team0);
    if (scoreThemEl) scoreThemEl.textContent = toPersianDigits(appState.scores.team1);
    if (roundBadge) {
      const isFinal = appState.dealRound === appState.maxDealRounds;
      roundBadge.textContent = isFinal
        ? `دست آخر (${toPersianDigits(appState.dealRound)}/${toPersianDigits(appState.maxDealRounds)})`
        : `دور ${toPersianDigits(appState.dealRound)}/${toPersianDigits(appState.maxDealRounds)}`;
    }

    // 3. Render Opponent / Partner Seats
    renderNonHumanSeats();

    // 4. Render Active Play Spotlight Banner (when bot is showing its played card)
    const activeBanner = document.getElementById('activePlayBanner');
    if (activeBanner) {
      if (botPreviewState) {
        const playedChip = createMiniCardChipHtml(botPreviewState.card);
        if (botPreviewState.captureCards.length > 0) {
          const capChips = botPreviewState.captureCards.map(createMiniCardChipHtml).join(' ');
          activeBanner.innerHTML = `<span>${botPreviewState.playerName} بازی کرد:</span> ${playedChip} <span>⬅ برداشت:</span> ${capChips}`;
        } else {
          activeBanner.innerHTML = `<span>${botPreviewState.playerName} روی زمین انداخت:</span> ${playedChip}`;
        }
        activeBanner.classList.remove('hidden');
      } else {
        activeBanner.classList.add('hidden');
      }
    }

    // 5. Render Table Cards & Interactive Selection Bar
    const tableContainer = document.getElementById('tableCardsContainer');
    const selectionBar = document.getElementById('selectionBar');
    const selectionSumText = document.getElementById('selectionSumText');

    const botCaptureIdSet = new Set(
      botPreviewState ? botPreviewState.captureCards.map(c => c.id) : []
    );

    if (tableContainer) {
      tableContainer.innerHTML = '';
      if (appState.tableCards.length === 0) {
        const emptyCircle = document.createElement('div');
        emptyCircle.className = 'empty-board-circle';
        emptyCircle.textContent = '♣';
        tableContainer.appendChild(emptyCircle);
      } else {
        for (const c of appState.tableCards) {
          const isSelected = selectedTableCardIds.has(c.id);
          const isBotTarget = botCaptureIdSet.has(c.id);
          tableContainer.appendChild(
            createCardElement(c, {
              isSelectedOnTable: isSelected,
              isBotCapturing: isBotTarget,
              onClick: (clickedTableCard) => toggleTableCardSelection(clickedTableCard)
            })
          );
        }
      }
    }

    if (selectionBar && selectionSumText) {
      if (selectedTableCardIds.size > 0) {
        const selectedCards = appState.tableCards.filter(c => selectedTableCardIds.has(c.id));
        const sumVal = selectedCards.reduce((s, c) => s + c.numericValue, 0);
        const needed = 11 - sumVal;
        selectionBar.classList.remove('hidden');
        if (sumVal > 0 && needed >= 1 && needed <= 10) {
          selectionSumText.textContent = `جمع انتخابی: ${toPersianDigits(sumVal)} (نیاز به ${toPersianDigits(needed)})`;
        } else {
          selectionSumText.textContent = `${toPersianDigits(selectedCards.length)} کارت انتخاب شد`;
        }
      } else {
        selectionBar.classList.add('hidden');
      }
    }

    // 6. Render Live Opponents Moves Bar ("حریف‌ها چی بازی کردن")
    renderOpponentsMovesBar();

    // 7. Render Human Hand
    renderHumanSeat();
  }

  function renderOpponentsMovesBar() {
    const barEl = document.getElementById('opponentsMovesBar');
    if (!barEl || !appState) return;

    // Find the latest move for each non-human player (seat 1 in 2P; seats 1, 2, 3 in 4P)
    const lastTrick = appState.trickHistory.length > 0
      ? appState.trickHistory[appState.trickHistory.length - 1]
      : null;

    const badgesHtml = [];
    for (let i = 1; i < appState.playerCount; i++) {
      const p = appState.players[i];
      // Find most recent move by player i in current round
      let lastMoveByPlayer = null;
      for (let tIdx = appState.trickHistory.length - 1; tIdx >= 0; tIdx--) {
        if (appState.trickHistory[tIdx].playerIndex === i) {
          lastMoveByPlayer = appState.trickHistory[tIdx];
          break;
        }
      }

      const isMostRecent = lastTrick && lastTrick.playerIndex === i;

      if (!lastMoveByPlayer) {
        badgesHtml.push(`
          <div class="opp-move-badge">
            <span class="opp-move-name">${p.name}:</span>
            <span class="opp-move-empty">هنوز بازی نکرده</span>
          </div>
        `);
      } else {
        const playedChip = createMiniCardChipHtml(lastMoveByPlayer.playedCard);
        let actionHtml = '';
        if (lastMoveByPlayer.capturedCards.length > 0) {
          const capChips = lastMoveByPlayer.capturedCards.map(createMiniCardChipHtml).join(' ');
          actionHtml = `<span>زد به</span> ${capChips} ${lastMoveByPlayer.isSur ? '🔥' : ''}`;
        } else {
          actionHtml = `<span class="opp-move-empty">(انداخت زمین)</span>`;
        }

        badgesHtml.push(`
          <div class="opp-move-badge ${isMostRecent ? 'just-played' : ''}">
            <span class="opp-move-name">${p.name}:</span>
            ${playedChip}
            ${actionHtml}
          </div>
        `);
      }
    }

    barEl.innerHTML = badgesHtml.join('');
  }

  function renderNonHumanSeats() {
    const topSeat = document.getElementById('seatTopContainer');
    const rightSeat = document.getElementById('seatRightContainer');
    const leftSeat = document.getElementById('seatLeftContainer');

    if (appState.playerCount === 2) {
      if (rightSeat) rightSeat.classList.add('hidden');
      if (leftSeat) leftSeat.classList.add('hidden');
      if (topSeat) topSeat.innerHTML = buildSeatPillHtml(1);
    } else {
      if (rightSeat) {
        rightSeat.classList.remove('hidden');
        rightSeat.innerHTML = buildSeatPillHtml(1);
      }
      if (topSeat) topSeat.innerHTML = buildSeatPillHtml(2);
      if (leftSeat) {
        leftSeat.classList.remove('hidden');
        leftSeat.innerHTML = buildSeatPillHtml(3);
      }
    }
  }

  function buildSeatPillHtml(playerIndex) {
    const p = appState.players[playerIndex];
    const isTurn = appState.currentTurnIndex === playerIndex && appState.phase === 'PLAYING';
    const isDealer = appState.dealerIndex === playerIndex;
    const clubsCount = p.capturedCards.filter(c => c.isClub).length;

    let backs = '';
    for (let i = 0; i < p.hand.length; i++) {
      backs += '<span class="mini-back"></span>';
    }

    return `
      <div class="seat-pill ${isTurn ? 'active-turn' : ''}">
        <span class="seat-name">
          ${isDealer ? '👑' : ''} ${p.name}
        </span>
        <span class="seat-meta">
          <span>♣${toPersianDigits(clubsCount)}</span>
          ${p.surCount > 0 ? `<span>🔥${toPersianDigits(p.surCount)}</span>` : ''}
        </span>
        <div class="mini-cards-fan">${backs}</div>
      </div>
    `;
  }

  function renderHumanSeat() {
    const humanZone = document.getElementById('humanSeatZone');
    const handContainer = document.getElementById('humanHandContainer');
    const roleBadgeEl = document.getElementById('humanRoleBadge');
    const statsEl = document.getElementById('humanRoundStats');

    const p0 = appState.players[0];
    const isMyTurn = appState.currentTurnIndex === 0 && appState.phase === 'PLAYING' && !botPreviewState;
    const isDealer = appState.dealerIndex === 0;
    const currentTurnName = appState.players[appState.currentTurnIndex].name;

    if (humanZone) {
      humanZone.classList.toggle('active-turn', isMyTurn);
    }
    if (roleBadgeEl) {
      roleBadgeEl.innerHTML = `
        <strong>${isDealer ? '👑 ' : ''}${isMyTurn ? 'نوبت شما' : `نوبت ${currentTurnName}...`}</strong>
      `;
    }
    if (statsEl) {
      const myClubs = p0.capturedCards.filter(c => c.isClub).length;
      statsEl.textContent = `برگ‌ها: ${toPersianDigits(p0.capturedCards.length)} | ♣ خاج: ${toPersianDigits(myClubs)} | 🔥 سور: ${toPersianDigits(p0.surCount)}`;
    }

    if (handContainer) {
      handContainer.innerHTML = '';
      for (const card of p0.hand) {
        const validCaptures = PasurEngine.findAllValidCaptureOptions(card, appState.tableCards);
        const matchesSelection = doesHandCardMatchSelection(card);

        const cardEl = createCardElement(card, {
          isHandCard: true,
          canCapture: isMyTurn && validCaptures.length > 0,
          readyMatch: isMyTurn && matchesSelection,
          onClick: (clickedCard) => handleHumanCardClick(clickedCard)
        });
        handContainer.appendChild(cardEl);
      }
    }
  }

  function handleHumanCardClick(card) {
    if (!appState || appState.phase !== 'PLAYING' || appState.currentTurnIndex !== 0 || botPreviewState) return;

    const validOptions = PasurEngine.findAllValidCaptureOptions(card, appState.tableCards);

    if (selectedTableCardIds.size > 0) {
      const matchedOption = validOptions.find(opt =>
        opt.length === selectedTableCardIds.size &&
        opt.every(c => selectedTableCardIds.has(c.id))
      );
      if (matchedOption) {
        selectedTableCardIds.clear();
        executeMoveAndAdvance(0, card.id, matchedOption.map(c => c.id));
        return;
      }
      selectedTableCardIds.clear();
    }

    if (validOptions.length > 1) {
      openCaptureChoiceModal(card, validOptions);
      return;
    }

    const chosenIds = validOptions.length === 1 ? validOptions[0].map(c => c.id) : [];
    executeMoveAndAdvance(0, card.id, chosenIds);
  }

  function openCaptureChoiceModal(playedCard, validOptions) {
    const modal = document.getElementById('modalCaptureSelector');
    const listContainer = document.getElementById('captureOptionsContainer');
    const titleSpan = document.getElementById('captureModalCardName');
    if (!modal || !listContainer) return;

    if (titleSpan) titleSpan.innerHTML = createMiniCardChipHtml(playedCard);
    listContainer.innerHTML = '';

    validOptions.forEach((subset) => {
      const row = document.createElement('div');
      row.className = 'capture-option-row';
      const chips = subset.map(createMiniCardChipHtml).join(' + ');

      row.innerHTML = `<div class="history-cards">${chips}</div><span>انتخاب ⬅</span>`;
      row.addEventListener('click', () => {
        closeModal('modalCaptureSelector');
        selectedTableCardIds.clear();
        executeMoveAndAdvance(0, playedCard.id, subset.map(c => c.id));
      });
      listContainer.appendChild(row);
    });

    modal.classList.remove('hidden');
  }

  function executeMoveAndAdvance(playerIndex, cardId, chosenCaptureIds) {
    try {
      selectedTableCardIds.clear();
      botPreviewState = null;

      const result = PasurEngine.playTurn(appState, playerIndex, cardId, chosenCaptureIds);

      if (result.isSur) {
        SoundFX.playSurFanfare();
        showToast(`🔥 سور! ${result.trickRecord.playerName} (+۵)`, true);
      } else if (result.trickRecord.capturedCards.length > 0) {
        SoundFX.playCapture();
      } else {
        SoundFX.playCardSlide();
      }

      saveSilently();
      renderGame();

      if (appState.phase === 'ROUND_OVER' || appState.phase === 'MATCH_OVER') {
        SoundFX.playRoundEnd();
        setTimeout(() => openRoundSummaryModal(), 700);
        return;
      }

      scheduleBotTurnIfNeeded();
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * Two-stage unhurried bot move:
   * 1. Wait 950ms for natural thinking pause, then show the played card in the spotlight banner and highlight any table cards being captured.
   * 2. Hold for 1150ms so the user clearly sees what the opponent played & captured, then commit the move.
   */
  function scheduleBotTurnIfNeeded() {
    clearBotTimers();
    if (!appState || appState.phase !== 'PLAYING') return;
    const currentPlayer = appState.players[appState.currentTurnIndex];
    if (!currentPlayer || currentPlayer.isHuman) return;

    botTimer = setTimeout(() => {
      if (!appState || appState.phase !== 'PLAYING') return;
      const turnIdx = appState.currentTurnIndex;
      const botPlayer = appState.players[turnIdx];
      const bestMove = PasurAI.chooseBestMove(appState, turnIdx);
      if (!bestMove || !bestMove.card) return;

      // Stage 1: Show preview banner & highlight captured cards on the board
      botPreviewState = {
        playerIndex: turnIdx,
        playerName: botPlayer.name,
        card: bestMove.card,
        captureCards: bestMove.captureSubset || []
      };
      SoundFX.playCardSlide();
      renderGame();

      // Stage 2: Commit the move after the user has seen what card was played
      botStageTimer = setTimeout(() => {
        if (!appState || appState.phase !== 'PLAYING') return;
        const capIds = (bestMove.captureSubset || []).map(c => c.id);
        executeMoveAndAdvance(turnIdx, bestMove.card.id, capIds);
      }, 1150);
    }, 950);
  }

  function clearBotTimers() {
    if (botTimer) {
      clearTimeout(botTimer);
      botTimer = null;
    }
    if (botStageTimer) {
      clearTimeout(botStageTimer);
      botStageTimer = null;
    }
    botPreviewState = null;
  }

  function openPreviousHandModal() {
    const modal = document.getElementById('modalPreviousHand');
    const bodyEl = document.getElementById('previousHandModalBody');
    if (!modal || !bodyEl || !appState) return;

    if (appState.trickHistory.length === 0) {
      bodyEl.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:14px;">هنوز حرکتی انجام نشده است.</p>`;
      modal.classList.remove('hidden');
      return;
    }

    const recentMoves = appState.trickHistory.slice(-12).reverse();
    let html = '';
    for (const t of recentMoves) {
      const playedChip = createMiniCardChipHtml(t.playedCard);
      const capHtml = t.capturedCards.length > 0
        ? `<span>برداشت:</span> ${t.capturedCards.map(createMiniCardChipHtml).join(' ')}`
        : `<span style="color:var(--text-secondary);">روی زمین ماند</span>`;

      html += `
        <div class="history-row">
          <strong>${t.playerName} ${t.isSur ? '🔥' : ''}</strong>
          <div class="history-cards">
            ${playedChip}
            <span>⬅</span>
            ${capHtml}
          </div>
        </div>
      `;
    }

    bodyEl.innerHTML = html;
    modal.classList.remove('hidden');
  }

  function openRoundSummaryModal() {
    const modal = document.getElementById('modalRoundSummary');
    const titleEl = document.getElementById('roundSummaryTitle');
    const bodyEl = document.getElementById('roundSummaryBody');
    const nextBtn = document.getElementById('btnNextRoundAction');

    if (!modal || !bodyEl || !appState || !appState.lastRoundSummary) return;

    const sum = appState.lastRoundSummary;
    const b0 = sum.breakdown.team0;
    const b1 = sum.breakdown.team1;
    const isMatchOver = appState.phase === 'MATCH_OVER';

    if (titleEl) {
      titleEl.textContent = isMatchOver
        ? (appState.winnerTeam === 0 ? '🏆 شما برنده شدید!' : '🏁 پایان بازی')
        : `نتیجه دست ${toPersianDigits(sum.roundNumber)}`;
    }

    bodyEl.innerHTML = `
      <table class="score-table">
        <thead>
          <tr>
            <th>امتیاز</th>
            <th>شما</th>
            <th>حریف</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>هفت‌خاج (♣)</td>
            <td>${toPersianDigits(b0.clubsCount)} برگ (${toPersianDigits(b0.clubsPoints)})</td>
            <td>${toPersianDigits(b1.clubsCount)} برگ (${toPersianDigits(b1.clubsPoints)})</td>
          </tr>
          <tr>
            <td>۱۰ خشت (♦)</td>
            <td>${toPersianDigits(b0.tenDiamondsPoints)}</td>
            <td>${toPersianDigits(b1.tenDiamondsPoints)}</td>
          </tr>
          <tr>
            <td>۲ خاج (♣)</td>
            <td>${toPersianDigits(b0.twoClubsPoints)}</td>
            <td>${toPersianDigits(b1.twoClubsPoints)}</td>
          </tr>
          <tr>
            <td>آس و سرباز</td>
            <td>${toPersianDigits(b0.acesPoints + b0.jacksPoints)}</td>
            <td>${toPersianDigits(b1.acesPoints + b1.jacksPoints)}</td>
          </tr>
          <tr>
            <td>سور (🔥)</td>
            <td>${toPersianDigits(b0.sursPoints)}</td>
            <td>${toPersianDigits(b1.sursPoints)}</td>
          </tr>
          <tr style="font-weight:900;">
            <td>جمع این دست</td>
            <td style="color:var(--accent);">+${toPersianDigits(b0.totalRoundPoints)}</td>
            <td style="color:#e11d48;">+${toPersianDigits(b1.totalRoundPoints)}</td>
          </tr>
          <tr style="font-weight:900;font-size:0.95rem;">
            <td>کل امتیاز (از ۶۲)</td>
            <td style="color:var(--accent);">${toPersianDigits(sum.cumulativeScores.team0)}</td>
            <td style="color:#e11d48;">${toPersianDigits(sum.cumulativeScores.team1)}</td>
          </tr>
        </tbody>
      </table>
    `;

    if (nextBtn) {
      nextBtn.textContent = isMatchOver ? 'بازی جدید' : 'دست بعدی';
    }

    modal.classList.remove('hidden');
  }

  function closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('hidden');
  }

  function startNewMatch(playerCount = appSettings.playerCount) {
    clearBotTimers();
    selectedTableCardIds.clear();
    appSettings.playerCount = playerCount;
    appState = PasurEngine.createInitialGameState({
      playerCount,
      targetScore: 62
    });
    saveSilently();
    renderGame();
    scheduleBotTurnIfNeeded();
  }

  function wireEvents() {
    const btn2P = document.getElementById('btnMode2P');
    const btn4P = document.getElementById('btnMode4P');
    if (btn2P) {
      btn2P.addEventListener('click', () => {
        if (appState && appState.playerCount === 2) return;
        SoundFX.playTap();
        startNewMatch(2);
      });
    }
    if (btn4P) {
      btn4P.addEventListener('click', () => {
        if (appState && appState.playerCount === 4) return;
        SoundFX.playTap();
        startNewMatch(4);
      });
    }

    const btnClearSel = document.getElementById('btnClearSelection');
    if (btnClearSel) {
      btnClearSel.addEventListener('click', () => {
        selectedTableCardIds.clear();
        renderGame();
      });
    }

    const btnPrevHand = document.getElementById('btnPreviousHand');
    if (btnPrevHand) {
      btnPrevHand.addEventListener('click', () => {
        SoundFX.playTap();
        openPreviousHandModal();
      });
    }

    const btnTheme = document.getElementById('btnThemeToggle');
    if (btnTheme) {
      btnTheme.addEventListener('click', () => {
        SoundFX.playTap();
        applyTheme(appSettings.theme === 'light' ? 'dark' : 'light');
      });
    }

    const btnMute = document.getElementById('btnAudioToggle');
    if (btnMute) {
      btnMute.addEventListener('click', () => {
        const isMuted = SoundFX.toggleMute();
        appSettings.muted = isMuted;
        btnMute.textContent = isMuted ? '🔇' : '🔊';
        saveSilently();
      });
    }

    const btnReset = document.getElementById('btnNewMatch');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        SoundFX.playTap();
        startNewMatch(appSettings.playerCount);
      });
    }

    const btnNextRound = document.getElementById('btnNextRoundAction');
    if (btnNextRound) {
      btnNextRound.addEventListener('click', () => {
        SoundFX.playTap();
        closeModal('modalRoundSummary');
        if (!appState || appState.phase === 'MATCH_OVER') {
          startNewMatch(appSettings.playerCount);
        } else {
          PasurEngine.advanceToNextRound(appState);
          saveSilently();
          renderGame();
          scheduleBotTurnIfNeeded();
        }
      });
    }

    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal(btn.getAttribute('data-close-modal'));
      });
    });

    const btnInstall = document.getElementById('btnInstallPWA');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (btnInstall) btnInstall.style.display = 'inline-flex';
    });

    if (btnInstall) {
      btnInstall.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        btnInstall.style.display = 'none';
      });
    }
  }

  function initApp() {
    const savedSettings = LZStorage.load(LZStorage.keys.SETTINGS, null);
    if (savedSettings && typeof savedSettings === 'object') {
      appSettings = { ...appSettings, ...savedSettings };
    }

    SoundFX.setMuted(appSettings.muted);
    const btnMute = document.getElementById('btnAudioToggle');
    if (btnMute) btnMute.textContent = appSettings.muted ? '🔇' : '🔊';

    applyTheme(appSettings.theme || 'light');

    const savedGame = LZStorage.load(LZStorage.keys.GAME_STATE, null);
    if (savedGame && Array.isArray(savedGame.players) && savedGame.phase === 'PLAYING') {
      appState = savedGame;
    } else {
      appState = PasurEngine.createInitialGameState({
        playerCount: appSettings.playerCount || 2,
        targetScore: 62
      });
      saveSilently();
    }

    wireEvents();
    renderGame();
    scheduleBotTurnIfNeeded();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', initApp);
  }
})(typeof window !== 'undefined' ? window : globalThis);
