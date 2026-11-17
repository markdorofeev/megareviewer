-- up
ALTER TABLE subscriptions ADD COLUMN paused_at timestamptz;

CREATE INDEX subscriptions_paused_at_idx ON subscriptions (paused_at) WHERE paused_at IS NOT NULL;
