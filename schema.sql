-- D1 schema for Method Machine Studio (database: method-machine-studio)
CREATE TABLE IF NOT EXISTS waitlist (id INTEGER PRIMARY KEY AUTOINCREMENT, submitted_at TEXT NOT NULL, email TEXT NOT NULL, page TEXT, ip TEXT, user_agent TEXT);
CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY AUTOINCREMENT, submitted_at TEXT NOT NULL, candidate TEXT, name TEXT, email TEXT NOT NULL, work TEXT, source TEXT, mode TEXT, timed_out TEXT, answered TEXT, focus_events TEXT, character_preferred TEXT, hard_fails TEXT, aptitude_auto TEXT, report TEXT, answers TEXT, ip TEXT);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS institute_papers (id INTEGER PRIMARY KEY AUTOINCREMENT, submitted_at TEXT NOT NULL, roll TEXT, name TEXT, email TEXT NOT NULL, track TEXT, years TEXT, answers TEXT, dossier TEXT, ip TEXT);
CREATE INDEX IF NOT EXISTS institute_ip_time ON institute_papers (ip, submitted_at);
CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, submitted_at TEXT NOT NULL, r2_key TEXT NOT NULL, slot TEXT, name TEXT, size INTEGER, ip TEXT);
CREATE INDEX IF NOT EXISTS uploads_ip_time ON uploads (ip, submitted_at);
CREATE INDEX IF NOT EXISTS waitlist_ip_time ON waitlist (ip, submitted_at);
CREATE INDEX IF NOT EXISTS applications_ip_time ON applications (ip, submitted_at);
