// Unlockable milestones. Checked after every completed session.

export const ACHIEVEMENTS = [
  { id: 'first', icon: '🌱', title: 'First steps', desc: 'Complete your first session', check: c => c.summary.sessions >= 1 },
  { id: 'n3', icon: '🎯', title: 'Three deep', desc: 'Reach 3-back', check: c => c.summary.currentN >= 3 || c.summary.bestN >= 3 },
  { id: 'n4', icon: '🧠', title: 'Four deep', desc: 'Reach 4-back', check: c => c.summary.currentN >= 4 || c.summary.bestN >= 4 },
  { id: 'n5', icon: '⚡', title: 'Five deep', desc: 'Reach 5-back', check: c => c.summary.currentN >= 5 || c.summary.bestN >= 5 },
  { id: 'n6', icon: '🚀', title: 'Six deep', desc: 'Reach 6-back', check: c => c.summary.currentN >= 6 || c.summary.bestN >= 6 },
  { id: 'perfect', icon: '💎', title: 'Flawless', desc: 'Finish a 2-back or higher with zero errors', check: c => c.summary.perfectSessions >= 1 },
  { id: 'streak3', icon: '🔥', title: 'Warming up', desc: 'Train 3 days in a row', check: c => c.summary.streak >= 3 },
  { id: 'streak7', icon: '🔥', title: 'One week', desc: 'Train 7 days in a row', check: c => c.summary.streak >= 7 },
  { id: 'streak30', icon: '🏆', title: 'One month', desc: 'Train 30 days in a row', check: c => c.summary.streak >= 30 },
  { id: 's10', icon: '🔟', title: 'Ten sessions', desc: 'Complete 10 sessions', check: c => c.summary.sessions >= 10 },
  { id: 's50', icon: '🎖️', title: 'Fifty sessions', desc: 'Complete 50 sessions', check: c => c.summary.sessions >= 50 },
  { id: 's100', icon: '👑', title: 'Century', desc: 'Complete 100 sessions', check: c => c.summary.sessions >= 100 },
  { id: 'triple', icon: '🎨', title: 'Triple threat', desc: 'Complete a triple N-back session', check: c => c.lastSession && c.lastSession.mode === 'triple' },
  { id: 'marathon', icon: '🏃', title: 'Marathon', desc: 'Play 10 sessions in one day', check: c => c.summary.mostInDay >= 10 },
  { id: 'hour', icon: '⏱️', title: 'One hour', desc: 'Train for a total of one hour', check: c => c.summary.totalMs >= 3600000 },
  { id: 'tenhours', icon: '🌙', title: 'Ten hours', desc: 'Train for a total of ten hours', check: c => c.summary.totalMs >= 36000000 },
  { id: 'quick', icon: '🐇', title: 'Quick draw', desc: 'Average under 600 ms on a session with 90%+ accuracy', check: c => c.lastSession && c.lastSession.meanRt != null && c.lastSession.meanRt < 600 && c.lastSession.accuracy >= 0.9 },
  { id: 'goal', icon: '✅', title: 'Goal getter', desc: 'Hit your daily goal', check: c => c.settings.dailyGoal > 0 && c.summary.todayCount >= c.settings.dailyGoal },
];

/** Returns the achievements newly unlocked by this context and updates `unlocked` in place. */
export function evaluate(context, unlocked) {
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked[a.id]) continue;
    let ok = false;
    try { ok = Boolean(a.check(context)); } catch { ok = false; }
    if (ok) {
      unlocked[a.id] = Date.now();
      fresh.push(a);
    }
  }
  return fresh;
}
