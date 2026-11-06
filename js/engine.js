/**
 * Chahar Barg 11 (Pasur / Haft-Khaj) Core Game Engine
 * Strictly implements all rules from Chahar_Barg_11_Master_Guide.md:
 * - 52-card standard deck, Ace=1, 2-10=face value, J/Q/K=0 numeric value
 * - Initial Jack Rule: Any Jack in the initial 4 table cards is returned to the deck and replaced
 * - Mandatory Capture: Sum=11 subsets for A..10, Jack sweeps all except K & Q, Q captures Q, K captures K
 * - Sur Verification Engine with all 4 strict exceptions:
 *   1. Jack NEVER scores a Sur
 *   2. Final deal round NEVER scores a Sur
 *   3. Empty table discard is not a Sur
 *   4. Single K+K or Q+Q clearing the table IS a Sur (if not final deal)
 * - Board Cleanup: Last player to capture takes remaining table cards at end of round (not a Sur)
 * - 20 Base Points per round: 7+ Clubs = 7 pts, 10♦ = 3 pts, 2♣ = 2 pts, 4 Aces = 4 pts, 4 Jacks = 4 pts + 5 pts per Sur
 * - Full Trick & Deal-Subround History ("دست قبلی") tracking
 */
(function (global) {
  'use strict';

  const SUITS = ['CLUBS', 'DIAMONDS', 'HEARTS', 'SPADES'];
  const SUIT_INFO = {
    CLUBS: { symbol: '♣', nameFa: 'خاج (گشنیز)', shortFa: 'خاج', color: 'black' },
    DIAMONDS: { symbol: '♦', nameFa: 'خشت', shortFa: 'خشت', color: 'red' },
    HEARTS: { symbol: '♥', nameFa: 'دل', shortFa: 'دل', color: 'red' },
    SPADES: { symbol: '♠', nameFa: 'پیک', shortFa: 'پیک', color: 'black' }
  };

  const RANK_NAMES_FA = {
    1: 'آس',
    2: '۲',
    3: '۳',
    4: '۴',
    5: '۵',
    6: '۶',
    7: '۷',
    8: '۸',
    9: '۹',
    10: '۱۰',
    11: 'سرباز',
    12: 'بی‌بی',
    13: 'شاه'
  };

  const RANK_LABELS = {
    1: 'A',
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
    11: 'J',
    12: 'Q',
    13: 'K'
  };

  function createCard(suit, rank) {
    const isClub = suit === 'CLUBS';
    const numericValue = (rank >= 1 && rank <= 10) ? rank : 0;
    let pointValue = 0;
    if (rank === 10 && suit === 'DIAMONDS') pointValue = 3;
    else if (rank === 2 && suit === 'CLUBS') pointValue = 2;
    else if (rank === 1 || rank === 11) pointValue = 1;

    return {
      id: `C_${rank}_${suit}`,
      suit,
      rank,
      label: RANK_LABELS[rank],
      nameFa: `${RANK_NAMES_FA[rank]} ${SUIT_INFO[suit].shortFa}`,
      numericValue,
      pointValue,
      isClub
    };
  }

  function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push(createCard(suit, rank));
      }
    }
    return deck;
  }

  function shuffleDeck(deck, rng = Math.random) {
    const arr = deck.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Initial Jack Rule:
   * Draws 4 cards for the table. If any Jack (rank === 11) is drawn,
   * it is put back into the middle of the deck and replaced with a new card
   * until all 4 initial table cards are non-Jacks.
   */
  function dealInitialTableCards(deck) {
    const tableCards = [];
    const replacedJacks = [];
    let guard = 0;

    while (tableCards.length < 4 && deck.length > 0 && guard < 200) {
      guard++;
      const card = deck.shift();
      if (card.rank === 11) {
        replacedJacks.push(card.nameFa);
        // Insert into middle of remaining deck
        const midIndex = Math.max(1, Math.floor(deck.length / 2));
        deck.splice(midIndex, 0, card);
      } else {
        tableCards.push(card);
      }
    }
    return { tableCards, replacedJacks };
  }

  /**
   * Evaluates intrinsic strategic value of a capture subset
   * Priority:
   * 1. Direct point cards (10♦=3, 2♣=2, A=1, J=1)
   * 2. Number of Clubs (for 7-Clubs bonus)
   * 3. Total number of captured cards
   */
  function scoreSubsetQuality(subset) {
    let directPoints = 0;
    let clubsCount = 0;
    for (const c of subset) {
      directPoints += c.pointValue;
      if (c.isClub) clubsCount++;
    }
    return (directPoints * 1000) + (clubsCount * 100) + subset.length;
  }

  /**
   * Finds all valid subsets of numeric cards (1..10) on the table that sum to targetSum.
   */
  function findSubsetsWithSum(numericCards, targetSum) {
    const results = [];
    function backtrack(startIdx, currentCombo, currentSum) {
      if (currentSum === targetSum) {
        results.push(currentCombo.slice());
        return;
      }
      if (currentSum > targetSum) return;
      for (let i = startIdx; i < numericCards.length; i++) {
        currentCombo.push(numericCards[i]);
        backtrack(i + 1, currentCombo, currentSum + numericCards[i].numericValue);
        currentCombo.pop();
      }
    }
    backtrack(0, [], 0);
    // Sort results from best quality to lowest
    results.sort((a, b) => scoreSubsetQuality(b) - scoreSubsetQuality(a));
    return results;
  }

  /**
   * Returns ALL valid capture options for a played card against tableCards.
   * Each option is an array of Card objects from tableCards.
   * - If no capture is possible, returns [].
   * - For Jack (11): returns 1 option containing all cards with rank !== 12 and rank !== 13 (if at least 1 exists).
   * - For Queen (12): returns 1 option per Queen on table (each option has 1 Queen).
   * - For King (13): returns 1 option per King on table (each option has 1 King).
   * - For Numeric/Ace (1..10): returns all subsets of numeric cards summing to (11 - playedCard.numericValue).
   */
  function findAllValidCaptureOptions(playedCard, tableCards) {
    if (!playedCard || !Array.isArray(tableCards) || tableCards.length === 0) {
      return [];
    }

    // Case 1: Jack (11) sweeps all numeric cards, Aces, and Jacks (everything except Queen=12 and King=13)
    if (playedCard.rank === 11) {
      const sweepable = tableCards.filter(c => c.rank !== 12 && c.rank !== 13);
      return sweepable.length > 0 ? [sweepable] : [];
    }

    // Case 2: Queen (12) captures a single Queen on table
    if (playedCard.rank === 12) {
      const queens = tableCards.filter(c => c.rank === 12);
      if (queens.length === 0) return [];
      // Sort so club queen is preferred first
      queens.sort((a, b) => (b.isClub ? 1 : 0) - (a.isClub ? 1 : 0));
      // If multiple queenshave identical value, deduplicate only if exact same id (never)
      return queens.map(q => [q]);
    }

    // Case 3: King (13) captures a single King on table
    if (playedCard.rank === 13) {
      const kings = tableCards.filter(c => c.rank === 13);
      if (kings.length === 0) return [];
      kings.sort((a, b) => (b.isClub ? 1 : 0) - (a.isClub ? 1 : 0));
      return kings.map(k => [k]);
    }

    // Case 4: Numeric / Ace (1..10)
    const targetSum = 11 - playedCard.numericValue;
    const numericTableCards = tableCards.filter(c => c.rank >= 1 && c.rank <= 10);
    return findSubsetsWithSum(numericTableCards, targetSum);
  }

  /**
   * Returns the single optimal capture subset (used by AI and auto-selection).
   */
  function findValidCaptures(playedCard, tableCards) {
    const options = findAllValidCaptureOptions(playedCard, tableCards);
    return options.length > 0 ? options[0] : [];
  }

  /**
   * Sur Verification Engine:
   * Checks all 4 mandatory rules:
   * 1. Remaining table cards must be 0.
   * 2. At least 1 card must have been captured (table was not empty prior).
   * 3. Played card must NOT be a Jack (rank 11).
   * 4. Must NOT be the final deal round of the deck.
   */
  function checkSurCondition(playedCard, capturedCards, remainingTableCards, isFinalDeal) {
    if (!playedCard || !Array.isArray(capturedCards) || !Array.isArray(remainingTableCards)) {
      return false;
    }
    if (remainingTableCards.length > 0) return false;
    if (capturedCards.length === 0) return false;
    if (playedCard.rank === 11) return false;
    if (isFinalDeal) return false;
    return true;
  }

  /**
   * Calculates full round breakdown for Team 0 and Team 1.
   * Base points always sum to 20 (7 Clubs + 3 TenDiamonds + 2 TwoClubs + 4 Aces + 4 Jacks).
   */
  function calculateRoundScores(team0Cards, team1Cards, team0Surs, team1Surs) {
    const detail = {
      team0: {
        totalCards: team0Cards.length,
        clubsCount: 0,
        clubsPoints: 0,
        hasTenDiamonds: false,
        tenDiamondsPoints: 0,
        hasTwoClubs: false,
        twoClubsPoints: 0,
        acesCount: 0,
        acesPoints: 0,
        jacksCount: 0,
        jacksPoints: 0,
        sursCount: team0Surs,
        sursPoints: team0Surs * 5,
        basePoints: 0,
        totalRoundPoints: 0
      },
      team1: {
        totalCards: team1Cards.length,
        clubsCount: 0,
        clubsPoints: 0,
        hasTenDiamonds: false,
        tenDiamondsPoints: 0,
        hasTwoClubs: false,
        twoClubsPoints: 0,
        acesCount: 0,
        acesPoints: 0,
        jacksCount: 0,
        jacksPoints: 0,
        sursCount: team1Surs,
        sursPoints: team1Surs * 5,
        basePoints: 0,
        totalRoundPoints: 0
      }
    };

    const processCards = (cards, t) => {
      for (const c of cards) {
        if (c.suit === 'CLUBS') t.clubsCount++;
        if (c.rank === 10 && c.suit === 'DIAMONDS') {
          t.hasTenDiamonds = true;
          t.tenDiamondsPoints += 3;
        }
        if (c.rank === 2 && c.suit === 'CLUBS') {
          t.hasTwoClubs = true;
          t.twoClubsPoints += 2;
        }
        if (c.rank === 1) {
          t.acesCount++;
          t.acesPoints += 1;
        }
        if (c.rank === 11) {
          t.jacksCount++;
          t.jacksPoints += 1;
        }
      }
    };

    processCards(team0Cards, detail.team0);
    processCards(team1Cards, detail.team1);

    // 7-Clubs bonus (7 points to whoever has >= 7 clubs)
    if (detail.team0.clubsCount >= 7) {
      detail.team0.clubsPoints = 7;
    } else if (detail.team1.clubsCount >= 7) {
      detail.team1.clubsPoints = 7;
    }

    for (const key of ['team0', 'team1']) {
      const d = detail[key];
      d.basePoints = d.clubsPoints + d.tenDiamondsPoints + d.twoClubsPoints + d.acesPoints + d.jacksPoints;
      d.totalRoundPoints = d.basePoints + d.sursPoints;
    }

    return detail;
  }

  /**
   * Role & Seat metadata according to Master Guide Section 2
   */
  function getSeatRoleInfo(seatIndex, dealerIndex, playerCount) {
    const relPos = (seatIndex - dealerIndex - 1 + playerCount) % playerCount;
    if (playerCount === 2) {
      if (seatIndex === dealerIndex) {
        return {
          orderNumber: 2,
          titleFa: 'نفر دوم (دیلر / حاکم)',
          badgeFa: 'دیلر',
          strategySummary: 'شما صاحب کارت ۵۲ (برگ آخر) هستید. سرباز یا مکمل تضمینی را برای حرکت آخر نگه دارید تا کل زمین را جمع کنید و به شکار سور بروید.'
        };
      }
      return {
        orderNumber: 1,
        titleFa: 'نفر اول (شروع‌کننده)',
        badgeFa: 'نفر اول',
        strategySummary: 'اولویت اول شکار ۱۰ خشت، ۲ خاج و برگ‌های خاج است. با خلوت نگه داشتن زمین، مانع از درو شدن زمین توسط دیلر در دست آخر شوید.'
      };
    }

    // 4-player seats relative to play order (Player 1 = (dealer+1)%4, Player 4 = dealer)
    switch (relPos) {
      case 0:
        return {
          orderNumber: 1,
          titleFa: 'نفر اول (شروع‌کننده / زیردست دیلر)',
          badgeFa: 'نفر ۱ (شروع‌کننده)',
          strategySummary: 'چهار برگ اول زمین پیش روی شماست. کارت‌های امتیازی را سریع شکار کنید، اعداد ۵ و ۶ و آس را روی زمین خالی نیندازید تا نفر دوم سور نزند، و سرباز را زود نسوزانید.'
        };
      case 1:
        return {
          orderNumber: 2,
          titleFa: 'نفر دوم (سد راه یار رقیب)',
          badgeFa: 'نفر ۲ (سد راه)',
          strategySummary: 'وظیفه شما قطع کردن خط تغذیه نفر سوم و جلوگیری از سور زدن اوست. روی زمین خالی کارت‌های بزرگ غیرخشت (۸، ۹، ۱۰) بیندازید و زمین را برای دیلر (یارتان) بارور نگه دارید.'
        };
      case 2:
        return {
          orderNumber: 3,
          titleFa: 'نفر سوم (دروکننده و حامی نفر اول)',
          badgeFa: 'نفر ۳ (حامی)',
          strategySummary: 'دیلر درست پشت سر شما نشسته است! هرگز زمین را تک‌برگ یا مستعد سور برای دیلر رها نکنید. قبل از رسیدن نوبت به دیلر، زمین‌های سنگین را با سرباز به نفع تیم خود جمع کنید.'
        };
      case 3:
      default:
        return {
          orderNumber: 4,
          titleFa: 'نفر چهارم (دیلر / حاکم / رفتگر آخر)',
          badgeFa: 'نفر ۴ (دیلر)',
          strategySummary: 'قدرتمندترین صندلی میز! بیشترین شانس سور زدن از آنِ شماست. در دست آخر، یک سرباز یا برگ مکمل را برای کارت ۵۲ نگه دارید تا تمام برگ‌های باقیمانده زمین به تیم شما برسد.'
        };
    }
  }

  /**
   * Creates and manages a complete Match / Round state machine
   */
  function createInitialGameState(options = {}) {
    const playerCount = options.playerCount === 4 ? 4 : 2;
    const targetScore = options.targetScore || 62;
    const dealerIndex = typeof options.dealerIndex === 'number' ? options.dealerIndex : (playerCount === 4 ? 3 : 1);

    const players = [];
    if (playerCount === 2) {
      players.push({
        id: 'p0',
        name: 'شما',
        isHuman: true,
        seatIndex: 0,
        teamId: 0,
        hand: [],
        capturedCards: [],
        surCount: 0
      });
      players.push({
        id: 'p1',
        name: 'حریف هوشمند',
        isHuman: false,
        seatIndex: 1,
        teamId: 1,
        hand: [],
        capturedCards: [],
        surCount: 0
      });
    } else {
      const configs = [
        { id: 'p0', name: 'شما', isHuman: true, seatIndex: 0, teamId: 0 },
        { id: 'p1', name: 'رقیب راست', isHuman: false, seatIndex: 1, teamId: 1 },
        { id: 'p2', name: 'یار شما', isHuman: false, seatIndex: 2, teamId: 0 },
        { id: 'p3', name: 'رقیب چپ', isHuman: false, seatIndex: 3, teamId: 1 }
      ];
      for (const c of configs) {
        players.push({
          ...c,
          hand: [],
          capturedCards: [],
          surCount: 0
        });
      }
    }

    const state = {
      version: 1,
      playerCount,
      targetScore,
      matchNumber: options.matchNumber || 1,
      roundNumber: 1,
      dealerIndex,
      currentTurnIndex: (dealerIndex + 1) % playerCount,
      dealRound: 1,
      maxDealRounds: playerCount === 2 ? 6 : 3,
      deck: [],
      tableCards: [],
      players,
      lastCapturerIndex: null,
      phase: 'PLAYING', // 'PLAYING' | 'ROUND_OVER' | 'MATCH_OVER'
      scores: { team0: 0, team1: 0 },
      roundHistory: [], // Summary of completed rounds in the match
      trickHistory: [], // Every move played in the current round (for "دست قبلی")
      lastSubDealTricks: [], // Moves from the previous 4-card deal cycle
      currentSubDealTricks: [], // Moves in the current 4-card deal cycle
      seenCards: [], // All cards played or seen on table so far in the round (for AI card counting)
      initialJackAlert: [],
      lastRoundSummary: null,
      winnerTeam: null
    };

    startNewRound(state, dealerIndex);
    return state;
  }

  function startNewRound(state, nextDealerIndex) {
    state.dealerIndex = typeof nextDealerIndex === 'number' ? nextDealerIndex : state.dealerIndex;
    state.currentTurnIndex = (state.dealerIndex + 1) % state.playerCount;
    state.dealRound = 1;
    state.maxDealRounds = state.playerCount === 2 ? 6 : 3;
    state.lastCapturerIndex = null;
    state.phase = 'PLAYING';
    state.trickHistory = [];
    state.lastSubDealTricks = [];
    state.currentSubDealTricks = [];
    state.seenCards = [];
    state.lastRoundSummary = null;

    for (const p of state.players) {
      p.hand = [];
      p.capturedCards = [];
      p.surCount = 0;
    }

    const rawDeck = shuffleDeck(createDeck());
    const { tableCards, replacedJacks } = dealInitialTableCards(rawDeck);
    state.deck = rawDeck;
    state.tableCards = tableCards;
    state.initialJackAlert = replacedJacks;

    // Record initial table cards in seenCards
    for (const c of tableCards) {
      if (!state.seenCards.some(sc => sc.id === c.id)) {
        state.seenCards.push(c);
      }
    }

    dealHandsToPlayers(state);
    return state;
  }

  function dealHandsToPlayers(state) {
    // Deal 4 cards to each player starting from (dealerIndex + 1) % playerCount
    for (let offset = 1; offset <= state.playerCount; offset++) {
      const pIdx = (state.dealerIndex + offset) % state.playerCount;
      const player = state.players[pIdx];
      player.hand = state.deck.splice(0, 4);
    }
  }

  /**
   * Executes a single card play by a player.
   * chosenCaptureIds: optional array of card IDs on table when multiple sum=11 subsets exist.
   */
  function playTurn(state, playerIndex, cardId, chosenCaptureIds = null) {
    if (state.phase !== 'PLAYING') {
      throw new Error('بازی در وضعیت فعال نیست.');
    }
    if (playerIndex !== state.currentTurnIndex) {
      throw new Error('نوبت این بازیکن نیست.');
    }

    const player = state.players[playerIndex];
    const handIdx = player.hand.findIndex(c => c.id === cardId);
    if (handIdx === -1) {
      throw new Error('کارت مورد نظر در دست بازیکن یافت نشد.');
    }

    const playedCard = player.hand.splice(handIdx, 1)[0];
    const validOptions = findAllValidCaptureOptions(playedCard, state.tableCards);

    let capturedCards = [];
    if (validOptions.length > 0) {
      if (Array.isArray(chosenCaptureIds) && chosenCaptureIds.length > 0) {
        const idSet = new Set(chosenCaptureIds);
        const matchedOption = validOptions.find(opt =>
          opt.length === idSet.size && opt.every(c => idSet.has(c.id))
        );
        capturedCards = matchedOption || validOptions[0];
      } else {
        capturedCards = validOptions[0];
      }
    }

    const isFinalDeal = state.dealRound === state.maxDealRounds;
    let isSur = false;

    if (capturedCards.length > 0) {
      const capturedIds = new Set(capturedCards.map(c => c.id));
      state.tableCards = state.tableCards.filter(c => !capturedIds.has(c.id));
      isSur = checkSurCondition(playedCard, capturedCards, state.tableCards, isFinalDeal);

      player.capturedCards.push(playedCard, ...capturedCards);
      if (isSur) {
        player.surCount += 1;
      }
      state.lastCapturerIndex = playerIndex;
    } else {
      state.tableCards.push(playedCard);
    }

    // Track seen cards
    if (!state.seenCards.some(sc => sc.id === playedCard.id)) {
      state.seenCards.push(playedCard);
    }

    const roleInfo = getSeatRoleInfo(playerIndex, state.dealerIndex, state.playerCount);
    const trickRecord = {
      moveNumber: state.trickHistory.length + 1,
      dealRound: state.dealRound,
      playerIndex,
      playerName: player.name,
      teamId: player.teamId,
      roleBadge: roleInfo.badgeFa,
      playedCard,
      capturedCards: capturedCards.slice(),
      isSur,
      remainingTableCount: state.tableCards.length,
      timestamp: Date.now()
    };

    state.trickHistory.push(trickRecord);
    state.currentSubDealTricks.push(trickRecord);

    // Advance turn or advance deal round / finish round
    const allHandsEmpty = state.players.every(p => p.hand.length === 0);
    let eventType = capturedCards.length > 0 ? (isSur ? 'SUR' : 'CAPTURE') : 'DISCARD';
    let subDealCompleted = false;

    if (allHandsEmpty) {
      state.lastSubDealTricks = state.currentSubDealTricks.slice();
      state.currentSubDealTricks = [];
      subDealCompleted = true;

      if (state.deck.length > 0 && state.dealRound < state.maxDealRounds) {
        state.dealRound += 1;
        dealHandsToPlayers(state);
        state.currentTurnIndex = (state.dealerIndex + 1) % state.playerCount;
      } else {
        // End of 52-card round! Perform Board Cleanup
        finalizeRound(state);
        eventType = state.phase === 'MATCH_OVER' ? 'MATCH_OVER' : 'ROUND_OVER';
      }
    } else {
      state.currentTurnIndex = (state.currentTurnIndex + 1) % state.playerCount;
    }

    return {
      trickRecord,
      eventType,
      subDealCompleted,
      isSur
    };
  }

  function finalizeRound(state) {
    const leftoverCards = state.tableCards.slice();
    let cleanupReceiverIndex = state.lastCapturerIndex;

    if (leftoverCards.length > 0 && cleanupReceiverIndex !== null) {
      state.players[cleanupReceiverIndex].capturedCards.push(...leftoverCards);
      state.tableCards = [];
    }

    const team0Cards = [];
    const team1Cards = [];
    let team0Surs = 0;
    let team1Surs = 0;

    for (const p of state.players) {
      if (p.teamId === 0) {
        team0Cards.push(...p.capturedCards);
        team0Surs += p.surCount;
      } else {
        team1Cards.push(...p.capturedCards);
        team1Surs += p.surCount;
      }
    }

    const breakdown = calculateRoundScores(team0Cards, team1Cards, team0Surs, team1Surs);
    state.scores.team0 += breakdown.team0.totalRoundPoints;
    state.scores.team1 += breakdown.team1.totalRoundPoints;

    const summary = {
      roundNumber: state.roundNumber,
      dealerIndex: state.dealerIndex,
      dealerName: state.players[state.dealerIndex].name,
      leftoverCards,
      cleanupReceiverIndex,
      cleanupReceiverName: cleanupReceiverIndex !== null ? state.players[cleanupReceiverIndex].name : 'هیچ‌کس',
      breakdown,
      cumulativeScores: { ...state.scores }
    };

    state.lastRoundSummary = summary;
    state.roundHistory.push(summary);

    // Check winning target score (default 62)
    const t0 = state.scores.team0;
    const t1 = state.scores.team1;
    if (t0 >= state.targetScore || t1 >= state.targetScore) {
      if (t0 !== t1) {
        state.phase = 'MATCH_OVER';
        state.winnerTeam = t0 > t1 ? 0 : 1;
        return;
      }
      // If tied above targetScore, continue to next round until tie is broken
    }

    state.phase = 'ROUND_OVER';
  }

  function advanceToNextRound(state) {
    const nextDealer = (state.dealerIndex + 1) % state.playerCount;
    state.roundNumber += 1;
    startNewRound(state, nextDealer);
    return state;
  }

  const PasurEngine = {
    SUITS,
    SUIT_INFO,
    RANK_NAMES_FA,
    RANK_LABELS,
    createCard,
    createDeck,
    shuffleDeck,
    dealInitialTableCards,
    findAllValidCaptureOptions,
    findValidCaptures,
    checkSurCondition,
    calculateRoundScores,
    getSeatRoleInfo,
    createInitialGameState,
    startNewRound,
    playTurn,
    finalizeRound,
    advanceToNextRound
  };

  global.PasurEngine = PasurEngine;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PasurEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
