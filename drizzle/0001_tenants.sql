CREATE TABLE shops (slug TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE sessions (hash TEXT PRIMARY KEY, slug TEXT NOT NULL REFERENCES shops(slug) ON DELETE CASCADE, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX sessions_expires ON sessions(expires);
--> statement-breakpoint
CREATE TABLE rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX rate_limits_expires ON rate_limits(expires);
--> statement-breakpoint
DELETE FROM queue_state;
