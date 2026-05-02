/* ============================================
   AI Study Planner - Global Script
   Handles: theme, storage, toasts, notifications,
            shared utilities, AI engine
   ============================================ */

'use strict';

// ─── Storage Manager ───────────────────────────────────────────
const Storage = {
  get(key, fallback = null) {
    try {
      const val = localStorage.getItem(`studyplanner_${key}`);
      return val !== null ? JSON.parse(val) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`studyplanner_${key}`, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key) { localStorage.removeItem(`studyplanner_${key}`); },
  update(key, updater, fallback = null) {
    const current = this.get(key, fallback);
    const next = updater(current);
    this.set(key, next);
    return next;
  }
};

// ─── Theme Manager ─────────────────────────────────────────────
const Theme = {
  init() {
    const saved = Storage.get('theme', 'dark');
    this.apply(saved);
    // Watch for system preference
    window.matchMedia?.('(prefers-color-scheme: light)')
      .addEventListener('change', e => {
        if (!Storage.get('theme')) this.apply(e.matches ? 'light' : 'dark');
      });
  },
  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    Storage.set('theme', theme);
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    });
  },
  toggle() {
    const current = Storage.get('theme', 'dark');
    this.apply(current === 'dark' ? 'light' : 'dark');
  }
};

// ─── Toast Manager ─────────────────────────────────────────────
const Toast = {
  container: null,
  init() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  show(message, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
  info(msg) { this.show(msg, 'info'); },
  warning(msg) { this.show(msg, 'warning'); }
};

// ─── Data Models ───────────────────────────────────────────────
const DB = {
  // Tasks
  getTasks() { return Storage.get('tasks', []); },
  saveTasks(tasks) { Storage.set('tasks', tasks); },
  addTask(task) {
    const tasks = this.getTasks();
    const newTask = {
      id: Date.now().toString(),
      title: task.title,
      subject: task.subject || 'General',
      priority: task.priority || 'medium',
      deadline: task.deadline || null,
      estimatedTime: task.estimatedTime || 25,
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
      tags: task.tags || [],
      notes: task.notes || '',
      order: tasks.length
    };
    tasks.push(newTask);
    this.saveTasks(tasks);
    this.trackActivity('task_added', { subject: newTask.subject });
    return newTask;
  },
  updateTask(id, updates) {
    const tasks = this.getTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const wasCompleted = tasks[idx].completed;
    tasks[idx] = { ...tasks[idx], ...updates };
    if (!wasCompleted && updates.completed) {
      tasks[idx].completedAt = new Date().toISOString();
      this.trackActivity('task_completed', { subject: tasks[idx].subject });
      this.updateStreak();
    }
    this.saveTasks(tasks);
    return tasks[idx];
  },
  deleteTask(id) {
    const tasks = this.getTasks().filter(t => t.id !== id);
    this.saveTasks(tasks);
  },
  reorderTasks(orderedIds) {
    const tasks = this.getTasks();
    orderedIds.forEach((id, idx) => {
      const task = tasks.find(t => t.id === id);
      if (task) task.order = idx;
    });
    this.saveTasks(tasks);
  },

  // Subjects
  getSubjects() {
    return Storage.get('subjects', [
      { id: '1', name: 'Mathematics', color: '#63b3ed', icon: '📐' },
      { id: '2', name: 'Physics', color: '#9f7aea', icon: '⚛️' },
      { id: '3', name: 'Computer Science', color: '#68d391', icon: '💻' },
      { id: '4', name: 'Chemistry', color: '#f6ad55', icon: '🧪' },
    ]);
  },
  saveSubjects(s) { Storage.set('subjects', s); },
  addSubject(sub) {
    const subjects = this.getSubjects();
    const newSub = { id: Date.now().toString(), ...sub };
    subjects.push(newSub);
    this.saveSubjects(subjects);
    return newSub;
  },

  // Goals
  getGoals() {
    return Storage.get('goals', {
      dailyMinutes: 120,
      weeklyTasks: 10,
      dailyTasksTarget: 3
    });
  },
  saveGoals(g) { Storage.set('goals', g); },

  // Pomodoro Sessions
  getSessions() { return Storage.get('sessions', []); },
  addSession(session) {
    const sessions = this.getSessions();
    sessions.push({
      id: Date.now().toString(),
      type: session.type || 'focus',
      duration: session.duration,
      subject: session.subject || 'General',
      date: new Date().toISOString(),
      ...session
    });
    Storage.set('sessions', sessions);
    if (session.type === 'focus') {
      this.trackActivity('session_completed', { subject: session.subject, duration: session.duration });
      this.updateStreak();
    }
  },

  // Activity Log for AI
  trackActivity(type, data = {}) {
    const activities = Storage.get('activities', []);
    activities.push({
      type,
      data,
      timestamp: new Date().toISOString()
    });
    // Keep last 500 activities
    if (activities.length > 500) activities.splice(0, activities.length - 500);
    Storage.set('activities', activities);
  },

  // Streak
  getStreak() { return Storage.get('streak', { current: 0, longest: 0, lastDate: null }); },
  updateStreak() {
    const streak = this.getStreak();
    const today = new Date().toDateString();
    if (streak.lastDate === today) return streak;
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (streak.lastDate === yesterday) {
      streak.current++;
    } else if (streak.lastDate !== today) {
      streak.current = 1;
    }
    streak.longest = Math.max(streak.longest, streak.current);
    streak.lastDate = today;
    Storage.set('streak', streak);
    return streak;
  },

  // Stats
  getStats() {
    const sessions = this.getSessions();
    const tasks = this.getTasks();
    const today = new Date().toDateString();
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    const todayMinutes = sessions
      .filter(s => s.type === 'focus' && new Date(s.date).toDateString() === today)
      .reduce((acc, s) => acc + s.duration, 0);

    const totalMinutes = sessions
      .filter(s => s.type === 'focus')
      .reduce((acc, s) => acc + s.duration, 0);

    const completedToday = tasks.filter(t =>
      t.completed && t.completedAt && new Date(t.completedAt).toDateString() === today
    ).length;

    const completedTotal = tasks.filter(t => t.completed).length;

    const weeklyData = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toDateString();
      const mins = sessions
        .filter(s => s.type === 'focus' && new Date(s.date).toDateString() === dateStr)
        .reduce((a, s) => a + s.duration, 0);
      return {
        day: d.toLocaleDateString('en', { weekday: 'short' }),
        date: dateStr,
        minutes: mins,
        hours: Math.round(mins / 60 * 10) / 10
      };
    });

    return {
      todayMinutes,
      totalMinutes,
      completedToday,
      completedTotal,
      totalTasks: tasks.length,
      weeklyData,
      streak: this.getStreak()
    };
  }
};

// ─── AI Recommendation Engine ──────────────────────────────────
const AIEngine = {
  analyze() {
    const tasks = DB.getTasks();
    const sessions = DB.getSessions();
    const activities = Storage.get('activities', []);
    const subjects = DB.getSubjects();
    const suggestions = [];

    // 1. Missed/overdue tasks
    const now = new Date();
    const overdue = tasks.filter(t =>
      !t.completed && t.deadline && new Date(t.deadline) < now
    );
    if (overdue.length > 0) {
      suggestions.push({
        type: 'warning',
        icon: '⚠️',
        title: 'Overdue Tasks Detected',
        body: `You have ${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}. Prioritize "${overdue[0].title}" to get back on track.`,
        action: 'View Planner',
        actionUrl: 'planner.html'
      });
    }

    // 2. Subject time analysis (last 7 days)
    const recentSessions = sessions.filter(s =>
      new Date(s.date) > new Date(Date.now() - 7 * 86400000) && s.type === 'focus'
    );

    const subjectTime = {};
    subjects.forEach(s => subjectTime[s.name] = 0);
    recentSessions.forEach(s => {
      if (s.subject) subjectTime[s.subject] = (subjectTime[s.subject] || 0) + s.duration;
    });

    const subjectEntries = Object.entries(subjectTime).filter(([k]) =>
      subjects.find(s => s.name === k)
    );

    if (subjectEntries.length >= 2) {
      const sorted = subjectEntries.sort((a, b) => a[1] - b[1]);
      const least = sorted[0];
      const most = sorted[sorted.length - 1];

      if (least[1] < most[1] * 0.3) {
        suggestions.push({
          type: 'info',
          icon: '📚',
          title: `Neglected Subject: ${least[0]}`,
          body: `You've spent only ${Math.round(least[1])} min on ${least[0]} vs ${Math.round(most[1])} min on ${most[0]} this week. Consider balancing your study time.`,
          action: 'Add Task',
          actionUrl: 'planner.html'
        });
      }
    }

    // 3. No study today
    const studiedToday = sessions.some(s =>
      s.type === 'focus' && new Date(s.date).toDateString() === new Date().toDateString()
    );
    const hour = new Date().getHours();
    if (!studiedToday && hour >= 10) {
      suggestions.push({
        type: 'info',
        icon: '⏰',
        title: "You haven't started today yet",
        body: `It's ${hour}:00. Starting a 25-minute focus session now can help you build momentum for the day.`,
        action: 'Start Timer',
        actionUrl: 'dashboard.html#timer'
      });
    }

    // 4. Streak encouragement
    const streak = DB.getStreak();
    if (streak.current >= 3) {
      suggestions.push({
        type: 'success',
        icon: '🔥',
        title: `${streak.current}-Day Streak!`,
        body: `Amazing consistency! You've studied for ${streak.current} days in a row. Keep it going to beat your record of ${streak.longest} days.`,
        action: null
      });
    }

    // 5. Completion rate
    const total = tasks.length;
    const done = tasks.filter(t => t.completed).length;
    if (total > 5) {
      const rate = Math.round((done / total) * 100);
      if (rate < 40) {
        suggestions.push({
          type: 'warning',
          icon: '📉',
          title: 'Low Completion Rate',
          body: `You've completed ${rate}% of your tasks. Try breaking large tasks into smaller ones to improve throughput.`,
          action: 'View Tasks',
          actionUrl: 'planner.html'
        });
      } else if (rate > 80) {
        suggestions.push({
          type: 'success',
          icon: '🎯',
          title: 'Excellent Completion Rate!',
          body: `${rate}% task completion rate — you're crushing it! Consider adding more challenging goals.`,
          action: null
        });
      }
    }

    // 6. Peak hour detection
    const hourCounts = {};
    sessions.filter(s => s.type === 'focus').forEach(s => {
      const h = new Date(s.date).getHours();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    });
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
    if (peakHour && sessions.length >= 5) {
      const h = parseInt(peakHour[0]);
      const period = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
      suggestions.push({
        type: 'success',
        icon: '⚡',
        title: 'Your Peak Focus Time',
        body: `You're most productive in the ${period} (around ${h}:00). Schedule your hardest tasks during this window for best results.`,
        action: null
      });
    }

    // Default if no suggestions
    if (suggestions.length === 0) {
      suggestions.push({
        type: 'info',
        icon: '🚀',
        title: 'Getting Started',
        body: 'Add some tasks and complete a few study sessions — your personalized AI recommendations will appear here.',
        action: 'Add Task',
        actionUrl: 'planner.html'
      });
    }

    return suggestions;
  },

  generateDailyPlan() {
    const tasks = DB.getTasks().filter(t => !t.completed);
    const goals = DB.getGoals();
    const today = new Date();

    // Sort by priority and deadline
    const priorityScore = { high: 3, medium: 2, low: 1 };
    const sorted = [...tasks].sort((a, b) => {
      const pDiff = (priorityScore[b.priority] || 1) - (priorityScore[a.priority] || 1);
      if (pDiff !== 0) return pDiff;
      if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });

    // Select top tasks that fit in daily goal
    let timeLeft = goals.dailyMinutes;
    const plan = [];
    for (const task of sorted) {
      if (plan.length >= goals.dailyTasksTarget) break;
      plan.push(task);
      timeLeft -= (task.estimatedTime || 25);
    }

    return plan;
  }
};

// ─── Browser Notifications ─────────────────────────────────────
const Notifications = {
  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const result = await Notification.requestPermission();
    return result === 'granted';
  },
  async send(title, body, icon = '📚') {
    const ok = await this.requestPermission();
    if (!ok) return;
    new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>' + icon + '</text></svg>' });
  }
};

// ─── Voice Input ───────────────────────────────────────────────
const Voice = {
  recognition: null,
  isListening: false,
  init() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return false;
    this.recognition = new SpeechRec();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';
    return true;
  },
  start(onResult, onEnd) {
    if (!this.recognition) { Toast.error('Voice input not supported in your browser'); return; }
    this.isListening = true;
    this.recognition.onresult = e => {
      const text = e.results[0][0].transcript;
      onResult(text);
    };
    this.recognition.onend = () => {
      this.isListening = false;
      onEnd?.();
    };
    this.recognition.onerror = () => {
      this.isListening = false;
      onEnd?.();
      Toast.error('Could not recognize speech. Try again.');
    };
    this.recognition.start();
  },
  stop() {
    this.recognition?.stop();
    this.isListening = false;
  }
};

// ─── Utility Functions ─────────────────────────────────────────
const Utils = {
  formatMinutes(mins) {
    if (mins < 60) return `${Math.round(mins)}m`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  },
  formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = d - now;
    if (Math.abs(diff) < 86400000 * 2) {
      if (d.toDateString() === now.toDateString()) return 'Today';
      const yesterday = new Date(now - 86400000);
      const tomorrow = new Date(now.getTime() + 86400000);
      if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
      if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    }
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  },
  isOverdue(dateStr) {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  },
  getDayProgress() {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    return Math.min(100, Math.round((mins / (24 * 60)) * 100));
  },
  generateId() { return Date.now().toString() + Math.random().toString(36).slice(2); },
  debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  },
  escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};

// ─── Weekly Report Generator ───────────────────────────────────
const ReportGenerator = {
  generate() {
    const stats = DB.getStats();
    const tasks = DB.getTasks();
    const sessions = DB.getSessions();
    const subjects = DB.getSubjects();

    const weekSessions = sessions.filter(s =>
      new Date(s.date) > new Date(Date.now() - 7 * 86400000) && s.type === 'focus'
    );

    const subjectTime = {};
    weekSessions.forEach(s => {
      subjectTime[s.subject || 'General'] = (subjectTime[s.subject || 'General'] || 0) + s.duration;
    });

    const completedThisWeek = tasks.filter(t =>
      t.completed && t.completedAt &&
      new Date(t.completedAt) > new Date(Date.now() - 7 * 86400000)
    ).length;

    const totalFocusMins = weekSessions.reduce((a, s) => a + s.duration, 0);
    const avgDaily = Math.round(totalFocusMins / 7);

    return {
      period: `${new Date(Date.now() - 6 * 86400000).toLocaleDateString('en', { month: 'short', day: 'numeric' })} – ${new Date().toLocaleDateString('en', { month: 'short', day: 'numeric' })}`,
      totalFocusTime: Utils.formatMinutes(totalFocusMins),
      avgDailyFocus: Utils.formatMinutes(avgDaily),
      completedTasks: completedThisWeek,
      sessionsCount: weekSessions.length,
      topSubject: Object.entries(subjectTime).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None',
      streak: DB.getStreak().current,
      weeklyData: stats.weeklyData,
      subjectBreakdown: subjectTime
    };
  }
};

// ─── App Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Theme.init();
  Toast.init();
  Voice.init();

  // Theme toggle buttons
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => Theme.toggle());
  });

  // Mobile menu
  const menuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', () => sidebar.classList.toggle('mobile-open'));
    document.addEventListener('click', e => {
      if (sidebar.classList.contains('mobile-open') &&
          !sidebar.contains(e.target) && e.target !== menuBtn) {
        sidebar.classList.remove('mobile-open');
      }
    });
  }

  // Request notification permission on load (silently)
  if ('Notification' in window && Notification.permission === 'default') {
    // Don't auto-request, wait for user action
  }

  // Focus mode cleanup
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('focus-mode-overlay');
      if (overlay?.classList.contains('active')) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
      }
    }
  });
});

// Make globals available across pages
window.Storage = Storage;
window.Theme = Theme;
window.Toast = Toast;
window.DB = DB;
window.AIEngine = AIEngine;
window.Notifications = Notifications;
window.Voice = Voice;
window.Utils = Utils;
window.ReportGenerator = ReportGenerator;