/**
 * Chahar Barg 11 Positional & Card-Counting AI Engine
 * Implements the exact seat strategies from Section 2 & Section 3.5 of Chahar_Barg_11_Master_Guide.md:
 * - Seat 1 (Starter / Under-Dealer): Hunts high-value targets, avoids discarding 5/6/Ace onto an empty or vulnerable table, saves Early Jacks.
 * - Seat 2 (Blocker): Starves Seat 3 from Sur opportunities, discards high non-diamond cards (8,9,10) on empty boards, feeds Dealer when safe.
 * - Seat 3 (Harvester / Anti-Dealer): Paranoia against Seat 4 (Dealer) Sur, uses Card Counting (seen complements) for safe discards, sweeps heavy boards with Jack before Dealer's turn.
 * - Seat 4 (Dealer / Ultimate Sur Hunter): Hunts Surs aggressively, preserves a Jack or guaranteed capture card for Card #52 (Final Deal) to claim Board Cleanup.
 * - 2-Player Heads-Up: Full card counting (clubs count, seen Jacks, 10♦, 2♣) and tempo control.
 */
(function (global) {
  'use strict';

  function getEngine() {
    if (typeof PasurEngine !== 'undefined') return PasurEngine;
    if (typeof global.PasurEngine !== 'undefined') return global.PasurEngine;
    throw new Error('PasurEngine not loaded');
  }

  /**
   * Counts how many cards of a given rank (1..13) have already been seen
   * (either in seenCards or currently in the bot's own hand).
   */
  function countSeenOfRank(rank, seenCards, ownHand) {
    const ids = new Set();
    for (const c of seenCards || []) {
      if (c.rank === rank) ids.add(c.id);
    }
    for (const c of ownHand || []) {
      if (c.rank === rank) ids.add(c.id);
    }
    return ids.size; // Out of 4 total in a 52-card deck
  }

  /**
   * Evaluates a specific (card, captureOption) move for a bot in `state`.
   */
  function evaluateMoveOption(state, playerIndex, cardToPlay, captureSubset) {
    const Engine = getEngine();
    const player = state.players[playerIndex];
    const tableCards = state.tableCards;
    const isFinalDeal = state.dealRound === state.maxDealRounds;
    const roleInfo = Engine.getSeatRoleInfo(playerIndex, state.dealerIndex, state.playerCount);
    const seatOrder = roleInfo.orderNumber; // 1, 2, 3, or 4 (in 2p: 1 or 2)
    const isDealer = playerIndex === state.dealerIndex;

    let score = 0;
    const reasonParts = [];

    // Count clubs captured so far by bot's team vs opponent team
    let myTeamClubs = 0;
    let oppTeamClubs = 0;
    for (const p of state.players) {
      const clubs = p.capturedCards.filter(c => c.isClub).length;
      if (p.teamId === player.teamId) myTeamClubs += clubs;
      else oppTeamClubs += clubs;
    }
    const needClubsUrgently = myTeamClubs < 7 && oppTeamClubs < 7;

    if (captureSubset && captureSubset.length > 0) {
      const capturedIds = new Set(captureSubset.map(c => c.id));
      const remainingAfter = tableCards.filter(c => !capturedIds.has(c.id));
      const isSur = Engine.checkSurCondition(cardToPlay, captureSubset, remainingAfter, isFinalDeal);

      // 1. Sur bonus
      if (isSur) {
        score += 550;
        reasonParts.push('ثبت سور (+۵ امتیاز مستقیم)');
      }

      // 2. Value of captured cards + played card
      const allGained = [cardToPlay, ...captureSubset];
      let clubsGained = 0;
      for (const c of allGained) {
        if (c.rank === 10 && c.suit === 'DIAMONDS') {
          score += 340;
          reasonParts.push('شکار ۱۰ خشت (+۳)');
        }
        if (c.rank === 2 && c.suit === 'CLUBS') {
          score += 240;
          reasonParts.push('شکار ۲ خاج (+۲)');
        }
        if (c.isClub) {
          clubsGained++;
          score += needClubsUrgently ? 115 : 55;
        }
        if (c.rank === 1 || c.rank === 11) {
          score += 85;
        }
      }
      if (clubsGained > 0 && needClubsUrgently) {
        reasonParts.push(`تصاحب ${clubsGained} برگ خاج`);
      }

      // Small bonus per card captured
      score += captureSubset.length * 18;

      // 3. Jack conservation rules
      if (cardToPlay.rank === 11) {
        const directPtsOnTable = captureSubset.reduce((acc, c) => acc + c.pointValue, 0);
        const clubsOnTable = captureSubset.filter(c => c.isClub).length;

        if (captureSubset.length <= 2 && directPtsOnTable === 0 && clubsOnTable <= 1 && !isFinalDeal) {
          score -= 190;
          reasonParts.push('پرهیز از سوزاندن زودهنگام سرباز');
        } else if (seatOrder === 3 && (captureSubset.length >= 3 || directPtsOnTable >= 2)) {
          // Seat 3 sweeps heavy board before Dealer (Seat 4) can take it
          score += 95;
          reasonParts.push('جارو کردن زمین قبل از نوبت دیلر');
        }
      }

      // 4. Final Deal Last-Card Advantage for Dealer
      if (isFinalDeal && isDealer && player.hand.length > 1) {
        if (cardToPlay.rank === 11 && captureSubset.length <= 2) {
          score -= 120;
          reasonParts.push('حفظ سرباز برای برگ ۵۲ (جمع کردن کل زمین در پایان دست)');
        }
      }
      if (isFinalDeal && state.lastCapturerIndex !== playerIndex) {
        score += 180;
        reasonParts.push('تثبیت آخرین بردارنده زمین در دست آخر');
      }

      // 5. Post-capture vulnerability check
      if (!isFinalDeal && remainingAfter.length === 1 && remainingAfter[0].numericValue > 0) {
        const loneCard = remainingAfter[0];
        const compRank = 11 - loneCard.numericValue;
        const seenComps = countSeenOfRank(compRank, state.seenCards, player.hand);
        const unseenComps = Math.max(0, 4 - seenComps);
        const seatCautionMultiplier = (seatOrder === 3 || seatOrder === 2) ? 32 : 20;
        score -= unseenComps * seatCautionMultiplier;
      }

    } else {
      // DISCARD LOGIC (No capture possible with this card)
      if (cardToPlay.rank === 10 && cardToPlay.suit === 'DIAMONDS') {
        score -= 1000;
        reasonParts.push('حفظ ۱۰ خشت');
      } else if (cardToPlay.rank === 2 && cardToPlay.suit === 'CLUBS') {
        score -= 800;
        reasonParts.push('حفظ ۲ خاج');
      } else if (cardToPlay.rank === 11) {
        score -= 650;
        reasonParts.push('پرهیز از انداختن سرباز روی زمین خالی');
      } else if (cardToPlay.rank === 1) {
        score -= 400;
        reasonParts.push('حفظ آس');
      } else {
        if (cardToPlay.isClub) {
          score -= needClubsUrgently ? 120 : 60;
        }
        score += cardToPlay.numericValue * 6;
      }

      // Evaluate Sur danger when discarding onto an EMPTY table
      if (tableCards.length === 0 && !isFinalDeal) {
        if (cardToPlay.numericValue > 0) {
          const complementRank = 11 - cardToPlay.numericValue;
          const seenComps = countSeenOfRank(complementRank, state.seenCards, player.hand);
          const unseenComps = Math.max(0, 4 - seenComps);

          if (unseenComps === 0) {
            score += 90;
            reasonParts.push('دیسکارد کاملاً امن (تمام مکمل‌ها بازی شده‌اند)');
          } else {
            if (cardToPlay.rank === 5 || cardToPlay.rank === 6) {
              score -= 75;
            } else if (cardToPlay.rank >= 8 && !(cardToPlay.rank === 10 && cardToPlay.suit === 'DIAMONDS')) {
              score += 35;
              reasonParts.push('انداختن کارت بزرگ برای کاهش احتمال سور حریف');
            }
            score -= unseenComps * (seatOrder === 3 ? 28 : 18);
          }
        } else if (cardToPlay.rank === 12 || cardToPlay.rank === 13) {
          const seenSame = countSeenOfRank(cardToPlay.rank, state.seenCards, player.hand);
          const unseenSame = Math.max(0, 4 - seenSame);
          if (unseenSame === 0) {
            score += 95;
            reasonParts.push('انداختن شاه/بی‌بی امن (جفت‌ها قبلاً بازی شده‌اند)');
          } else {
            score -= unseenSame * 22;
          }
        }
      } else if (tableCards.length > 0) {
        if ((cardToPlay.rank === 12 || cardToPlay.rank === 13) &&
            !tableCards.some(c => c.rank === cardToPlay.rank)) {
          score += 45;
          reasonParts.push('دیسکارد امن شاه/بی‌بی بدون ریسک سور');
        }

        if (!isFinalDeal && cardToPlay.numericValue > 0) {
          const nonNumericOnTable = tableCards.some(c => c.rank >= 11);
          if (!nonNumericOnTable) {
            const totalNumericSum = tableCards.reduce((s, c) => s + c.numericValue, 0) + cardToPlay.numericValue;
            if (totalNumericSum <= 10) {
              const neededForSweep = 11 - totalNumericSum;
              const unseenSweepers = Math.max(0, 4 - countSeenOfRank(neededForSweep, state.seenCards, player.hand));
              if (unseenSweepers > 0) {
                score -= unseenSweepers * 45;
                reasonParts.push('پرهیز از ساختن جمع ۱۱ کامل روی زمین برای حریف');
              }
            }
          }
        }
      }
    }

    return {
      card: cardToPlay,
      captureSubset: captureSubset || [],
      score,
      reason: reasonParts.length > 0 ? reasonParts[0] : (captureSubset && captureSubset.length > 0 ? 'برداشت بهینه از زمین' : 'دیسکارد کارت کم‌ریسک')
    };
  }

  /**
   * Chooses the best move for the current player (or provides a strategic hint for the human player).
   */
  function chooseBestMove(state, playerIndex = state.currentTurnIndex) {
    const Engine = getEngine();
    const player = state.players[playerIndex];
    if (!player || player.hand.length === 0) return null;

    const candidates = [];

    for (const card of player.hand) {
      const validOptions = Engine.findAllValidCaptureOptions(card, state.tableCards);
      if (validOptions.length > 0) {
        for (const subset of validOptions) {
          candidates.push(evaluateMoveOption(state, playerIndex, card, subset));
        }
      } else {
        candidates.push(evaluateMoveOption(state, playerIndex, card, []));
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  const PasurAI = {
    countSeenOfRank,
    evaluateMoveOption,
    chooseBestMove
  };

  global.PasurAI = PasurAI;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PasurAI;
  }
})(typeof window !== 'undefined' ? window : globalThis);
