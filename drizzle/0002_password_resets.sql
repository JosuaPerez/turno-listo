CREATE TABLE password_resets (
  hash TEXT PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES shops(slug) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX password_resets_slug ON password_resets(slug);
--> statement-breakpoint
CREATE INDEX password_resets_expires ON password_resets(expires);
