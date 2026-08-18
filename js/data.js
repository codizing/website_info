/* ==========================================================================
   DATA LAYER
   Courses, quizzes and admin-added content live in localStorage so the
   "admin" (whoever has access to /admin.html) can add PDFs/videos without
   touching code. Students only ever read this data.
   Swap this file for real API calls if/when a backend is added — every
   other page only talks to the functions below, never to localStorage
   directly.
   ========================================================================== */

const DB_KEY = 'csp_db_v4';

const SEED = {
  courses: [],
  quizzes: {
    1: [],
    2: []
  },
  users: []
};

function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) {
    localStorage.setItem(DB_KEY, JSON.stringify(SEED));
    return structuredClone(SEED);
  }
  try {
    const db = JSON.parse(raw);
    if (!db.courses || !Array.isArray(db.courses)) {
      localStorage.setItem(DB_KEY, JSON.stringify(SEED));
      return structuredClone(SEED);
    }
    // ensure all items have a valid type and language-specific PDF fields
    db.courses.forEach(c => {
      if (!c.type) c.type = 'course';
      if (!c.pdfUrl_en && c.pdfUrl) c.pdfUrl_en = c.pdfUrl;
      if (!c.pdfUrl_fr && c.pdfUrl) c.pdfUrl_fr = c.pdfUrl;
    });
    // Ensure quizzes structure exists
    if (!db.quizzes || typeof db.quizzes !== 'object') {
      db.quizzes = { 1: [], 2: [] };
      saveDB(db);
    }
    // Ensure users array exists
    if (!db.users || !Array.isArray(db.users)) {
      db.users = [];
      saveDB(db);
    }
    return db;
  }
  catch (e) {
    localStorage.setItem(DB_KEY, JSON.stringify(SEED));
    return structuredClone(SEED);
  }
}
function saveDB(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

const Store = {
  async syncWithFirebase() {
    if (!window.FB_Sync) return;
    try {
      const cloudCourses = await window.FB_Sync.fetchCourses();
      const cloudQuizzes = await window.FB_Sync.fetchQuizzes();
      const cloudUsers = await window.FB_Sync.fetchUsers();

      const db = loadDB();
      let updated = false;

      if (cloudCourses && cloudCourses.length) {
        db.courses = cloudCourses;
        updated = true;
      }
      if (cloudQuizzes && (cloudQuizzes[1]?.length || cloudQuizzes[2]?.length)) {
        if (cloudQuizzes[1]?.length) db.quizzes[1] = cloudQuizzes[1];
        if (cloudQuizzes[2]?.length) db.quizzes[2] = cloudQuizzes[2];
        updated = true;
      }
      if (cloudUsers && cloudUsers.length) {
        db.users = cloudUsers;
        updated = true;
      }

      if (updated) {
        saveDB(db);
        document.dispatchEvent(new CustomEvent('dbupdated'));
      }
    } catch (e) {
      console.warn("syncWithFirebase error:", e);
    }
  },
  getCourses(year, type) {
    const db = loadDB();
    return db.courses.filter(c => {
      if (year && c.year !== Number(year)) return false;
      if (type && c.type !== type) return false;
      return true;
    });
  },
  getAllCourses() {
    const db = loadDB();
    return db.courses || [];
  },
  addCourse(course) {
    const db = loadDB();
    course.id = (course.type || 'c') + Date.now();
    if (!course.type) course.type = 'course';
    if (!course.pdfUrl_en) course.pdfUrl_en = course.pdfUrl || '';
    if (!course.pdfUrl_fr) course.pdfUrl_fr = course.pdfUrl || '';
    db.courses.push(course);
    saveDB(db);
    document.dispatchEvent(new CustomEvent('dbupdated'));

    if (window.FB_Sync) {
      window.FB_Sync.saveCourse(course).then(id => {
        if (id) {
          course.firestoreId = id;
          saveDB(db);
        }
      });
    }
    return course;
  },
  updateCourse(id, patch) {
    const db = loadDB();
    const i = db.courses.findIndex(c => c.id === id);
    if (i > -1) {
      db.courses[i] = { ...db.courses[i], ...patch };
      saveDB(db);
      document.dispatchEvent(new CustomEvent('dbupdated'));
    }
  },
  deleteCourse(id) {
    const db = loadDB();
    const target = db.courses.find(c => c.id === id);
    db.courses = db.courses.filter(c => c.id !== id);
    // Also cleanup completed course references in users
    if (db.users) {
      db.users.forEach(u => {
        if (u.completedCourses) {
          u.completedCourses = u.completedCourses.filter(cid => cid !== id);
        }
      });
    }
    saveDB(db);
    document.dispatchEvent(new CustomEvent('dbupdated'));

    if (window.FB_Sync) {
      window.FB_Sync.deleteCourse(target?.firestoreId || id);
    }
  },
  getQuiz(year) {
    const db = loadDB();
    return (db.quizzes[year] || []);
  },
  addQuestion(year, question) {
    const db = loadDB();
    if (!db.quizzes[year]) db.quizzes[year] = [];
    question.id = 'q_' + Date.now();
    question.year = Number(year);
    db.quizzes[year].push(question);
    saveDB(db);
    document.dispatchEvent(new CustomEvent('dbupdated'));

    if (window.FB_Sync) {
      window.FB_Sync.saveQuizQuestion(question).then(id => {
        if (id) {
          question.firestoreId = id;
          saveDB(db);
        }
      });
    }
  },
  deleteQuestion(year, index) {
    const db = loadDB();
    const removed = db.quizzes[year]?.splice(index, 1);
    saveDB(db);
    document.dispatchEvent(new CustomEvent('dbupdated'));

    if (window.FB_Sync && removed && removed[0]) {
      window.FB_Sync.deleteQuizQuestion(removed[0].firestoreId || removed[0].id);
    }
  },
  // ----- USERS & PROGRESS METHODS -----
  getUsers() {
    const db = loadDB();
    return db.users || [];
  },
  getUserByEmail(email) {
    if (!email) return null;
    const db = loadDB();
    return (db.users || []).find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
  },
  ensureUser(user) {
    if (!user || !user.email) return null;
    const db = loadDB();
    if (!db.users) db.users = [];
    let existing = db.users.find(u => u.email.toLowerCase() === user.email.toLowerCase());
    if (!existing) {
      existing = {
        id: 'u_' + Date.now(),
        name: user.name || user.email.split('@')[0],
        email: user.email,
        initials: (user.name ? user.name.charAt(0) : user.email.charAt(0)).toUpperCase(),
        registeredAt: new Date().toISOString().split('T')[0],
        completedCourses: [],
        quizResults: []
      };
      db.users.push(existing);
      saveDB(db);

      if (window.FB_Sync) {
        window.FB_Sync.saveUser(existing);
      }
    }
    return existing;
  },
  addUser(userData) {
    const db = loadDB();
    if (!db.users) db.users = [];
    const email = userData.email.trim();
    if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      return { error: 'User already exists' };
    }
    const name = userData.name.trim();
    const newUser = {
      id: 'u_' + Date.now(),
      name: name,
      email: email,
      initials: (name ? name.charAt(0) : email.charAt(0)).toUpperCase(),
      registeredAt: new Date().toISOString().split('T')[0],
      completedCourses: [],
      quizResults: []
    };
    db.users.push(newUser);
    saveDB(db);

    if (window.FB_Sync) {
      window.FB_Sync.saveUser(newUser);
    }
    return newUser;
  },
  deleteUser(userId) {
    const db = loadDB();
    if (db.users) {
      db.users = db.users.filter(u => u.id !== userId);
      saveDB(db);
    }
    if (window.FB_Sync) {
      window.FB_Sync.deleteUser(userId);
    }
  },
  resetUserProgress(userId) {
    const db = loadDB();
    if (db.users) {
      const user = db.users.find(u => u.id === userId);
      if (user) {
        user.completedCourses = [];
        user.quizResults = [];
        saveDB(db);
        if (window.FB_Sync) {
          window.FB_Sync.saveUser(user);
        }
      }
    }
  },
  toggleCourseCompletion(email, courseId) {
    if (!email || !courseId) return false;
    const db = loadDB();
    let user = (db.users || []).find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      user = this.ensureUser({ email, name: email.split('@')[0] });
    }
    if (!user.completedCourses) user.completedCourses = [];
    const idx = user.completedCourses.indexOf(courseId);
    let isCompleted = false;
    if (idx > -1) {
      user.completedCourses.splice(idx, 1);
      isCompleted = false;
    } else {
      user.completedCourses.push(courseId);
      isCompleted = true;
    }
    saveDB(db);

    if (window.FB_Sync) {
      window.FB_Sync.saveUser(user);
    }
    return isCompleted;
  },
  isCourseCompleted(email, courseId) {
    if (!email || !courseId) return false;
    const user = this.getUserByEmail(email);
    return !!(user && user.completedCourses && user.completedCourses.includes(courseId));
  },
  saveQuizResult(email, result) {
    if (!email) return;
    const db = loadDB();
    let user = (db.users || []).find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      user = this.ensureUser({ email, name: email.split('@')[0] });
    }
    if (!user.quizResults) user.quizResults = [];
    const entry = {
      year: Number(result.year),
      score: Number(result.score),
      total: Number(result.total),
      percent: Math.round((result.score / result.total) * 100),
      date: new Date().toISOString().split('T')[0]
    };
    user.quizResults.push(entry);
    saveDB(db);

    if (window.FB_Sync) {
      window.FB_Sync.saveUser(user);
    }
    return entry;
  },
  resetAll() {
    localStorage.setItem(DB_KEY, JSON.stringify(SEED));
  }
};

